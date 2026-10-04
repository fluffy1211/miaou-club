import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import type { StorybookConfig } from "@storybook/react-vite";
const config: StorybookConfig = {
  stories: ["../src/components/**/*.stories.tsx"],
  addons: ["@storybook/addon-a11y"],
  framework: "@storybook/react-vite",
  staticDirs: ["../public"],
  viteFinal: (config) => ({
    ...config,
    plugins: [...(config.plugins ?? []), react(), tailwind()],
  }),
};
export default config;
