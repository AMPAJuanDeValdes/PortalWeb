# Estructura del proyecto — Portal AMPA Colegio Juan de Valdés v2

> **Este archivo es un documento vivo.** Cualquier IA o persona que trabaje
> en este proyecto debe leerlo ANTES de pedir contexto o de tomar
> decisiones de diseño, y debe ACTUALIZARLO cada vez que se añada, cambie
> o elimine algo relevante (una tabla, una función, una mecánica de
> negocio, una decisión de diseño). El objetivo es que nunca haga falta
> volver a preguntar "¿cómo funciona X?" ni "mándame el archivo Y para
> verlo" cuando la respuesta ya está aquí.
>
> `README.md` es para **desplegar el proyecto desde cero** (pasos,
> variables de entorno, checklist). Este archivo es para **entender cómo
> está construido y por qué**, y para seguir construyendo sobre él sin
> romper nada ni repetir decisiones ya tomadas.

---

## 0. ⚠️ Cosas a vigilar (código muerto y decisiones de diseño recientes)

- **`shared/documentoRellenable.js`** ya existe (creado en esta sesión).
  Expone `renderizarPaginaPDF`, `abrirEditorPlantilla` y
  `abrirFormularioRelleno`, usadas tal cual por `admin-eventos.html` y
  `eventos.html` (no hizo falta tocar esas dos páginas para esto). Usa
  **PDF.js cargado dinámicamente desde CDN** la primera vez que se
  necesita (no está en ningún `<script>` de las páginas). El "campo"
  guardado en `documentos_evento.campos` es
  `{ id, tipo, xPct, yPct }` — posición en % de la imagen, y `tipo` uno
  de: `nombre` / `apellidos` / `dni_nie` / `fecha_nacimiento` / `texto`
  / `fecha_hoy` / `firma`. El resultado final se compone en un único
  PNG (imagen de fondo + textos + firma dibujada) antes de subirlo a
  Supabase Storage, tal como describe el README.
- **`formularios.html` y `admin-formularios.html` son código muerto**:
  usan tablas `formularios` / `formulario_respuestas` que **no existen**
  en `schema.sql`, y leen `ctx.profile` — un campo que **no existe** en
  lo que devuelve `requireAuth()` (ver §1.9: es `{ session, adulto,
  socio }`, sin `profile`). Son restos de un sistema de formularios
  genérico anterior, sustituido por el sistema de **Encuestas** de esta
  sesión. No están enlazados desde `shared/nav.js`. No tocarlos ni
  intentar "arreglarlos" — si hace falta algo parecido, ya existe
  Encuestas.
- **`admin-respuestas.html`, pestaña "Préstamo de libros"**: sigue
  consultando `prestamo_items` con las columnas de antes de la reforma
  de convocatorias/ejemplares (no muestra `estado` ni el código del
  ejemplar asignado). Sigue funcionando, pero da una foto incompleta —
  actualizarla si se retoma esa pantalla.

---

## 1. Convenciones y patrones que usa TODO el proyecto

Antes de tocar nada, conviene conocer estos patrones — se repiten en
cada funcionalidad nueva que se ha ido añadiendo:

### 1.1 Funciones auxiliares de Postgres
- `is_admin()` — true si `auth.uid()` corresponde a un adulto con
  `role = 'admin'`.
- `mi_socio_id()` — devuelve el `socio_id` del adulto autenticado
  (`auth.uid()`), o null si no aplica.
- Prácticamente toda política RLS del proyecto se apoya en estas dos.

### 1.2 Funciones SQL "acción" (RPC) con `security definer`
Cuando una acción necesita comprobar permisos Y modificar varias filas
de forma atómica, se hace como una función Postgres `security definer`
(no como una serie de updates sueltos desde el cliente). Ejemplos:
`mochila_posponer`, `prestamo_admin_asignar`, `uniformes_admin_quitar`,
`encuesta_responder`, `concurso_enviar_texto`. Estas funciones:
- Comprueban `is_admin()` o `socio_id = mi_socio_id()` ellas mismas.
- Se llaman desde el HTML directamente vía `sb.rpc('nombre', {...})`
  cuando no hace falta enviar ningún email (no requieren función de
  Netlify).

### 1.3 Funciones de Netlify: patrón de DOS clientes de Supabase
Cuando una acción sí necesita mandar un email (o hacer trabajo pesado
en servidor), se implementa como función de Netlify, y casi todas usan
**dos clientes distintos** dentro del mismo archivo:
1. `supabaseAdmin` — con la **Service Role Key**. Bajo Service Role,
   `auth.uid()` es `null`, así que **cualquier función SQL que dependa
   de `is_admin()`/`mi_socio_id()` fallará si se llama con este
   cliente**. Se usa para: validar el token (`auth.getUser`), leer/escribir
   datos de OTRAS personas (ej. el email de la familia a la que hay que
   avisar), y para bulk-writes de un algoritmo ya calculado en JS.
