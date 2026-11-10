@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0\.."
title Prueba de documentos (en tu ordenador)

rem Prueba los documentos para firmar (Cabalgata...) en tu ordenador.
rem No lee ni guarda nada en la base de datos: usa datos de prueba.

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

start "" http://localhost:8888/pruebas-local/documentos.html
node "%~dp0servidor-local.js"
pause
