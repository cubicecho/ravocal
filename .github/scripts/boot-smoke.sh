#!/usr/bin/env bash
# What CI's boot job asks of a running instance, once `docker compose up --wait` has returned.
# Usage: .github/scripts/boot-smoke.sh [base URL, default http://127.0.0.1:3001]
set -euo pipefail

base="${1:-http://127.0.0.1:3001}"

fail() {
  echo "::error::$1"
  exit 1
}

# A GraphQL query over HTTP, as the app sends it. Errors still answer 200, so -f only catches a broken server.
query() {
  curl -fsS "$base/graphql" -H 'content-type: application/json' -d "{\"query\":\"$1\"}"
}

health=$(curl -fsS "$base/healthz")
echo "GET /healthz: $health"
[[ $health == *'"ok":true'* ]] || fail '/healthz did not answer ok'

groups=$(query '{ groups { id } }')
echo "anonymous groups: $groups"
[[ $groups == *'"code":"UNAUTHENTICATED"'* ]] || fail 'an anonymous groups query was not refused as UNAUTHENTICATED'

auth=$(query '{ authConfig { magicLink } }')
echo "authConfig: $auth"
[[ $auth == *'"authConfig":{"magicLink":'* ]] || fail 'authConfig did not answer'

page=$(curl -fsS "$base/")
[[ $page == *'<div id="root">'* ]] || fail 'GET / did not serve the app'
echo 'GET /: the app'
