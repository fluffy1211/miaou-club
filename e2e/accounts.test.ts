import { test, expect } from "@playwright/test";
test("admitted signup without verification, profile persistence, logout and protected return", async ({
  page,
  context,
}, testInfo) => {
  const email = `new-${testInfo.project.name}@example.test`;
  await page.goto("/compte");
  await page.getByLabel("Ton nom affiché").fill("Synthetic member");
  await page.getByLabel("Ton e-mail", { exact: true }).fill(email);
  await page
    .getByLabel("Ton mot de passe", { exact: true })
    .fill("synthetic-ui-password-long");
  await expect(page.getByRole("checkbox")).not.toBeChecked();
  await page
    .getByRole("button", { name: "Créer mon compte", exact: true })
    .click();
  await expect(page).toHaveURL(/\/compte$/);
  await page.getByRole("checkbox").check();
  await page
    .getByRole("button", { name: "Créer mon compte", exact: true })
    .click();
  await expect(page).toHaveURL(/\/profil$/);
  await expect(
    page.getByRole("heading", { name: "Mon profil", exact: true }),
  ).toBeVisible();
  expect((await context.request.get("/api/v1/access")).status()).toBe(200);
  await page
    .getByLabel("Identifiant public")
    .fill(`member_${testInfo.project.name.replaceAll("-", "_")}`);
  await page
    .getByLabel("Nom affiché", { exact: true })
    .fill("Synthetic renamed");
  await page.getByRole("button", { name: "Enregistrer le profil" }).click();
  await expect(page.getByRole("status")).toContainText("Profil enregistré.");
  await page.reload();
  await expect(page.getByLabel("Nom affiché", { exact: true })).toHaveValue(
    "Synthetic renamed",
  );
  await expect(page.getByLabel("Identifiant public")).toHaveAttribute(
    "readonly",
    "",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page
    .getByRole("button", { name: "Se déconnecter", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Retrouve ton petit monde." }),
  ).toBeVisible();
  expect((await context.request.get("/api/v1/me")).status()).toBe(401);
  await page.goto("/figue");
  await expect(page).toHaveURL(/\/profil\?retour=/);
  await page.getByLabel("Ton e-mail", { exact: true }).fill(email);
  await page
    .getByLabel("Ton mot de passe", { exact: true })
    .fill("synthetic-ui-password-long");
  await page.getByRole("button", { name: "Se connecter", exact: true }).click();
  await expect(page).toHaveURL(/\/figue$/);
});
test("non admitted signup and external return refuse without exposing group content", async ({
  page,
  context,
}) => {
  await page.goto("/compte");
  await page.getByLabel("Ton nom affiché").fill("Synthetic outsider");
  await page
    .getByLabel("Ton e-mail", { exact: true })
    .fill("outsider@example.test");
  await page
    .getByLabel("Ton mot de passe", { exact: true })
    .fill("synthetic-ui-password-long");
  await page.getByRole("checkbox").check();
  await page
    .getByRole("button", { name: "Créer mon compte", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "L’action n’a pas abouti",
  );
  expect((await context.request.get("/api/v1/access")).status()).toBe(401);
  await page.goto("/profil?retour=https%3A%2F%2Foutside.example.test");
  await expect(
    page.getByRole("heading", { name: "Retrouve ton petit monde." }),
  ).toBeVisible();
});
