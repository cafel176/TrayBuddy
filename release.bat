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

echo Packing mods_release to .tbuddy files...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0pack-mods.ps1" -ModsDir "%~mods_release" -NoClean
if errorlevel 1 goto :_tb_pack_failed

echo Packing mods_test to .tbuddy files...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0pack-mods.ps1" -ModsDir "%~dp0mods_test" -NoClean
if errorlevel 1 goto :_tb_pack_failed

echo Packing .tbuddy to .sbuddy files...
set "TB_TBUDDY_DIR=%~dp0tbuddy"
set "TB_SBUDDY_DIR=%~dp0sbuddy"

if not exist "%TB_TBUDDY_DIR%" (
  echo.
  echo [ERROR] tbuddy directory not found: "%TB_TBUDDY_DIR%"
  goto :_tb_sbuddy_failed
)

set "TB_SBUDDY_CRYPTO="
if exist "%~dp0src-tauri\sbuddy-crypto.exe" set "TB_SBUDDY_CRYPTO=%~dp0src-tauri\sbuddy-crypto.exe"
if not defined TB_SBUDDY_CRYPTO if exist "%~dp0sbuddy-crypto.exe" set "TB_SBUDDY_CRYPTO=%~dp0sbuddy-crypto.exe"
if not defined TB_SBUDDY_CRYPTO (
  where sbuddy-crypto.exe >nul 2>&1
  if not errorlevel 1 set "TB_SBUDDY_CRYPTO=sbuddy-crypto.exe"
)

if not defined TB_SBUDDY_CRYPTO (
  echo.
  echo [WARN] sbuddy-crypto.exe not found, skipping .sbuddy packing step.
  goto :_tb_after_sbuddy
)

if not exist "%TB_SBUDDY_DIR%" mkdir "%TB_SBUDDY_DIR%" >nul 2>&1

del /q "%TB_SBUDDY_DIR%\*.sbuddy" >nul 2>&1

echo Using: %TB_SBUDDY_CRYPTO%


setlocal EnableDelayedExpansion
set /a TB_SBUDDY_COUNT=0
for %%f in ("%TB_TBUDDY_DIR%\*.tbuddy") do (
  if exist "%%~ff" (
    set "TB_IN=%%~ff"
    set "TB_OUT=%TB_SBUDDY_DIR%\%%~nf.sbuddy"
    echo   encrypt: "%%~nxf" ^> "%%~nf.sbuddy"
    "%TB_SBUDDY_CRYPTO%" encrypt < "!TB_IN!" > "!TB_OUT!"
    if errorlevel 1 (
      endlocal
      echo.
      echo [ERROR] Failed to generate sbuddy: "%%~nxf"
      goto :_tb_sbuddy_failed
    )
    set /a TB_SBUDDY_COUNT+=1
  )
)

if !TB_SBUDDY_COUNT! LEQ 0 (
  endlocal
  echo.
  echo [ERROR] No .tbuddy files found in "%TB_TBUDDY_DIR%"
  goto :_tb_sbuddy_failed
)

endlocal

:_tb_after_sbuddy

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

:_tb_sbuddy_failed
echo.
echo [ERROR] Packing sbuddy failed!
pause
exit /b 1

:_tb_build_failed
echo.
echo [ERROR] Build failed! Check tauri-build.log for details.
set "TB_EXITCODE=%errorlevel%"
pause
exit /b %TB_EXITCODE%