2. `supabaseUser` — con la **Anon Key** + `Authorization: Bearer
   <access_token del usuario>`. Se usa para llamar a funciones RPC que
   internamente comprueban `is_admin()`/`mi_socio_id()`, para que esa
   comprobación funcione correctamente.

Patrón típico de una función Netlify de acción:
```
1. Verificar token con supabaseAdmin.auth.getUser(token)
2. Buscar el rol/socio_id del que llama con supabaseAdmin
3. Ejecutar la acción con supabaseUser.rpc(...) (si depende de is_admin())
   O directamente con supabaseAdmin (si el permiso ya se comprobó en JS
   y el resto es bulk-write sin necesidad de RLS)
4. Si algo cambió que requiere avisar a otra persona, usar supabaseAdmin
   para buscar su email y mandar el correo con _lib/email.js
```

### 1.4 Patrón "reclamo atómico" (evitar doble ejecución)
Cualquier acción de "repartir/sortear una sola vez" (préstamo, uniformes,
sorteos de eventos) se protege así, NUNCA con una comprobación previa
separada:
```js
const { data: reclamado } = await supabaseAdmin
  .from('tabla_convocatoria_o_evento')
  .update({ estado: 'repartida' }) // o el flag que corresponda
  .eq('id', id)
  .eq('estado', 'abierta') // condición que solo es cierta la primera vez
  .select('id')
  .maybeSingle();
if (!reclamado) { /* ya se hizo antes, abortar */ }
```
La base de datos garantiza que si dos peticiones llegan a la vez, solo
una gana el `UPDATE`. Esto evita usar candados explícitos.

### 1.5 Patrón de convocatoria (préstamo, uniformes)
Una convocatoria = una ventana de tiempo para pedir algo, con
`fecha_cierre` fija puesta por el admin, y `estado` que pasa de
`'abierta'` a `'repartida'` cuando se ejecuta el reparto (una función de
Netlify con algoritmo en JS). Solo puede existir una convocatoria
`'abierta'` a la vez (índice único parcial). El admin puede **resetear**
un reparto entero (vuelve todo a `'pendiente'`/`'disponible'` y la
convocatoria a `'abierta'`) para corregir errores o recalcular.

### 1.6 Patrón de anonimato (encuestas, concurso literario)
Cuando algo debe ser anónimo mientras que aún hace falta poder
correlacionar respuestas de la MISMA persona entre sí (o revelar la
identidad más adelante bajo una condición), se separa en dos tablas:
- Una con el **contenido** (respuestas, texto del envío) ligado a un
  identificador neutro (`envio_id`).
- Otra con la **identidad** (`socio_id`), con una política RLS que solo
  permite verla al admin bajo una condición explícita (nunca por
  defecto). Ver `encuesta_envios`/`encuesta_respuestas` y
  `concurso_envios`/`concurso_identidades`.

### 1.7 Algoritmos de reparto/sorteo: en JavaScript, no en SQL
Cualquier algoritmo con lógica de varias pasadas, desempates o sorteo
(préstamo de libros, uniformes, sorteos de eventos) se implementa en
JS dentro de la función de Netlify, no en PL/pgSQL — es mucho más
legible y fácil de verificar. La función SQL/RPC solo hace el "reclamo
atómico" inicial; el resto son lecturas, cálculo en memoria, y updates
en lotes (`actualizarEnLotes`, function reutilizada en varias funciones).

### 1.8 Navegación
- **El menú lateral ya NO EXISTE.** `shared/nav.js` se reescribió por
  completo: `renderNav(activePage, ctx)` ya no envuelve el `<body>` en
  `.app-shell`/`.sidenav`/`.app-content` — ahora solo inserta una
  barra superior simple (`.topbar-simple`) con un enlace **"‹ Inicio"**
  (oculto en el propio `dashboard.html`) y **"Cerrar sesión"**. Las
  clases CSS antiguas del menú lateral siguen en `shared/styles.css`
  (sin usarse, no se borraron por seguridad) bajo el comentario
  "EN DESUSO".
- `dashboard.html` ("Inicio") es el **hub central**, para socio Y para
  admin: todo se alcanza desde ahí mediante tiles. Un socio ve Mochila,
  Mis datos, Eventos, Préstamo, Uniformes, Encuestas y el comentario
  directo. Si `ctx.adulto.role === 'admin'`, además ve una sección
  "Administración" con tiles a los 10 paneles de admin (antes solo
  alcanzables desde el menú lateral que ya no existe).
- `mis-datos.html` es **solo para modificar datos** (adultos, alumnos,
  forma de pago, baja de cuenta) — ninguna funcionalidad "activa"
  (Mochila, Préstamo, etc.) debe vivir ahí.

### 1.9 Contrato exacto de `shared/supabaseClient.js`
Confirmado leyendo el archivo real — no asumir nada distinto a esto:
- `sb` — cliente de Supabase, global, creado a partir de
  `shared/config.js` (cargado por su cuenta vía `XMLHttpRequest` +
  `eval`, ver el bug histórico del `const` que ya se corrigió).
