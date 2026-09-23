# Portal AMPA Colegio Juan de Valdés — v2

Socios, adultos (login individual), alumnos, eventos con actividades/
exclusiones/voluntariado/invitados/documentos a firmar, préstamo de libros
con stock, comprobantes de pago, carrusel de fotos, web pública con alta
autoservicio, envío de email masivo, y reseteo anual automático.

## Estructura

```
ampa-portal-v2/
├── netlify.toml, package.json
├── netlify/functions/
│   ├── _lib/email.js              <- utilidad SMTP compartida
│   ├── admin-import-socios.js     <- alta de socios (CSV/manual) por un admin
│   ├── invitar-adulto.js          <- añadir 2º adulto desde "Mis datos"
│   ├── autoservicio-alta.js       <- alta completa self-service ("Hazte socio")
│   └── enviar-email-masivo.js     <- envío de email a una lista de destinatarios
├── supabase/
│   ├── schema.sql                        <- esquema completo (proyecto NUEVO)
│   └── migracion-*.sql                   <- migraciones incrementales (proyecto YA desplegado)
├── shared/ (config.js, supabaseClient.js, nav.js, styles.css, csv.js,
│            helpers.js, catalogo.js, carrusel.js, documentoRellenable.js)
├── assets/ (logos)
├── index.html, publico.html, hazte-socio.html      <- web pública
├── login.html, cambiar-clave.html,
│   estado-recien-creada.html, estado-falta-pago.html
├── dashboard.html, mis-datos.html, prestamo.html, eventos.html,
│   uniformes.html, encuestas.html
└── admin-importar.html, admin-comprobantes.html, admin-eventos.html,
    admin-libros.html, admin-uniformes.html, admin-encuestas.html,
    admin-sepa.html, admin-carrusel.html, admin-email.html,
    admin-respuestas.html, admin-documentos.html
```

> **Nota:** la lista de archivos de arriba está actualizada a fecha de
> esta sesión, pero para la explicación completa y al día de cómo está
> construido cada módulo (esquema de base de datos, convenciones,
> mecánica de negocio de cada funcionalidad), consulta **`ESTRUCTURA.md`**
> en la raíz del proyecto — ese archivo se mantiene actualizado en cada
> sesión de trabajo, este README se centra solo en el despliegue.

---

## A. Si es un proyecto de Supabase NUEVO (o vacío)

1. Crea el proyecto en https://supabase.com/dashboard.
2. **SQL Editor → New query** → pega **todo** `supabase/schema.sql` → **Run**.
   Ya incluye absolutamente todo lo construido hasta la fecha — no hace
   falta ninguna migración adicional.
3. Ve a **Project Settings → API Keys** (o "Data API"): copia el
   **Project URL** y la **Publishable key**.
4. Abre `shared/config.js` y pon ahí esos dos valores
   (`SUPABASE_URL`, `SUPABASE_ANON_KEY`). **Este archivo es tuyo — nunca
   te lo vuelvo a mandar en futuras actualizaciones**, así que edítalo tú
   directamente cada vez que cambies de proyecto.
5. **Authentication → Providers → Email** → **desactiva "Confirm email"**.
   Imprescindible: el alta autoservicio ("Hazte socio") necesita que la
   persona quede con sesión activa nada más registrarse.
6. **Configura "Recuperar contraseña"** — ver la sección dedicada más
   abajo, es un paso de configuración obligatorio, no solo recomendado.

## B. Si ya tenías el proyecto v2 desplegado (actualizar sin perder datos)

Ejecuta las migraciones nuevas de `supabase/migracion-*.sql` en el SQL
Editor, en el orden en que se fueron creando (revisa las fechas de los
archivos o el histórico de la sesión en que se generaron), saltándote
las que ya hayas ejecutado antes. Ninguna de ellas borra datos existentes.

## Crear el primer administrador (una sola vez, cualquiera de los dos casos)

Sáltate esto si ya tienes uno funcionando.

1. **Authentication → Users → Add user** (marca "Auto Confirm User").
   Copia el UUID que se genera.
2. **SQL Editor**, sustituyendo los valores en mayúsculas:
   ```sql
   insert into socios (anio_ultima_cuota, numero_secuencial, estado)
   values (2026, '0000', 'activa')
   returning id; -- copia el id que devuelve, lo necesitas abajo

   insert into adultos (id, socio_id, nombre, apellidos, dni_nie, email,
                        direccion, ciudad, provincia, codigo_postal, movil,
                        role, force_password_change)
   values ('PEGA-UUID-DEL-USUARIO', 'PEGA-ID-DEL-SOCIO', 'Admin', 'AMPA',
           '00000000A', 'tu-email@ejemplo.com', '—', '—', '—', '00000',
           '600000000', 'admin', false);
   ```

---

## Recuperar contraseña — configuración obligatoria en Supabase

El código (`login.html` → `sb.auth.resetPasswordForEmail(...)` →
`cambiar-clave.html`) ya está hecho y no necesita ningún cambio, pero
**no funciona correctamente hasta que hagas estos tres ajustes en el
panel de Supabase**, uno por uno, la primera vez que despliegues (o al
migrar a un proyecto de Supabase nuevo):

### 1. Añadir la URL de vuelta a la lista blanca

Sin esto, Supabase rechaza el redirect o manda a la persona a un sitio
por defecto en vez de a `cambiar-clave.html`.

- **Authentication → URL Configuration → Redirect URLs**
- Añade: `https://TU-SITIO.netlify.app/cambiar-clave.html`
  (sustituye por tu dominio real; si usas un dominio propio en vez del
  de Netlify, añade esa versión también).

