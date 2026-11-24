@echo off
setlocal
cd /d "%~dp0"

echo =============================================
echo Dotinout - Local Android APK Build
echo =============================================

where node >nul 2>nul
if errorlevel 1 (
  echo ERROR: Node.js is not installed or not on PATH.
  echo Install Node.js 22 LTS, reopen this window, and retry.
  pause
  exit /b 1
)

if not exist package.json (
  echo ERROR: Run this file from the extracted mobile folder.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Installing npm dependencies...
  call npm ci --no-audit --no-fund
  if errorlevel 1 goto :fail
)

set EXPO_PUBLIC_API_BASE_URL=https://timetrackpro-ai.vercel.app

echo Generating Android native project with Expo Prebuild...
call npx expo prebuild --platform android --no-install
if errorlevel 1 goto :fail

if not exist android\gradlew.bat (
  echo ERROR: Android Gradle wrapper was not generated.
  goto :fail
)

echo Building debug APK with Gradle...
pushd android
call gradlew.bat --no-daemon assembleDebug
if errorlevel 1 (
  popd
  goto :fail
)
popd

if not exist android\app\build\outputs\apk\debug\app-debug.apk (
  echo ERROR: Build finished but APK was not found.
  goto :fail
)

copy /Y android\app\build\outputs\apk\debug\app-debug.apk dotinout-debug.apk >nul

echo.
echo SUCCESS! APK created:
echo %CD%\dotinout-debug.apk
echo Install it on an Android phone with USB debugging/ADB or copy it to the phone.
pause
exit /b 0

:fail
echo.
echo BUILD FAILED. Read the error above. Check Android Studio SDK/JDK setup.
pause
exit /b 1