- `getSession()` — sesión actual o `null`.
- `getAdulto()` — fila de `adultos` del usuario autenticado, o `null`.
- `getSocio(socioId)` — fila de `socios` por id.
- `redirigirPorEstado(socio)` — si `estado !== 'activa'`, redirige a
  `estado-recien-creada.html` / `estado-falta-pago.html` (o trata
  `'baja'` como sesión inválida) y devuelve `false`; si está `'activa'`
  devuelve `true`.
- `requireAuth()` — **devuelve exactamente `{ session, adulto, socio }`,
  nada más** (no hay `profile`, no hay `role` a nivel raíz). Si no hay
  sesión, si falta la ficha de adulto, si `force_password_change` está
  activo, o si el estado del socio no es `'activa'`, redirige a la
  página que corresponda y devuelve `null`.
- `requireAdmin()` — llama a `requireAuth()` y además exige
  `ctx.adulto.role === 'admin'`, si no, redirige a `dashboard.html`.
- `signOut()` — cierra sesión y redirige a `login.html`.
- `calcularEdad(fechaNacimiento)` — para elegibilidad por edad en eventos.

### 1.10 Utilidades compartidas ya existentes (reutilizar, no reinventar)
- **`shared/csv.js`** — `descargarCSV(filas, nombreArchivo)`,
  `parsearCSV(texto)`, `csvAObjetos(filasParseadas)`. Usado en
  `admin-importar.html` (leer CSV de alta) y `admin-respuestas.html`
  (exportar listados).
- **`shared/carrusel.js`** — `renderCarrusel(contenedorDOM, [urls])`,
  carrusel simple sin librerías externas. Usado en `index.html`,
  `publico.html`, `eventos.html`.
- **`shared/catalogo.js`** — `CURSOS_POR_ETAPA` (ver README).
- **`shared/helpers.js`** — `getResumenSocios(socioIds)`, devuelve
  `{ [socioId]: { numero_socio, nombre, estado } }`. Usado en pantallas
  de admin que listan cosas por familia.
- **`shared/documentoRellenable.js`** — `renderizarPaginaPDF(pdfUrl, num)`,
  `abrirEditorPlantilla(...)`, `abrirFormularioRelleno(...)` (ver §0 —
  creado en esta sesión, antes no existía).

---

## 2. Esquema de base de datos — todas las tablas

### 2.1 Núcleo (ya existía en v1/v2 antes de esta sesión)
- **`socios`** — la cuenta familiar. `numero_socio_completo` es un campo
  generado. `estado`: `recien_creada` / `activa` / `falta_pago` / `baja`.
- **`adultos`** — 1 o 2 por socio, login individual (`id` = uuid de
  `auth.users`). `role`: `'socio'` / `'admin'`. Tiene
  `ya_visito_comedor` (añadido en esta sesión, ver §2.7).
- **`alumnos`** — hijos de la familia. `etapa`/`curso` vienen de
  `shared/catalogo.js` (`CURSOS_POR_ETAPA`). `aula` limitado a A-D.
  `sexo`: Masculino/Femenino/Otro (opcional). `fecha_nacimiento`
  obligatoria **en el formulario** aunque la columna permite null (por
  alumnos antiguos importados sin ese dato).
- **`comprobantes_pago`** — justificantes de pago, con `tipo`:
  `cuota_socio` / `invitado_evento` / `mochila_no_socio`. Tiene
  `mochila_cola_id` y `reembolsado` (de la Mochila, ver §2.3).
- **`documentos`** — newsletters y documentos públicos (no ligados a un
  evento).
- **`fotos_carrusel`** — carrusel de fotos de portada o de un evento.

### 2.2 Eventos (existía, ampliado en esta sesión — ver §5.6 para el
### detalle completo de mecánica de negocio)
- **`eventos`** — columnas originales: `titulo`, `descripcion`, `fecha`,
  `activo`, `tipo_elegibilidad` (`toda_familia`/`alumnos`/`adultos`),
  elegibilidad por curso o edad, `aforo_total`, `permite_invitados`
  (el SOCIO invita a alguien pagando, desde su propia cuenta),
  `precio_invitado`, `voluntariado_habilitado`,
  `voluntariado_excluye_asistencia`.
  **Columnas nuevas de esta sesión**: `abierto_no_socios` (aparece en
  `publico.html` para que se apunten desconocidos — DISTINTO de
  `permite_invitados`), `fecha_apertura_socios`,
  `fecha_apertura_no_socios`, `fecha_cierre_inscripcion` (una sola,
  igual para todos), `metodo_asignacion` (`aforo`/`sorteo`),
  `requiere_pareja_adulto_alumno`, `usa_prioridad_historial`,
  `sorteo_realizado` (candado del reclamo atómico), `sin_inscripcion`,
  `precio_adulto`, `precio_alumno`.
- **`evento_actividades`** — sub-eventos anidados dentro de un evento
  (ej. los talleres de Warhammer/rol dentro de la Barbacoa), con su
  propio aforo/elegibilidad/voluntariado.
