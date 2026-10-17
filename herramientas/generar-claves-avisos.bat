@echo off
chcp 65001 >nul
cd /d "%~dp0\.."
title Claves de los avisos en el movil
where node >nul 2>nul
if errorlevel 1 (
  echo [!] No tienes Node.js instalado. Descargalo de https://nodejs.org ^(version LTS^).
  pause
  exit /b 1
)
node "%~dp0generar-claves-avisos.js"
pause
