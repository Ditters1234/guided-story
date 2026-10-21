@echo off
setlocal
cd /d "%~dp0"
where node.exe >nul 2>&1
if errorlevel 1 (
  echo Storyweaver needs Node.js 24 or newer.
  pause
  exit /b 1
)
if not exist "node_modules\vite\bin\vite.js" (
  echo Dependencies are missing. Run npm.cmd ci in this folder first.
  pause
  exit /b 1
)
echo Opening Storyweaver at http://127.0.0.1:5175/
echo Your saves are in data\play. Development uses port 5173 and data\dev.
echo Keep this window open. Press Ctrl+C to stop this instance.
node scripts\start.mjs play --production --open
if errorlevel 1 (
  echo.
  echo Storyweaver could not start. See the message above.
  pause
)