- **`actividad_exclusiones`** — pares de actividades que NO se pueden
  combinar (ej. dos talleres a la misma hora). No es "excluir alumnos".
- **`evento_inscripciones`** — la inscripción en sí.
  `tipo_miembro`: `adulto`/`alumno`/`invitado`/`publico`.
  **Columnas nuevas**: `estado` (`pendiente`/`ganador`/`no_ganador`,
  para eventos con sorteo), `grupo_id` (agrupa la pareja adulto+alumno
  de la Cabalgata para que el sorteo las trate como una sola unidad).
- **`documentos_evento`** — plantilla de documento a rellenar/firmar
  para un evento. **Bug corregido en esta sesión**: faltaban las
  columnas `titulo` y `pagina_rellenable` que el frontend ya usaba
  (la migración que debía añadirlas nunca se aplicó).
- **`documentos_evento_respuestas`** — el documento ya rellenado y
  firmado por una persona concreta.
- **`concurso_envios`** / **`concurso_identidades`** — mecanismo de
  envío anónimo para el Concurso Literario (ver §1.6 y §5.6).

### 2.3 Mochila Jugona Exploradora (nueva en esta sesión)
- **`mochila_cola`** — la cola activa. `posicion`: `0` = la tiene ahora
  mismo, `1,2,3...` = en espera (siempre calculada por un trigger en
  el servidor, nunca por el cliente). `tipo`: `socio`/`no_socio`
  (no_socio preparado en la tabla pero sin frontend construido
  todavía). `notificado_en` marca cuándo se avisó a quien está en
  posición 1 (tiene 24h para responder).
- **`mochila_historial`** — registro permanente al devolver, con
  `numero_socio_completo` como "foto" del momento (para estadísticas
  de fin de año aunque cambien datos después).
- **`mochila_config`** — importes de depósito/alquiler para no socios,
  editable por admin.
- Funciones RPC: `mochila_cola_length()` (pública, cuenta total),
  `mochila_posponer`, `mochila_salir` (sirve tanto para
  "Desapuntarme" del socio como "Eliminar" del admin — la única
  diferencia es el permiso, comprobado dentro de la función),
  `mochila_admin_entregar`, `mochila_admin_devuelto`,
  `mochila_admin_pasar_semana`.
- Funciones de Netlify (mandan el email de "te toca"):
  `mochila-apuntarse`, `mochila-posponer`, `mochila-desapuntarse`,
  `mochila-admin-entregar`, `mochila-admin-devuelto`,
  `mochila-admin-eliminar`, `mochila-admin-pasar-semana`.
- **Regla de negocio clave**: el email de "te toca la mochila" se
  manda SIEMPRE que alguien pasa a ser el nuevo `posicion = 1`, sea
  por entrega, por renuncia de quien iba delante, por eliminación del
  admin, o por apuntarse a una cola vacía.
- Frontend: sección en `dashboard.html` (Inicio), no en `mis-datos.html`.

### 2.4 Préstamo de libros (rediseñado en esta sesión)
- **`libros_catalogo`** — el título (etapa, curso, título, editorial,
  ISBN, asignatura). `stock` **ya no se edita a mano**: lo recalcula un
  trigger a partir de `libros_ejemplares`.
- **`libros_ejemplares`** — un ejemplar físico por fila. `codigo` es el
  número impreso en el libro (texto, ej. "0001"), **lo pone el admin a
  mano**, único en todo el catálogo (no solo dentro de un título).
  `estado`: `disponible`/`prestado`/`perdido`/`baja`.
- **`prestamo_convocatorias`** — ver patrón §1.5.
- **`prestamo_items`** — una fila por libro pedido (aunque dos gemelos
  pidan el mismo título, son 2 filas independientes). Amplía la tabla
  original con `convocatoria_id`, `ejemplar_id`, `estado`
  (`pendiente`/`asignado`/`no_asignado`), `fecha_asignacion`,
  `fecha_devolucion`. `tipo = 'donacion'` sigue funcionando sin
  convocatoria (las donaciones están siempre abiertas).
- **Algoritmo de reparto** (`prestamo-repartir.js`, ejecutado UNA vez
  por convocatoria): para cada libro que se reparte, se elige la
  familia con **menos libros recibidos hasta ahora**; empate → la que
  **pidió MÁS en total** (nunca al revés — quien pide más nunca debe
  acabar con menos que quien pidió menos); empate todavía → **sorteo
  aleatorio** (nunca por orden de apuntado). Dentro de la familia
  elegida, se da primero el libro más escaso entre sus pendientes.
- Acciones de admin tras el reparto (RPC, llamadas directas desde
  `admin-libros.html`): `prestamo_admin_asignar` (mover un ejemplar a
  otra solicitud, liberando el anterior), `prestamo_admin_quitar`,
  `prestamo_admin_resetear_reparto` (deshace todo, reabre la
  convocatoria).
- Frontend: `admin-libros.html` (pestañas Catálogo / Ejemplares /
  Convocatoria y reparto), `prestamo.html` (socio).

