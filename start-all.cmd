@echo off
rem One-click start. Usage:  start-all.cmd          (asrul only, quickest test)
rem                         start-all.cmd both     (asrul + naveen)
rem Starts the host (if not already running), makes the workspace(s), opens the owner page(s),
rem and opens a Claude window per workspace. You still must /login once per Claude window.
cd /d "%~dp0"
set "WHO=asrul"
if /i "%~1"=="both" set "WHO=asrul naveen"

curl -s -o nul http://127.0.0.1:8787/health
if not errorlevel 1 goto hostready
echo Starting host...
start "AgentGroups host" cmd /k "%~dp0host.cmd"
:wait
if exist "%~dp0data\connect\asrul.agent.json" goto waited
timeout /t 1 >nul
goto wait
:waited
timeout /t 2 >nul
goto go
:hostready
echo Host already running.
:go

for %%N in (%WHO%) do (
  call "%~dp0make-workspace.cmd" %%N >nul
  for /f "delims=" %%U in ('node -e "const j=require('./data/connect/%%N.owner.json');console.log('http://127.0.0.1:8787/#token='+j.token)"') do start "" "%%U"
  start "Claude %%N" "%USERPROFILE%\agentgroups-ws\%%N\start-claude.cmd"
)

echo.
echo In each Claude window: /login, choose "I am using this for local development", then "Use this MCP server".
echo The banner should say: Channels (experimental) messages from server:agentgroups
