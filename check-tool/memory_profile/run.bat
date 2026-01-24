@echo off
:: Request admin privileges
>nul 2>&1 "%SYSTEMROOT%\system32\cacls.exe" "%SYSTEMROOT%\system32\config\system"
if '%errorlevel%' NEQ '0' (
    echo Requesting administrative privileges...
    goto UACPrompt
) else ( goto gotAdmin )

:UACPrompt
    echo Set UAC = CreateObject^("Shell.Application"^) > "%temp%\getadmin.vbs"
    echo UAC.ShellExecute "%~s0", "%*", "", "runas", 1 >> "%temp%\getadmin.vbs"
    "%temp%\getadmin.vbs"
    exit /B

:gotAdmin
    if exist "%temp%\getadmin.vbs" ( del "%temp%\getadmin.vbs" )
    pushd "%~dp0"

chcp 65001 >nul
echo ============================================
echo TrayBuddy Memory Profiler
echo ============================================
echo.
echo Usage:
echo   run.bat           - Full check (build + monitor 60s)
echo   run.bat quick     - Quick check (skip build, monitor 60s)
echo   run.bat quick 30  - Quick check (skip build, monitor 30s)
echo.

set DURATION=60
set SKIP_BUILD=

if "%1"=="quick" (
    set SKIP_BUILD=-SkipBuild
    if not "%2"=="" set DURATION=%2
) else if not "%1"=="" (
    set DURATION=%1
)

echo Starting memory profiler...
echo Duration: %DURATION% seconds
if defined SKIP_BUILD echo Skip build: Yes
echo.

powershell -ExecutionPolicy Bypass -File "%~dp0profiler.ps1" -Duration %DURATION% %SKIP_BUILD%

echo.
pause
