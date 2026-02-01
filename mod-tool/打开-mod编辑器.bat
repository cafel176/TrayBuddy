@echo off
setlocal enabledelayedexpansion

REM Ensure UTF-8 for Chinese path args
chcp 65001 >nul

REM Open Mod Editor via HTTP instead of file:// to avoid fetch(CORS) issues for i18n JSON

set "ROOT=%~dp0"
set "PORT=4174"
set "HOST=127.0.0.1"

REM Ensure Node.js exists
where node >nul 2>nul
if errorlevel 1 (
  echo [open-tool] Node.js not found. Please install Node.js and retry.
  echo [open-tool] Or use VSCode Live Server to open the folder via HTTP.
  pause
  exit /b 1
)

REM If port is not listening, start dev server in background
powershell -NoProfile -Command "try { $c = New-Object System.Net.Sockets.TcpClient('%HOST%', %PORT%); if ($c.Connected) { $c.Close(); exit 0 } } catch { exit 1 }" >nul
if errorlevel 1 (
  set "LOG=%TEMP%\mod-tool-dev-server-%PORT%.log"
  start "mod-tool-dev-server" /b cmd /c "set "HOST=%HOST%"&&set "PORT=%PORT%"&&node "%ROOT%dev-server.mjs" 1>> "!LOG!" 2>>&1"

  REM Wait until server is ready (up to ~8s)
  powershell -NoProfile -Command "$ok=$false; for($i=0;$i -lt 40;$i++){ try { $c = New-Object System.Net.Sockets.TcpClient('%HOST%', %PORT%); if ($c.Connected) { $c.Close(); $ok=$true; break } } catch {}; Start-Sleep -Milliseconds 200 }; if(-not $ok){ Write-Host '[open-tool] Server did not start. Check log:' '%TEMP%\mod-tool-dev-server-%PORT%.log'; exit 2 }" 

  if errorlevel 1 (
    pause
    exit /b 2
  )
)

set "URL=http://%HOST%:%PORT%/"

echo [open-tool] Opening: %URL%
start "" "%URL%"

endlocal
