@echo off
setlocal EnableExtensions

REM Ensure UTF-8 code page so Chinese paths/filenames survive CMD -> PowerShell arg passing.
chcp 65001 >nul

REM One-click entry. Real argument handling is done in PowerShell to avoid CMD quoting issues.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0ExportVrma.ps1" %*
exit /b %ERRORLEVEL%
