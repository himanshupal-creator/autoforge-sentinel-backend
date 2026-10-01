# AutoForge Sentinel — Vercel-ready backend

Express API designed for Vercel with Neon PostgreSQL. Vercel supports Express backends; this version does not use local SQLite.

## Deploy
1. Push this folder to GitHub.
2. Import the repository into Vercel.
3. Add a Neon/Postgres integration or set `DATABASE_URL`.
4. Set `ALLOWED_ORIGIN` to your frontend URL (or `*` for testing).
5. Deploy.

## Local
```bash
npm install
npx vercel dev
```

## Endpoints
GET `/health`
GET `/api/dashboard`
POST `/api/sensors/packet`
GET `/api/sensors/packets`
GET `/api/sensors/latest/:machineId`
GET `/api/events`
POST `/api/events`
GET `/api/maintenance`
POST `/api/maintenance`
PATCH `/api/maintenance/:id`
GET `/api/batches`
POST `/api/batches`

The tables are initialized automatically on the first request.

This is a clean-room recreation of behavior exposed by the public AutoForge Sentinel demo, not the original private backend source.
