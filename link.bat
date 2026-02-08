@echo off

rem Re-link libraries

mklink /j %USERPROFILE%\Documents\ComfyUI\user\default\workflows %~dp0workflows

pause