@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0\.."
title Probar la Cabalgata en tu ordenador

rem Prueba la Cabalgata entera en tu ordenador, con la web tal como está en tu carpeta.
rem  1. Crea en la base de datos una Cabalgata DE PRUEBA que solo ven la Junta y las
rem     cuentas de prueba (las familias reales no la ven), con familias de prueba.
rem  2. Abre la web en http://localhost:8888
rem  3. Cuando termines, borra todo lo de prueba.
rem Antes hay que haber ejecutado en Supabase las migraciones de supabase\pendientes.

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

echo.
echo Si quieres probar tambien con TU familia real, escribe el email de tu cuenta de socio.
echo ^(Enter para no usarla: solo cuentas de prueba^)
set "AMPA_FAMILIA_PRUEBA="
set /p "AMPA_FAMILIA_PRUEBA=Email: "
echo.
echo Preparando la Cabalgata de prueba...
node "pruebas\cabalgata\preparar-cabalgata.js"
if errorlevel 1 ( pause & exit /b 1 )

start "Web del AMPA - prueba Cabalgata" cmd /c node "%~dp0servidor-local.js"
timeout /t 2 >nul
start "" http://localhost:8888/login.html
start "" notepad "pruebas\cabalgata\cuentas-de-prueba.txt"

echo.
echo ============================================================
echo   La web esta abierta en http://localhost:8888
echo   Las cuentas de prueba estan en el Bloc de notas.
echo.
echo   Cuando TERMINES de probar, vuelve a esta ventana y pulsa
echo   una tecla: se borra la Cabalgata y las cuentas de prueba.
echo ============================================================
pause >nul

taskkill /fi "WINDOWTITLE eq Web del AMPA - prueba Cabalgata*" /t /f >nul 2>nul
echo Borrando los datos de prueba...
node "pruebas\cabalgata\borrar-cabalgata.js"
pause
