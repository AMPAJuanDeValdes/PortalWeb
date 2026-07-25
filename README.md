# Portal AMPA Colegio Juan de Valdés

Web con login, préstamo de libros, eventos y formularios genéricos para los
socios del AMPA. Backend: **Supabase** (autenticación + base de datos).
Hosting: **Netlify** (sitio estático + 1 función serverless para el alta de socios).

## Estructura del proyecto

```
ampa-portal/
├── netlify.toml
├── package.json
├── netlify/functions/admin-import-socios.js   <- única pieza de servidor
├── supabase/schema.sql                        <- pégalo en Supabase (SQL Editor)
├── shared/
│   ├── supabaseClient.js   <- AQUÍ VAN TUS CLAVES DE SUPABASE
│   ├── nav.js
│   ├── styles.css
│   └── csv.js
├── assets/logo-ampa.png, logo-colegio.png
├── index.html, login.html, cambiar-clave.html, dashboard.html
├── prestamo.html, eventos.html, formularios.html
└── admin-importar.html, admin-eventos.html, admin-formularios.html, admin-respuestas.html
```

---

## Paso 1 — Crear el proyecto en Supabase

1. Ve a https://supabase.com → crea una cuenta gratuita → **New project**.
2. Elige nombre, contraseña de base de datos (guárdala) y región (Europa).
3. Cuando el proyecto esté listo, ve a **Project Settings → API** y copia:
   - **Project URL**
   - **anon public key**
4. Abre `shared/supabaseClient.js` y sustituye:
   ```js
   const SUPABASE_URL = 'https://TU-PROYECTO.supabase.co';
   const SUPABASE_ANON_KEY = 'TU-ANON-KEY';
   ```
   por tus valores reales.

## Paso 2 — Crear las tablas y permisos

1. En Supabase, ve a **SQL Editor → New query**.
2. Abre `supabase/schema.sql`, copia todo el contenido, pégalo y pulsa **Run**.
3. Esto crea las tablas (`profiles`, `hijos`, `prestamo_items`, `eventos`,
   `evento_inscripciones`, `formularios`, `formulario_respuestas`) con sus
   permisos de seguridad (RLS) ya configurados.

## Paso 3 — Crear el primer administrador (a mano, una sola vez)

Como el alta de socios la hace un admin desde el CSV, tiene que existir un
admin *antes* de poder usar esa función. Se crea una única vez, a mano:

1. En Supabase → **Authentication → Users → Add user**. Pon tu email y una
   contraseña. Marca "Auto Confirm User".
2. Copia el **UUID** del usuario que acabas de crear (aparece en la lista).
3. Ve a **SQL Editor** y ejecuta (sustituyendo los valores):
   ```sql
   insert into profiles (id, anio_ultima_cuota, numero_secuencial, email, role, force_password_change)
   values ('PEGA-AQUI-EL-UUID', 2026, '0000', 'tu-email@ejemplo.com', 'admin', false);

   insert into progenitores (profile_id, tipo, nombre, apellidos, dni_nie, email, direccion, ciudad, provincia, codigo_postal)
   values ('PEGA-AQUI-EL-UUID', 'principal', 'Administrador', 'AMPA', '00000000A', 'tu-email@ejemplo.com', '—', '—', '—', '00000');
   ```
   (Los datos de dirección del primer admin son solo un relleno; puedes editarlos
   después desde "Mis datos" ya dentro del portal.)
4. Ya puedes entrar con ese email/contraseña y llegarás al panel con acceso
   de administrador. Desde ahí puedes:
   - Importar al resto de socios por CSV, o darlos de alta uno a uno.
   - Ascender a otros miembros de la Junta a administradores desde la
     lista de socios (botón "Hacer admin"), sin tocar SQL nunca más.

## Paso 4 — Desplegar en Netlify (vía GitHub, no drag-and-drop)

A diferencia de la versión anterior, **esta ya no se puede arrastrar y
soltar** porque incluye una función de servidor que necesita instalar una
dependencia (`npm install`). Hay que conectarlo por Git:

