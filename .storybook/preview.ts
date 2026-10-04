import "../src/styles/global.css";
import "../public/fonts/fonts.css";
import type { Preview } from "@storybook/react-vite";
const preview: Preview = { parameters: { a11y: { test: "error" } } };
export default preview;
