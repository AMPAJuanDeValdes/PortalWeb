@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title Pruebas automaticas - Portal AMPA

echo.
echo ============================================
echo   Pruebas automaticas del Portal AMPA
echo ============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [!] No tienes Node.js instalado.
  echo     Descargalo de https://nodejs.org ^(version LTS^), instalalo y vuelve a ejecutar este archivo.
  start https://nodejs.org/es/download
  pause
  exit /b 1
)

set "CONFIG=%USERPROFILE%\ampa-pruebas.env"
if not exist "%CONFIG%" (
  copy /y "plantilla-config.env" "%CONFIG%" >nul
  echo [1/3] He creado tu archivo de configuracion:
  echo       %CONFIG%
  echo.
  echo       Se va a abrir en el Bloc de notas. Rellena los 3 datos, GUARDA y cierra.
  echo       Despues vuelve a hacer doble clic en ejecutar-pruebas.bat
  echo.
  notepad "%CONFIG%"
  pause
  exit /b 0
)

if not exist "node_modules\@playwright\test" (
  echo [2/3] Instalando lo necesario ^(solo la primera vez, tarda unos minutos^)...
  call npm install --no-audit --no-fund
  if errorlevel 1 ( echo [!] Fallo al instalar. & pause & exit /b 1 )
  call npx playwright install chromium
  if errorlevel 1 ( echo [!] Fallo al instalar el navegador de pruebas. & pause & exit /b 1 )
)

if /i "%~1"=="local" (
  set AMPA_LOCAL=1
  if not exist "..\node_modules\@supabase\supabase-js" ( pushd .. & call npm install --no-audit --no-fund & popd )
  echo [3/3] Ejecutando las pruebas contra la web de TU ORDENADOR ^(sin Netlify^)...
) else (
  echo [3/3] Ejecutando las pruebas contra tu web real...
)
echo       ^(las cuentas de prueba se crean y se borran solas al terminar^)
echo.
call npx playwright test
set RESULTADO=%errorlevel%

echo.
if "%RESULTADO%"=="0" (
  echo ============================================
  echo   TODO CORRECTO
  echo ============================================
) else (
  echo ============================================
  echo   HAY PRUEBAS QUE HAN FALLADO
  echo   Se abre el informe en el navegador. Si quieres que lo arregle,
  echo   dime "revisa el informe de pruebas" y lo leo de tu carpeta.
  echo ============================================
)
start "" npx playwright show-report informe
pause
