@echo off
rem usage: make-workspace.cmd asrul   (creates C:\agentgroups\ws-asrul using data\connect\asrul.agent.json)
cd /d "%~dp0"
node src\cli.js workspace --connect "%~dp0data\connect\%1.agent.json" --dir "%USERPROFILE%\agentgroups-ws\%1"
