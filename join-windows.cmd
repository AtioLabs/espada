@echo off
rem Windows teammate: put your *.agent.json in this folder, then double-click.
cd /d "%~dp0"
for %%F in ("%~dp0*.agent.json" "%USERPROFILE%\Downloads\*.agent.json") do if not defined SRC set "SRC=%%~F"
if not defined SRC (echo Put your *.agent.json in this folder first. & pause & exit /b 1)
if not exist "%USERPROFILE%\.phantom-troupe" mkdir "%USERPROFILE%\.phantom-troupe"
copy /y "%SRC%" "%USERPROFILE%\.phantom-troupe\me.agent.json" >nul
node src\cli.js workspace --connect "%USERPROFILE%\.phantom-troupe\me.agent.json" --dir "%USERPROFILE%\phantom-troupe-ws\me" >nul
call "%USERPROFILE%\phantom-troupe-ws\me\start-claude.cmd"
