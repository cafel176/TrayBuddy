@echo off
:: 检查管理员权限
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo Requesting administrator privileges...
    powershell -Command "Start-Process '%~f0' -Verb RunAs"
    exit /b
)

cd /d "%~dp0"
:: 删除开发模式的 mods 目录
if exist "%~dp0src-tauri\target\debug\mods" (
    echo Cleaning debug mods directory...
    rmdir /s /q "%~dp0src-tauri\target\debug\mods"
)

pnpm tauri dev
pause

