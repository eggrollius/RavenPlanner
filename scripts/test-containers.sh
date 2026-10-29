#!/usr/bin/env bash
set -euo pipefail

compose() {
  docker compose --project-name raven-planner-test "$@"
}

cleanup() {
  compose down --volumes --remove-orphans
}
trap cleanup EXIT

compose up --detach --wait --wait-timeout 120 db
compose exec -T db psql -v ON_ERROR_STOP=1 -U raven -d ravenplanner < scripts/fixtures/legacy-schema.sql
# Server startup must migrate an existing database without a manual command.
compose up --build --detach --wait --wait-timeout 120
# The release migration must also be safe after startup has already run it.
compose exec -T server npm run migrate
node scripts/smoke-multiterm.mjs
