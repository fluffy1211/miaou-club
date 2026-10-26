import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
const origin = "http://localhost:43991";

test("Figue is found by searching her name in friends and from the 404 cat", async ({
  page,
  context,
}) => {
  const sessions = JSON.parse(
    await readFile(".cache/e2e-sessions.json", "utf8"),
  ) as Record<string, string>;
  const [name, ...value] = sessions.member.split("=");
  await context.addCookies([{ name, value: value.join("="), url: origin }]);
  await page.goto("/amis");
  await page.getByLabel("Chercher un pseudo").fill("Figue");
  await page.getByRole("button", { name: "Chercher", exact: true }).click();
  await expect(page).toHaveURL(/\/figue$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "Figue, le chat figue." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Lancer son jouet" }).click();
  await expect(page.getByAltText(/Figue, chat noir/)).toBeVisible();
  const missing = await page.goto("/ce-chat-n-existe-pas");
  expect(missing?.status()).toBe(404);
  await page.getByRole("link", { name: "Suivre le petit chat" }).click();
  await expect(page).toHaveURL(/\/figue$/);
});
