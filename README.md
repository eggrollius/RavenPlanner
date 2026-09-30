# Raven Planner

Raven Planner builds conflict-free Carleton University timetables. The application is a React + TypeScript client, a small Express API, and PostgreSQL. The existing Python scraper remains in `RavenData/` and its API contract is preserved.

## Run with Docker

```bash
cp .env.example .env
docker compose up --build
```

Open <http://localhost:5000>. Compose runs exactly two services: `server` and `db`. PostgreSQL data is stored in the `raven-data` volume. The server creates its tables and indexes at startup.

Set `ACTIVE_TERM` and `ACTIVE_YEAR` to choose the catalog exposed to the planner. Change `POSTGRES_PASSWORD` outside local development. This setup is portable to any host with Docker Compose; the same server image and environment variables can also be deployed to AWS ECS, Azure Container Apps, or another container platform with managed PostgreSQL.

## Local development

Start PostgreSQL (or set `DATABASE_URL`), then:

```bash
npm install
npm run dev
```

Vite serves the client and proxies `/api` to the API on port 5000. Production uses `npm run build` and `npm start`.

## Verification

```bash
npm test
npm run typecheck
npm run build
```

The API tests run against an in-memory PostgreSQL-compatible database and exercise the legacy scraper lifecycle. Scheduler tests cover conflicts and valid schedule generation.

## Legacy scraper

The scraper remains a separate Python utility. Its request and response shapes for create, update, existence checks, search, list, and delete are accepted by the new API. Set `RAVEN_API_URL` (for example, `http://localhost:5000/api`) to point it at a deployment; scraper behavior and payloads are otherwise unchanged.
