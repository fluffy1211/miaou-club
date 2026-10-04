import { defineConfig } from "astro/config";
import node from "@astrojs/node";
import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";
export default defineConfig({
  output: "server",
  session: false,
  adapter: node({ mode: "standalone", bodySizeLimit: 65536 }),
  integrations: [react()],
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
