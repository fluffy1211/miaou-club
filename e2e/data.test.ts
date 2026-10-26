import type { BrowserContext } from "@playwright/test";
import { test, expect } from "./fixtures.js";
import { readFile, mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
const origin = "http://localhost:43991";
async function session(context: BrowserContext, role: string) {
  const sessions = JSON.parse(
    await readFile(".cache/e2e-sessions.json", "utf8"),
  );
  const [name, ...value] = sessions[role].split("=");
  await context.addCookies([
    {
      name,
      value: value.join("="),
      url: origin,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
}
test("report, audited private administration, protected export and account deletion through real mobile routes", async ({
  page,
  context,
  browser,
}, info) => {
  test.setTimeout(120000);
  await session(context, "data-" + info.project.name);
  const upload = await context.request.post("/api/v1/media", {
    headers: { origin, "content-type": "application/octet-stream" },
    data: await readFile(".cache/e2e-photo.png"),
  });
  expect(upload.status()).toBe(201);
  const photo = (await upload.json()).media;
  const published = await context.request.post("/api/v1/encounters", {
    headers: { origin, "idempotency-key": randomUUID() },
    data: {
      mediaId: photo.id,
      title: "Souvenir données " + info.project.name,
      description: "Un chat synthétique.",
      encounterDate: "2026-10-06",
      visibility: "public",
    },
  });
  expect(published.status()).toBe(201);
  const entry = (await published.json()).encounter;
  const reader = await browser.newContext();
  const admin = await browser.newContext();
  try {
    await session(reader, "reader");
    const readerPage = await reader.newPage();
    await readerPage.goto(origin + "/rencontre/" + entry.id);
    await readerPage
      .getByLabel("Motif du signalement")
      .fill("Vérification synthétique " + info.project.name);
    await readerPage
      .getByRole("button", { name: "Signaler cette rencontre" })
      .click();
    await expect(readerPage.getByRole("status")).toContainText(
      "Signalement enregistré",
    );
    const edited = await context.request.patch(
      "/api/v1/encounters/" + entry.id,
      {
        headers: { origin },
        data: {
          title: entry.title,
          description: entry.description,
          encounterDate: entry.encounterDate,
          visibility: "private",
          revision: 1,
        },
      },
    );
    expect(edited.status()).toBe(200);
    await session(admin, "admin");
    const adminPage = await admin.newPage();
    await adminPage.goto(origin + "/administration");
    await adminPage
      .getByRole("listitem")
      .filter({ hasText: "Vérification synthétique " + info.project.name })
      .getByRole("button", { name: "Traiter ce signalement" })
      .click();
    await adminPage
      .getByLabel("Motif de consultation ou de décision")
      .fill("Examiner le dossier synthétique");
    await adminPage
      .getByRole("button", { name: "Consulter le contenu signalé" })
      .click();
    await expect(
      adminPage.getByRole("heading", { name: entry.title }),
    ).toBeVisible();
    await expect(
      adminPage.getByAltText("Polaroid de la rencontre signalée"),
    ).toBeVisible();
    expect((await admin.request.get(origin + entry.image)).status()).toBe(404);
    await mkdir(".cache/lot5-browser", { recursive: true });
    await adminPage.screenshot({
      path: ".cache/lot5-browser/" + info.project.name + "-administration.png",
      fullPage: true,
    });
    await adminPage
      .getByRole("button", { name: "Masquer", exact: true })
      .click();
    await expect(adminPage.getByRole("status")).toContainText(
      "Décision enregistrée",
    );
    await page.goto("/donnees");
    await expect(
      page.getByRole("heading", { name: "Tes données", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Demander ma copie" }).click();
    await expect(page.getByRole("status")).toContainText("Copie demandée");
    await expect
      .poll(
        async () => {
          const response = await context.request.get("/api/v1/me/exports");
          const data = await response.json();
          return data.exports[0]?.state;
        },
        { timeout: 75000, intervals: [1000, 3000, 5000] },
      )
      .toBe("ready");
    await page.getByRole("button", { name: "Actualiser mes copies" }).click();
    await expect(
      page.getByRole("button", { name: "Télécharger ma copie" }),
    ).toBeVisible();
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Télécharger ma copie" }).click();
    expect((await download).suggestedFilename()).toBe("miaou-donnees.zip");
    await page.screenshot({
      path: ".cache/lot5-browser/" + info.project.name + "-donnees.png",
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.getByLabel("Écris SUPPRIMER pour confirmer").fill("SUPPRIMER");
    await page
      .getByRole("button", { name: "Supprimer définitivement mon compte" })
      .click();
    await expect(page).toHaveURL(/compte=supprime/);
    expect((await context.request.get(entry.image)).status()).toBe(401);
    expect((await reader.request.get(origin + entry.image)).status()).toBe(404);
  } finally {
    await reader.close();
    await admin.close();
  }
});

test("personal data page remains available after suspension, ordinary member cannot enter administration APIs", async ({
  page,
  context,
}) => {
  await session(context, "suspended");
  await page.goto("/donnees");
  await expect(
    page.getByRole("heading", { name: "Tes données", exact: true }),
  ).toBeVisible();
  expect((await context.request.get("/api/v1/me/exports")).status()).toBe(200);
  expect((await context.request.get("/api/v1/admin/reports")).status()).toBe(
    403,
  );
  await page.getByLabel("Écris SUPPRIMER pour confirmer").focus();
  await expect(page.getByLabel("Écris SUPPRIMER pour confirmer")).toBeFocused();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
