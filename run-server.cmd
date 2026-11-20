@echo off
rem Starts the prices API (used by the Windows scheduled task "BaqalaTech Prices API" at logon)
cd /d "%~dp0"
if not exist logs mkdir logs
echo ===== %date% %time% =====>> logs\server.log
"C:\Program Files\nodejs\node.exe" --env-file-if-exists=.env server.mjs >> logs\server.log 2>&1
