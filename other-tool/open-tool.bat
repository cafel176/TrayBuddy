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


REM Open tools via HTTP instead of file:// to avoid fetch(CORS) issues for i18n JSON

set "ROOT=%~dp0"
set "BASE_PORT=4173"
set "HOST=127.0.0.1"

REM Pick a port. If BASE_PORT is already used by another program, auto-pick a free one.
set "TB_HOST=%HOST%"
set "TB_BASE_PORT=%BASE_PORT%"
for /f "usebackq delims=" %%P in (`powershell -NoProfile -Command "$h=$env:TB_HOST; $base=[int]$env:TB_BASE_PORT; function Test-Tcp([int]$p){ $c=New-Object System.Net.Sockets.TcpClient; try{ $t=$c.ConnectAsync($h,$p); if($t.Wait(150) -and $c.Connected){ return $true } } catch {} finally { try{ $c.Dispose() } catch {} }; return $false }; function Test-Our([int]$p){ try{ $r=Invoke-WebRequest -UseBasicParsing -TimeoutSec 1 ('http://{0}:{1}/__tb_ping' -f $h,$p); return ($r.StatusCode -eq 200 -and $r.Content -match 'other-tool-dev-server') } catch { return $false } }; for($i=0;$i -le 50;$i++){ $cand=$base+$i; if(Test-Our $cand){ $cand; exit 0 } }; if(-not (Test-Tcp $base)){ $base; exit 0 }; for($i=1;$i -le 50;$i++){ $cand=$base+$i; if(-not (Test-Tcp $cand)){ $cand; exit 0 } }; $base"`) do set "PORT=%%P"



set "LOG=%TEMP%\other-tool-dev-server-%PORT%.log"
set "LOG_ERR=%TEMP%\other-tool-dev-server-%PORT%.err.log"


REM Tool directory (relative to other-tool). Default: spritesheet切分
set "TOOL=%~1"
if "%TOOL%"=="" set "TOOL=spritesheet切分"

REM Check if Node.js exists (optional)
set "HAS_NODE=1"
where node >nul 2>nul
if errorlevel 1 set "HAS_NODE=0"

REM If our dev server is not responding on this port, start it in background.
set "TB_HOST=%HOST%"
set "TB_PORT=%PORT%"
powershell -NoProfile -Command "$h=$env:TB_HOST; $p=[int]$env:TB_PORT; try{ $r=Invoke-WebRequest -UseBasicParsing -TimeoutSec 1 ('http://{0}:{1}/__tb_ping' -f $h,$p); if($r.StatusCode -eq 200 -and $r.Content -match 'other-tool-dev-server'){ exit 0 } } catch {} ; exit 1" >nul

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
powershell -NoProfile -Command "$wd=$env:TB_ROOT; $out=$env:TB_LOG; $err=$env:TB_LOG_ERR; $env:HOST=$env:TB_HOST; $env:PORT=$env:TB_PORT; Start-Process -WindowStyle Hidden -FilePath 'node' -ArgumentList @('dev-server.js') -WorkingDirectory $wd -RedirectStandardOutput $out -RedirectStandardError $err" >nul
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
REM Build URL (escape Chinese/space/special characters safely via PowerShell)
set "TB_HOST=%HOST%"
set "TB_PORT=%PORT%"
set "TB_TOOL=%TOOL%"
for /f "usebackq delims=" %%U in (`powershell -NoProfile -Command "$h=$env:TB_HOST; $p=[int]$env:TB_PORT; $t=$env:TB_TOOL; $t=$t.Trim('/').Trim([char]92); $ub=[System.UriBuilder]::new('http',$h,$p); $ub.Path = $t + '/'; $ub.Uri.AbsoluteUri"`) do set "URL=%%U"

echo [open-tool] Opening: %URL%
if defined TB_NO_BROWSER goto :eof
set "TB_URL=%URL%"
powershell -NoProfile -Command "Start-Process -FilePath $env:TB_URL"

goto :eof

:failed
echo [open-tool] Failed. Check logs: %LOG%  and  %LOG_ERR%
if defined TB_NO_PAUSE exit /b 2
pause
exit /b 2
