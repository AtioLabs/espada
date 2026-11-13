#!/bin/sh
# usage: ./make-workspace.sh asrul   (creates ~/agentgroups-ws/asrul from data/connect/asrul.agent.json)
[ -n "$1" ] || { echo "usage: ./make-workspace.sh NAME"; exit 1; }
cd "$(dirname "$0")" && exec node src/cli.js workspace --connect "$PWD/data/connect/$1.agent.json" --dir "$HOME/agentgroups-ws/$1"
