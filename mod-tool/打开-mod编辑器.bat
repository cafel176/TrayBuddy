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
set "TB_CWD=%CD%"
set "TB_ARGS=%*"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$bat=$env:TB_SELF; $cwd=$env:TB_CWD; $a=$env:TB_ARGS; $q=[char]34; $cmd=$q+$bat+$q; if($a){$cmd+=' '+$a}; Start-Process -FilePath 'cmd.exe' -WorkingDirectory $cwd -ArgumentList @('/d','/c',$cmd) -Verb RunAs"
exit /b

:_tb_got_admin


REM Open Mod Editor via HTTP instead of file:// to avoid fetch(CORS) issues for i18n JSON

set "ROOT=%~dp0"
set "PORT=4174"
set "HOST=127.0.0.1"
set "LOG=%TEMP%\mod-tool-dev-server-%PORT%.log"
set "LOG_ERR=%TEMP%\mod-tool-dev-server-%PORT%.err.log"

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
set "TB_ROOT=%ROOT%"
set "TB_LOG=%LOG%"
set "TB_LOG_ERR=%LOG_ERR%"
set "TB_HOST=%HOST%"
set "TB_PORT=%PORT%"
powershell -NoProfile -Command "$wd=$env:TB_ROOT; $out=$env:TB_LOG; $err=$env:TB_LOG_ERR; $env:HOST=$env:TB_HOST; $env:PORT=$env:TB_PORT; Start-Process -WindowStyle Hidden -FilePath 'node' -ArgumentList @('dev-server.mjs') -WorkingDirectory $wd -RedirectStandardOutput $out -RedirectStandardError $err" >nul
goto :waitServer

:startPs
echo [open-tool] Node.js not found. Falling back to PowerShell HTTP server... 1>>"%LOG%"
set "TB_ROOT=%ROOT%"
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
set "URL=http://%HOST%:%PORT%/"

echo [open-tool] Opening: %URL%
if defined TB_NO_BROWSER goto :eof
start "" "%URL%"

goto :eof

:failed
echo [open-tool] Failed. Check logs: %LOG%  and  %LOG_ERR%
if defined TB_NO_PAUSE exit /b 2
pause
exit /b 2
