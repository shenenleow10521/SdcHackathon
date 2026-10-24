# HalaTuju on Replit

## Stack and layout

Keep the imported structure: Node.js 22, TypeScript, Express, and the existing vanilla JavaScript frontend in `web/`. The server serves both the frontend and `/api` routes.

## Running

- Click **Run** to start the **Start application** workflow (`npm run dev`).
- The server binds to `0.0.0.0:5000`; `.replit` sets `PORT=5000`.
- `/` is the landing page; `/app` is the career planner; `/api/health` reports database and service status.
- In this Replit, `DATABASE_URL` connects the app to PostgreSQL. Startup creates the schema, applies migrations, and seeds the sample data automatically. The successful health check reports `db.kind=pg` and knowledge-base version 1. If running without `DATABASE_URL` elsewhere, the existing fallback is on-disk PGlite at `data/pglite`.
- `npm start` runs the server without the development watcher.
- `npm run check` runs TypeScript checks and the automated tests.
- With the workflow running, `npx tsx scripts/smoke-api.ts https://$REPLIT_DEV_DOMAIN` runs the existing read-only API smoke checks.

## Current service configuration

This Replit has configured AI and embedding credentials and Replit-managed Clerk. The health check confirms Gemini and RunPod are available. `SCOUT_SCHEDULE=on` enables the existing daily market-research scheduler.

- Replit-managed Clerk is provisioned for this app. Clerk sessions secure the API and profile ownership; the Priya demo remains available to visitors.
- Visitors can upload a CV as guests without creating a Clerk account. A signed, HttpOnly guest cookie scopes the guest profile to that browser; the existing **Delete my data** option is available for guest data as well.
- `SESSION_SECRET` signs guest cookies. Replit Secrets already contains this setting; configure a strong random value when running the app in a different environment.
- When deploying, keep the Clerk proxy middleware mounted before Express body parsers. It is required for the production Clerk proxy and is a no-op in development.
- Optional provider settings are listed in `.env.example`.
- Do not commit `.env` or credentials. Clerk user IDs are stored as text; the migration preserves older UUID-form owner IDs but does not transfer ownership between identity providers.
- Keep the existing PostgreSQL database unless the user explicitly requests a database change.
