@echo off
:: 检查管理员权限
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo Requesting administrator privileges...
    powershell -NoProfile -Command "Start-Process -FilePath \"%~f0\" -Verb RunAs"
    exit /b
)

cd /d "%~dp0"
:: 删除开发模式的 mods 目录
if exist "%~dp0src-tauri\target\debug\mods" (
    echo Cleaning debug mods directory...
    rmdir /s /q "%~dp0src-tauri\target\debug\mods"
)

echo Starting Tauri dev server...
pnpm tauri dev --verbose
@REM pnpm tauri dev --verbose > tauri-dev.log 2>&1
@REM if %errorlevel% neq 0 (
@REM     echo.
@REM     echo [ERROR] Build failed! Check tauri-dev.log for details.
@REM     pause
@REM     exit /b %errorlevel%
@REM )
@REM echo Build successful! Log saved to tauri-dev.log.
pause