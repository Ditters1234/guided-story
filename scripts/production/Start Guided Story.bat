@echo off
setlocal
cd /d "%~dp0"
where node.exe >nul 2>&1
if errorlevel 1 goto neednode
node -e "process.exit(Number(process.versions.node.split('.')[0]) < 24 ? 1 : 0)" >nul 2>&1
if errorlevel 1 goto neednode
if not exist "node_modules\@sveltejs\kit\package.json" goto install
if not exist "node_modules\sharp\package.json" goto install
if not exist "node_modules\fflate\package.json" goto install
if not exist "node_modules\zod\package.json" goto install
goto launch
:install
where npm.cmd >nul 2>&1
if errorlevel 1 goto neednode
echo Installing Storyweaver dependencies. Internet access is needed the first time.
call npm.cmd ci --omit=dev --no-audit --no-fund
if errorlevel 1 (
  echo Dependency installation failed. Check the message above and try again.
  pause
  exit /b 1
)
:launch
node scripts\start-production.mjs --open
if errorlevel 1 pause
exit /b
:neednode
echo Install Node.js 24 or newer, including npm, then run this file again.
pause
exit /b 1
