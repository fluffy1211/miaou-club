import { test, expect } from "@playwright/test";
test("shared React notice renders its closed and unavailable stories", async ({
  page,
}) => {
  page.on("pageerror", (error) =>
    console.error("Story preview error:", error.message),
  );
  for (const [story, message] of [
    ["closed", "L’accès au club est réservé aux membres admis."],
    ["unavailable", "Le club est temporairement indisponible."],
  ]) {
    await page.goto(
      `http://localhost:43992/iframe.html?id=${encodeURIComponent(`accès-notice--${story}`)}&viewMode=story`,
    );
    await expect(
      page.getByRole("heading", { name: "Miaou Club" }),
    ).toBeVisible();
    await expect(page.getByText(message)).toBeVisible();
    await expect(page.locator(".access-notice")).toHaveCSS(
      "background-color",
      "rgb(255, 255, 255)",
    );
    if (story === "unavailable")
      await expect(page.getByRole("alert")).toBeVisible();
  }
});
