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

:: ================================================================
:: mods 文件夹：跳过，不进行任何打包
:: ================================================================

:: ================================================================
:: mods_release -> tbuddy_release/ -> sbuddy_release/
:: ================================================================
echo Packing mods_release to .tbuddy files...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0pack-mods.ps1" -ModsDir "%~dp0mods_release" -OutputDir "%~dp0tbuddy_release"
if errorlevel 1 goto :_tb_pack_failed

:: ================================================================
:: mods_test -> tbuddy_test/ -> sbuddy_test/
:: ================================================================
echo Packing mods_test to .tbuddy files...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0pack-mods.ps1" -ModsDir "%~dp0mods_test" -OutputDir "%~dp0tbuddy_test"
if errorlevel 1 goto :_tb_pack_failed

:: ================================================================
:: sbuddy 加密：release 和 test 分别处理
:: ================================================================

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

echo Using: %TB_SBUDDY_CRYPTO%

:: --- sbuddy_release ---
echo Packing .tbuddy to .sbuddy files (release)...
call :_tb_encrypt_sbuddy "%~dp0tbuddy_release" "%~dp0sbuddy_release"
if errorlevel 1 goto :_tb_sbuddy_failed

:: --- sbuddy_test ---
echo Packing .tbuddy to .sbuddy files (test)...
call :_tb_encrypt_sbuddy "%~dp0tbuddy_test" "%~dp0sbuddy_test"
if errorlevel 1 goto :_tb_sbuddy_failed

:_tb_after_sbuddy

echo Building Tauri app...
call pnpm tauri build --verbose > tauri-build.log 2>&1
if errorlevel 1 goto :_tb_build_failed



echo Build successful! Log saved to tauri-build.log.
pause
exit /b 0

:: ================================================================
:: 子过程：将指定 tbuddy 目录下的 .tbuddy 文件加密为 .sbuddy
:: 参数: %1 = tbuddy 源目录, %2 = sbuddy 输出目录
:: ================================================================
:_tb_encrypt_sbuddy
setlocal EnableDelayedExpansion
set "TB_TBUDDY_IN=%~1"
set "TB_SBUDDY_OUT=%~2"

if not exist "%TB_TBUDDY_IN%" (
  echo.
  echo [WARN] tbuddy directory not found: "%TB_TBUDDY_IN%", skipping.
  endlocal
  exit /b 0
)

if not exist "%TB_SBUDDY_OUT%" mkdir "%TB_SBUDDY_OUT%" >nul 2>&1
del /q "%TB_SBUDDY_OUT%\*.sbuddy" >nul 2>&1

set /a TB_SBUDDY_COUNT=0
for %%f in ("%TB_TBUDDY_IN%\*.tbuddy") do (
  if exist "%%~ff" (
    set "TB_IN=%%~ff"
    set "TB_OUT=%TB_SBUDDY_OUT%\%%~nf.sbuddy"
    echo   encrypt: "%%~nxf" ^> "%%~nf.sbuddy"
    "%TB_SBUDDY_CRYPTO%" encrypt < "!TB_IN!" > "!TB_OUT!"
    if errorlevel 1 (
      endlocal
      echo.
      echo [ERROR] Failed to generate sbuddy: "%%~nxf"
      exit /b 1
    )
    set /a TB_SBUDDY_COUNT+=1
  )
)

if !TB_SBUDDY_COUNT! LEQ 0 (
  echo   [WARN] No .tbuddy files found in "%TB_TBUDDY_IN%"
)

endlocal
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

