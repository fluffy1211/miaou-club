import { test, expect } from "./fixtures.js";
import { readFile } from "node:fs/promises";

test("anonymous member pages are closed and public Astro/React notice renders", async ({
  page,
  request,
}) => {
  await page.goto("/figue");
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
    "/api/v1/profiles/%ZZ/encounters",
    "/api/v1/profiles/%E0%A4%A",
    "/media/%ZZ/image",
  ]) {
    const response = await request.get(path);
    expect(response.status()).toBe(400);
    expect(await response.json()).toEqual({ code: "invalid_request" });
    expect(response.headers()["cache-control"]).toBe("no-store");
  }
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
    await page.goto("/figue");
    const image = await context.request.get("/_astro/e2e-fixture.svg");
    expect(image.status()).toBe(role === "member" ? 200 : 403);
    expect(image.headers()["cache-control"]).toBe("no-store");
    if (role !== "member") {
      await expect(page).toHaveURL(/\/profil\?retour=/);
      expect((await context.request.get("/api/v1/access")).status()).toBe(403);
    } else {
      await expect(page).toHaveURL(/\/figue$/);
      await expect(page.getByRole("heading", { level: 1 })).toContainText(
        "Figue",
      );
      const response = await context.request.get("/api/v1/access");
      expect(response.status()).toBe(200);
      expect(response.headers()["cache-control"]).toBe("no-store");
    }
  }
});
