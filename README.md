# Raven Planner

Raven Planner builds conflict-free Carleton University timetables. The application is a React + TypeScript client, a small Express API, PostgreSQL, and a TypeScript catalog scraper in `RavenData/`.

## Local development

Install **Node.js 22** (the version in `.nvmrc`), then run these commands from the repository root:

```bash
npm install
npm run dev
```

Open <http://localhost:5173>. That is the full React UI and Express API, backed by
a persistent local PostgreSQL database. No Docker, PostgreSQL installation,
`.env` file, accounts, scraper credentials, or production database access is
needed. `npm ci` also works for a clean install from the lockfile. The first
install needs Internet access; normal development uses the installed packages.

`dev` starts PGlite (PostgreSQL compiled to WebAssembly) on a free loopback port,
creates the same schema as production, and loads a synthetic catalog before
starting the API and Vite with hot reload. The API uses its normal `pg` driver and
SQL queries. PGlite's single PostgreSQL session serializes queries through its
socket adapter; use a full PostgreSQL server when testing database concurrency or
deployment behavior. The local database is only reachable from this computer.

Try adding **COMP 1405**, **MATH 1007**, and **PSYC 1001** together. Each of the
three demo catalogs (fall, summer, and winter in the selected year) has 34 sections
across these ten courses:

| Course | Sample data |
| --- | --- |
| COMP 1405, COMP 1406 | Two lectures, each with two tutorials |
| MATH 1007, MATH 1104 | Two lectures, each with two tutorials |
| PHYS 1001 | A lecture with two lab choices |
| PSYC 1001, ECON 1001 | Two lecture choices |
| BUSI 1001, STAT 2507 | Evening and late-afternoon lectures |
| CGSC 1001 | Online Unscheduled course with no fixed meeting time |

The names, instructors, CRNs, dates, and times are development examples, not a
live Carleton catalog. They include overlapping times and early/evening sections
so you can test section selection, schedule pagination, and time preferences.
Search uses an exact department and course number; other course codes return the
normal “No course found” error.

Data lives in the ignored `.local/postgres` directory and survives restarts.
Existing courses are preserved; an empty active term is automatically seeded.
Press **Ctrl+C** to stop the UI, API, and database together. Stop `dev` before
running either database maintenance command:

```bash
npm run db:seed   # Create the local database/catalog if missing; preserve edits
npm run db:reset  # Replace all local catalog data with the synthetic catalog
```

Both commands operate only on this repository's embedded database, even if
`DATABASE_URL` points elsewhere. A process lock prevents another development
server or maintenance command from opening the same files concurrently. A stale
lock left by a terminated process is recovered on the next start.

Optional settings come from your shell or Vite's `.env` / `.env.local` files;
shell values take precedence. `PORT` defaults to `5000` for the API and
`VITE_PORT` to `5173` for the UI; the proxy follows the API port automatically.
An occupied port causes startup to fail with a clear error. `ACTIVE_TERM` and
`ACTIVE_YEAR` select the initial catalog and seed all three seasons for that year;
they default to `FALL`, `2026`.
You do not need to copy `.env.example` for the default workflow.

To develop against your own PostgreSQL server, export `DATABASE_URL` and any
catalog/port settings, then run `npm run dev:external`. That command starts the
UI and API, creates the schema, and leaves your existing catalog data in place.
Production uses `npm run build` and `npm start`.

## Run with Docker

```bash
cp .env.example .env
docker compose up --build
```

Open <http://localhost:5000>. Compose runs exactly two services: `server` and `db`. PostgreSQL data is stored in the `raven-data` volume. The server automatically creates and migrates its tables and indexes at startup, including upgrading existing databases for multiple terms.

Users can choose fall, summer, and winter catalogs by term and year in the planner. Each catalog has its own course selections while the page is open. Set `ACTIVE_TERM` and `ACTIVE_YEAR` to choose the default catalog; they default to `FALL` and `2026`. The scraper automatically refreshes every supported term offered by Carleton Central and makes imported catalogs available in the selector. Change `POSTGRES_PASSWORD` outside local development. This setup is portable to any host with Docker Compose; the same server image and environment variables can also be deployed to AWS ECS, Azure Container Apps, or another container platform with managed PostgreSQL.

## Unscheduled sections

The scraper reads each lecture/tutorial's `Section Information` and publishes its
delivery label as `section_type`. The API stores that label on the section's
course row and returns it in search and catalog results, including sections with
no meeting rows. On server startup, `ensureSchema` automatically adds the nullable
column to existing databases before accepting requests. Existing records remain
`NULL` until a scrape supplies their actual labels; there is no data backfill.
A scrape without a label sends `null`, clearing any stale label, while API updates
that omit the field preserve its current value.

Both of Carleton's **Online Unscheduled** delivery types stay in generated
schedule options but do not occupy calendar time or affect conflict checks and
time/day preferences. Lectures and tutorials are classified independently. The
course picker identifies unscheduled sections, and each generated option lists
them above the calendar with course, section, CRN, and instructor. Missing delivery
labels or meeting times do not establish that a section is unscheduled; sections
with missing times are listed separately as awaiting meeting information.

