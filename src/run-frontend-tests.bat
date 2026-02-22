@echo off
setlocal

if not exist test_logs (
  mkdir test_logs
)

pnpm test:run > test_logs\frontend-tests.log 2>&1

echo. >> test_logs\frontend-tests.log
echo ====== Coverage Report ====== >> test_logs\frontend-tests.log
pnpm test:coverage >> test_logs\frontend-tests.log 2>&1

echo 测试完成，日志已生成在 test_logs\frontend-tests.log
