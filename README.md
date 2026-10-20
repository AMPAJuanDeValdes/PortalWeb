# Portal AMPA Colegio Juan de Valdés

Web pública y zona de socios del AMPA: alta y reactivación de familias,
eventos (inscripción, voluntariado, personas no socias, sorteos, concurso),
Mochila Jugona Exploradora, Banco de Libros, Banco de Uniformes, donaciones,
encuestas, mandato SEPA, email masivo y reseteo anual automático.

## Carpetas

```
ampa-portal-v2/
├── README.md, netlify.toml, package.json
├── web/                    <- lo único que se publica
│   ├── *.html              <- páginas (públicas, de socio y admin-*.html)
│   ├── shared/             <- JS y CSS comunes (config.js = claves públicas)
│   └── assets/             <- logos y PDF (mandato SEPA, carta de la Mochila)
├── netlify/functions/      <- funciones de servidor (altas, emails, Mochila...)
│   └── _lib/               <- código común de las funciones
├── supabase/
│   ├── schema.sql          <- base de datos completa (proyecto NUEVO)
│   ├── cron-reseteo-anual.sql
│   └── pendientes/         <- migraciones aún por ejecutar en el Supabase actual
├── pruebas/                <- pruebas automáticas (ver pruebas/LEEME.md)
├── herramientas/           <- probar la web en tu ordenador
└── docs/
    ├── ESTRUCTURA.md       <- cómo está construido cada módulo y por qué
    └── PLAN-DE-PRUEBAS.md  <- pruebas manuales
```

## Actualizar el Supabase que ya está funcionando

Ejecuta en el **SQL Editor** cada archivo de `supabase/pendientes/`, en
orden alfabético (si hay más de uno). Si la carpeta está vacía, no hay nada
que hacer.

Ninguno borra datos y todos se pueden ejecutar dos veces. Cuando estén
ejecutados, borra los archivos de `pendientes/`: su contenido ya está en
`schema.sql`.

## Proyecto de Supabase NUEVO (o vacío)

1. Crea el proyecto en https://supabase.com/dashboard.
2. **SQL Editor → New query** → pega **todo** `supabase/schema.sql` → **Run**.
   Ya incluye todo; no hace falta ninguna migración.
3. Ejecuta también `supabase/cron-reseteo-anual.sql` (activa `pg_cron`).
4. **Project Settings → API Keys**: copia el **Project URL** y la
   **Publishable key** en `web/shared/config.js` (`SUPABASE_URL`,
   `SUPABASE_ANON_KEY`). Son públicas.
5. **Authentication → Providers → Email** → desactiva **"Confirm email"**
   (el alta "Hazte socio" deja a la familia con sesión nada más registrarse).
6. **Authentication → URL Configuration → Redirect URLs** → añade
   `https://TU-SITIO.netlify.app/cambiar-clave.html`.
7. El IBAN y el titular de la cuenta están en `web/shared/datos-ampa.js`.

### Primer administrador (una sola vez)

1. **Authentication → Users → Add user** (marca "Auto Confirm User") y
   copia su UUID.
2. En el **SQL Editor**, cambiando los valores en mayúsculas:
   ```sql
   insert into socios (anio_ultima_cuota, numero_secuencial, estado)
   values (2026, '0000', 'activa')
   returning id; -- copia este id

   insert into adultos (id, socio_id, nombre, apellidos, dni_nie, email,
                        direccion, ciudad, provincia, codigo_postal, movil,
                        role, force_password_change)
   values ('UUID-DEL-USUARIO', 'ID-DEL-SOCIO', 'Admin', 'AMPA',
           '00000000T', 'tu-email@ejemplo.com', '—', '—', '—', '00000',
           '600000000', 'admin', false);
   ```

## Netlify

**Variables de entorno** (Site configuration → Environment variables):

| Variable | Valor |
|---|---|
| `SUPABASE_URL` | el Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | la **Secret key** (`sb_secret_...`). Solo aquí, nunca en el proyecto |
| `SUPABASE_ANON_KEY` | la Publishable key (la de `web/shared/config.js`) |
| `SMTP_HOST` | `smtp.serviciodecorreo.es` (o el de tu hosting) |
| `SMTP_PORT` | `465` |
| `SMTP_USER` | el buzón completo del AMPA |
| `SMTP_PASSWORD` | la contraseña de ese buzón |
| `SMTP_FROM_NAME` | `AMPA Colegio Juan de Valdés` |
| `SITE_URL` | la URL de la web, sin barra al final |
| `VAPID_PUBLIC_KEY` | clave pública de los avisos en el móvil (ver abajo) |
| `VAPID_PRIVATE_KEY` | clave privada de los avisos. Solo aquí, nunca en el proyecto |
| `IMAP_HOST` | (opcional) servidor IMAP del buzón para «Enviar circular». Si no está, el de `SMTP_HOST` cambiando «smtp.» por «imap.» (`imap.serviciodecorreo.es`) |
| `IMAP_BORRADORES` | (opcional) nombre de la carpeta de borradores si no se encuentra sola |
| `VISITAS_SECRETO` | (opcional) texto largo cualquiera para los códigos anónimos de las estadísticas de visitas. Si no está, se usa uno sacado de la clave de servicio |

