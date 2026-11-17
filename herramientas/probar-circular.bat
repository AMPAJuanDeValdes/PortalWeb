@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0\.."
title Ver la circular de un evento

rem Muestra en tu ordenador qué quedaría escrito en la circular de un evento
rem (el PDF y el email), sin guardar nada en el correo del AMPA ni en el historial.
rem Lee los eventos de la base de datos real. Deja los archivos en
rem herramientas\circulares-de-prueba y los abre.

where node >nul 2>nul
if errorlevel 1 (
  echo [!] No tienes Node.js instalado. Descargalo de https://nodejs.org ^(version LTS^).
  start https://nodejs.org/es/download
  pause
  exit /b 1
)
if not exist "%USERPROFILE%\ampa-pruebas.env" (
  echo [!] Falta tu archivo de claves: %USERPROFILE%\ampa-pruebas.env
  echo     Ejecuta primero pruebas\ejecutar-pruebas.bat, que lo crea y te dice que poner.
  pause
  exit /b 1
)
if not exist "node_modules\@supabase\supabase-js" (
  echo Instalando lo necesario ^(solo la primera vez^)...
  call npm install --no-audit --no-fund
  if errorlevel 1 ( echo [!] Fallo al instalar. & pause & exit /b 1 )
)

node "herramientas\probar-circular.js"
echo.
pause
