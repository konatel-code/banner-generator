@echo off
title CK DAKA – Banner Generator
echo.
echo  ==========================================
echo   CK DAKA – Generator reklamnych bannerov
echo  ==========================================
echo.
echo  Spustam server na http://localhost:3456
echo  Zatvorte toto okno pre zastavenie servera.
echo.
cd /d "%~dp0"
start "" "http://localhost:3456"
node server.js
pause
