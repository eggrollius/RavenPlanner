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
npm ci
npm run dev
```

Vite serves the client and proxies `/api` to the API on port 5000. Production uses `npm run build` and `npm start`.

## Verification

```bash
npm run validate
```

`validate` is the single local and CI entry point for linting, type checking, unit and integration tests, and the production build. Use `npm test` for one test run or `npm run test:watch` while developing. The API tests run against an in-memory PostgreSQL-compatible database and exercise the legacy scraper lifecycle. Scheduler tests cover conflicts and valid schedule generation, and UI integration tests cover the primary course-planning flow.

To build both production containers and smoke-test the API and rendered client with a real PostgreSQL instance, run:

```bash
npm run test:containers
```

The command always removes its containers and test volume when it finishes. CI runs both validation commands before changes can be merged.

## Deploy to Heroku

The app uses the Heroku Node.js buildpack on `heroku-24`. `Procfile` starts the
Express server with `npm start`; `heroku-postbuild` compiles the server and client
before Heroku prunes development dependencies. Node 22 is pinned in `package.json`.
The server listens on Heroku's assigned `PORT` and creates its database schema at
startup; the old Flask release and worker processes are no longer required.

The existing Heroku app, `raven-planner`, automatically deploys the GitHub `main`
branch. Merge the deployment changes into `main` to trigger a deployment; no
Heroku CLI push is needed. The existing app must use the Node.js buildpack and a
Node 22 compatible stack. `app.json` describes new apps and review apps; it does
not change the existing app's settings when `main` deploys.

Keep an existing database attachment: it supplies `DATABASE_URL`. Select the
catalog with `ACTIVE_TERM` and `ACTIVE_YEAR`. `app.json` declares the buildpack,
configuration defaults, and a paid PostgreSQL add-on for a new Heroku app.
The server detects Heroku's `DYNO` environment variable and uses the Heroku Postgres
Node configuration: `ssl: { rejectUnauthorized: false }`. This requires an encrypted
connection while accepting Heroku's database certificates, whose issuer isn't
trusted by Node. It does not authenticate the database certificate. This Heroku
configuration assumes `DATABASE_URL` comes from the Heroku Postgres add-on;
revisit the trust configuration before switching to another database provider.
The explicit configuration takes precedence over existing `PGSSLMODE` values and
SSL parameters in `DATABASE_URL`, so existing apps need no config-var changes.
Local development and Docker retain PostgreSQL's default SSL behavior.

After deployment, check for `Raven Planner listening on ...` in the logs and
validate `/api/health` and the planner. An empty database needs catalog data before
course search returns results.

The Python scraper runs separately with `RAVEN_API_URL` pointing to the Heroku
app's `/api` endpoint. The web build does not install its Python dependencies.

## Legacy scraper

The scraper remains a separate Python utility. Its request and response shapes for create, update, existence checks, search, list, and delete are accepted by the new API. Set `RAVEN_API_URL` (for example, `http://localhost:5000/api`) to point it at a deployment; scraper behavior and payloads are otherwise unchanged.
