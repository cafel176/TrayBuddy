@echo off
setlocal enabledelayedexpansion

REM Ensure UTF-8 for Chinese path args
chcp 65001 >nul

REM Open tools via HTTP instead of file:// to avoid fetch(CORS) issues for i18n JSON

set "ROOT=%~dp0"
set "PORT=4173"
set "HOST=127.0.0.1"

REM Tool directory (relative to other-tool). Default: spritesheet切分
set "TOOL=%~1"
if "%TOOL%"=="" set "TOOL=spritesheet切分"

REM Ensure Node.js exists
where node >nul 2>nul
if errorlevel 1 (
  echo [open-tool] Node.js not found. Please install Node.js and retry.
  echo [open-tool] Or use VSCode Live Server to open the folder via HTTP.
  pause
  exit /b 1
)

REM If port is not listening, start dev server in background
powershell -NoProfile -Command "if (-not (Test-NetConnection -ComputerName '%HOST%' -Port %PORT% -InformationLevel Quiet)) { exit 1 } else { exit 0 }" >nul
if errorlevel 1 (
  set "LOG=%TEMP%\other-tool-dev-server-%PORT%.log"
  start "other-tool-dev-server" /b cmd /c "set HOST=%HOST%&& set PORT=%PORT%&& node \"%ROOT%dev-server.js\" 1>> \"!LOG!\" 2>>&1"

  REM Wait until server is ready (up to ~8s)
  powershell -NoProfile -Command "$ok=$false; for($i=0;$i -lt 40;$i++){ if(Test-NetConnection -ComputerName '%HOST%' -Port %PORT% -InformationLevel Quiet){$ok=$true; break}; Start-Sleep -Milliseconds 200 }; if(-not $ok){ Write-Host '[open-tool] Server did not start. Check log:' '%TEMP%\other-tool-dev-server-%PORT%.log'; exit 2 }" 
  if errorlevel 1 (
    pause
    exit /b 2
  )
)

REM Build URL (escape Chinese characters safely via PowerShell)
for /f "usebackq delims=" %%U in (`powershell -NoProfile -Command "[System.Uri]::EscapeUriString(('http://%HOST%:%PORT%/' + '%TOOL%'.Trim('/').Trim('\\') + '/'))"`) do set "URL=%%U"

echo [open-tool] Opening: %URL%
start "" "%URL%"

endlocal
