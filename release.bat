@echo off
:: 检查管理员权限
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo Requesting administrator privileges...
    powershell -Command "Start-Process '%~f0' -Verb RunAs"
    exit /b
)

cd /d "%~dp0"
:: 删除release模式的 mods 目录
if exist "%~dp0src-tauri\target\release\mods" (
    echo Cleaning release mods directory...
    rmdir /s /q "%~dp0src-tauri\target\release\mods"
)

echo Building Tauri app...
pnpm tauri build --verbose > tauri-build.log 2>&1
if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Build failed! Check tauri-build.log for details.
    pause
    exit /b %errorlevel%
)
echo Build successful! Log saved to tauri-build.log.
pause
