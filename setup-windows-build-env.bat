@echo off
setlocal EnableExtensions EnableDelayedExpansion

rem TrayBuddy - Windows build environment bootstrapper
rem - Installs: Node.js LTS, Rustup, VS2022 Build Tools (C++), NSIS, WebView2 Runtime
rem - Optional: run build when called with: setup-windows-build-env.bat build

rem ---------------------------------------------------------------------------
rem Auto-elevate to Administrator (UAC)
rem ---------------------------------------------------------------------------
net session >nul 2>&1
if errorlevel 1 (
  if /I "%~1"=="--elevated" (
    echo [ERROR] Failed to obtain Administrator privileges.
    echo         Please right-click and choose "Run as administrator".
    pause
    exit /b 1
  )

  echo [INFO] Requesting Administrator privileges...
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -ArgumentList '--elevated %*' -Verb RunAs" >nul 2>&1
  pause
  exit /b
)


rem Remove the internal elevation flag if present
if /I "%~1"=="--elevated" shift

echo.
echo === TrayBuddy Windows Build Env Setup ===
echo.

if not exist "%~dp0package.json" (
  echo [WARN] Cannot find package.json next to this script.
  echo        Please place this file in the project root and run again.
  echo.
)

where winget >nul 2>&1
if errorlevel 1 (
  echo [ERROR] winget not found.
  echo         Please install "App Installer" from Microsoft Store (provides winget),
  echo         then re-run this script.
  echo.
  pause
  exit /b 1
)


call :install "OpenJS.NodeJS.LTS" "Node.js LTS"
call :install "Rustlang.Rustup" "Rustup (Rust toolchain manager)"
call :install_vs_buildtools
call :install "NSIS.NSIS" "NSIS (installer builder)"
call :install "Microsoft.EdgeWebView2Runtime" "WebView2 Runtime"

echo.
echo === Post-install setup ===
echo.

call :ensure_node
if errorlevel 1 (
  echo [WARN] Node.js still not detected in PATH in this session.
  echo        Close this terminal, open a new one, and re-run this script.
  echo.
  goto :maybe_build
)

call :ensure_pnpm
call :ensure_rust
call :ensure_msvc

:maybe_build
if /I "%~1"=="build" (
  echo.
  echo === Running build (pnpm install + pnpm tauri build) ===
  echo.
  pushd "%~dp0"
  call pnpm install
  if errorlevel 1 (
    echo [ERROR] pnpm install failed.
    popd
    pause
    exit /b 1
  )

  rem Use vcvars64 if available to ensure MSVC env for this session
  call :try_vcvars64

  call pnpm tauri build
  if errorlevel 1 (
    echo [ERROR] tauri build failed.
    popd
    pause
    exit /b 1
  )
  popd
)


echo.
echo === Done ===
echo If some tools were installed just now, you may need to open a NEW terminal.
echo.
pause
exit /b 0


:install
set "PKG=%~1"
set "NAME=%~2"
echo [INFO] Installing %NAME% ...
rem Use --accept-package-agreements / --accept-source-agreements for non-interactive
winget install -e --id "%PKG%" --accept-package-agreements --accept-source-agreements --silent
if errorlevel 1 (
  echo [WARN] winget install failed (or already installed): %NAME%
) else (
  echo [OK]  %NAME%
)
goto :eof


:install_vs_buildtools
echo [INFO] Installing Visual Studio 2022 Build Tools (C++ workload) ...
rem Workload + Windows SDK; winget uses installer override args.
rem If you already have VS/BuildTools installed, this will no-op or update components.
set "VS_OVERRIDE=--add Microsoft.VisualStudio.Workload.VCTools --includeRecommended --includeOptional --quiet --wait --norestart"
winget install -e --id "Microsoft.VisualStudio.2022.BuildTools" --accept-package-agreements --accept-source-agreements --silent --override "%VS_OVERRIDE%"
if errorlevel 1 (
  echo [WARN] VS Build Tools install failed (or already installed). You may need Admin rights.
) else (
  echo [OK]  Visual Studio Build Tools
)
goto :eof


:ensure_node
where node >nul 2>&1
if errorlevel 1 (
  rem Preserve errorlevel for the caller without using exit.
  cmd /c exit /b 1
  goto :eof
)
for /f "tokens=*" %%i in ('node -v') do set "NODEV=%%i"
echo [OK]  node %NODEV%
goto :eof


:ensure_pnpm
where corepack >nul 2>&1
if errorlevel 1 (
  echo [WARN] corepack not found. Trying to enable pnpm via npm...
  where npm >nul 2>&1
  if errorlevel 1 (
    echo [WARN] npm not found; skip pnpm setup.
    goto :eof
  )
  call npm i -g pnpm
  goto :eof
)

call corepack enable
rem Pin a known major; adjust if you want to lock a specific version.
call corepack prepare pnpm@latest --activate

where pnpm >nul 2>&1
if errorlevel 1 (
  echo [WARN] pnpm still not detected in PATH. Reopen terminal and try again.
  goto :eof
)
for /f "tokens=*" %%i in ('pnpm -v') do set "PNPMV=%%i"
echo [OK]  pnpm %PNPMV%
goto :eof


:ensure_rust
set "RUSTUP=%USERPROFILE%\.cargo\bin\rustup.exe"
if exist "%RUSTUP%" (
  echo [INFO] Setting up Rust toolchain...
  "%RUSTUP%" toolchain install stable --profile minimal
  "%RUSTUP%" default stable
  "%RUSTUP%" target add x86_64-pc-windows-msvc
  "%RUSTUP%" component add rustfmt
  "%RUSTUP%" component add clippy
  goto :eof
)

where rustup >nul 2>&1
if errorlevel 1 (
  echo [WARN] rustup not found in PATH (may require new terminal).
  goto :eof
)

echo [INFO] Setting up Rust toolchain...
call rustup toolchain install stable --profile minimal
call rustup default stable
call rustup target add x86_64-pc-windows-msvc
call rustup component add rustfmt
call rustup component add clippy
goto :eof


:try_vcvars64
set "VSWHERE=%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe"
if not exist "%VSWHERE%" goto :eof

for /f "usebackq tokens=*" %%i in (`"%VSWHERE%" -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath`) do set "VSINST=%%i"
if not defined VSINST goto :eof
set "VCVARS=%VSINST%\VC\Auxiliary\Build\vcvars64.bat"
if exist "%VCVARS%" (
  call "%VCVARS%" >nul
)
goto :eof


:ensure_msvc
call :try_vcvars64
where cl >nul 2>&1
if errorlevel 1 (
  echo [WARN] MSVC cl.exe not found in this session.
  echo        Build Tools may be installed but not in PATH. This is OK for Rust in many cases,
  echo        but if tauri build fails with linker errors, open "x64 Native Tools Command Prompt" or
  echo        re-run with vcvars64.
  goto :eof
)
echo [OK]  MSVC toolchain detected (cl.exe)
goto :eof

