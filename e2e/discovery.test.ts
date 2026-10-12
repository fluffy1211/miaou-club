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
test("map pagination keeps the canvas and the explored viewport during loading and after appending a page", async ({
  page,
  context,
}, info) => {
  await login(context);
  const bytes = await readFile(".cache/e2e-photo.png");
  const uploaded = await context.request.post("/api/v1/media", {
    headers: {
      origin: "http://localhost:43991",
      "content-type": "application/octet-stream",
    },
    data: bytes,
  });
  expect(uploaded.status()).toBe(201);
  const media = (await uploaded.json()).media;
  const response = await context.request.post("/api/v1/encounters", {
    headers: {
      origin: "http://localhost:43991",
      "idempotency-key": crypto.randomUUID(),
    },
    data: {
      mediaId: media.id,
      title: "Viewport fixture " + info.project.name,
      encounterDate: "2026-10-06",
      visibility: "public",
      location: { size: 1000, x: 648, y: 6855 },
      locationMethod: "map",
    },
  });
  expect(response.status()).toBe(201);
  const entry = (await response.json()).encounter;
  // Transport double isolates viewport behavior; backend pagination is covered
  // against PostgreSQL separately. All content comes from a real synthetic upload.
  let release: () => void = () => {};
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requested = false;
  await page.route("**/api/v1/map*", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname !== "/api/v1/map") {
      await route.continue();
      return;
    }
    if (url.searchParams.has("after")) {
      requested = true;
      await pending;
      await route.fulfill({
        json: {
          encounters: [
            {
              ...entry,
              id: "00000000-0000-4000-8000-000000000001",
              title: "Second synthetic page",
            },
          ],
          next: null,
        },
      });
    } else
      await route.fulfill({
        json: { encounters: [entry], next: "synthetic-page-cursor" },
      });
  });
  try {
    await page.goto("/carte");
    const canvas = page.locator(".maplibregl-canvas");
    await expect(page.locator(".zone-map")).toHaveAttribute(
      "data-ready",
      "true",
    );
    await expect(page.locator(".zone-marker")).toHaveCount(1);
    const bounds = (await canvas.boundingBox())!;
    const x = bounds.x + bounds.width * 0.3,
      y = bounds.y + bounds.height * 0.3;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 80, y + 30, { steps: 8 });
    await page.mouse.up();
    // A DOM-rendered marker provides a browser-observable projection of the
    // viewport; pan/zoom must move it away from its initial centered position.
    const marker = page.locator(".zone-marker");
    const center = await canvas.boundingBox();
    await expect
      .poll(async () => {
        const b = await marker.boundingBox();
        return Math.abs(b!.x + b!.width / 2 - (center!.x + center!.width / 2));
      })
      .toBeGreaterThan(20);
    await page.getByRole("button", { name: "Zoom in", exact: true }).click();
    await expect(page.locator(".zone-map")).toHaveAttribute(
      "data-ready",
      "true",
    );
    const before = await marker.boundingBox();
    const beforeCanvas = await canvas.boundingBox();
    const original = await canvas.elementHandle();
    await page.getByRole("button", { name: "Voir la suite" }).click();
    await expect.poll(() => requested).toBe(true);
    await expect(canvas).toBeVisible();
    expect(await canvas.evaluate((node, old) => node === old, original)).toBe(
      true,
    );
    release();
    await expect(marker).toHaveText("2");
    await expect(
      page.getByRole("button", { name: "Voir la suite" }),
    ).toHaveCount(0);
    const after = await marker.boundingBox();
    const afterCanvas = await canvas.boundingBox();
    // Loading more may scroll the document; compare projection within the map.
    expect(
      Math.abs(after!.x - afterCanvas!.x - (before!.x - beforeCanvas!.x)),
    ).toBeLessThan(1);
    expect(
      Math.abs(after!.y - afterCanvas!.y - (before!.y - beforeCanvas!.y)),
    ).toBeLessThan(1);
    expect(await canvas.evaluate((node, old) => node === old, original)).toBe(
      true,
    );
  } finally {
    release();
    await context.request.delete("/api/v1/encounters/" + entry.id, {
      headers: { origin: "http://localhost:43991" },
    });
  }
});
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
  const geographicResources: string[] = [];
  page.on("request", (r) => {
    if (
      /\/_astro\/(?:location\.|ZoneMap\.|maplibre-gl).*\.js$/.test(
        new URL(r.url()).pathname,
      )
    )
      geographicResources.push(r.url());
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
  expect(geographicResources).toEqual([]);
  await page.getByLabel("Taille proposée").selectOption("500");
  await page
    .getByRole("button", { name: "Utiliser ma position actuelle" })
    .click();
  await expect(
    page.getByText(
      "Zone proposée. Vérifie qu’elle correspond à cette rencontre.",
    ),
  ).toBeVisible();
  await expect(page.locator(".zone-map")).toHaveAttribute("data-ready", "true");
  expect(geographicResources.some((url) => /\/location\./.test(url))).toBe(
    true,
  );
  expect(geographicResources.some((url) => /\/maplibre-gl\./.test(url))).toBe(
    true,
  );
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
test("home and notebook avoid geographic JavaScript; a failed geographic import leaves the photo flow usable", async ({
  page,
  context,
}, info) => {
  await login(context, "friend-b-" + info.project.name);
  await context.setGeolocation({
    longitude: 2.301234,
    latitude: 48.801234,
    accuracy: 10,
  });
  await context.grantPermissions(["geolocation"]);
  const geographicResources: string[] = [];
  page.on("request", (r) => {
    if (
      /\/_astro\/(?:location\.|ZoneMap\.|maplibre-gl).*\.js$/.test(
        new URL(r.url()).pathname,
      )
    )
      geographicResources.push(r.url());
  });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Les derniers mignons." }),
  ).toBeVisible();
  await page.goto("/carnet");
  await expect(
    page.getByRole("link", { name: "Ajouter une rencontre" }).first(),
  ).toBeVisible();
  expect(geographicResources).toEqual([]);
  await page.route("**/_astro/location.*.js", (route) => route.abort());
  await page.goto("/photo");
  await expect(
    page.getByRole("button", { name: "Choisir dans la galerie", exact: true }),
  ).toBeEnabled();
  await page
    .getByLabel("Choisir une photo dans la galerie")
    .setInputFiles(".cache/e2e-photo.png");
  await page
    .getByLabel("Un petit titre")
    .fill("Import indisponible synthétique");
  expect(geographicResources).toEqual([]);
  await page
    .getByRole("button", { name: "Utiliser ma position actuelle" })
    .click();
  await expect(
    page.getByText(
      "La localisation est indisponible. Tu peux publier sans lieu.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Utiliser ma position actuelle" }),
  ).toBeEnabled();
  await expect(page.locator(".zone-map")).toHaveCount(0);
  await page.getByRole("button", { name: "Voir l’aperçu" }).click();
  await expect(page.getByText("Sans lieu partagé.")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Publier la rencontre" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Effacer le brouillon" }).click();
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

for (const download of ["delayed", "failed"] as const) {
  test(`restored photo protects its location when the selected-zone download is ${download}`, async ({
    page,
    context,
  }, info) => {
    await login(context, "friend-a-" + info.project.name);
    await context.setGeolocation({
      longitude: 2.301234,
      latitude: 48.801234,
      accuracy: 10,
    });
    await context.grantPermissions(["geolocation"]);
    // Disable the browser cache before the first geographic download so the
    // return journey exercises an actual module request on both engines.
    let interceptSelection = false;
    let requested = false;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/*", async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (interceptSelection && /\/_astro\/location\.[^/]+\.js$/.test(path)) {
        requested = true;
        if (download === "failed") {
          await route.abort();
          return;
        }
        await gate;
      }
      await route.continue();
    });
    await page.goto("/photo");
    await expect(
      page.getByRole("button", {
        name: "Choisir dans la galerie",
        exact: true,
      }),
    ).toBeEnabled();
    await page
      .getByLabel("Choisir une photo dans la galerie")
      .setInputFiles(".cache/e2e-photo.png");
    await page
      .getByLabel("Un petit titre")
      .fill("Reprise synthétique " + download);
    await page
      .getByRole("button", { name: "Utiliser ma position actuelle" })
      .click();
    await expect(
      page.getByText(
        "Zone proposée. Vérifie qu’elle correspond à cette rencontre.",
      ),
    ).toBeVisible();
    const savedLocation = await page.evaluate(() => {
      const key = Object.keys(sessionStorage).find((key) =>
        key.startsWith("miaou-draft-"),
      )!;
      return JSON.parse(sessionStorage.getItem(key)!).draft.location;
    });
    await page
      .getByRole("link", { name: "Choisir une zone sur la carte" })
      .click();
    await expect(page.locator(".zone-map")).toHaveAttribute(
      "data-ready",
      "true",
    );
    await page
      .getByRole("button", { name: "Choisir la zone au centre" })
      .click();
    interceptSelection = true;
    try {
      await page.getByRole("button", { name: "Utiliser cette zone" }).click();
      await expect.poll(() => requested).toBe(true);
      await expect(page.getByLabel("Un petit titre")).toHaveValue(
        "Reprise synthétique " + download,
      );
      if (download === "delayed") {
        await expect(
          page.getByRole("button", { name: "Retirer le lieu" }),
        ).toBeDisabled();
        await expect(
          page.getByRole("button", { name: "Voir l’aperçu" }),
        ).toBeDisabled();
        release();
        await expect(
          page.getByRole("button", { name: "Retirer le lieu" }),
        ).toBeEnabled();
        await page.getByRole("button", { name: "Retirer le lieu" }).click();
        await page.getByRole("button", { name: "Voir l’aperçu" }).click();
        await expect(page.getByText("Sans lieu partagé.")).toBeVisible();
      } else {
        await expect(
          page.getByText(
            "La zone choisie n’a pas pu être chargée. Le lieu précédent est conservé. Choisis à nouveau une zone sur la carte.",
          ),
        ).toBeVisible();
        expect(
          await page.evaluate(() =>
            Object.keys(sessionStorage).some((key) =>
              key.startsWith("miaou-selected-cell-"),
            ),
          ),
        ).toBe(false);
        const restoredLocation = await page.evaluate(() => {
          const key = Object.keys(sessionStorage).find((key) =>
            key.startsWith("miaou-draft-"),
          )!;
          return JSON.parse(sessionStorage.getItem(key)!).draft.location;
        });
        expect(restoredLocation).toEqual(savedLocation);
        interceptSelection = false;
        await page.reload();
        await expect(
          page.getByRole("button", { name: "Voir l’aperçu" }),
        ).toBeEnabled();
        const reloadedLocation = await page.evaluate(() => {
          const key = Object.keys(sessionStorage).find((key) =>
            key.startsWith("miaou-draft-"),
          )!;
          return JSON.parse(sessionStorage.getItem(key)!).draft.location;
        });
        expect(reloadedLocation).toEqual(savedLocation);
      }
      await page.getByRole("button", { name: "Effacer le brouillon" }).click();
    } finally {
      release();
    }
  });
}
