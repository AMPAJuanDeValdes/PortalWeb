# Portal AMPA Colegio Juan de Valdés — v2

Reconstrucción completa según el "Modelo de datos consolidado": socios,
adultos (login individual), alumnos, eventos con actividades/exclusiones/
voluntariado/invitados, préstamo de libros con stock, comprobantes de pago,
web pública con alta autoservicio, y envío de email masivo. v2

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
├── supabase/schema.sql            <- esquema completo (pégalo en Supabase)
├── shared/ (config.js, supabaseClient.js, nav.js, styles.css, csv.js, helpers.js, catalogo.js, carrusel.js)
├── assets/ (logos)
├── index.html, publico.html, hazte-socio.html      <- web pública
├── login.html, cambiar-clave.html,
│   estado-recien-creada.html, estado-falta-pago.html
├── dashboard.html, mis-datos.html, prestamo.html, eventos.html
└── admin-importar.html, admin-comprobantes.html, admin-eventos.html,
    admin-libros.html, admin-documentos.html, admin-carrusel.html,
    admin-email.html, admin-respuestas.html
```

## Paso 1 — Supabase

1. Crea un proyecto nuevo en https://supabase.com/dashboard (o usa uno vacío).
2. **SQL Editor** → pega todo `supabase/schema.sql` → **Run**.
3. **Project Settings → API Keys**: copia el **Project URL** y la
   **Publishable key**. Ponlas en `shared/config.js`
   (`SUPABASE_URL`, `SUPABASE_ANON_KEY`). **Este archivo es el único que
   nunca te reenvío al actualizar el proyecto** — así tu configuración
   real nunca se pisa por accidente. No hace falta tocar ninguna página:
   `shared/supabaseClient.js` lo carga por su cuenta.
4. **¡Importante!** Ve a **Authentication → Providers → Email** y
   **desactiva "Confirm email"**. El alta autoservicio ("Hazte socio")
   necesita que el usuario quede con sesión activa nada más registrarse;
   si la confirmación por email está activada, se quedaría bloqueado.

## Paso 2 — Crear el primer administrador

1. **Authentication → Users → Add user** (marca "Auto Confirm User").
   Copia el UUID.
2. **SQL Editor**, sustituyendo los valores:
   ```sql
   insert into socios (anio_ultima_cuota, numero_secuencial, estado)
   values (2026, '0000', 'activa')
   returning id; -- copia el id que devuelve

   insert into adultos (id, socio_id, nombre, apellidos, dni_nie, email,
                        direccion, ciudad, provincia, codigo_postal,
                        role, force_password_change)
   values ('PEGA-UUID-DEL-USUARIO', 'PEGA-ID-DEL-SOCIO', 'Admin', 'AMPA',
           '00000000A', 'tu-email@ejemplo.com', '—', '—', '—', '00000',
           'admin', false);
   ```

## Paso 3 — Variables de entorno en Netlify

Además de las de Supabase, esta versión necesita las de email (SMTP):

| Variable | Valor |
|---|---|
| `SUPABASE_URL` | tu Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | tu **Secret key** (`sb_secret_...`) |
| `SMTP_HOST` | `smtp.serviciodecorreo.es` (o el de tu hosting) |
| `SMTP_PORT` | `465` |
| `SMTP_USER` | el buzón completo (ej. `ampa_j_valdes@fapaginerdelosrios.org`) |
| `SMTP_PASSWORD` | la contraseña de ese buzón |
| `SMTP_FROM_NAME` | `AMPA Colegio Juan de Valdés` |
| `SITE_URL` | la URL final de tu sitio (ej. `https://tu-sitio.netlify.app`), sin barra al final |

Igual que antes: conecta el repo de GitHub a Netlify (no vale drag-and-drop,
hay funciones de servidor), añade estas variables en
**Site configuration → Environment variables**, y haz **Trigger deploy**
después de añadirlas.

## Si ya tenías el proyecto v2 desplegado (carrusel de fotos)

Ejecuta `supabase/migracion-carrusel.sql` en el SQL Editor — añade la tabla
`fotos_carrusel` y el bucket `carrusel` sin tocar nada más.

## Pendiente de construir (no está en este ZIP)

- **Domiciliación bancaria real (mandato SEPA digital)**: falta que nos
  paséis el PDF base del adeudo para construir el editor de plantilla
  (marcar posiciones) y la firma manuscrita. Mientras tanto, "Mis datos"
  muestra un aviso en vez de simular algo que no funciona.
- **Documentos de evento a firmar / subida libre para concursos**: mismo
  motivo — es la misma pieza técnica (visor de PDF + posiciones + firma,
  o subida simple de archivo) que el mandato SEPA. Se construye en cuanto
  definamos esa parte con un documento de ejemplo.
- **Reseteo automático anual (31 de julio)**: hay que programarlo como
  tarea recurrente (Supabase Cron / pg_cron, o una Netlify Scheduled
  Function) que ponga todas las cuentas en `falta_pago` y todos los
  alumnos en `verificado = false`. No está programada todavía.

## Notas de configuración de redes sociales

- **YouTube**: pon tu API key y el ID del canal en `index.html`
  (constantes `YOUTUBE_API_KEY` / `YOUTUBE_CHANNEL_ID`). Sin esas dos
  claves, esa sección simplemente no se muestra.
- **Instagram / WhatsApp**: de momento son botones con enlace directo
  (edítalos en `index.html`). La integración real por API de Instagram
  queda documentada en el modelo de datos para una fase posterior.

## Catálogo de libros y cursos

Las etapas y cursos (`CURSOS_POR_ETAPA`) viven en un único archivo:
`shared/catalogo.js`. Si cambia la estructura de cursos del colegio, se
edita solo ahí y afecta automáticamente a `prestamo.html`,
`hazte-socio.html`, `admin-importar.html`, `admin-eventos.html`,
`admin-libros.html` y `admin-email.html`.
