@echo off
setlocal
cd /d "%~dp0"
echo Expo Smart Scheduler - Find a space browser check
echo Checks the new search, AI explanations, review and simulation reservation flow.
echo Target: https://expo-smart-scheduler.vercel.app/find.html
echo Uses fresh browser profiles and does not access QAIRU Campus.
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
call npm.cmd run test:browser:finder
set "qa_result=%errorlevel%"
echo.
echo Browser check exit code: %qa_result%
echo Report: %CD%\results\finder_e2e\report.json
pause
exit /b %qa_result%

:failed
echo Setup failed. Keep this window's error message for review.
pause
exit /b 1

:missing_node
echo Node.js 20 or newer with npm is required for this optional check.
pause
exit /b 2
