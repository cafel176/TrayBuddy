@echo off
setlocal EnableExtensions DisableDelayedExpansion

:: Ensure UTF-8 for Chinese output
chcp 65001 >nul

:: Request admin privileges (optional)
>nul 2>&1 net session
if %errorlevel% neq 0 goto :elevate
goto :gotAdmin

:elevate
echo Requesting administrative privileges...
set "SELF=%~f0"
set "ARGS=%*"
powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath $env:SELF -ArgumentList $env:ARGS -Verb RunAs"
exit /b

:gotAdmin
pushd "%~dp0"

echo ============================================
echo TrayBuddy Bundle Analyzer
echo ============================================
echo.
echo Usage:
echo   run.bat         - Full analysis (build + analyze)
echo   run.bat quick   - Quick analysis (skip build)
echo.

set "SKIP_BUILD="
if /i "%~1"=="quick" set "SKIP_BUILD=-SkipBuild"

echo Starting bundle analyzer...

:: 清理旧的日志文件（避免括号块，以兼容路径中的 () 等特殊字符）
if not exist "%~dp0Logs" goto :afterCleanup
echo Cleaning up old logs in Logs folder...
del /q "%~dp0Logs\*.*" >nul 2>nul

:afterCleanup
if defined SKIP_BUILD echo Skip build: Yes
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0analyzer.ps1" %SKIP_BUILD%

echo.
pause
