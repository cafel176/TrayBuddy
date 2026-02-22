@echo off
setlocal enabledelayedexpansion

cd /d "%~dp0"

set "LOG_DIR=%~dp0test_logs"
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"

set "ALL_LOG=%LOG_DIR%\all-tests.log"
set "IGNORED_LOG=%LOG_DIR%\ignored-tests.log"
for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd_HHmmss"') do set "COV_TAG=%%i"
set "COV_LOG=%LOG_DIR%\coverage_%COV_TAG%.log"
set "COV_DIR=%LOG_DIR%\coverage_%COV_TAG%"
set "COV_IGNORE_REGEX=app_state\.rs$|lib\.rs$|main\.rs$|lib_helpers\.rs$|commands[\\/].*\.rs$|modules[\\/](environment|event_manager|media_observer|mod_archive|process_observer|resource|state|system_observer|trigger)\.rs$|modules[\\/]utils[\\/](i18n|window|http)\.rs$"





if not exist "%COV_DIR%" mkdir "%COV_DIR%"
type nul > "%COV_LOG%"

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
echo Ensuring coverage tooling...
where cargo-llvm-cov >nul 2>&1
if errorlevel 1 (
  echo Installing cargo-llvm-cov... >> "%COV_LOG%"
  cargo install cargo-llvm-cov --locked >> "%COV_LOG%" 2>&1
  if errorlevel 1 (
    echo.
    echo Failed to install cargo-llvm-cov. See log: %COV_LOG%
    exit /b 1
  )
)

rustup component add llvm-tools-preview >> "%COV_LOG%" 2>&1
if errorlevel 1 (
  echo.
  echo Failed to add llvm-tools-preview. See log: %COV_LOG%
  exit /b 1
)

echo.
echo Running coverage...
echo ====== Coverage Start %date% %time% ====== >> "%COV_LOG%"
echo [coverage] summary-only >> "%COV_LOG%"
cargo llvm-cov --workspace --tests --summary-only --ignore-filename-regex "%COV_IGNORE_REGEX%" -- --nocapture --test-threads=1 >> "%COV_LOG%" 2>&1

if errorlevel 1 (
  echo.
  echo Coverage summary failed. See log: %COV_LOG%
  exit /b 1
)

echo ====== Coverage End %date% %time% ====== >> "%COV_LOG%"


echo.
echo All tests passed.
echo Logs saved to: %LOG_DIR%
exit /b 0
