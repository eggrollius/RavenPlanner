#!/usr/bin/env bash
set -euo pipefail

cleanup() {
  docker compose down --volumes --remove-orphans
}
trap cleanup EXIT

docker compose up --build --detach --wait --wait-timeout 120
curl --fail --silent --show-error http://127.0.0.1:${PORT:-5000}/api/health \
  | grep --fixed-strings '"status":"ok"'
curl --fail --silent --show-error http://127.0.0.1:${PORT:-5000}/ \
  | grep --fixed-strings '<title>Raven Planner</title>'
