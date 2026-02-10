@echo off
chcp 65001 >nul
cd /d "%~dp0"
call open-tool.bat live2d导出
