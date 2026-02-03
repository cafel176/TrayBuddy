@echo off
setlocal EnableExtensions DisableDelayedExpansion

:: Ensure UTF-8 for Chinese output
chcp 65001 >nul

:: Request admin privileges
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
echo TrayBuddy Memory Profiler
echo ============================================
echo.
echo Usage:
echo   run.bat           - Full check (build + monitor 4 min)
echo   run.bat quick     - Quick check (skip build, monitor 4 min)
echo   run.bat quick 120 - Quick check (skip build, monitor 120s)
echo.

set "DURATION=240"
set "SKIP_BUILD="

if "%~1"=="" goto :parsed
if /i "%~1"=="quick" goto :quick
set "DURATION=%~1"
goto :parsed

:quick
set "SKIP_BUILD=-SkipBuild"
if not "%~2"=="" set "DURATION=%~2"

:parsed
echo Starting memory profiler...

:: 清理旧的日志文件（避免括号块，以兼容路径中的 () 等特殊字符）
if not exist "%~dp0Logs" goto :afterCleanup
echo Cleaning up old logs in Logs folder...
del /q "%~dp0Logs\*.*" >nul 2>nul

:afterCleanup
echo Duration: %DURATION% seconds
if defined SKIP_BUILD echo Skip build: Yes
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0profiler.ps1" -Duration %DURATION% %SKIP_BUILD%

echo.
pause
