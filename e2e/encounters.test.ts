import type { BrowserContext } from "@playwright/test";
import { test, expect } from "./fixtures.js";
import { readFile, mkdir } from "node:fs/promises";
async function session(context: BrowserContext, role = "member") {
  const sessions = JSON.parse(
    await readFile(".cache/e2e-sessions.json", "utf8"),
  ) as Record<string, string>;
  const [name, ...value] = sessions[role].split("=");
  await context.addCookies([
    {
      name,
      value: value.join("="),
      url: "http://localhost:43991",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  return sessions;
}
async function readyPhoto(page: import("@playwright/test").Page) {
  await page.goto("/photo");
  await expect(
    page.getByRole("button", { name: "Choisir dans la galerie", exact: true }),
  ).toBeEnabled();
  await page
    .getByLabel("Choisir une photo dans la galerie")
    .setInputFiles(".cache/e2e-photo.png");
  await expect(
    page.getByRole("heading", { name: "Une nouvelle rencontre." }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Voir l’aperçu" }),
  ).toBeEnabled();
}
test("real upload, preview, publication, durable notebook, edit revocation and delete on mobile", async ({
  page,
  context,
  browser,
}, info) => {
  const sessions = await session(context);
  const title = "Museau " + info.project.name;
  await readyPhoto(page);
  await page.getByLabel("Un petit titre").fill(title);
  await page
    .getByLabel("Quelques mots")
    .fill("Une photo synthétique pour vérifier le carnet.");
  await page.getByLabel("Date de la rencontre").fill("2026-09-01");
  await mkdir(".cache/lot3-browser", { recursive: true });
  await page.screenshot({
    path: `.cache/lot3-browser/${info.project.name}-description.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "Voir l’aperçu" }).click();
  await expect(
    page.getByRole("heading", { name: "Prêt à rejoindre le carnet ?" }),
  ).toBeVisible();
  await expect(
    page.getByText("Public · membres du club", { exact: false }).last(),
  ).toBeVisible();
  await mkdir(".cache/lot3-browser", { recursive: true });
  await page.screenshot({
    path: `.cache/lot3-browser/${info.project.name}-preview.png`,
    fullPage: true,
  });
  const responsePromise = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/v1/encounters") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Publier la rencontre" }).click();
  const publication = await responsePromise;
  expect(publication.status()).toBe(201);
  await expect(page).toHaveURL(/\/rencontre\//);
  const publishedId = new URL(page.url()).pathname.split("/").at(-1)!;
  const published = await context.request.get(
    "/api/v1/encounters/" + publishedId,
  );
  expect(published.status()).toBe(200);
  const entry = (await published.json()).encounter;
  await expect(
    page.getByRole("heading", { name: title, exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: title, exact: true }),
  ).toBeVisible();
  const other = await browser.newContext();
  const [name, ...value] = sessions.reader.split("=");
  await other.addCookies([
    { name, value: value.join("="), url: "http://localhost:43991" },
  ]);
  try {
    const shared = await other.request.get(
      "http://localhost:43991" + entry.image,
    );
    expect(shared.status()).toBe(200);
    expect(shared.headers()["cache-control"]).toBe("no-store");
    await page.getByRole("button", { name: "Modifier la rencontre" }).click();
    await page.getByLabel("Un petit titre").fill(title + " privé");
    await page
      .getByLabel("Qui peut voir cette rencontre ?")
      .selectOption("private");
    await page
      .getByRole("button", { name: "Enregistrer les changements" })
      .click();
    await expect(
      page.getByRole("heading", { name: title + " privé", exact: true }),
    ).toBeVisible();
    expect(
      (
        await other.request.get("http://localhost:43991" + entry.image)
      ).status(),
    ).toBe(404);
    const persisted = await context.request.get(
      "/api/v1/encounters/" + entry.id,
    );
    const edited = (await persisted.json()).encounter;
    expect(edited.publishedAt).toBe(entry.publishedAt);
    expect(edited.image).toBe(entry.image);
    expect(edited.encounterDate).toBe("2026-09-01");
    await page.getByRole("link", { name: "Retour au carnet" }).click();
    await expect(
      page.getByText(title + " privé", { exact: true }),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByText(title + " privé", { exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `.cache/lot3-browser/${info.project.name}-notebook.png`,
      fullPage: true,
    });
    const mobileSize = page.viewportSize()!;
    await page.setViewportSize({ width: 1280, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `.cache/lot3-browser/${info.project.name}-desktop.png`,
      fullPage: true,
    });
    await page.setViewportSize(mobileSize);
    await page.getByRole("link", { name: title + " privé" }).click();
    await page.getByRole("button", { name: "Supprimer ma rencontre" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("button", { name: "Supprimer ma rencontre" }),
    ).toBeFocused();
    await page.getByRole("button", { name: "Supprimer ma rencontre" }).click();
    await page
      .getByRole("button", { name: "Confirmer la suppression" })
      .click();
    await expect(page).toHaveURL(/\/carnet$/);
    await expect(page.getByText(title + " privé", { exact: true })).toHaveCount(
      0,
    );
    expect((await context.request.get(entry.image)).status()).toBe(404);
    expect(
      (await context.request.get("/api/v1/encounters/" + entry.id)).status(),
    ).toBe(404);
  } finally {
    await other.close();
  }
});
test("camera opens only on explicit action; invalid file error and draft refresh are recoverable", async ({
  page,
  context,
}, info) => {
  await session(context);
  await page.goto("/photo");
  await expect(
    page.getByRole("button", { name: "Prendre une photo", exact: true }),
  ).toBeEnabled();
  const chooser = page.waitForEvent("filechooser");
  await page
    .getByRole("button", { name: "Prendre une photo", exact: true })
    .click();
  expect((await chooser).isMultiple()).toBe(false);
  await page.getByLabel("Choisir une photo dans la galerie").setInputFiles({
    name: "bad.png",
    mimeType: "image/png",
    buffer: Buffer.from("not an image"),
  });
  await expect(
    page.getByText("Choisis une photo JPEG, PNG ou WebP.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Voir l’aperçu" }),
  ).toBeDisabled();
  await page
    .getByLabel("Choisir une photo dans la galerie")
    .setInputFiles(".cache/e2e-photo.png");
  await expect(
    page.getByRole("button", { name: "Voir l’aperçu" }),
  ).toBeEnabled();
  await page
    .getByLabel("Un petit titre")
    .fill("Brouillon " + info.project.name);
  await page
    .getByLabel("Qui peut voir cette rencontre ?")
    .selectOption("private");
  await page.getByRole("button", { name: "Voir l’aperçu" }).click();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Prêt à rejoindre le carnet ?" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Brouillon " + info.project.name }),
  ).toBeVisible();
  await expect(
    page.getByText("Privé · toi uniquement", { exact: false }).last(),
  ).toBeVisible();
  await page.screenshot({
    path: `.cache/lot3-browser/${info.project.name}-draft.png`,
    fullPage: true,
  });
  // Discard through the server and browser, leaving no cross-test draft.
  const stored = await page.evaluate(
    () =>
      Object.entries(sessionStorage).find(([key]) =>
        key.startsWith("miaou-draft-"),
      )?.[1],
  );
  const m = JSON.parse(stored!).media;
  expect(
    (
      await context.request.delete("/api/v1/media/" + m.id, {
        headers: { origin: "http://localhost:43991" },
      })
    ).status(),
  ).toBe(200);
  await page.evaluate(() => sessionStorage.clear());
});
test("anonymous and restricted fixtures cannot upload or view another member's private preview", async ({
  context,
  browser,
}) => {
  const sessions = await session(context);
  const bytes = await readFile(".cache/e2e-photo.png");
  const r = await context.request.post("/api/v1/media", {
    headers: {
      origin: "http://localhost:43991",
      "content-type": "application/octet-stream",
    },
    data: bytes,
  });
  expect(r.status()).toBe(201);
  const m = (await r.json()).media;
  for (const role of ["anonymous", "reader", "unadmitted", "suspended"]) {
    const other = await browser.newContext();
    try {
      if (role !== "anonymous") {
        const [name, ...value] = sessions[role].split("=");
        await other.addCookies([
          { name, value: value.join("="), url: "http://localhost:43991" },
        ]);
      }
      const image = await other.request.get("http://localhost:43991" + m.image);
      expect(image.status()).toBe(role === "anonymous" ? 401 : 404);
      expect(image.headers()["cache-control"]).toBe("no-store");
      if (role !== "reader")
        expect(
          (
            await other.request.post("http://localhost:43991/api/v1/media", {
              headers: { origin: "http://localhost:43991" },
              data: bytes,
            })
          ).status(),
        ).toBe(role === "anonymous" ? 401 : 403);
    } finally {
      await other.close();
    }
  }
  expect(
    (
      await context.request.delete("/api/v1/media/" + m.id, {
        headers: { origin: "http://localhost:43991" },
      })
    ).status(),
  ).toBe(200);
});

test("publication still completes when browser session storage is disabled", async ({
  page,
  context,
}, info) => {
  await session(context, "reader");
  await page.addInitScript(() => {
    for (const name of ["getItem", "setItem", "removeItem"])
      Object.defineProperty(Storage.prototype, name, {
        value: () => {
          throw new DOMException("Storage disabled", "SecurityError");
        },
      });
  });
  await readyPhoto(page);
  const title = "Stockage navigateur refusé " + info.project.name;
  await page.getByLabel("Un petit titre").fill(title);
  await page
    .getByLabel("Qui peut voir cette rencontre ?")
    .selectOption("private");
  await page.getByRole("button", { name: "Voir l’aperçu" }).click();
  await page.getByRole("button", { name: "Publier la rencontre" }).click();
  await expect(page).toHaveURL(/\/rencontre\//);
  await expect(
    page.getByRole("heading", { name: title, exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Supprimer ma rencontre" }).click();
  await page.getByRole("button", { name: "Confirmer la suppression" }).click();
  await expect(page).toHaveURL(/\/carnet$/);
});
