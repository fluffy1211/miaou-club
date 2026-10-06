import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

test("anonymous catalogue is closed and public Astro/React notice renders", async ({
  page,
  request,
}) => {
  await page.goto("/races");
  await expect(page).toHaveURL(/\/profil\?retour=/);
  await expect(
    page.getByRole("heading", { name: "Retrouve ton petit monde." }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Se connecter", exact: true }),
  ).toBeVisible();
  expect((await request.get("/api/v1/access")).status()).toBe(401);
  expect((await request.get("/api/ready")).status()).toBe(200);
  for (const path of [
    "/_astro/e2e-fixture.svg",
    "/_astro/e2e-fixture.%73vg",
    "/_image?href=anything",
  ]) {
    const response = await request.get(path);
    expect(response.status()).toBe(401);
    expect(response.headers()["cache-control"]).toBe("no-store");
  }
});

test("real session allows admitted member, refuses non-admitted and suspended fixtures", async ({
  page,
  context,
}) => {
  const sessions = JSON.parse(
    await readFile(".cache/e2e-sessions.json", "utf8"),
  ) as Record<string, string>;
  for (const role of ["unadmitted", "suspended", "member"]) {
    await context.clearCookies();
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
    await page.goto("/races");
    const image = await context.request.get("/_astro/e2e-fixture.svg");
    expect(image.status()).toBe(role === "member" ? 200 : 403);
    expect(image.headers()["cache-control"]).toBe("no-store");
    if (role !== "member") {
      await expect(page).toHaveURL(/\/profil\?retour=/);
      expect((await context.request.get("/api/v1/access")).status()).toBe(403);
    } else {
      await expect(page).toHaveURL(/\/races$/);
      await expect(
        page.getByRole("searchbox", { name: "Chercher une race" }),
      ).toBeVisible();
      await expect(
        page.getByRole("link", { name: "Abyssin", exact: true }),
      ).toBeVisible();
      const link = page.locator('a[href^="/race/"]').first();
      await link.click();
      await expect(page.locator("h1")).toBeVisible();
      const response = await context.request.get("/api/v1/access");
      expect(response.status()).toBe(200);
      expect(response.headers()["cache-control"]).toBe("no-store");
    }
  }
});
