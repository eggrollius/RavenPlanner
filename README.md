# Raven Planner

Raven Planner builds conflict-free Carleton University timetables. The application is a React + TypeScript client, a small Express API, and PostgreSQL. The existing Python scraper remains in `RavenData/` and its API contract is preserved.

## Deploy to Heroku

The repository is configured for Heroku's Node.js buildpack. Heroku runs `npm run build` during the build phase and starts the web dyno with the command in `Procfile`.

Attach Heroku Postgres so that `DATABASE_URL` is set, then configure `ACTIVE_TERM` and `ACTIVE_YEAR` for the catalog exposed to the planner. The server creates its tables and indexes when the dyno starts. `PORT` is supplied automatically by Heroku.

Automatic deploys can continue to target `main`. The `Validate` GitHub Actions workflow has a stable `validate` check that runs for pull requests and pushes to `main`; once the Heroku setting **Wait for GitHub checks to pass before deploy** is enabled, that check can gate automatic deployment.

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

## Legacy scraper

The scraper remains a separate Python utility. Its request and response shapes for create, update, existence checks, search, list, and delete are accepted by the new API. Set `RAVEN_API_URL` (for example, `http://localhost:5000/api`) to point it at a deployment; scraper behavior and payloads are otherwise unchanged.
