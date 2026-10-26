import { test as base, expect } from "@playwright/test";

export { expect };

// Every page uses client:load islands. Interacting before they hydrate loses typed values
// or clicks (seen in webkit-mobile), so goto resolves once no island is waiting to hydrate.
export const test = base.extend({
  page: async ({ page }, use) => {
    const goto = page.goto.bind(page);
    page.goto = async (url, options) => {
      const response = await goto(url, options);
      await page.waitForFunction(
        () => !document.querySelector("astro-island[ssr]"),
      );
      return response;
    };
    await use(page);
  },
});
