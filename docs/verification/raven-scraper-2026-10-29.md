# Live RavenData verification — October 29, 2026

The live scraper finished with **exit status 0**, importing **9,419 course sections** across **3 catalogs and 390 subject searches**, with **zero failed subjects, catalogs, or publishing operations**.

Run: October 29, 2026, 01:29:36–01:41:21 EDT (America/Toronto). Duration: 11.7 minutes. Source commit: `71766cfc49eb59961fd51358af47de8a865281eb`. The [machine-readable evidence](raven-scraper-2026-10-29.json) includes the run ID, source hashes, timestamps, log hash, API counts, database integrity checks, and publishing summaries. Source hashes were checked again after the run.

## Reproduction and fix

The original scraper reached the student sign-in page with the supplied environment credentials, then received `UnexpectedAlertOpenError: Session timeout occurred` and landed on the SSO sign-out page. Before login testing, Chromium's trust store needed the managed environment's supplied proxy CA; certificate verification remained enabled.

The fix reads [Carleton's public timetable](https://central.carleton.ca/prod/bwysched.p_select_term?wsea_code=EXT), which offers the same three catalog terms without a student session. The live page also exposed outdated absolute XPath selectors, table dimensions, and differences in the public course rows. Search controls now use their labels; the parser accepts the public 11-column format and omitted room assignments.

The first public run exposed a navigation race: separate result-table and Return to Search queries could straddle navigation and falsely report an empty subject. Both markers are now read in one completed-page DOM snapshot. A separate real Chromium check with delayed navigation and streamed result rows retained both the first and last rows.

Subjects retry up to three times. This completed run required no retries. Exhausted retries or failed publishing operations make the overall run fail after successful data is retained. HTTP errors from course-existence checks and CRN updates are counted as failures.

The live Winter import also exposed four PHYS 1004 registration lists of 335 characters, exceeding the existing database limit. The schema migration widens `also_register_in` to `TEXT` without truncation; a real PostgreSQL container test verifies the old schema upgrade and the long-list write.

## Local database and API proof

The target was the local Docker PostgreSQL 17 development database `ravenplanner-dev-db-1/ravenplanner`, containing 9,415 sections from earlier diagnostic runs before this clean rerun. Its Express API was `http://127.0.0.1:5000/api`. This was a live scrape with publishing enabled, not a dry run or a seeded catalog.

| Catalog | Subjects completed | Parsed sections | Added | Updated | PostgreSQL sections | Meetings |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| FALL 2026 | 142 | 4,221 | 0 | 4,221 | 4,221 | 4,219 |
| WINTER 2027 | 141 | 4,130 | 4 | 4,126 | 4,130 | 4,120 |
| SUMMER 2026 | 107 | 1,068 | 0 | 1,068 | 1,068 | 1,065 |

For every catalog, parsed totals, successful publishing totals, SQL row counts, and `GET /api/courses?term=...&year=...` counts agreed. The API returned only the requested catalog. `/api/health` and Fall 2026 `COMP 1405` search both returned HTTP 200. SQL found zero duplicate catalog/CRN keys, missing required course fields, or orphaned meetings.

All 9,419 stored sections were then republished through the same publisher and local API. Every operation was an update, with zero additions or failures; API responses were identical before and after republishing, including meeting data.

## Commands and checks

With the local API running and Chromium trusting the environment CA:

```sh
GOOGLE_CHROME_BIN=/usr/bin/chromium \
SE_CACHE_PATH=/tmp/raven-selenium \
RAVEN_API_URL=http://127.0.0.1:5000/api \
RAVEN_SCRAPE_LOG_FILE=/tmp/raven-clean.jsonl \
npm run scrape:dev
```

- `npm run validate`: passed lint, type checks, all 142 tests in 15 files, and the production build.
- `npm run test:containers`: passed PostgreSQL migration, preserved-data, catalog-isolation, and rendered-client checks. Used port 15000 and a temporary Dockerfile/Compose override mounting the environment proxy CA as a BuildKit secret for npm; repository Docker files were unchanged.
- Real Chromium delayed-navigation/streaming-results check: passed.
- Runtime: Node v22.23.4, Chromium 154.0.8037.57, Chromedriver 154.0.8037.92, PostgreSQL 17.

The full redacted JSONL log remains at `/tmp/raven-clean.jsonl` in the task workspace; its SHA-256 is recorded in the JSON evidence. Student credentials, cookies, SSO tokens, and full page captures are excluded from committed evidence. The public ACCS regression fixture has link query strings removed.

Public timetable results can omit building and room assignments; unavailable fields stay empty. The parser continues to retain the last meeting row per section, matching existing behavior.
