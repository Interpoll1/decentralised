@echo off
REM Windows double-click entry point. Same job as launch.sh: check Node,
REM install once, start the instance, open a browser. No flags, no setup.
setlocal enabledelayedexpansion
cd /d "%~dp0.."

echo.
echo   Starting your instance...
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo   Node.js is not installed. Get it from https://nodejs.org ^(version 18 or newer^),
  echo   then run this again.
  echo.
  pause
  exit /b 1
)

if not exist node_modules (
  echo   Installing dependencies. This happens once and takes a few minutes...
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo   Installing dependencies failed. Check your internet connection and try again.
    pause
    exit /b 1
  )
  echo.
)

if "%PORT%"=="" set PORT=8080
if "%EDITION%"=="" set EDITION=lite

if /i "%EDITION%"=="full" (
  echo   Building the full app ^(a few minutes the first time^)...
  call node selfhost\build-full.js
  if errorlevel 1 (
    echo   The full app failed to build. The simple version needs no build:
    echo   run this again without setting EDITION.
    pause
    exit /b 1
  )
)

echo.
echo   -^>  On this computer:  http://localhost:%PORT%
for /f "delims=" %%i in ('node -e "const os=require(''os'');const h=Object.values(os.networkInterfaces()).flat().find(i=>i&&i.family===''IPv4''&&!i.internal);process.stdout.write(h?h.address:'''')"') do set LAN_IP=%%i
if not "%LAN_IP%"=="" echo   -^>  On the same wifi:  http://%LAN_IP%:%PORT%
echo.
echo   Press Ctrl-C to stop.
echo.

start "" "http://localhost:%PORT%"
node selfhost\relay\server.js
