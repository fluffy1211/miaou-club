import { test, expect } from "@playwright/test";
test("shared React notice renders its closed and unavailable stories", async ({
  page,
}) => {
  page.on("pageerror", (error) =>
    console.error("Story preview error:", error.message),
  );
  for (const [story, heading, message] of [
    ["closed", "Accès réservé.", "Le club est réservé aux membres admis."],
    [
      "unavailable",
      "Le club fait une pause.",
      "Il est temporairement indisponible.",
    ],
  ]) {
    await page.goto(
      `http://localhost:43992/iframe.html?id=${encodeURIComponent(`accès-notice--${story}`)}&viewMode=story`,
    );
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
    await expect(page.getByText(message)).toBeVisible();
    // Shared action styles load in Storybook: 44 px touch target.
    await expect(page.getByRole("link", { name: "Se connecter" })).toHaveCSS(
      "min-height",
      "44px",
    );
    if (story === "unavailable")
      await expect(page.getByRole("alert")).toBeVisible();
  }
});
