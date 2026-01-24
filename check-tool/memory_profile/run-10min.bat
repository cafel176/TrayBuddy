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
echo TrayBuddy Memory Profiler - 10 Minutes
echo ============================================
echo.
echo Duration: 600 seconds (10 minutes)
echo Skip build: Yes
echo.

powershell -ExecutionPolicy Bypass -File "%~dp0profiler.ps1" -Duration 600 -SkipBuild

echo.
pause
