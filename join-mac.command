#!/bin/bash
# ESPADA - one-click join for macOS. Double-click this file in Finder (or run ./join-mac.command).
# First time: paste the invite your host sent you (looks like ABCD-EFGH-JKLM-NPQR@https://...). Next times: no input needed.
set -e
cd "$(dirname "$0")"
say() { printf '\n\033[1m%s\033[0m\n' "$1"; }
fail() { printf '\n\033[31mERROR:\033[0m %s\n' "$1"; read -n 1 -s -r -p "Press any key to close"; exit 1; }

command -v node >/dev/null || fail "Node.js is missing. Install the LTS from https://nodejs.org (then double-click this again)."
[ "$(node -p 'process.versions.node.split(".")[0]')" -ge 22 ] || fail "Node is too old ($(node -v)). Install Node 22+ LTS from https://nodejs.org."
command -v claude >/dev/null || fail "Claude Code is missing. Install: curl -fsSL https://claude.ai/install.sh | bash   (then open a new Terminal)."

KEEP="$HOME/.espada"; mkdir -p "$KEEP"; chmod 700 "$KEEP"
INV=""; SRC=""
case "${1:-}" in *@*) INV="$1";; "") ;; *) SRC="$1";; esac   # arg can be an invite or a path to a connect file

if [ -z "$INV" ] && [ -z "$SRC" ] && [ ! -f "$KEEP/me.agent.json" ]; then
  for f in "$PWD"/*.agent.json "$HOME"/Downloads/*.agent.json; do [ -z "$SRC" ] && [ -f "$f" ] && SRC="$f"; done
  if [ -z "$SRC" ]; then
    say "Paste your invite (one-time code from your host), then press Enter:"
    read -r INV
  fi
fi

if [ -n "$INV" ]; then
  say "Redeeming invite..."
  node src/cli.js redeem "$INV" --dir "$KEEP" || fail "Invite did not work. Ask your host for a new one."
  chmod 600 "$KEEP"/me.* 2>/dev/null || true
elif [ -n "$SRC" ]; then
  [ -f "$SRC" ] || fail "File not found: $SRC"
  cp "$SRC" "$KEEP/me.agent.json"; chmod 600 "$KEEP/me.agent.json"
fi
[ -f "$KEEP/me.agent.json" ] || fail "No connection saved. Run again and paste your invite."

say "Checking connection..."
node src/cli.js doctor --connect "$KEEP/me.agent.json" || true

say "Creating your workspace..."
WS="$HOME/espada-ws/me"
node src/cli.js workspace --connect "$KEEP/me.agent.json" --dir "$WS" >/dev/null
chmod +x "$WS/start-claude.sh"

say "Starting Claude. First time only: /login, choose 'I am using this for local development', then 'Use this MCP server'."
exec "$WS/start-claude.sh"