### 2.5 Entrega de Uniformes (nueva en esta sesión)
- **`prendas_catalogo`** — combinación tipo+talla con su `stock`
  (aquí SÍ es un contador simple, editable directamente — no hay
  ejemplares individuales porque las prendas no se devuelven). Tipos:
  Sudadera, Pantalón Largo, Pantalón Corto, Camiseta, Baby. Tallas 1-20
  (Baby limitado a 1,2,3,4,6 por `check`).
- **`uniformes_convocatorias`** — igual patrón que préstamo.
- **`uniformes_pedidos`** — 3 filas por alumno (prioridad 1/2/3), cada
  una apuntando a una prenda concreta. `prioridad = 0` = ajuste manual
  del admin (no fue una elección real de la familia).
- **Algoritmo de reparto** (`uniformes-repartir.js`): aceptación
  diferida por rondas. Cada alumno "sostiene" su prioridad actual; si
  una prenda+talla tiene más peticiones que stock, se sortea
  aleatoriamente quién se queda, el resto pasa a su siguiente
  prioridad; se repite hasta que nadie más se mueve.
- **Reglas del formulario del socio** (validación en frontend, no en
  DB): un alumno recibe como máximo 1 prenda en total, aunque puede
  pedir cosas de tallas distintas a las "reales" de cada hijo (no se
  controla eso). Semáforo de stock: 🔴 ≤2, 🟡 3-5, 🟢 ≥6. La 2ª
  prioridad nunca puede ser roja; la 3ª tiene que ser verde. No se
  puede repetir la misma prenda en dos prioridades del mismo alumno.
- Acciones de admin: `uniformes_admin_asignar` (acepta CUALQUIER
  prenda, no solo las 3 elegidas — queda registrada con
  `prioridad = 0`), `uniformes_admin_quitar`,
  `uniformes_admin_resetear_reparto`.
- Frontend: `admin-uniformes.html`, `uniformes.html` (socio).

### 2.6 Encuestas (nueva en esta sesión)
- **`encuestas`** — `anonima` boolean, `fecha_cierre` (null = infinita,
  se cierra a mano), `estado` (`abierta`/`cerrada`).
- **`encuesta_preguntas`** — `tipo`: `opcion_unica` / `opcion_multiple`
  / `texto_libre`.
- **`encuesta_opciones`** — solo para los dos tipos de opción.
- **`encuesta_control_respondidos`** — SOLO sirve para impedir el doble
  envío. Nunca se cruza con las respuestas (ver §1.6).
- **`encuesta_envios`** — un envío por persona. `socio_id` queda
  `null` si la encuesta es anónima — es la única garantía real de
  anonimato.
- **`encuesta_respuestas`** — ligada al envío, no al socio directamente
  (permite al admin cruzar respuestas de una misma persona dentro de
  una encuesta anónima sin saber quién es).
- Única vía de escritura: `encuesta_responder(encuesta_id, respuestas
  jsonb)` — atómico (control + envío + respuestas en un solo paso).
- Frontend: `admin-encuestas.html` (crear, cerrar, resultados
  agregados, y **consulta cruzada** entre dos preguntas de opción),
  `encuestas.html` (socio).

### 2.7 Comentario directo por email (nuevo en esta sesión)
- **`comentarios`** — guarda copia de todo lo que llega, `origen`:
  `publico`/`socio`. Solo el admin puede leerlos (`select`); las
  inserciones las hacen las funciones de Netlify con Service Role.
