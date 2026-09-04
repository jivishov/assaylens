@echo off
setlocal

rem Always run from the folder containing this launcher.
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
    echo Node.js is required to run AssayLens.
    echo Install it from https://nodejs.org/ and try again.
    pause
    exit /b 1
)

where npm >nul 2>&1
if errorlevel 1 (
    echo npm is required to run AssayLens.
    echo Install Node.js from https://nodejs.org/ and try again.
    pause
    exit /b 1
)

rem Install locked dependencies on the first launch if needed.
if not exist "node_modules\.bin\vite.cmd" (
    echo Installing AssayLens dependencies...
    call npm ci
    if errorlevel 1 (
        echo.
        echo Dependency installation failed.
        pause
        exit /b 1
    )
)

echo Starting AssayLens at http://127.0.0.1:5173/
call npm run dev -- --open
set "EXIT_CODE=%ERRORLEVEL%"

if not "%EXIT_CODE%"=="0" (
    echo.
    echo AssayLens stopped with exit code %EXIT_CODE%.
    pause
)

exit /b %EXIT_CODE%
