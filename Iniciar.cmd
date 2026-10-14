@echo off
cd /d "%~dp0"
set "NOVELVOICE_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if not exist "%NOVELVOICE_NODE%" set "NOVELVOICE_NODE=node"
"%NOVELVOICE_NODE%" -e "fetch('http://127.0.0.1:4318/api/status',{signal:AbortSignal.timeout(1500)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
if not errorlevel 1 (
  start "" "http://127.0.0.1:4318"
  exit /b 0
)
start "" "http://127.0.0.1:4318"
"%NOVELVOICE_NODE%" server.mjs
pause
