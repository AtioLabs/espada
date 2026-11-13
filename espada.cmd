@echo off
rem Start Claude with the ESPADA channel in the CURRENT folder. Run "node src\cli.js attach ..." once per project first.
claude --dangerously-load-development-channels server:agentgroups %*
