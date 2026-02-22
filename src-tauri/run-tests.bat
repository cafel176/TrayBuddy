@echo off
setlocal enabledelayedexpansion

cd /d "%~dp0"

set "LOG_DIR=%~dp0test_logs"
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"

set "ALL_LOG=%LOG_DIR%\all-tests.log"
set "IGNORED_LOG=%LOG_DIR%\ignored-tests.log"

echo Running all tests...
cargo test -- --nocapture > "%ALL_LOG%" 2>&1
if errorlevel 1 (
  echo.
  echo Tests failed. See log: %ALL_LOG%
  exit /b 1
)

echo.
echo Running ignored tests...
cargo test -- --ignored --nocapture > "%IGNORED_LOG%" 2>&1
if errorlevel 1 (
  echo.
  echo Ignored tests failed. See log: %IGNORED_LOG%
  exit /b 1
)

echo.
echo All tests passed.
echo Logs saved to: %LOG_DIR%
exit /b 0
