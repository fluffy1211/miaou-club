import { defineConfig } from "drizzle-kit";
export default defineConfig({
  dialect: "postgresql",
  schema: "./server/src/infrastructure/db/schema.ts",
  out: "./server/drizzle",
});
