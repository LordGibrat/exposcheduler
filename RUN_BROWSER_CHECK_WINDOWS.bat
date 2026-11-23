@echo off
setlocal
cd /d "%~dp0"
echo Expo Smart Scheduler - desktop/mobile browser check
echo This installs the optional Playwright package and Chromium browser.
echo Target: https://expo-smart-scheduler.vercel.app/
echo Uses fresh simulation profiles. Does not access QAIRU Campus.
echo The verified suite prints its final report when finished.
echo For extra diagnostic checks, run this file with the diagnostic argument.
echo.
where node >nul 2>nul
if errorlevel 1 goto missing_node
where npm.cmd >nul 2>nul
if errorlevel 1 goto missing_node
call npm.cmd install --no-audit --no-fund
if errorlevel 1 goto failed
call npx.cmd playwright install chromium
if errorlevel 1 goto failed
set "BASE_URL=https://expo-smart-scheduler.vercel.app/"
set "qa_script=test:browser"
if /I "%~1"=="diagnostic" set "qa_script=test:browser:diagnostic"
call npm.cmd run %qa_script%
set "qa_result=%errorlevel%"
echo.
echo Browser check exit code: %qa_result%
echo Report: %CD%\results\browser_e2e\report.json
echo Send report.json for review. Screenshots are in the same folder.
pause
exit /b %qa_result%

:failed
echo.
echo Setup failed. Keep this window's error message for review.
pause
exit /b 1

:missing_node
echo Node.js with npm is required for this optional check.
echo The Python application can still run without Node.js.
pause
exit /b 2
