@echo off
chcp 65001 >nul
cd /d "%~dp0"

REM 直接设置工具名并启动
set "TOOL_NAME=二次元背景生成器"
set "PORT=4173"
set "HOST=127.0.0.1"

REM 检查端口是否已监听
powershell -NoProfile -Command "$h='%HOST%'; $p=[int]%PORT%; $c=New-Object System.Net.Sockets.TcpClient; try { $t=$c.ConnectAsync($h,$p); if($t.Wait(200) -and $c.Connected){ $c.Close(); exit 0 } } catch {} finally { try { $c.Dispose() } catch {} }; exit 1" >nul
if errorlevel 1 (
    REM 启动服务器
    start /b "" node dev-server.js >nul 2>nul
    timeout /t 2 /nobreak >nul
)

REM 直接构建 URL 并打开（使用硬编码的 URL 编码路径）
set "URL=http://%HOST%:%PORT%/%%E4%%BA%%8C%%E6%%AC%%A1%%E5%%85%%83%%E8%%83%%8C%%E6%%99%%AF%%E7%%94%%9F%%E6%%88%%90%%E5%%99%%A8/"
echo Opening: %URL%
start "" "%URL%"
