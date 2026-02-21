@echo off
setlocal EnableExtensions DisableDelayedExpansion

REM Ensure UTF-8 for Chinese path/args
chcp 65001 >nul

set "TB_ROOT=%~dp0"
set "TB_PORT=4174"
set "TB_HOST=127.0.0.1"
set "TB_LOG_PREFIX=mod-tool-dev-server"
set "TB_SERVER_ENTRY=dev-server.mjs"
set "TB_DEFAULT_TOOL="

call "%~dp0..\tools-common\open-tool-common.bat" %*
