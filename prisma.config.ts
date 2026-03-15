// In local dev, load .env so DATABASE_URL is available.
// In Docker/production (Render), DATABASE_URL is injected as a runtime env var
// and dotenv is intentionally skipped (no .env file exists in the container).
if (process.env.NODE_ENV !== "production") {
    require("dotenv/config");
}

import { defineConfig, env } from "prisma/config";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
    throw new Error(
        "❌ DATABASE_URL environment variable is not set. " +
        "In production (Render), add it under Environment Variables in the Render dashboard."
    );
}

export default defineConfig({
    schema: "prisma/schema.prisma",
    migrations: {
        path: "prisma/migrations",
    },
    datasource: {
        url: env("DATABASE_URL"),
    },
});