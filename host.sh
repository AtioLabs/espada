#!/bin/sh
cd "$(dirname "$0")" && exec node src/cli.js host "$@"