- `comentario-publico.js` — sin autenticación, pide email
  explícitamente (formulario en `index.html`, tarjeta "Contacta con el
  AMPA").
- `comentario-socio.js` — usa la sesión, no pide email (bloque en
  `dashboard.html`). Si la familia tiene 2 adultos, **ambos quedan en
  el Reply-To** del email que recibe el AMPA, para que "Responder"
  desde su cuenta conteste a los dos a la vez.
- `_lib/email.js` ampliado con `plantillaComentario` y soporte de
  `replyTo` en `enviarEmail`.

---

## 3. Funciones de Netlify — listado completo

| Función | Qué hace | Autenticación |
|---|---|---|
| `admin-import-socios.js` | Alta de socios (CSV/manual) | Admin |
| `invitar-adulto.js` | Añadir 2º adulto desde "Mis datos" | Socio |
| `autoservicio-alta.js` | Alta completa self-service | Público |
| `enviar-email-masivo.js` | Email a lista de destinatarios | Admin |
| `mochila-apuntarse.js` | Apuntarse a la cola de la Mochila | Socio |
| `mochila-posponer.js` | "Prefiero esperar una semana más" | Socio |
| `mochila-desapuntarse.js` | Salir de la cola (si no tiene la mochila) | Socio |
| `mochila-admin-entregar.js` | Entregar a quien está en posición 1 | Admin |
| `mochila-admin-devuelto.js` | Registrar devolución + historial | Admin |
| `mochila-admin-eliminar.js` | Quitar a cualquiera de la cola | Admin |
| `mochila-admin-pasar-semana.js` | Posponer a quien está en posición 1 | Admin |
| `prestamo-repartir.js` | Algoritmo de reparto de libros | Admin |
| `uniformes-repartir.js` | Algoritmo de reparto de uniformes | Admin |
| `evento-sortear.js` | Sorteo de un evento (3 variantes) | Admin |
| `comentario-publico.js` | Comentario desde la web pública | Público |
| `comentario-socio.js` | Comentario desde el dashboard | Socio |

`_lib/email.js` — utilidad SMTP compartida. Plantillas:
`plantillaCredenciales`, `plantillaMochilaTurno`, `plantillaComentario`.
`_lib/mochila.js` — `notificarNuevoTurno()`, usada por las 6 funciones
de la Mochila que pueden mover la cola.

---

## 4. Taxonomía de tipos de evento (definida en esta sesión)

Todos usan las mismas tablas (`eventos` + flags), pero cada "tipo" es en
realidad una combinación concreta de esos flags. Esta lista es la
referencia de qué flags activar para replicar cada tipo:

| Tipo de evento | Flags clave |
|---|---|
| **Talleres** (Juegos, Rol, Warhammer, Ciencias, Arqueología...) | `abierto_no_socios` = true/false a elección del admin; `fecha_apertura_socios` y `fecha_apertura_no_socios` distintas; `metodo_asignacion = 'aforo'`; se cierra por aforo completo o por `fecha_cierre_inscripcion`. Si es público, el no-socio escribe los datos del alumno a mano (`tipo_miembro = 'publico'`); el socio elige de su lista existente. |
| **Cabalgata del distrito** | `requiere_pareja_adulto_alumno = true`; `metodo_asignacion = 'sorteo'`; límite de edad en alumnos; el adulto puede ser no-socio (se escriben sus datos) o socio (un clic). Si pierde la pareja, pierden los dos (nunca se rompe). Es el único evento con documento a firmar hoy — solo lo firman quienes ganan el sorteo (o, si se prefiere simplificar el sorteo, se puede pedir la firma a todos antes de sortear). |
| **Visita al Comedor** | Siempre 2 plazas (`aforo_total = 2`); `metodo_asignacion = 'sorteo'`; `usa_prioridad_historial = true`; solo adultos socios (selector). Quien ya visitó (`adultos.ya_visito_comedor`) solo compite si sobran plazas tras asignar a quienes nunca fueron. |
| **Concurso de Christmas** | `sin_inscripcion = true`. Puramente informativo, sin ningún flujo de apuntarse. |
| **Concurso literario** | Envío de texto vía `concurso_enviar_texto()`, anónimo hasta que el admin marca un envío como ganador (`concurso_envios.es_ganador`), momento en el que su identidad se vuelve visible. |
| **Chocolatada** | `permite_invitados = true` (el socio invita, pagando, desde su cuenta), `abierto_no_socios = false` (nunca aparece en la web pública — solo socios pueden iniciar la inscripción de terceros). Miembros de la familia que son socios: un clic; el resto: escriben sus datos. |
| **Formulario de voluntarios** | `voluntariado_habilitado = true`, sin aforo ni fecha estrictas. Adultos se apuntan directamente; **un alumno solo puede apuntarse si un adulto de su familia ya está apuntado en el mismo evento** (trigger `verificar_alumno_voluntario_acompanado`). |
| **Barbacoa del Cole** | `precio_alumno = 0` (gratis pero debe apuntarse, para el recuento), `precio_adulto` > 0 (todos pagan). Usa `evento_actividades` para los talleres/torneos anidados (Warhammer, rol, ajedrez), cada uno con su propio aforo. |

---

## 5. Estado actual — qué está construido y qué falta

### ✅ Completo
- Mochila Jugona Exploradora (SQL + funciones + frontend socio en Inicio).
- Préstamo de libros (SQL + algoritmo + admin + socio).
- Entrega de Uniformes (SQL + algoritmo + admin + socio).
- Encuestas (SQL + admin con consulta cruzada + socio).
- Comentario directo por email (público + socio).
- Reorganización de navegación (todo se llega desde Inicio; sidebar
  sin Préstamo/Uniformes).
- Alta/edición de alumnos movida a `mis-datos.html` (antes apuntaba
  erróneamente a "Préstamo de libros").
- `shared/documentoRellenable.js` (antes no existía — ver §0).
- **Menú lateral eliminado**: `shared/nav.js` reescrito (barra superior
  simple, ver §1.8), `shared/styles.css` con las nuevas clases
  `.topbar-*`, y `dashboard.html` con la sección "Administración"
  (tiles a los 11 paneles de admin, solo visible si `role === 'admin'`).
- **Domiciliación bancaria (mandato SEPA)**: reutiliza por completo el
  editor de `shared/documentoRellenable.js` (ver §0), que se generalizó
  para esto — `valorDePersonaParaTipo()` ya no tiene una lista fija de
  tipos identidad, ahora lee `persona[tipo]` directamente, así que
  cualquier página que llame a `abrirFormularioRelleno()` puede
  autorellenar lo que quiera sin tocar ese archivo compartido. Nuevos
  tipos de campo: `direccion`, `cp_ciudad_provincia`, `pais_deudor`,
  `iban`, `swift_bic`, `ref_mandato`, `id_acreedor`, `nombre_acreedor`,
  `direccion_acreedor`, `cp_acreedor`, `pais_acreedor`,
  `tipo_pago_fijo`.
  - `mandato_sepa_config`: fila única (plantilla PDF global + página
    rellenable + campos + los datos fijos del acreedor/AMPA).
  - `mandatos_sepa`: historial completo, con `vigente` marcando el
    actual — al firmar uno nuevo (`mandato_sepa_firmar()`), el anterior
    pasa a `vigente = false` y `socios.forma_pago`/`socios.iban` se
    actualizan **al instante, sin revisión de admin** (a diferencia del
    comprobante de cuota, que sí se revisa a mano).
  - Bucket `mandatos-sepa` (privado — contiene IBAN, no como el
    carrusel): las URLs se generan siempre firmadas
    (`createSignedUrl`), tanto para el admin como para el propio
    socio. Bucket `mandato-sepa-plantilla` (público, solo el PDF base
    en blanco, sin datos personales).
  - `admin-sepa.html`: pestañas "Plantilla y acreedor" / "Mandatos
    firmados". `mis-datos.html` ya no muestra el aviso de "pendiente" —
    el botón "Domiciliar / cambiar cuenta bancaria" abre el formulario
    real. Volver a firmar sustituye el mandato anterior (se permite
    cambiar de cuenta en cualquier momento).
- **Recuperar contraseña**: el código ya existía a medias (`login.html`
  ya llamaba a `sb.auth.resetPasswordForEmail`) — se completó con:
  `cambiar-clave.html` reescrito para distinguir "recuperación"
  (`#type=recovery` en la URL) de "cambio forzado", y mostrar una
  pantalla de "enlace caducado" en vez de rebotar en silencio a
  `login.html`; enlace "Cambiar mi contraseña" añadido en `mis-datos.html`
  (voluntario, sin forzar — la página ya lo permitía, solo faltaba el
  enlace); plantilla de email en español
  (`plantilla-email-recuperar-contrasena.html`) para pegar en Supabase.
  **Esto requiere 3 pasos de configuración manual en el panel de
  Supabase** (URL de redirect, SMTP propio para Auth, pegar la
  plantilla) — no es código, está documentado paso a paso en
  `README.md`, sección "Recuperar contraseña".
- **Eventos avanzado** (SQL + algoritmo + admin + socio + público):
  - SQL: `migracion-eventos-avanzado.sql` + `migracion-eventos-concurso-flag.sql`.
  - `evento-sortear.js`: sorteo simple, por pareja, o con prioridad histórica.
  - `admin-eventos.html`: todos los campos nuevos (fechas de apertura,
    método de asignación, pareja, prioridad histórica, precio por rol,
    sin inscripción), botón "Sortear" por evento, panel "Concurso"
    (leer envíos anónimos, marcar/desmarcar ganador, ver identidad
    revelada solo cuando gana).
  - `eventos.html`: router según tipo (`renderEventoInformativo` /
    `renderEventoConcurso` / `renderEventoPareja` / `renderEventoNormal`),
    voluntariado con alumnos acompañados, fechas de apertura/cierre
    aplicadas vía `estadoInscripcionSocio()`. El Comedor y cualquier
    otro `metodo_asignacion='sorteo'` sin pareja reutilizan el flujo
    normal de apuntarse (sin aforo en vivo; tras `sorteo_realizado` se
    muestra ganador/no ganador en vez del botón).
    Concurso literario: el envío es **uno por alumno** — `p_alumno_id`
    es obligatorio en `concurso_enviar_texto()`, se valida que
    pertenezca a la familia del que llama, y un mismo alumno no puede
    enviar dos veces para el mismo evento (`migracion-concurso-por-alumno.sql`).
  - `publico.html`: filtra por `abierto_no_socios = true` (nunca por
    `permite_invitados`, que es que un socio invite a alguien desde su
    cuenta, ej. Chocolatada — no debe salir en la web pública), excluye
    `sin_inscripcion`/`usa_concurso_texto`, y respeta
    `fecha_apertura_no_socios`/`fecha_cierre_inscripcion`.

### ⬜ Pendiente, sin empezar
- Mochila para no socios (tabla preparada con `tipo = 'no_socio'`, sin
  frontend ni política de alta pública todavía).
- Cargar ejemplares de libros y prendas de uniforme reales en la base
  de datos (alta manual desde los paneles de admin).

---

## 6. Alta de socios, login y páginas de admin restantes (confirmado
### leyendo el código real en esta sesión — antes solo se conocían por
### el README)

### 6.1 Flujo de alta y login
- **`hazte-socio.html`** + **`autoservicio-alta.js`** — alta
  self-service. El adulto principal **elige su propia contraseña** (no
  se le genera ni se le manda por email); el segundo adulto, si lo hay,
  sí recibe contraseña generada por email. El comprobante de pago es
  **obligatorio** para completar el formulario. Resultado: `socios.estado
  = 'recien_creada'`, redirige a `estado-recien-creada.html`.
- **`admin-importar.html`** + **`admin-import-socios.js`** — alta hecha
  por el admin (CSV o formulario manual, mismas columnas que documenta
  `README.md`). A diferencia de la anterior, crea la cuenta **ya
  `'activa'`** directamente y genera contraseña para AMBOS adultos
  (enviada por email). Reutiliza `shared/csv.js` para parsear el CSV.
- **`login.html`** → tras validar credenciales, comprueba en cascada:
  `force_password_change` → `cambiar-clave.html`; `estado ===
  'recien_creada'` → `estado-recien-creada.html`; `estado ===
  'falta_pago'` → `estado-falta-pago.html`; `estado === 'baja'` → se
  trata como login inválido (mismo mensaje genérico que credenciales
  incorrectas, no revela que la cuenta existe). Si todo bien →
  `dashboard.html`.
- **`cambiar-clave.html`** — obligatorio si `force_password_change =
  true` (primer acceso o tras recuperar contraseña). Al guardar, pone
  ese flag a `false` y sigue la misma cascada de redirección por estado.
- **`estado-recien-creada.html`** / **`estado-falta-pago.html`** —
  pantallas de espera. La segunda distingue si la forma de pago es
  `'Domiciliación Bancaria'` (mensaje pasivo, se resuelve solo) o no
  (formulario para subir un nuevo comprobante).

### 6.2 Resto de páginas de admin
- **`admin-carrusel.html`** — sube fotos a `fotos_carrusel` (solo las
  de portada, `evento_id is null`), con orden editable.
- **`admin-documentos.html`** — sube newsletters/documentos a la tabla
  `documentos` (categoría `newsletter`/`documento`), con ocultar/borrar.
- **`admin-email.html`** — email masivo por BCC, en tandas de 80,
  vía `enviar-email-masivo.js`. Destinatarios: todos los activos, por
  curso, o inscritos a un evento concreto.
- **`admin-respuestas.html`** — 3 pestañas: Préstamo (⚠️ desactualizada,
  ver §0), Eventos (inscritos por evento, exportable a CSV), Alumnos
  (listado para cotejar matrícula, con toggle de `alumnos.verificado`
  — el mismo campo que el reseteo anual pone a `false` cada 31 de julio).

### 6.3 Infraestructura de despliegue
- **`netlify.toml`** — `publish = "."`, `functions =
  "netlify/functions"`, `command = "npm install"`, redirect 404 →
  `index.html`.
- **`package.json`** — dependencias: `@supabase/supabase-js`,
  `nodemailer`. Nada más.

---

## 7. Dónde vive cada cosa (mapa rápido de archivos)

```
dashboard.html          → Hub del socio: Mochila, tiles a todo lo demás,
                           comentario directo, próximos eventos.
mis-datos.html           → SOLO edición de datos (adultos, alumnos, baja).
prestamo.html            → Socio: pedir libros / ver prestados.
uniformes.html           → Socio: elegir 3 prioridades por alumno.
encuestas.html           → Socio: responder encuestas abiertas.
eventos.html             → Socio: apuntarse a eventos (pendiente de
                           actualizar con la mecánica avanzada).
publico.html             → No socio: eventos abiertos (pendiente de
                           actualizar el filtro abierto_no_socios).
index.html               → Web pública: info, contacto (comentario-publico).
hazte-socio.html         → Alta self-service (adulto1 elige su propia
                           contraseña) → autoservicio-alta.js.
login.html               → Login + cascada de redirección por estado.
cambiar-clave.html       → Obligatorio si force_password_change = true.
estado-recien-creada.html / estado-falta-pago.html → pantallas de espera.

admin-libros.html         → Catálogo / Ejemplares / Convocatoria y reparto.
admin-uniformes.html      → Catálogo / Convocatoria y reparto.
admin-encuestas.html      → Crear / Resultados y consulta cruzada.
admin-eventos.html        → Crear eventos (pendiente de ampliar con la
                           mecánica avanzada + sorteo + concurso literario).
admin-importar.html      → Alta de socios (CSV o manual) → admin-import-socios.js.
admin-carrusel.html      → Fotos de portada (fotos_carrusel).
admin-documentos.html    → Newsletters/documentos públicos (tabla documentos).
admin-email.html         → Email masivo (BCC) → enviar-email-masivo.js.
admin-respuestas.html    → Préstamo (⚠️ desactualizada) / Eventos / Alumnos.

formularios.html          → ⚠️ CÓDIGO MUERTO — no tocar (ver §0).
admin-formularios.html    → ⚠️ CÓDIGO MUERTO — no tocar (ver §0).

supabase/schema.sql       → Esquema completo de referencia (despliegue
                           desde cero). Se actualiza cada sesión.
supabase/migracion-*.sql  → Migraciones incrementales, una por
                           funcionalidad añadida esta sesión.
```
