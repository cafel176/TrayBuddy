@echo off
setlocal

if not exist test_logs (
  mkdir test_logs
)

echo [1/2] Running frontend tests...
pnpm test:run > test_logs\frontend-tests.log 2>&1
if errorlevel 1 (
  echo FAILED: Some tests did not pass. See test_logs\frontend-tests.log
  exit /b 1
)

echo [2/2] Generating coverage report...
echo. >> test_logs\frontend-tests.log
echo ====== Coverage Report ====== >> test_logs\frontend-tests.log
pnpm test:coverage >> test_logs\frontend-tests.log 2>&1

echo. >> test_logs\frontend-tests.log
echo ====== De-duplicated Coverage ====== >> test_logs\frontend-tests.log
node src\test\calc-coverage.cjs >> test_logs\frontend-tests.log 2>&1
node src\test\calc-coverage.cjs

echo.
echo Tests completed. Full log: test_logs\frontend-tests.log
