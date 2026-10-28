@echo off
setlocal
cd /d "%~dp0"
echo THAIKALI PM Booking - Cloudflare Pages deploy using Wrangler
echo.
where node >nul 2>nul
if errorlevel 1 (
  echo ERROR: Node.js is not installed. Install Node.js LTS first.
  pause
  exit /b 1
)
echo Deploying public/ with Pages Functions from functions/ ...
npx wrangler pages deploy public --project-name thaikali-pm-booking
if errorlevel 1 (
  echo.
  echo Deploy failed. Check Wrangler login, project name, and configuration.
  pause
  exit /b 1
)
echo.
echo Deploy command finished. Open the URL shown by Wrangler.
pause
