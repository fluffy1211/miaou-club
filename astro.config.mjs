import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";
export default defineConfig({
  output: "static",
  image: {
    domains: [
      "upload.wikimedia.org",
      "cdn2.thecatapi.com",
      "cdn.thecatapi.com",
    ],
  },
  vite: { plugins: [tailwindcss()] },
  devToolbar: { enabled: false },
});
