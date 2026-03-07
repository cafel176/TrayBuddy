@echo off
setlocal EnableExtensions DisableDelayedExpansion

:: Ensure UTF-8 for Chinese path/args
chcp 65001 >nul

:: 检查管理员权限（使用 fltmc 检测，避免 net session 在部分系统下失效）
>nul 2>&1 "%SystemRoot%\System32\fltmc.exe"
if errorlevel 1 goto :_tb_elevate

goto :_tb_got_admin

:_tb_elevate
set "TB_SELF=%~f0"
set "TB_CWD=%CD%"
set "TB_ARGS=%*"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$bat=$env:TB_SELF; $cwd=$env:TB_CWD; $a=$env:TB_ARGS; $q=[char]34; $cmd=$q+$bat+$q; if($a){$cmd+=' '+$a}; Start-Process -FilePath 'cmd.exe' -WorkingDirectory $cwd -ArgumentList @('/d','/c',$cmd) -Verb RunAs"
exit /b

:_tb_got_admin


cd /d "%~dp0"

:: 检查是否已有 traybuddy.exe 在运行
tasklist /FI "IMAGENAME eq traybuddy.exe" 2>nul | find /I "traybuddy.exe" >nul
if not errorlevel 1 (
    echo.
    echo [WARNING] traybuddy.exe is already running!
    echo Please close the existing instance before starting dev server.
    echo.
    pause
    exit /b 1
)

:: 删除开发模式的 mods 目录（避免括号块，兼容路径中的 ()）
if not exist "%~dp0src-tauri\target\debug\mods" goto :_tb_after_clean

echo Cleaning debug mods directory...
rmdir /s /q "%~dp0src-tauri\target\debug\mods"

:_tb_after_clean


:: 确保 tauri.conf.json 引用的 resource 目录存在
if not exist "%~dp0tbuddy_release" mkdir "%~dp0tbuddy_release"

echo Starting Tauri dev server...
call pnpm tauri dev --verbose
@REM pnpm tauri dev --verbose > tauri-dev.log 2>&1
@REM if %errorlevel% neq 0 (
@REM     echo.
@REM     echo [ERROR] Build failed! Check tauri-dev.log for details.
@REM     pause
@REM     exit /b %errorlevel%
@REM )
@REM echo Build successful! Log saved to tauri-dev.log.
pause
