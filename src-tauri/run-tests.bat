@echo off
setlocal enabledelayedexpansion

cd /d "%~dp0"

set "LOG_DIR=%~dp0test_logs"
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"

set "ALL_LOG=%LOG_DIR%\all-tests.log"
set "IGNORED_LOG=%LOG_DIR%\ignored-tests.log"

:: Deploy Common Controls v6 manifest for test exe (TaskDialogIndirect fix)
echo Deploying comctl32 v6 manifest for test executables...
cargo test --lib --no-run 2>nul
for /f "delims=" %%E in ('dir /b /s target\debug\deps\traybuddy_lib-*.exe 2^>nul') do (
  if not exist "%%E.manifest" (
    > "%%E.manifest" echo ^<?xml version='1.0' encoding='UTF-8' standalone='yes'?^>^<assembly xmlns='urn:schemas-microsoft-com:asm.v1' manifestVersion='1.0'^>^<dependency^>^<dependentAssembly^>^<assemblyIdentity type='win32' name='Microsoft.Windows.Common-Controls' version='6.0.0.0' processorArchitecture='*' publicKeyToken='6595b64144ccf1df' language='*'/^>^</dependentAssembly^>^</dependency^>^</assembly^>
    echo   Created manifest for: %%~nxE
  )
)

echo Running all tests...
cargo test -- --test-threads=1 --nocapture > "%ALL_LOG%" 2>&1
if errorlevel 1 (
  echo.
  echo Tests failed. See log: %ALL_LOG%
  pause
  exit /b 1
)

echo.
echo Running ignored tests...
cargo test -- --ignored --test-threads=1 --nocapture > "%IGNORED_LOG%" 2>&1
if errorlevel 1 (
  echo.
  echo Ignored tests failed. See log: %IGNORED_LOG%
  pause
  exit /b 1
)

echo.
echo Running coverage (via run-cov.bat)...
call "%~dp0run-cov.bat"
if errorlevel 1 (
  echo.
  echo Coverage failed.
  pause
  exit /b 1
)

echo.
echo All tests passed.
echo Logs saved to: %LOG_DIR%

pause

exit /b 0
