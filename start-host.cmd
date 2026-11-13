@echo off
rem ESPADA host on THIS laptop, reachable over Tailscale (private, stable address, nothing public).
rem Double-click, leave the window open. Needs Tailscale signed in. Then run invite.cmd NAME to invite someone.
cd /d "%~dp0"
set "TS=C:\Program Files\Tailscale\tailscale.exe"
if not exist "%TS%" (echo Tailscale is not installed. Run: winget install Tailscale.Tailscale & pause & exit /b 1)
set "TSIP="
for /f %%i in ('"%TS%" ip -4 2^>nul') do if not defined TSIP set "TSIP=%%i"
if not defined TSIP (echo Tailscale is not signed in. Open Tailscale from the Start menu, sign in, then run this again. & pause & exit /b 1)
curl -s -m 2 -o nul http://127.0.0.1:8787/health
if not errorlevel 1 (echo Something is already running on port 8787. Close the old ESPADA host / tunnel windows first, then run this again. & pause & exit /b 1)
echo ESPADA host starting on %TSIP% ...
echo Owner page for you:  http://%TSIP%:8787/   (your link with token is printed below)
node src\cli.js host --host %TSIP% --public-url http://%TSIP%:8787
pause
