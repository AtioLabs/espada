@echo off
rem ESPADA join for Windows. First time: paste the invite from your host (ABCD-EFGH-JKLM-NPQR@https://...). Next times: no input.
cd /d "%~dp0"
set "KEEP=%USERPROFILE%\.espada"
if not exist "%KEEP%" mkdir "%KEEP%"
set "INV="
echo %~1| find "@" >nul && set "INV=%~1"
if defined INV goto redeem
if exist "%KEEP%\me.agent.json" goto ready
set /p INV=Paste your invite and press Enter:
:redeem
if not defined INV (echo No invite given. & pause & exit /b 1)
node src\cli.js redeem "%INV%" --dir "%KEEP%"
if errorlevel 1 (pause & exit /b 1)
:ready
node src\cli.js doctor --connect "%KEEP%\me.agent.json"
node src\cli.js workspace --connect "%KEEP%\me.agent.json" --dir "%USERPROFILE%\espada-ws\me" >nul
call "%USERPROFILE%\espada-ws\me\start-claude.cmd"