1. Sube esta carpeta a un repositorio de GitHub (puedes crear uno nuevo en
   github.com → "New repository" → y subir los archivos desde la web, o
   con `git init / git add . / git commit / git push` si usas terminal).
2. En https://app.netlify.com → **Add new site → Import an existing project**
   → conecta tu cuenta de GitHub → elige el repositorio.
3. Netlify detectará automáticamente el `netlify.toml` (publish = raíz,
   functions = `netlify/functions`, comando de build = `npm install`). Dale a **Deploy**.
4. Ve a **Site settings → Environment variables** y añade:
   - `SUPABASE_URL` → tu Project URL de Supabase.
   - `SUPABASE_SERVICE_ROLE_KEY` → en Supabase: Project Settings → API →
     **service_role key** (⚠️ esta clave es secreta, no la pongas nunca en el
     frontend, solo aquí, en las variables de entorno de Netlify).
5. Vuelve a **Deploys → Trigger deploy** para que la función coja las nuevas
   variables de entorno.
6. Tu portal ya está en `https://tu-sitio.netlify.app`. Puedes cambiar el
   nombre en **Site settings → Change site name**.

## Uso del día a día

- **Alta de socios**: panel de admin → "Alta de socios". Por CSV (columnas
  obligatorias: `anio_ultima_cuota, numero_secuencial, nombre, apellidos,
  dni_nie, email, direccion, ciudad, provincia, codigo_postal`; opcionales:
  `forma_pago, iban, es_pasaporte, sexo, telefono_fijo, movil`) o de uno en
  uno. Se genera una contraseña provisional por cada socio; el socio la
  cambia obligatoriamente en su primer inicio de sesión. El alta solo crea
  la cuenta y el progenitor principal — el segundo progenitor y los
  hijos/as los añade la propia familia desde "Mis datos" y "Préstamo de
  libros" una vez dentro.
- **Mis datos**: cada familia gestiona ahí sus propios progenitores
  (principal y, opcionalmente, secundario) y su forma de pago / IBAN. El
  número de socio y el año de cuota los fija el AMPA en el alta.
- **Préstamo de libros**: cada familia entra, añade a sus hijos/as (nombre,
  apellidos, fecha de nacimiento, sexo, etapa, curso y aula) y, si ese
  curso tiene libros de lectura obligatoria, los marca. Puede volver y
  editarlo cuando quiera.
- **Eventos**: el admin crea eventos (con aforo opcional) desde "Eventos
  (admin)"; los socios se apuntan desde "Eventos". El admin ve quién se ha
  apuntado y puede exportar la lista a CSV.
- **Formularios**: el admin crea formularios a medida (título + campos de
  texto/número/selección/casillas) desde "Formularios (admin)"; los socios
  los responden desde "Formularios". El admin exporta las respuestas a CSV
  desde "Respuestas".
- **Roles**: cualquier admin puede ascender o degradar a otros socios desde
  "Alta de socios" → tabla inferior → botón "Hacer admin" / "Quitar admin".

## Límites y cosas a tener en cuenta

- El plan gratuito de Supabase admite hasta 50.000 usuarios activos y una
  base de datos de 500 MB — de sobra para 100 socios.
- El envío de emails de recuperación de contraseña usa el servicio de
  pruebas de Supabase (límite bajo, unos pocos emails/hora). Si necesitáis
  volumen, hay que configurar un proveedor SMTP propio en
  Project Settings → Auth → SMTP Settings.
- Las contraseñas provisionales generadas al importar socios **no se
  guardan en ningún sitio**: solo se muestran una vez en pantalla para que
  las descargues o copies. Si se pierden, un admin puede regenerar el
  acceso desde Supabase (Authentication → Users → ese usuario → "Send
  password recovery").

## Cambiar el catálogo de libros, etapas o cursos

Dentro de `prestamo.html` (etiqueta `<script>`):
- `CURSOS_POR_ETAPA` define qué cursos existen dentro de cada etapa.
- `LIBROS_POR_CLAVE` define los libros de préstamo de cada combinación
  "curso + etapa" (ej. `'3º Primaria'`). Los cursos que no aparezcan ahí
  simplemente no muestran ninguna sección de libros.
