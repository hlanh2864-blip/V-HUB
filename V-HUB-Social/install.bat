@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ======================================
echo          V-HUB SOCIAL - KIEM TRA
echo ======================================
where node >nul 2>nul
if errorlevel 1 (
  echo Chua tim thay Node.js. Hay cai Node.js LTS truoc.
  echo https://nodejs.org/en/download/
  pause
  exit /b 1
)
node -v
if errorlevel 1 (
  echo Node.js chua san sang.
  pause
  exit /b 1
)
echo.
echo V-HUB khong can tai thu vien npm. Ban co the chay start.bat ngay.
pause
