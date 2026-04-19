import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./lib/db/schema.ts",
  out: "./migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_ADMIN_URL ?? "postgres://edict_admin:dev@127.0.0.1:5432/edict",
  },
  strict: true,
  verbose: true,
});
