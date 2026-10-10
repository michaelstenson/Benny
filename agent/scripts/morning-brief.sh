#!/usr/bin/env bash
# The 7:00 morning brief. Hermes runs this as a no-agent cron job: the
# app writes the brief (GET /api/digest/brief) and whatever this prints
# is posted to Discord as-is, with no model call. A failed fetch exits
# non-zero, so Hermes posts a failure notice instead of a blank brief.
#
# Lives on the Pi at ~/.hermes/scripts/morning-brief.sh. Hermes strips
# its own secrets from a script's environment, so the URL and token are
# read straight from ~/.hermes/.env.
set -euo pipefail

env_file="${HERMES_HOME:-$HOME/.hermes}/.env"
env_value() { grep -E "^$1=" "$env_file" | tail -n 1 | cut -d= -f2-; }

api_url="${BENNY_API_URL:-$(env_value BENNY_API_URL)}"
token="${BENNY_AGENT_TOKEN:-$(env_value BENNY_AGENT_TOKEN)}"

# Retries cover a cold start on Vercel or a brief network blip on the Pi.
curl --fail --silent --show-error --max-time 30 --retry 2 --retry-delay 10 \
  -H "Authorization: Bearer $token" \
  "$api_url/digest/brief"
