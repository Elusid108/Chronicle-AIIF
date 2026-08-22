@echo off
setlocal
cd /d "%~dp0"

set PORT=8000

echo Chronicle — http://localhost:%PORT%
echo Close this window to stop the server.
echo.

start "" cmd /c "timeout /t 1 /nobreak >nul & start http://localhost:%PORT%/"

where python >nul 2>&1
if %ERRORLEVEL%==0 (
    python -m http.server %PORT%
    goto :eof
)

where py >nul 2>&1
if %ERRORLEVEL%==0 (
    py -3 -m http.server %PORT%
    goto :eof
)

where npx >nul 2>&1
if %ERRORLEVEL%==0 (
    npx --yes serve -l %PORT%
    goto :eof
)

echo Could not find Python or Node.js.
echo Install Python 3 from https://www.python.org/ or Node.js from https://nodejs.org/
echo then double-click launch.bat again.
echo.
pause
