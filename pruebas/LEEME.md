# Pruebas automáticas del portal

47 pruebas que abren tu web real en un navegador invisible y comprueban, como
lo haría una persona: acceso y contraseñas, cuentas de baja, Hazte socio,
Reactivar cuenta, el panel de Socios del admin, Mis datos, la Mochila y la
seguridad entre familias.

## Cómo ejecutarlas

Doble clic en **`pruebas\ejecutar-pruebas.bat`**.

- **La primera vez** te pide instalar Node.js si no lo tienes (https://nodejs.org,
  versión LTS) y abre un archivo de configuración en el Bloc de notas con 3 datos:
  - `SITE_URL`: la dirección de tu web (ej. `https://tu-sitio.netlify.app`)
  - `SUPABASE_SERVICE_ROLE_KEY`: la *Secret key* de Supabase (la misma que en Netlify)
  - `EMAIL_PRUEBAS`: un email tuyo de Gmail
  Guárdalo, ciérralo y vuelve a hacer doble clic. Después instala lo
  necesario (unos minutos, solo esa vez).
- **Las siguientes veces** solo ejecuta las pruebas (unos 5-10 minutos) y al
  final abre un informe en el navegador.

## Qué debes saber

- Se prueba contra tu **web y base de datos reales**. Cada prueba crea sus
  propias familias de prueba (email `tu.email+ampa-prueba-...@gmail.com`) y
  **se borran todas al terminar**, también los restos de una ejecución que se
  hubiera cortado. Nunca se tocan datos de socios reales.
- Te llegarán unos 10 correos a tu Gmail (bienvenidas, contraseñas, rechazo...):
  sirven para comprobar a ojo que los emails salen bien.
- El archivo con la clave secreta está en `C:\Users\<tú>\ampa-pruebas.env`,
  **fuera del proyecto** a propósito: así nunca se sube a GitHub ni a la web.
- No subas la carpeta `pruebas\node_modules` a GitHub (pesa mucho). La carpeta
  `pruebas` en sí no hace daño: Netlify no la publica (`netlify.toml`).

## No se prueba (todavía)

Los repartos y convocatorias de libros y uniformes (las pruebas no tocan
vuestras convocatorias reales), encuestas, eventos y la firma del mandato
SEPA. De libros y uniformes sí se prueba: catálogo, movimientos de stock,
compras y el filtro de libros por curso.