This presentation follows [Fleming College's timetable guidance](https://flemingcollege.ca/PDF/Orientation/timetable-tips.pdf)
and [UW–La Crosse's Schedule Planner guidance](https://www.uwlax.edu/globalassets/offices-services/wings-help/students/class-schedule-in-calendar-view.pdf),
which keep asynchronous classes in a visible list outside the calendar grid.
[Carleton's delivery definitions](https://carleton.ca/registration/course-delivery-types/)
also make clear that unscheduled coursework still has deadlines and may have
in-person assessments; the list directs students to their course outlines.

## Verification

```bash
npm run validate
```

`validate` is the local and CI entry point for linting, type checking, unit and integration tests, and the production build. Use `npm test` for one test run or `npm run test:watch` while developing. The API tests run against an in-memory PostgreSQL-compatible database and exercise the scraper lifecycle. Local catalog tests also run the actual PGlite PostgreSQL engine through `pg`, exercising seed/reset behavior, active-term changes, concurrent API calls, and scheduling from the seeded data. Scraper tests compare against fixtures generated by the original Python parser, check API requests and response handling, publish through the Express API, and verify worker retries and shutdown. Scheduler tests cover conflicts and valid schedule generation, and UI integration tests cover the primary course-planning flow.

To exercise the complete product in a browser before pushing:

```bash
npx playwright install chromium  # Once per computer
npm run test:e2e
```

On Linux machines missing browser system libraries, use
`npx playwright install --with-deps chromium`. Agents with an installed Chromium
can instead set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to its absolute executable
path. Browser tests start their own full development stack on ports 5001/5174,
seed a temporary in-memory database, and stop everything on completion. They
exercise course search, lecture/tutorial selection, timetable rendering,
pagination, removal, term switching, unscheduled classes, and API error handling without mocked requests or changes
to your saved local database. CI runs these tests on Linux, macOS, and Windows.

To build both production containers and smoke-test the API and rendered client with a real PostgreSQL instance, run:

```bash
npm run test:containers
```

The command always removes its containers and test volume when it finishes. CI runs both validation commands before changes can be merged.

## Deploy to Heroku

The app uses the Heroku Chrome for Testing and Node.js buildpacks on `heroku-24`.
`Procfile` starts the Express server with `npm start` and the catalog worker with
`npm run worker`. `heroku-postbuild` compiles the server, worker, and client before
Heroku prunes development dependencies. Both processes run compiled JavaScript;
Python and `tsx` are not needed at runtime. Node 22 is pinned in `package.json`.
The Heroku release process automatically runs `npm run migrate` before new web
and worker dynos start. Server startup also runs the same idempotent migration for
Docker and other hosts. Existing course IDs and meeting rows are preserved while
the old globally unique CRN is replaced with uniqueness on `(term, year, crn)`.
Migration changes run in one transaction; a failure prevents the new server from
starting. No manual database command is needed. The server listens on Heroku's
assigned `PORT`.

The existing Heroku app, `raven-planner`, automatically deploys the GitHub `main`
branch. Merge the deployment changes into `main` to trigger a deployment; no
Heroku CLI push is needed. The existing app must use the Node.js buildpack and a
Node 22 compatible stack. `app.json` describes new apps and review apps; it does
not change the existing app's settings when `main` deploys.

Keep an existing database attachment: it supplies `DATABASE_URL`. Select the
default catalog with `ACTIVE_TERM` and `ACTIVE_YEAR`; these settings do not restrict
users or scraping to one term. `app.json` declares the buildpack,
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

### Enable the catalog worker on the existing app

1. Add `heroku-community/chrome-for-testing` **before** `heroku/nodejs` in the
   app's buildpacks, then deploy. The Chrome buildpack supplies matched `chrome`
   and `chromedriver` executables on `PATH`. Remove older separate Chrome and
   Chromedriver buildpacks if present.
2. Set `RAVEN_API_URL` to the deployed app's public `/api` URL if it
   differs from the default `https://www.ravenplanner.ca/api`. A worker dyno must
   use the public URL to reach the web dyno; it cannot use `localhost`.
   Existing `ACTIVE_TERM` and `ACTIVE_YEAR` settings continue to select the default
   catalog. No config-var change is needed to enable multiple terms.

3. Once the web dyno is healthy, enable **one** worker dyno in Resources, or run:

   ```bash
   heroku ps:scale worker=1 --app raven-planner
   heroku logs --tail --dyno worker --app raven-planner
   ```

The worker discovers and scrapes all available winter, summer, and fall terms
when it starts, prioritizing the configured default when offered. Terms can span
years, such as Fall 2026 and Winter 2027. A failed term is logged and skipped so
other terms can still refresh. The worker then waits 86,400 seconds (24 hours)
after each completed or failed run. Set the optional `RAVEN_SCRAPE_INTERVAL_SECONDS`
config var to change that wait. Runs are sequential and Chrome is closed after
each run. Dyno restarts also trigger a run; this is an elapsed-time refresh loop,
not a fixed wall-clock schedule. Invalid interval settings cause startup to fail.
The scraper uses Carleton's public timetable and does not require student
credentials. `SIGTERM` and `SIGINT` stop the loop and close Chrome.
Scale to `worker=0` to disable refreshing. Existing API access behavior is preserved.

Browser actions reacquire elements while waiting, retrying stale or temporarily
unavailable controls for up to 30 seconds. Set `RAVEN_BROWSER_WAIT_MS` (1–300,000
milliseconds) to adjust this limit for slower portal responses. Invalid
values fail before Chrome starts. Timeout errors identify the browser step,
current page URL (without credentials, query parameters or fragment), and page
title. Before each subject, the scraper
waits for the search form or returns to it; if that fails, it reopens the catalog
in the current session. A failed subject is logged as `Skipping subject ...`, and
the scraper continues to the next subject after up to three attempts. Its final
subject summary lists any failures. Successful subjects are retained and published even when another
subject fails; malformed individual courses are also skipped during publishing.
Initial navigation or term-discovery errors still fail the run; failures within one
catalog do not prevent other catalogs from refreshing. Any exhausted subject
retries, failed publishing operations, or failed catalogs make the overall run
exit with a failure status, after retaining successful imports.
After investigating a failed run, restart the worker to retry immediately instead
of waiting for the configured refresh interval:

```bash
heroku ps:restart worker --app raven-planner
```

## RavenData scraper

The scraper reads [Carleton's public timetable](https://central.carleton.ca/prod/bwysched.p_select_term?wsea_code=EXT),
avoiding the student SSO redirect that can immediately expire automated sessions.
It finds search controls by their labels and result tables by their form, rather
than absolute page positions or pixel widths. It retains subject order, course
and meeting fields, registration-section parsing, missing-field defaults, and
the check-by-CRN followed by create-or-update flow. Public results have 11 course
columns and may omit building and room assignments; these fields remain empty
when unavailable. Empty subjects complete as soon as the result page arrives.

The existence check and update both include the scraped term and year, so a CRN reused in another catalog
is a separate course. The scraper reads the portal's term options and selects
each supported term by code (`202630` for Fall 2026), so displayed labels and
month ranges do not affect selection. `ACTIVE_TERM` (`WINTER`, `SUMMER`, or `FALL`)
and `ACTIVE_YEAR` choose the default and scrape priority; the default is
**Fall 2026**. Invalid settings fail before Chrome starts. Unavailable terms
are skipped automatically, and existing stored catalogs remain accessible.
Each course retains only its last meeting row, as before. API existence checks,
creation, and CRN updates reject HTTP errors so failed writes are counted.
The database stores linked lab/tutorial registration lists as `TEXT`; startup
automatically widens existing `VARCHAR(255)` columns without truncating data.
Its ID-update helper still calls the legacy endpoint; the current Express API
only implements updates by CRN, which is what the scraper uses.

For a one-time run, install Google Chrome/Chromium and a matching Chromedriver on
`PATH`, set `RAVEN_API_URL` to the target API, then:

```bash
npm run build
RAVEN_API_URL=http://127.0.0.1:5000/api npm run scrape
```

For a live test that scrapes without publishing to the API, run:

```bash
npm run scrape -- --dry-run
tail -f logs/scrape.jsonl
```

Every run appends timestamped JSON records to `logs/scrape.jsonl`, with a unique
run ID, browser steps and durations, element retries, subject counts, recovery
attempts, publishing summaries, and failure details. Set `RAVEN_SCRAPE_LOG_FILE`
to choose another path. The log excludes entered credentials and URL tokens;
it does not capture page HTML, cookies, or screenshots. Log files are ignored by
Git. On Heroku the file is local to the dyno and disappears when it is replaced;
the existing console output remains available through Heroku logs.

Use `npm run scrape:dev` to run the TypeScript source during development. For
nonstandard browser installations, set `GOOGLE_CHROME_BIN` and `CHROMEDRIVER_PATH`
to executable paths. Locally, Selenium can discover/download a driver if one is
not already available. The normal web-only Docker image does not install Chrome;
the Heroku worker uses the Chrome for Testing buildpack. No Python dependencies
are required. `.env.example` documents the variables; export them in your shell
or supply them through your process manager (the scraper does not load `.env`).

## Catalog API

`GET /api/catalog` returns the default `term` and `year` plus a `catalogs` array
containing the default and all stored term/year pairs. Other course endpoints
accept `?term=WINTER&year=2027`; requests without a selector use the configured
default for compatibility. Supply both fields when selecting a catalog.
Creation and CRN updates also accept `term` and `year` in their JSON body. Query
and body selectors must agree when both are supplied. Invalid selectors return
HTTP 400. Lists, searches, existence checks, updates, and deletes all operate
within that catalog. The same CRN can exist in different terms or years, while
duplicates within one catalog retain the existing duplicate response.
