@echo off
setlocal enabledelayedexpansion

:: Ensure UTF-8 output
chcp 65001 >nul

cd /d "%~dp0"

set "LOG_DIR=%~dp0test_logs"
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"

set FRONTEND_OK=0
set BACKEND_OK=0
set FRONTEND_COV_OK=0
set BACKEND_COV_OK=0

echo.
echo ================================================================
echo   TrayBuddy Automated Test Runner
echo ================================================================
echo.

:: =====================================================================
:: 1. Frontend Tests
:: =====================================================================
echo [1/4] Running frontend tests...
call pnpm test:run > "%LOG_DIR%\frontend-tests.log" 2>&1
if errorlevel 1 (
  set FRONTEND_OK=1
  echo   FAILED: Some frontend tests did not pass.
  echo   See log: %LOG_DIR%\frontend-tests.log
) else (
  echo   PASSED
)

:: =====================================================================
:: 2. Frontend Coverage
:: =====================================================================
echo [2/4] Generating frontend coverage report...
call pnpm test:coverage > "%LOG_DIR%\frontend-coverage.log" 2>&1
if errorlevel 1 (
  set FRONTEND_COV_OK=1
  echo   FAILED: Frontend coverage generation failed.
) else (
  echo   Done
)

:: De-duplicated coverage report
echo.
echo ----------------------------------------------------------------
echo   Frontend Coverage (de-duplicated)
echo ----------------------------------------------------------------
node src\test\calc-coverage.cjs 2>nul
echo.

:: =====================================================================
:: 3. Backend Tests
:: =====================================================================
echo [3/4] Running backend tests...
pushd src-tauri

:: Build test binaries first
cargo test --lib --no-run 2>nul

:: Deploy comctl32 v6 manifest for test executables
for /f "delims=" %%E in ('dir /b /s target\debug\deps\traybuddy_lib-*.exe 2^>nul') do (
  if not exist "%%E.manifest" (
    > "%%E.manifest" echo ^<?xml version='1.0' encoding='UTF-8' standalone='yes'?^>^<assembly xmlns='urn:schemas-microsoft-com:asm.v1' manifestVersion='1.0'^>^<dependency^>^<dependentAssembly^>^<assemblyIdentity type='win32' name='Microsoft.Windows.Common-Controls' version='6.0.0.0' processorArchitecture='*' publicKeyToken='6595b64144ccf1df' language='*'/^>^</dependentAssembly^>^</dependency^>^</assembly^>
    echo   Created manifest for: %%~nxE
  )
)

:: Run all tests (normal + ignored)
cargo test -- --test-threads=1 --nocapture > "%LOG_DIR%\backend-tests.log" 2>&1
if errorlevel 1 (
  set BACKEND_OK=1
  echo   FAILED: Some backend tests did not pass.
  echo   See log: %LOG_DIR%\backend-tests.log
) else (
  echo   Normal tests PASSED
  cargo test -- --ignored --test-threads=1 --nocapture >> "%LOG_DIR%\backend-tests.log" 2>&1
  if errorlevel 1 (
    set BACKEND_OK=1
    echo   FAILED: Some ignored backend tests did not pass.
    echo   See log: %LOG_DIR%\backend-tests.log
  ) else (
    echo   Ignored tests PASSED
  )
)

:: =====================================================================
:: 4. Backend Coverage
:: =====================================================================
echo [4/4] Generating backend coverage report...

set "COV_IGNORE_REGEX=app_state\.rs$|lib\.rs$|main\.rs$|lib_helpers\.rs$|commands[\\/].*\.rs$|resource_runtime\.rs$|resource_fs_runtime\.rs$|state_runtime\.rs$|environment_runtime\.rs$|mod_archive_runtime\.rs$|storage_runtime\.rs$|media_observer\.rs$|system_observer\.rs$|process_observer\.rs$|event_manager\.rs$|window\.rs$|thread\.rs$|i18n\.rs$"

cargo llvm-cov --workspace --tests --no-run --ignore-filename-regex "%COV_IGNORE_REGEX%" 2>nul

:: Deploy manifest for coverage test executables
for /f "delims=" %%E in ('dir /b /s target\llvm-cov-target\debug\deps\traybuddy_lib-*.exe 2^>nul') do (
  if not exist "%%E.manifest" (
    > "%%E.manifest" echo ^<?xml version='1.0' encoding='UTF-8' standalone='yes'?^>^<assembly xmlns='urn:schemas-microsoft-com:asm.v1' manifestVersion='1.0'^>^<dependency^>^<dependentAssembly^>^<assemblyIdentity type='win32' name='Microsoft.Windows.Common-Controls' version='6.0.0.0' processorArchitecture='*' publicKeyToken='6595b64144ccf1df' language='*'/^>^</dependentAssembly^>^</dependency^>^</assembly^>
    echo   Created manifest for: %%~nxE
  )
)

echo.
echo ----------------------------------------------------------------
echo   Backend Coverage
echo ----------------------------------------------------------------
cargo llvm-cov --workspace --tests --summary-only --ignore-filename-regex "%COV_IGNORE_REGEX%" -- --test-threads=1
if errorlevel 1 (
  set BACKEND_COV_OK=1
  echo   FAILED: Backend coverage generation failed.
) else (
  echo.
)

popd

:: =====================================================================
:: Summary
:: =====================================================================
echo.
echo ================================================================
echo   Test Summary
echo ================================================================

if !FRONTEND_OK!==0 (
  echo   Frontend Tests:    PASSED
) else (
  echo   Frontend Tests:    FAILED
)

if !FRONTEND_COV_OK!==0 (
  echo   Frontend Coverage: OK
) else (
  echo   Frontend Coverage: FAILED
)

if !BACKEND_OK!==0 (
  echo   Backend Tests:     PASSED
) else (
  echo   Backend Tests:     FAILED
)

if !BACKEND_COV_OK!==0 (
  echo   Backend Coverage:  OK
) else (
  echo   Backend Coverage:  FAILED
)

echo.

echo.
echo   Logs saved to: %LOG_DIR%
echo ================================================================
echo.

:: Exit with error if any step failed
set /a TOTAL_ERR=FRONTEND_OK+BACKEND_OK+FRONTEND_COV_OK+BACKEND_COV_OK
if !TOTAL_ERR! gtr 0 (
  echo Some steps failed. Check the logs above.
  pause
  exit /b 1
)

echo All tests passed!
pause
exit /b 0
