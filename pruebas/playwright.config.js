// Configuración de las pruebas automáticas. Lee "pruebas/.env" y las
// claves públicas de "../shared/config.js" (no hace falta repetirlas).
const { defineConfig } = require('@playwright/test');
const { cargarEntorno } = require('./ayudantes/entorno');

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
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }]
});
