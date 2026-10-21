@echo off
setlocal
pushd "%~dp0"
if errorlevel 1 (
  echo Could not open the Storyweaver project folder.
  pause
  exit /b 1
)

where node.exe >nul 2>&1
if errorlevel 1 goto neednode
node -e "process.exit(Number(process.versions.node.split('.')[0]) < 24 ? 1 : 0)" >nul 2>&1
if errorlevel 1 goto neednode
where npm.cmd >nul 2>&1
if errorlevel 1 goto neednode

if not exist "node_modules\vite\bin\vite.js" goto install
if not exist "node_modules\@sveltejs\adapter-node\package.json" goto install
if not exist "node_modules\fflate\package.json" goto install
goto build

:install
echo Installing project dependencies. Internet access may be needed.
set "buildStep=Dependency installation"
call npm.cmd ci --include=dev --no-audit --no-fund
if errorlevel 1 goto failed

:build
echo.
echo Building Storyweaver for production...
set "buildStep=Production build"
call npm.cmd run build
if errorlevel 1 goto failed

echo.
echo Creating the clean production ZIP...
set "buildStep=ZIP packaging"
call npm.cmd run release:production
if errorlevel 1 goto failed

echo.
echo Production ZIP created successfully.
echo Find the ZIP and its SHA-256 checksum in "%CD%\dist".
popd
pause
exit /b 0

:neednode
echo Install Node.js 24 or newer, including npm, then run this file again.
popd
pause
exit /b 1

:failed
echo.
echo %buildStep% failed. See the error above; no new release was completed.
popd
pause
exit /b 1