### 2. Conectar un SMTP propio para los emails de Auth

Por defecto, Supabase envía estos emails con su propio servicio, con
límite muy bajo de envíos por hora (pensado solo para pruebas, no para
producción) y sin vuestra marca. Solucionadlo conectando el mismo buzón
SMTP que ya usáis para el resto de emails del portal:

- **Authentication → Emails → SMTP Settings** (activa "Enable Custom SMTP")
- Rellena con los mismos valores que ya tienes en las variables de
  entorno de Netlify:
  - **Host**: el mismo valor que `SMTP_HOST`
  - **Port**: el mismo valor que `SMTP_PORT`
  - **Username**: el mismo valor que `SMTP_USER`
  - **Password**: el mismo valor que `SMTP_PASSWORD`
  - **Sender email**: el mismo valor que `SMTP_USER`
  - **Sender name**: el mismo valor que `SMTP_FROM_NAME`
- Guarda.

### 3. Poner la plantilla del email en español

Por defecto, el email que envía Supabase está en inglés y sin vuestra
marca.

- **Authentication → Email Templates → "Reset Password"**
- **Subject**: `Restablece tu contraseña — AMPA Colegio Juan de Valdés`
- **Message body (HTML)**: pega el contenido de
  `plantilla-email-recuperar-contrasena.html` (incluido en el proyecto).
  No toques la variable `{{ .ConfirmationURL }}` que hay dentro — es la
  que Supabase rellena automáticamente con el enlace real.
- Guarda.

### Cómo probarlo

1. `login.html` → "¿Has olvidado tu contraseña?" con un email de socio real.
2. Comprueba que llega el correo en español, con vuestra marca, desde
   vuestro propio buzón (no desde una dirección de Supabase).
3. El botón del correo debe llevar a `cambiar-clave.html` con el título
   "Restablece tu contraseña" (distinto del mensaje que ves cuando
   entras forzado por primera vez).
4. Si esperas y vuelves a abrir un enlace ya usado o caducado, debe
   aparecer la pantalla "Enlace no válido o caducado" con un botón para
   volver al acceso, no un error en blanco.

---

## Variables de entorno en Netlify

| Variable | Valor |
|---|---|
| `SUPABASE_URL` | tu Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | tu **Secret key** (`sb_secret_...`) — nunca en el código, solo aquí |
| `SMTP_HOST` | `smtp.serviciodecorreo.es` (o el de tu hosting) |
| `SMTP_PORT` | `465` |
| `SMTP_USER` | el buzón completo (ej. `ampa_j_valdes@fapaginerdelosrios.org`) |
| `SMTP_PASSWORD` | la contraseña de ese buzón |
| `SMTP_FROM_NAME` | `AMPA Colegio Juan de Valdés` |
| `SITE_URL` | la URL final de tu sitio (ej. `https://tu-sitio.netlify.app`), sin barra al final |

## Desplegar en Netlify

1. Sube el proyecto a un repositorio de GitHub (arrastrando los archivos,
   o con `git push` si usas terminal).
2. En Netlify: **Add new site → Import an existing project → GitHub** →
   selecciona el repositorio. Deja la configuración que detecta sola
   (viene de `netlify.toml`) → **Deploy**.
3. Añade las variables de entorno de la tabla de arriba en
   **Site configuration → Environment variables**.
4. **Deploys → Trigger deploy → Clear cache and deploy site** (para que
   las funciones cojan las variables nuevas).

**Importante:** este proyecto no se puede desplegar arrastrando la carpeta
directamente (drag-and-drop) porque tiene funciones de servidor
(`netlify/functions`) que necesitan `npm install` durante el build.

## Probar sin gastar despliegues de Netlify

**Solo páginas, sin las funciones de servidor:**
```bash
python3 -m http.server 8000
```
y abre `http://localhost:8000/login.html`.

**Todo, incluidas las funciones**, usando la Netlify CLI, en tu propio
ordenador, sin tocar servidores de Netlify:
```bash
npm install -g netlify-cli   # una sola vez
npm install                  # trae las dependencias (nodemailer, etc.)
netlify link                 # vincula con tu sitio real, para heredar
                              # las variables de entorno ya configuradas
netlify dev                  # arranca todo en local (normalmente en :8888)
```

## Checklist rápida para verificar que todo funciona

1. `login.html` carga sin errores en la consola (F12).
2. Entras con el usuario admin → ves los tiles de administración en Inicio.
3. **Alta de socios** → das de alta un socio de prueba → te llega el
   email con la contraseña provisional.
4. Entras con esa cuenta de prueba → cambias la contraseña → completas
   "Mis datos".
5. **"¿Has olvidado tu contraseña?"** en `login.html` → te llega el
   email en español, con vuestra marca → el enlace funciona.
6. Borra la cuenta de prueba cuando termines (Authentication → Users).

## Reseteo anual automático

Cada 31 de julio a las 00:00 UTC, `pg_cron` pone todas las cuentas
`activa` en `falta_pago` y todos los alumnos en `verificado = false`.

## Notas de redes sociales

- **YouTube**: pon tu API key y el ID del canal en `index.html`
  (`YOUTUBE_API_KEY` / `YOUTUBE_CHANNEL_ID`).
- **Instagram / WhatsApp / email**: iconos circulares en la portada
  (edítalos en `index.html` si cambian las cuentas).

## Catálogo de libros y cursos

Las etapas y cursos (`CURSOS_POR_ETAPA`) viven en `shared/catalogo.js`.
