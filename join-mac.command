#!/bin/bash
# Phantom Troupe - one-click join for macOS. Double-click this file in Finder (or run ./join-mac.command).
# You need the private file your host sent you (naveen.agent.json). Put it in this folder or ~/Downloads.
set -e
cd "$(dirname "$0")"
say() { printf '\n\033[1m%s\033[0m\n' "$1"; }
fail() { printf '\n\033[31mERROR:\033[0m %s\n' "$1"; read -n 1 -s -r -p "Press any key to close"; exit 1; }

command -v node >/dev/null || fail "Node.js is missing. Install the LTS from https://nodejs.org (then double-click this again)."
[ "$(node -p 'process.versions.node.split(".")[0]')" -ge 22 ] || fail "Node is too old ($(node -v)). Install Node 22+ LTS from https://nodejs.org."
command -v claude >/dev/null || fail "Claude Code is missing. Install: curl -fsSL https://claude.ai/install.sh | bash   (then open a new Terminal)."

SRC="${1:-}"
for f in "$PWD/naveen.agent.json" "$HOME/Downloads/naveen.agent.json" "$PWD"/*.agent.json "$HOME"/Downloads/*.agent.json; do
  [ -z "$SRC" ] && [ -f "$f" ] && SRC="$f"
done
[ -f "$SRC" ] || fail "Could not find your connect file (*.agent.json). Save it into ~/Downloads or this folder and run again."

KEEP="$HOME/.phantom-troupe"; mkdir -p "$KEEP"; chmod 700 "$KEEP"
cp "$SRC" "$KEEP/me.agent.json"; chmod 600 "$KEEP/me.agent.json"

say "Checking connection..."
node src/cli.js doctor --connect "$KEEP/me.agent.json" || true

say "Creating your workspace..."
WS="$HOME/phantom-troupe-ws/me"
node src/cli.js workspace --connect "$KEEP/me.agent.json" --dir "$WS" >/dev/null
chmod +x "$WS/start-claude.sh"

say "Starting Claude. First time only: /login, choose 'I am using this for local development', then 'Use this MCP server'."
exec "$WS/start-claude.sh"
