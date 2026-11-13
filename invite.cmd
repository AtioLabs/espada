@echo off
rem Usage: invite.cmd NAME   (host must be running via start-host.cmd). Prints a one-time invite to send to that person.
cd /d "%~dp0"
if "%~1"=="" (echo usage: invite.cmd naveen & exit /b 1)
set "TS=C:\Program Files\Tailscale\tailscale.exe"
set "TSIP="
for /f %%i in ('"%TS%" ip -4 2^>nul') do if not defined TSIP set "TSIP=%%i"
if not defined TSIP (echo Tailscale is not signed in. & exit /b 1)
node src\cli.js invite %1 --server http://%TSIP%:8787
