@echo off
setlocal EnableExtensions DisableDelayedExpansion

REM Ensure UTF-8 for Chinese path/args
chcp 65001 >nul

REM 启动时申请管理员权限（使用 fltmc 检测，避免 net session 在部分系统下失效）
>nul 2>&1 "%SystemRoot%\System32\fltmc.exe"
if errorlevel 1 goto :_tb_elevate

goto :_tb_got_admin

:_tb_elevate
set "TB_SELF=%~f0"
REM If the caller provides TB_ENTRY_BAT, elevate the *entry* script so TB_ROOT/TB_PORT are set correctly.
if defined TB_ENTRY_BAT set "TB_SELF=%TB_ENTRY_BAT%"
set "TB_CWD=%CD%"
set "TB_ARGS=%*"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$bat=$env:TB_SELF; $cwd=$env:TB_CWD; $a=$env:TB_ARGS; $q=[char]34; $cmd=$q+$bat+$q; if($a){$cmd+=' '+$a}; Start-Process -FilePath 'cmd.exe' -WorkingDirectory $cwd -ArgumentList @('/d','/c',$cmd) -Verb RunAs"
exit /b

:_tb_got_admin

if "%TB_ROOT%"=="" (
  echo [open-tool] TB_ROOT is not set. Please run the tool opener .bat, not open-tool-common.bat directly.
  if not defined TB_NO_PAUSE pause
  exit /b 2
)

if "%TB_PORT%"=="" set "TB_PORT=4173"
if "%TB_HOST%"=="" set "TB_HOST=127.0.0.1"
if "%TB_LOG_PREFIX%"=="" set "TB_LOG_PREFIX=tool-dev-server"
if "%TB_SERVER_ENTRY%"=="" set "TB_SERVER_ENTRY=dev-server.js"

set "ROOT=%TB_ROOT%"
set "PORT=%TB_PORT%"
set "HOST=%TB_HOST%"
set "LOG=%TEMP%\%TB_LOG_PREFIX%-%PORT%.log"
set "LOG_ERR=%TEMP%\%TB_LOG_PREFIX%-%PORT%.err.log"

REM Tool directory (relative to tool root). Default from TB_DEFAULT_TOOL
set "TOOL=%~1"
if "%TOOL%"=="" set "TOOL=%TB_DEFAULT_TOOL%"

REM Check if Node.js exists (optional)
set "HAS_NODE=1"
where node >nul 2>nul
if errorlevel 1 set "HAS_NODE=0"

REM If port is not listening, start dev server in background
powershell -NoProfile -Command "$h='%HOST%'; $p=[int]%PORT%; $c=New-Object System.Net.Sockets.TcpClient; try { $t=$c.ConnectAsync($h,$p); if($t.Wait(200) -and $c.Connected){ $c.Close(); exit 0 } } catch {} finally { try { $c.Dispose() } catch {} }; exit 1" >nul
if errorlevel 1 goto :startServer
goto :afterServer

:startServer
if "%HAS_NODE%"=="1" goto :startNode
goto :startPs

:startNode
echo [open-tool] Starting Node dev server... 1>>"%LOG%"
set "TB_LOG=%LOG%"
set "TB_LOG_ERR=%LOG_ERR%"
set "TB_HOST=%HOST%"
set "TB_PORT=%PORT%"
set "TB_ENTRY=%TB_SERVER_ENTRY%"
powershell -NoProfile -Command "$wd=$env:TB_ROOT; $out=$env:TB_LOG; $err=$env:TB_LOG_ERR; $env:HOST=$env:TB_HOST; $env:PORT=$env:TB_PORT; $entry=$env:TB_ENTRY; Start-Process -WindowStyle Hidden -FilePath 'node' -ArgumentList @($entry) -WorkingDirectory $wd -RedirectStandardOutput $out -RedirectStandardError $err" >nul
goto :waitServer

:startPs
echo [open-tool] Node.js not found. Falling back to PowerShell HTTP server... 1>>"%LOG%"
set "TB_LOG=%LOG%"
set "TB_LOG_ERR=%LOG_ERR%"
set "TB_HOST=%HOST%"
set "TB_PORT=%PORT%"
powershell -NoProfile -Command "$wd=$env:TB_ROOT; $wd=$wd.TrimEnd([IO.Path]::DirectorySeparatorChar,[IO.Path]::AltDirectorySeparatorChar); $out=$env:TB_LOG; $err=$env:TB_LOG_ERR; $h=$env:TB_HOST; $p=[int]$env:TB_PORT; $q=[char]34; $ps1=(Join-Path $wd 'dev-server.ps1'); $ps1q=$q+$ps1+$q; $wdq=$q+$wd+$q; Start-Process -WindowStyle Hidden -FilePath 'powershell' -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',$ps1q,'-ListenHost',$h,'-Port',$p,'-Root',$wdq) -WorkingDirectory $wd -RedirectStandardOutput $out -RedirectStandardError $err" >nul
goto :waitServer

:waitServer
set "TB_HOST=%HOST%"
set "TB_PORT=%PORT%"
set "TB_LOG=%LOG%"
powershell -NoProfile -Command "$ok=$false; $h=$env:TB_HOST; $p=[int]$env:TB_PORT; $log=$env:TB_LOG; for($i=0;$i -lt 40;$i++){ $c=New-Object System.Net.Sockets.TcpClient; try { $t=$c.ConnectAsync($h,$p); if($t.Wait(200) -and $c.Connected){ $c.Close(); $ok=$true; break } } catch {} finally { try { $c.Dispose() } catch {} }; Start-Sleep -Milliseconds 200 }; if(-not $ok){ Write-Host '[open-tool] Server did not start. Check log:' $log; exit 2 }" 
if errorlevel 1 goto :failed

:afterServer
REM Build URL (escape Chinese/space/special characters safely via PowerShell)
if not defined TOOL goto :openRoot
if "%TOOL%"=="" goto :openRoot

set "TB_HOST=%HOST%"
set "TB_PORT=%PORT%"
set "TB_TOOL=%TOOL%"
for /f "usebackq delims=" %%U in (`powershell -NoProfile -Command "$h=$env:TB_HOST; $p=[int]$env:TB_PORT; $t=$env:TB_TOOL; $t=$t.Trim('/').Trim([char]92); $ub=[System.UriBuilder]::new('http',$h,$p); $ub.Path = $t + '/'; $ub.Uri.AbsoluteUri"`) do set "URL=%%U"

goto :openUrl

:openRoot
set "URL=http://%HOST%:%PORT%/"

:openUrl
echo [open-tool] Opening: %URL%
if defined TB_NO_BROWSER goto :eof
set "TB_URL=%URL%"

REM Open URL via built-in cmd 'start' (avoid PowerShell Start-Process ArgumentList validation issues)
if "%URL%"=="" (
  echo [open-tool] URL is empty. Skip opening browser.
  goto :eof
)
start "" "%URL%" >nul 2>nul

goto :eof

:failed
echo [open-tool] Failed. Check logs: %LOG%  and  %LOG_ERR%
if defined TB_NO_PAUSE exit /b 2
pause
exit /b 2
