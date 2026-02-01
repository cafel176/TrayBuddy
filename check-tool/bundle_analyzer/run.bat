@echo off
:: Request admin privileges (optional, for accurate file access)
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
echo TrayBuddy Bundle Analyzer
echo ============================================
echo.
echo Usage:
echo   run.bat         - Full analysis (build + analyze)
echo   run.bat quick   - Quick analysis (skip build)
echo.

set SKIP_BUILD=

if "%1"=="quick" (
    set SKIP_BUILD=-SkipBuild
)

echo Starting bundle analyzer...

:: 清理旧的日志文件
if exist "%~dp0Logs" (
    echo Cleaning up old logs in Logs folder...
    del /q "%~dp0Logs\*.*"
)

if defined SKIP_BUILD echo Skip build: Yes
echo.

powershell -ExecutionPolicy Bypass -File "%~dp0analyzer.ps1" %SKIP_BUILD%

echo.
pause
