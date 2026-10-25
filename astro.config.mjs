import { defineConfig } from "astro/config";
import node from "@astrojs/node";
import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";
export default defineConfig({
  output: "server",
  session: false,
  // Hosts allowed to set Request.url (Astro's origin check compares against it).
  // localhost covers the E2E and image smoke servers.
  security: {
    allowedDomains: [
      { hostname: "miaou-club.fr", protocol: "https" },
      { hostname: "*.miaou-club.fr", protocol: "https" },
      { hostname: "localhost" },
    ],
  },
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
