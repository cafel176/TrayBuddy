@echo off
setlocal EnableExtensions DisableDelayedExpansion

REM Ensure UTF-8 for Chinese path args
chcp 65001 >nul

REM Open tools via HTTP instead of file:// to avoid fetch(CORS) issues for i18n JSON

set "ROOT=%~dp0"
set "PORT=4173"
set "HOST=127.0.0.1"
set "LOG=%TEMP%\other-tool-dev-server-%PORT%.log"
set "LOG_ERR=%TEMP%\other-tool-dev-server-%PORT%.err.log"

REM Tool directory (relative to other-tool). Default: spritesheet切分
set "TOOL=%~1"
if "%TOOL%"=="" set "TOOL=spritesheet切分"

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
powershell -NoProfile -Command "$wd=$env:TB_ROOT; $out=$env:TB_LOG; $err=$env:TB_LOG_ERR; $env:HOST=$env:TB_HOST; $env:PORT=$env:TB_PORT; Start-Process -WindowStyle Hidden -FilePath 'node' -ArgumentList @('dev-server.js') -WorkingDirectory $wd -RedirectStandardOutput $out -RedirectStandardError $err" >nul
goto :waitServer

:startPs
echo [open-tool] Node.js not found. Falling back to PowerShell HTTP server... 1>>"%LOG%"
set "TB_ROOT=%ROOT%"
set "TB_LOG=%LOG%"
set "TB_LOG_ERR=%LOG_ERR%"
set "TB_HOST=%HOST%"
set "TB_PORT=%PORT%"
powershell -NoProfile -Command "$wd=$env:TB_ROOT; $out=$env:TB_LOG; $err=$env:TB_LOG_ERR; $h=$env:TB_HOST; $p=[int]$env:TB_PORT; Start-Process -WindowStyle Hidden -FilePath 'powershell' -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File','dev-server.ps1','-ListenHost',$h,'-Port',$p,'-Root',$wd) -WorkingDirectory $wd -RedirectStandardOutput $out -RedirectStandardError $err" >nul
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
