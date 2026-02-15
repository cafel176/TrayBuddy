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

:: 删除release模式的 mods 目录（避免括号块，兼容路径中的 ()）
if not exist "%~dp0src-tauri\target\release\mods" goto :_tb_after_clean

echo Cleaning release mods directory...
rmdir /s /q "%~dp0src-tauri\target\release\mods"

:_tb_after_clean

echo Packing mods to .tbuddy files...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0pack-mods.ps1"
if errorlevel 1 goto :_tb_pack_failed

echo Building Tauri app...
call pnpm tauri build --verbose > tauri-build.log 2>&1
if errorlevel 1 goto :_tb_build_failed

echo Build successful! Log saved to tauri-build.log.
pause
exit /b 0

:_tb_pack_failed
echo.
echo [ERROR] Packing mods failed!
pause
exit /b 1

:_tb_build_failed
echo.
echo [ERROR] Build failed! Check tauri-build.log for details.
set "TB_EXITCODE=%errorlevel%"
pause
exit /b %TB_EXITCODE%

