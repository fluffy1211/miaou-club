import { test, expect, type BrowserContext } from "@playwright/test";
import { readFile, mkdir } from "node:fs/promises";
async function login(context: BrowserContext, role = "reader") {
  const sessions = JSON.parse(
    await readFile(".cache/e2e-sessions.json", "utf8"),
  );
  const [name, ...value] = sessions[role].split("=");
  await context.addCookies([
    { name, value: value.join("="), url: "http://localhost:43991" },
  ]);
}
test("local discovery and coarse GPS flow: action only, no precise request/storage, profile, map fallback and withdrawal", async ({
  page,
  context,
}, info) => {
  await login(context);
  await context.setGeolocation({
    longitude: 2.301234,
    latitude: 48.801234,
    accuracy: 10,
  });
  await context.grantPermissions(["geolocation"]);
  await page.addInitScript(() => {
    const original = navigator.geolocation.getCurrentPosition.bind(
      navigator.geolocation,
    );
    Object.assign(window, { geoCalls: 0 });
    navigator.geolocation.getCurrentPosition = (...args) => {
      Object.assign(window, {
        geoCalls: (window as unknown as { geoCalls: number }).geoCalls + 1,
      });
      original(...args);
    };
  });
  const foreign: string[] = [];
  page.on("request", (r) => {
    if (!new URL(r.url()).hostname.match(/^(localhost|127\.0\.0\.1)$/))
      foreign.push(r.url());
  });
  await page.goto("/photo");
  await expect(
    page.getByRole("button", { name: "Choisir dans la galerie", exact: true }),
  ).toBeEnabled();
  await page
    .getByLabel("Choisir une photo dans la galerie")
    .setInputFiles(".cache/e2e-photo.png");
  await page
    .getByLabel("Un petit titre")
    .fill("Zone synthétique " + info.project.name);
  expect(
    await page.evaluate(
      () => (window as unknown as { geoCalls: number }).geoCalls,
    ),
  ).toBe(0);
  await page.getByLabel("Taille proposée").selectOption("500");
  await page
    .getByRole("button", { name: "Utiliser ma position actuelle" })
    .click();
  await expect(
    page.getByText(
      "Zone proposée. Vérifie qu’elle correspond à cette rencontre.",
    ),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => (window as unknown as { geoCalls: number }).geoCalls,
    ),
  ).toBe(1);
  const saved = await page.evaluate(() => JSON.stringify(sessionStorage));
  expect(saved).not.toContain("2.301234");
  expect(saved).not.toContain("48.801234");
  await page.getByRole("button", { name: "Voir l’aperçu" }).click();
  await expect(page.getByText(/Zone de 500 m de côté/)).toBeVisible();
  const response = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/v1/encounters") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Publier la rencontre" }).click();
  const r = await response;
  expect(r.status()).toBe(201);
  expect(r.request().postData()).not.toContain("2.301234");
  expect(r.request().postData()).not.toContain("48.801234");
  await expect(page).toHaveURL(/\/rencontre\//);
  const entryId = new URL(page.url()).pathname.split("/").at(-1)!;
  const e = (
    await (await context.request.get("/api/v1/encounters/" + entryId)).json()
  ).encounter;
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Les derniers mignons." }),
  ).toBeVisible();
  await expect(page.getByText(e.title).first()).toBeVisible();
  await mkdir(".cache/lot4-browser", { recursive: true });
  await page.screenshot({
    path: `.cache/lot4-browser/${info.project.name}-home.png`,
    fullPage: true,
  });
  await page.goto("/profil/synthetic_reader");
  await expect(page.getByText("@synthetic_reader")).toBeVisible();
  await expect(page.locator(".public-profile")).toHaveClass(
    /account-color-corail/,
  );
  await expect(page.getByText("Profil synthétique du club.")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Profil", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await expect(page.getByText(e.title)).toBeVisible();
  await page.screenshot({
    path: `.cache/lot4-browser/${info.project.name}-profile.png`,
    fullPage: true,
  });
  await page.goto("/carte");
  await expect(
    page.getByRole("heading", {
      name: "Liste alternative des rencontres localisées",
    }),
  ).toBeVisible();
  await expect(page.getByText(e.title)).toBeVisible();
  await expect(page.locator(".zone-marker")).toHaveCount(1);
  await expect(page.locator(".zone-map")).toHaveAttribute("data-ready", "true");
  await expect(page.getByText(/fond local simplifié/)).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await mkdir(".cache/lot4-browser", { recursive: true });
  await page.screenshot({
    path: `.cache/lot4-browser/${info.project.name}-map.png`,
    fullPage: true,
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({
    path: `.cache/lot4-browser/${info.project.name}-desktop.png`,
    fullPage: true,
  });
  expect(foreign).toEqual([]);
  await page.goto("/rencontre/" + e.id);
  await page.getByRole("button", { name: "Modifier le souvenir" }).click();
  await page.getByLabel("Taille de la zone").selectOption("2000");
  await page
    .getByRole("button", { name: "Enregistrer les changements" })
    .click();
  await expect(page.getByText(/Zone de 2 km de côté/)).toBeVisible();
  await page.getByRole("button", { name: "Modifier le souvenir" }).click();
  await page.getByRole("button", { name: "Retirer le lieu" }).click();
  const edited = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/v1/encounters/" + e.id) &&
      r.request().method() === "PATCH",
  );
  await page
    .getByRole("button", { name: "Enregistrer les changements" })
    .click();
  expect((await edited).status()).toBe(200);
  await expect(
    page.getByRole("button", { name: "Modifier le souvenir" }),
  ).toBeVisible();
  const map = await context.request.get("/api/v1/map");
  expect(
    (await map.json()).encounters.some((x: { id: string }) => x.id === e.id),
  ).toBe(false);
  await page.getByRole("button", { name: "Supprimer ma rencontre" }).click();
  await page.getByRole("button", { name: "Confirmer la suppression" }).click();
});
test("denied geolocation permits publication without place and restricted discovery APIs refuse access", async ({
  page,
  context,
  browser,
}) => {
  await login(context);
  await page.addInitScript(() => {
    navigator.geolocation.getCurrentPosition = (_success, error) =>
      error?.({
        code: 1,
        message: "synthetic denial",
        PERMISSION_DENIED: 1,
        POSITION_UNAVAILABLE: 2,
        TIMEOUT: 3,
      });
  });
  await page.goto("/photo");
  await expect(
    page.getByRole("button", { name: "Choisir dans la galerie", exact: true }),
  ).toBeEnabled();
  await page
    .getByLabel("Choisir une photo dans la galerie")
    .setInputFiles(".cache/e2e-photo.png");
  await page
    .getByRole("button", { name: "Utiliser ma position actuelle" })
    .click();
  await expect(
    page.getByText(/Position refusée ou indisponible/),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Voir l’aperçu" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Effacer le brouillon" }).click();
  for (const role of ["anonymous", "unadmitted", "suspended"]) {
    const c = await browser.newContext();
    try {
      if (role !== "anonymous") await login(c, role);
      for (const path of [
        "/api/v1/encounters",
        "/api/v1/map",
        "/api/v1/map/contours",
        "/api/v1/profiles/synthetic_reader",
        "/api/v1/profiles/synthetic_reader/encounters",
      ]) {
        const r = await c.request.get("http://localhost:43991" + path);
        expect(r.status()).toBe(role === "anonymous" ? 401 : 403);
        expect(r.headers()["cache-control"]).toBe("no-store");
      }
    } finally {
      await c.close();
    }
  }
});
test("manual map selection preserves the draft and publishes only the selected cell", async ({
  page,
  context,
}, info) => {
  await login(context);
  await page.goto("/photo");
  await expect(
    page.getByRole("button", { name: "Choisir dans la galerie", exact: true }),
  ).toBeEnabled();
  await page
    .getByLabel("Choisir une photo dans la galerie")
    .setInputFiles(".cache/e2e-photo.png");
  const title = "Zone manuelle " + info.project.name;
  await page.getByLabel("Un petit titre").fill(title);
  await page
    .getByRole("link", { name: "Choisir une zone sur la carte" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Choisir un lieu" }),
  ).toBeVisible();
  await page.getByLabel("Taille de la zone à choisir").selectOption("500");
  await expect(page.locator(".maplibregl-canvas")).toBeVisible();
  await page.locator(".maplibregl-canvas").click();
  await page.getByRole("button", { name: "Utiliser cette zone" }).click();
  await expect(page.getByLabel("Un petit titre")).toHaveValue(title);
  await expect(page.getByText(/Zone de 500 m de côté/)).toBeVisible();
  await page.getByRole("button", { name: "Voir l’aperçu" }).click();
  const publication = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/v1/encounters") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Publier la rencontre" }).click();
  const r = await publication;
  expect(r.status()).toBe(201);
  expect(r.request().postDataJSON().locationMethod).toBe("map");
  await expect(page).toHaveURL(/\/rencontre\//);
  await expect(
    page.getByRole("heading", { name: title, exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Supprimer ma rencontre" }).click();
  await page.getByRole("button", { name: "Confirmer la suppression" }).click();
});
