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
6. **Añade la URL de `cambiar-clave.html` a Redirect URLs** — ver la
   sección "Recuperar contraseña" más abajo.
7. El IBAN del AMPA que se muestra en la web está en `shared/datos-ampa.js`.

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

## Recuperar contraseña

Desde esta versión, el correo de "¿Has olvidado tu contraseña?" **lo envía
nuestra propia función** (`netlify/functions/recuperar-contrasena.js`) con
el buzón SMTP del AMPA, no Supabase. Solo se envía a cuentas **activas** y
como mucho **una vez cada 15 minutos** por email. Por eso ya **no hace
falta** configurar el SMTP ni la plantilla "Reset Password" dentro de
Supabase (si ya lo hiciste, no molesta).

Lo único que sigue siendo obligatorio en Supabase:

- **Authentication → URL Configuration → Redirect URLs** → añade
  `https://TU-SITIO.netlify.app/cambiar-clave.html` (y la versión con tu
  dominio propio si lo usas). Sin esto, el enlace del correo no lleva a
  `cambiar-clave.html`.
- La variable `SITE_URL` de Netlify debe ser la URL real del sitio (el
  enlace del correo se construye con ella).

### Cómo probarlo

1. `login.html` → "¿Has olvidado tu contraseña?" con el email de un socio
   **activo** → llega el correo del buzón del AMPA.
2. Pulsa otra vez enseguida → te dice que esperes 15 minutos (no llega otro).
3. Con el email de una cuenta de baja o inexistente → no se envía nada y
   te ofrece "Reactivar" / "Hazte socio".
4. El botón del correo lleva a `cambiar-clave.html` → "Restablece tu
   contraseña". Si abres el mismo enlace una segunda vez → "Enlace no
   válido o caducado" (con botones para ir al acceso o a la web).

---

## Migraciones recientes (proyecto ya desplegado)

En este orden, si no las has ejecutado: `migracion-gestion-cuentas.sql` y
después `migracion-libros-uniformes.sql`, `migracion-fusionar-libros-repetidos.sql`
(deja un solo registro por título con todos sus cursos) y `migracion-portada.sql`
(pie de foto del carrusel y vídeos de portada). Todas se pueden
ejecutar dos veces sin problema.

## Variables de entorno en Netlify

| Variable | Valor |
|---|---|
| `SUPABASE_URL` | tu Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | tu **Secret key** (`sb_secret_...`) — nunca en el código, solo aquí |
| `SUPABASE_ANON_KEY` | tu **Publishable key** (la misma de `shared/config.js`). La usan las funciones de la Mochila. Si falta, el navegador la envía igualmente, pero es mejor configurarla |
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
   email desde el buzón del AMPA → el enlace funciona.
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
