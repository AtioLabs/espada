@echo off
rem Run from ANY folder/worktree:  ag-claude [normal claude args]
rem Starts Claude in the current folder with the AgentGroups channel. One session per agent identity at a time.
claude --mcp-config "%~dp0ag-mcp.json" --dangerously-load-development-channels server:agentgroups %*