**Desplegar:** el sitio está conectado al repositorio de GitHub; cada
subida se publica sola. La configuración (carpeta `web`, funciones, tarea
de la Mochila cada 15 minutos) está en `netlify.toml`. Si cambias variables
de entorno: **Deploys → Trigger deploy → Clear cache and deploy site**.

No se puede desplegar arrastrando la carpeta: las funciones necesitan
`npm install` durante el build.

## Probar en tu ordenador

- **Ver la web con funciones:** doble clic en
  `herramientas\probar-en-local.bat` → `http://localhost:8888`. Usa los
  datos reales de Supabase y las claves de
  `C:\Users\<tú>\ampa-pruebas.env`.
- **Pruebas automáticas:** `pruebas\ejecutar-pruebas.bat` (contra la web
  publicada) o `pruebas\ejecutar-pruebas-local.bat` (contra tu ordenador).

## Avisos en el móvil y el ordenador

Las familias activan los avisos en **Mis datos** (o desde el aviso de
Inicio). La Junta avisa de una actividad con el botón **«Avisar a las
familias»** de cada evento: llega a las familias socias activas con algún
alumno/a que puede apuntarse.

- **Claves (una sola vez):** doble clic en
  `herramientas\generar-claves-avisos.bat`, copia `VAPID_PUBLIC_KEY` y
  `VAPID_PRIVATE_KEY` en las variables de entorno de Netlify y vuelve a
  publicar. Si se cambian, las familias tienen que volver a activarlos.
- **Android y Windows/Mac (Chrome, Edge, Firefox):** directamente desde la web.
- **iPhone/iPad:** solo con la web añadida a la pantalla de inicio
  (Compartir → «Añadir a pantalla de inicio») e iOS 16.4 o posterior. La web
  lo explica a quien entra desde un iPhone.

## Recuperar contraseña

El correo de "¿Has olvidado tu contraseña?" lo envía la función
`recuperar-contrasena.js` con el buzón del AMPA (no Supabase): solo a
cuentas activas y como mucho una vez cada 15 minutos por email. En Supabase
solo hace falta la Redirect URL del paso 6.

## Reseteo anual

Cada 31 de julio a las 00:00 UTC, `pg_cron` pasa las cuentas `activa` a
`falta_pago`, sus alumnos a `verificado = false` y pide a todas las
familias que revisen sus datos. Las cuentas de la Junta no se desactivan.
Al principio de `supabase/cron-reseteo-anual.sql` están las consultas para
comprobar que sigue programado.

## Otros datos que se editan a mano

- Etapas y cursos: `CURSOS_POR_ETAPA` en `web/shared/catalogo.js`.
- Vídeos y fotos de la portada: desde el panel (admin-carrusel.html).
- Enlaces de redes sociales de la portada: `web/index.html`.

## Visitas a la web

Estadísticas propias, sin cookies ni servicios externos (no hace falta aviso
de cookies). Cada página carga `shared/visitas.js`, que apunta la visita con
`netlify/functions/visita.js` en la tabla `visitas`: página, día, si es socio,
Junta o visitante, si es móvil y un código anónimo (no se guarda ni la IP ni
quién es). La Junta lo ve en Panel → Comunicación → «Visitas a la web».
Se guarda 13 meses. En local, en las pruebas automáticas (navegador manejado por Playwright) y con las cuentas ficticias de las pruebas (email con «ampa-prueba-») no se apunta nada. Migración:
`supabase/pendientes/migracion-visitas.sql`.

## Enviar circular

En Panel → Eventos, cada evento tiene «Enviar circular»: prepara un email con
la información del evento (descripción, cuándo, dónde, para quién, plazas,
precio para no socios y enlace para apuntarse) con la firma del AMPA y lo deja
en la carpeta de Borradores del buzón del AMPA (por IMAP, con el mismo usuario
y contraseña que el correo: `SMTP_USER` y `SMTP_PASSWORD`). Desde el correo se
revisa, se ponen los destinatarios y se envía. Función:
`netlify/functions/circular-borrador.js` (`_lib/imap.js`).

Lo mismo en la convocatoria abierta del Banco de Uniformes y del Banco de
Libros: «Avisar a las familias» (`push-avisar-convocatoria.js`) y «Enviar
circular». Los textos están en `netlify/functions/_lib/bancos.js`.
