@echo off
cd /d "%~dp0"
set "COV_IGNORE_REGEX=app_state\.rs$|lib\.rs$|main\.rs$|lib_helpers\.rs$|commands[\\/].*\.rs$|resource_runtime\.rs$|resource_fs_runtime\.rs$|state_runtime\.rs$|environment_runtime\.rs$|mod_archive_runtime\.rs$|storage_runtime\.rs$|media_observer\.rs$|system_observer\.rs$|process_observer\.rs$|event_manager\.rs$|window\.rs$|thread\.rs$|i18n\.rs$"

echo Building coverage binaries...
cargo llvm-cov --workspace --tests --no-run --ignore-filename-regex "%COV_IGNORE_REGEX%" 2>nul

echo Deploying manifest for coverage test exe...
for /f "delims=" %%E in ('dir /b /s target\llvm-cov-target\debug\deps\traybuddy_lib-*.exe 2^>nul') do (
  if not exist "%%E.manifest" (
    > "%%E.manifest" echo ^<?xml version='1.0' encoding='UTF-8' standalone='yes'?^>^<assembly xmlns='urn:schemas-microsoft-com:asm.v1' manifestVersion='1.0'^>^<dependency^>^<dependentAssembly^>^<assemblyIdentity type='win32' name='Microsoft.Windows.Common-Controls' version='6.0.0.0' processorArchitecture='*' publicKeyToken='6595b64144ccf1df' language='*'/^>^</dependentAssembly^>^</dependency^>^</assembly^>
    echo   Created manifest for: %%~nxE
  )
)

echo Running coverage...
cargo llvm-cov --workspace --tests --summary-only --ignore-filename-regex "%COV_IGNORE_REGEX%" -- --test-threads=1

pause
