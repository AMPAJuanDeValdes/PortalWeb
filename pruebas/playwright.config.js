// Configuración de las pruebas automáticas. Lee "pruebas/.env" y las
// claves públicas de "../shared/config.js" (no hace falta repetirlas).
const { defineConfig } = require('@playwright/test');
const { cargarEntorno } = require('./ayudantes/entorno');

// Modo local (ejecutar-pruebas-local.bat): prueba la web de tu ordenador,
// sin subir nada a Netlify. Arranca el servidor local él solo.
const LOCAL = process.env.AMPA_LOCAL === '1';
if (LOCAL) process.env.SITE_URL = 'http://localhost:8888';
cargarEntorno();

module.exports = defineConfig({
  testDir: './tests',
  // Las pruebas comparten datos reales (cuentas de prueba): una detrás de otra
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  globalSetup: require.resolve('./ayudantes/preparar.js'),
  globalTeardown: require.resolve('./ayudantes/limpiar.js'),
  outputDir: 'resultados',
  reporter: [['list'], ['html', { outputFolder: 'informe', open: 'never' }]],
  use: {
    baseURL: process.env.SITE_URL,
    locale: 'es-ES',
    timezoneId: 'Europe/Madrid',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 30_000
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  ...(LOCAL ? { webServer: { command: 'node ../herramientas/servidor-local.js', url: 'http://localhost:8888/login.html', reuseExistingServer: true, timeout: 60_000 } } : {})
});
