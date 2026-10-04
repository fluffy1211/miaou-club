// Schema generation only. No real credentials or database connection are required.
import { createDatabase } from "./src/infrastructure/db/client.js";
import { createAuth } from "./src/infrastructure/auth/auth.js";
const { db } = createDatabase(
  "postgresql://schema:schema@127.0.0.1:5432/schema",
);
export const auth = createAuth(db, {
  secret: "schema-generation-only-placeholder-32-characters",
  baseURL: "http://localhost:4321",
});
