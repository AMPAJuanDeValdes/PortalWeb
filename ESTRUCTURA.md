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
- **Archivos sobrantes** (no tocar, se pueden borrar): copias sueltas en la
  raíz de `comentario-publico.js`, `comentario-socio.js`, `email.js`,
  `nav.js`; `netlify/functions/documentoRellenable.js` (código de navegador,
  sin `handler`); `netlify/functions/verificar-email-recuperacion.js`
  (sustituida por `recuperar-contrasena.js`); `estado-falta-pago.html` es
  ya solo una redirección a `reactivar-cuenta.html`.
- **No hay pantalla de admin para la Mochila**: las funciones
  `mochila-admin-*` existen, pero ninguna página las llama todavía.
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
   <access_token del usuario>`. **Créalo siempre con
   `clienteUsuario(event, token)` de `_lib/clientes.js`**: toma la clave
   de `SUPABASE_ANON_KEY` o, si falta, de la cabecera
   `x-supabase-anon-key` que envía el navegador (antes, sin la variable,
   la Mochila fallaba siempre). Se usa para llamar a funciones RPC que
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
- `redirigirPorEstado(socio)` — si `estado !== 'activa'`, redirige
  (`recien_creada` → `estado-recien-creada.html`; `falta_pago`/`baja` →
  `reactivar-cuenta.html`) y devuelve `false`.
- **Cuentas `baja` o `falta_pago` nunca entran al portal**:
  `requireAuth()` cierra la sesión y manda a `reactivar-cuenta.html`.
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
- **`shared/datos-ampa.js`** — `AMPA_IBAN`, `AMPA_CUOTA_ANUAL`,
  `htmlDatosTransferencia(concepto)` y `marcarCamposVacios([elementos])`
  (marca en rojo con la clase `.campo-error` y hace scroll al primero).
  **El IBAN del AMPA vive solo aquí.**
- **`shared/documentoRellenable.js`** — `renderizarPaginaPDF(pdfUrl, num)`,
  `abrirEditorPlantilla(...)`, `abrirFormularioRelleno(...)` (ver §0 —
  creado en esta sesión, antes no existía).

---

## 2. Esquema de base de datos — todas las tablas

### 2.1 Núcleo (ya existía en v1/v2 antes de esta sesión)
- **`socios`** — la cuenta familiar. `numero_socio_completo` es un campo
  generado. `estado`: `recien_creada` / `activa` / `falta_pago` / `baja`.
  `motivo_rechazo` (lo escribe el admin al rechazar) y
  `reactivacion_solicitada_en` (lo pone `reactivar-cuenta-solicitar.js`;
  se limpia al activar/rechazar/dar de baja).
  **Trigger `proteger_campos_socio`**: un socio (no admin) solo puede
  cambiar su `estado` a `'baja'` y no puede tocar número de socio, año de
  cuota, motivo ni la marca de reactivación.
- **`recuperaciones_password`** — registro de peticiones de "recuperar
  contraseña" (límite 1 cada 15 min por email). Solo Service Role.
- **`adultos`** — 1 o 2 por socio, login individual (`id` = uuid de
  `auth.users`). `role`: `'socio'` / `'admin'`. Los adultos de una
  familia pueden editar la ficha del otro (política "adultos actualizan
  a su familia"). **Trigger `proteger_campos_adulto`**: un no-admin no
  puede cambiar `role`, `socio_id` ni `email` (el email es el usuario de
  acceso; lo cambia el admin vía `admin-gestionar-cuenta` →
  `guardar_adulto`, que actualiza también `auth.users`). Tiene
  `ya_visito_comedor` (añadido en esta sesión, ver §2.7).
- **`alumnos`** — hijos de la familia (`curso` es **opcional** desde
  `migracion-gestion-cuentas.sql`; mínimo nombre, apellidos y etapa).
  Las referencias desde `evento_inscripciones` y
  `documentos_evento_respuestas` se borran en cascada con el alumno/adulto.
  `etapa`/`curso` vienen de
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

### 2.4 Préstamo de libros (ampliado con lo de la web aparte ampa-libros-web)
- **`libros_catalogo`** — título, editorial, ISBN (varios separados por " / "),
  `asignatura` (Lengua/Inglés/Alemán = idioma) y **`cursos text[]`** con
  los cursos en los que se usa, como `'Etapa|Curso'` (ej. Coraline =
  `{ESO|1º, ESO|2º}`). `etapa`/`curso` quedan como el curso "principal"
  (compatibilidad). Las páginas filtran SIEMPRE por `cursos`. `stock` lo
  recalcula un trigger a partir de los ejemplares. Catálogo real de 20
  títulos sembrado por `migracion-libros-uniformes.sql`.
- **`libros_ejemplares`** — un ejemplar físico por fila, `codigo` puesto a
  mano por el admin (se pueden dar de alta rangos: 0041–0045). `estado`:
  `disponible`/`prestado`/`perdido`/`baja`.
- **`libros_compras`** — registro de compras compartido entre admins:
  `estado` `reservado`/`comprado`/`recibido` (= "Obtenido"), tienda, coste,
  quién (`creado_por_nombre`) y cuándo. NO crea ejemplares: al obtenerlos
  se dan de alta a mano (decisión del usuario); el panel avisa de los
  "obtenidos sin dar de alta".
- **`prestamo_convocatorias`** — patrón §1.5. Estados `abierta` /
  `repartida` / `cancelada`. Acciones `convocatoria_admin_accion('prestamo',
  id, 'cerrar'|'cancelar')`. Repartir exige plazo ya cerrado.
- **`prestamo_items`** — una fila por libro pedido. `estado`
  (`pendiente`/`asignado`/`no_asignado`) + seguimiento físico:
  **`entregado_en`**, **`fecha_devolucion`**, **`perdido`**. Acciones
  `prestamo_admin_entrega(item, 'entregar'|'deshacer_entrega'|'devuelto'|
  'perdido'|'deshacer_devolucion')`. Devuelto → ejemplar `disponible`;
  perdido → ejemplar `perdido`. No se puede quitar/cambiar/anular el
  reparto de un libro ya entregado. La familia puede desmarcar peticiones
  pendientes mientras el plazo esté abierto.
- **Algoritmo de reparto** (`prestamo-repartir.js`): familia con menos
  libros recibidos; empate → la que pidió MÁS; empate → sorteo. Sin cambios.
- `prestamo-recordatorio.js` (admin): email de "devolved los libros" a
  una familia o a todas las que tienen libros entregados sin devolver.
- Frontend: `admin-libros.html` (pestañas Catálogo / Ejemplares /
  Convocatoria y reparto / **Demanda y compras** (necesarios, ejemplares,
  reservados, comprados, obtenidos, FALTAN, gasto, historial, importador
  del CSV de la web antigua, hijos por curso, detalle por familia,
  donaciones) / **Entregas y devoluciones**), `prestamo.html` (socio).

### 2.5 Entrega de Uniformes (ampliado con lo de ampa-uniformes-web)
- **`prendas_catalogo`** — tipo+talla con `stock`. Ya **no se edita a mano**:
  se registran movimientos con `uniformes_mover_stock(tipo, talla,
  cantidad, 'sumar'|'restar', motivo)` (crea la combinación si no
  existía, nunca baja de 0) y queda historial en **`prendas_movimientos`**.
  Stock inicial real (42 combinaciones) sembrado por la migración.
- **`uniformes_convocatorias`** — estados `abierta` / `repartida` /
  **`finalizada`** / **`cancelada`**; `resumen_reparto` (jsonb: totales,
  quién y cuándo), `finalizada_en/por`. Acciones
  `convocatoria_admin_accion('uniformes', id, 'cerrar'|'cancelar'|'finalizar')`.
  "Finalizar" (= "Cerrar y guardar") la deja de solo lectura: las RPC de
  asignar/quitar/anular/borrar lo rechazan. Para abrir otra, la anterior
  tiene que estar finalizada o cancelada.
- **`uniformes_pedidos`** — 3 filas por alumno (prioridad 1/2/3);
  `prioridad = 0` = asignación a mano. El admin puede asignar a mano
  ANTES del sorteo y el sorteo lo respeta (esos alumnos no entran).
  `uniformes_admin_borrar_pedido(socio, convocatoria)` borra el pedido de
  una familia devolviendo el stock.
- **La familia solo ve qué le ha tocado cuando la convocatoria está
  `finalizada`** (decisión del usuario).
- Formulario de la familia: por prioridad, primero el tipo y luego la
  talla; reglas 🔴/🟡/🟢 iguales (2ª no roja, 3ª verde).
- Frontend: `admin-uniformes.html` (Catálogo en tabla tipo×talla +
  movimientos; Convocatoria con todo el ciclo y pedidos por familia, CSV),
  `uniformes.html` (socio).

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
| `prestamo-recordatorio.js` | Email de recordatorio de devolución de libros | Admin |
| `admin-gestionar-cuenta.js` | `activar` (+email bienvenida), `rechazar` (motivo +email), `baja`, `quitar_adulto`, `guardar_adulto` | Admin |
| `reactivar-cuenta-solicitar.js` | Pedir reactivación con email + DNI + comprobante | Público |
| `recuperar-contrasena.js` | Enlace de recuperación (solo cuentas activas, 1 cada 15 min, SMTP propio) | Público |

`_lib/email.js` — utilidad SMTP compartida. Plantillas:
`plantillaCredenciales`, `plantillaMochilaTurno`, `plantillaComentario`,
`plantillaBienvenida`, `plantillaRechazo`, `plantillaRecuperarPassword`.
`_lib/clientes.js` — `clienteUsuario(event, token)` (ver §1.3).
`_lib/mochila.js` — `notificarNuevoTurno()`, usada por las 6 funciones
de la Mochila que pueden mover la cola.

---

## 4. Taxonomía de tipos de evento (revisada con la Junta, oct. 2026)

Todos usan las mismas tablas (`eventos` + flags). En el admin, «Empezar
desde» rellena las opciones típicas de cada tipo. Las reglas se comprueban
en la base de datos (`eventos_validar_inscripcion()`, migracion-eventos-v2.sql):
plazo, aforo con bloqueo (sin pasarse aunque dos familias se apunten a la
vez), duplicados, alergias obligatorias, niños con adulto, voluntarios,
subactividades solo para quien está en el evento, curso de los externos.
Los voluntarios no ocupan plaza; los invitados no socios sí.

| Evento | Opciones |
|---|---|
| **Chocolatada** | Toda la familia, sin aforo. `pide_alergias`; `alumnos_requieren_adulto` (si la familia apunta solo niños, indica con qué adulto socio van: `responsable_nombre`); `permite_invitados` + `precio_invitado` (el socio apunta a no socios con nombre, apellidos, edad, alergias y justificante); `voluntariado_modo = 'adultos_y_ninos'`. No aparece en la web pública. Listado con nombre, apellidos, edad y alergias en «Inscritos». |
| **Cabalgata** | `metodo_asignacion = 'sorteo'`, `requiere_pareja_adulto_alumno` (cada niño con un adulto; adultos solos también, sin ocupar plaza; el acompañante puede ser no socio con DNI), aforo en NIÑOS (12 o 20). Dos documentos (adulto y alumno) que firma cada persona apuntada; tras el sorteo, solo quien tiene plaza. |
| **Talleres** (juegos de mesa, rol, ciencias, Warhammer) | Solo alumnos de ciertos cursos, aforo por orden de llegada. Socios gratis; externos por la web pública (`abierto_no_socios`) con alumno, curso en rango, adulto responsable, teléfono, email y justificante (`precio_invitado`). Pregunta opcional (`pregunta_extra`/`pregunta_opciones`): Patines solo en juegos de mesa. Torneos = subactividades elegibles en el mismo formulario. `voluntariado_modo = 'adultos'`. |
| **Barbacoa** | Solo alumnos (gratis); los adultos no se apuntan y pagan en la entrada (`precio_adulto`, informativo). Subactividades con aforo, solo para alumnos apuntados al evento. Externos solo a subactividades (`publico_solo_actividades`) con `aviso_no_socios`. Voluntarios como en la Chocolatada. |
| **Visita al comedor** | Solo adultos, `sorteo` + `usa_prioridad_historial`: primero entre quienes nunca fueron; si sobran plazas, entre los que ya fueron. |
| **Concurso literario** | `usa_concurso_texto`: un texto por alumno en Word (.docx, bucket privado `concursos`, nombre al azar) o escrito; anónimo hasta elegir ganador. El texto del Word se extrae en el navegador con mammoth para leerlo en el panel. `concurso_envios.metadatos` guarda datos del Word (minutos de edición, revisiones, fechas, programa; nunca el autor) o, si se escribe en la web, tiempo y caracteres pegados; el panel muestra «Revisar» como pista orientativa para el jurado. |
| **Christmas, Olimpiadas matemáticas** | `sin_inscripcion`: informativo, con premios. |

**Premios** (`evento_premios`): puesto, premio y ganador, del evento o de una subactividad (torneos). Se muestran a las familias.

Los eventos se pueden editar en cualquier momento sin perder inscripciones.
La inscripción pública va por `evento_inscribir_publico()` (todo o nada).

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
  (tiles a los 12 paneles de admin, incluido "Socios" con contador de
  solicitudes pendientes; solo visible si `role === 'admin'`).
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
  - **Un solo mandato vigente por SOCIO** (índice único parcial
    `mandatos_sepa_un_vigente_por_socio`): la domiciliación es de la
    familia, los dos adultos ven el mismo mandato en "Mis datos" (IBAN,
    quién lo firmó, enlace al documento) y cualquiera puede sustituirlo.
    Al firmar, el documento se rellena con los datos del adulto que firma
    (releídos con `getAdulto()`, sin "PENDIENTE"; `localidad` = su ciudad)
    y el IBAN de la familia precargado.
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

- **Fusión de las webs aparte de Libros y Uniformes** (`migracion-libros-uniformes.sql`):
  ver §2.4 y §2.5. Las webs `ampa-libros-web` y `ampa-uniformes-web`
  quedan sustituidas por el portal.

### ⬜ Pendiente, sin empezar
- Mochila para no socios (tabla preparada con `tipo = 'no_socio'`, sin
  frontend ni política de alta pública todavía).
- Cargar ejemplares de libros y prendas de uniforme reales en la base
  de datos (alta manual desde los paneles de admin).

---

## 6. Alta de socios, login y páginas de admin restantes (confirmado
### leyendo el código real en esta sesión — antes solo se conocían por
### el README)

### 6.1 Flujo de alta, login y reactivación
- **`hazte-socio.html`** + **`autoservicio-alta.js`** — alta
  self-service. El navegador valida todo (campos vacíos en rojo), **sube
  primero el comprobante** a `comprobantes/publico/altas/...` y envía su
  ruta (`archivo_path`); la función lo crea todo o nada (usuario, socio,
  adultos, comprobante, alumnos) y deshace si algo falla. Fecha de
  nacimiento de alumnos obligatoria. Si el email pertenece a una cuenta
  `baja`/`falta_pago` (`codigo: 'cuenta_inactiva'`), el navegador redirige
  a `reactivar-cuenta.html?desde=alta`. Resultado: `recien_creada`.
- **`reactivar-cuenta.html`** + **`reactivar-cuenta-solicitar.js`** — sin
  sesión: email + DNI/NIE de un adulto + comprobante (subido a
  `publico/reactivaciones/`). Marca `reactivacion_solicitada_en`; el admin
  la aprueba en Socios → Solicitudes.
- **`admin-importar.html`** + **`admin-import-socios.js`** — alta por el
  admin, ya `'activa'`, contraseña generada por email a ambos adultos.
  Alumno válido = nombre + apellidos + etapa. Deshace la fila si falla.
- **`login.html`** — tras validar credenciales: `baja`/`falta_pago` →
  cierra sesión y muestra "Cuenta inactiva / Usuario dado de baja" con
  botón a Reactivar; `force_password_change` → `cambiar-clave.html`;
  `recien_creada` → `estado-recien-creada.html`; si no → `dashboard.html`.
  "¿Has olvidado tu contraseña?" abre un panel que llama a
  `recuperar-contrasena.js` (no usa `resetPasswordForEmail`).
- **`cambiar-clave.html`** — guarda el `#hash` original antes de cargar
  Supabase y distingue: enlace con error/caducado → aviso; recuperación
  (`type=recovery`, solo si la cuenta está activa) → "Restablece tu
  contraseña"; `force_password_change` → "Elige una nueva contraseña";
  voluntario → "Cambiar mi contraseña" con "‹ Inicio".

### 6.2 Resto de páginas de admin
- **`admin-socios.html`** — pestaña **Solicitudes pendientes** (altas
  `recien_creada` + reactivaciones pedidas, con TODOS los datos y el
  comprobante; Activar / Rechazar con motivo) y **Lista de socios**
  (buscador, filtro por estado, CSV, ficha desplegable editable: cuenta y
  nº de socio, estado, comprobantes, adultos, alumnos). Las acciones con
  email o sobre `auth.users` van por `admin-gestionar-cuenta.js`; el resto
  (socios, alumnos) se escribe directamente con RLS de admin.
- **`admin-comprobantes.html`** — ya solo comprobantes de **invitados**.
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
admin-socios.html        → Lista de socios + solicitudes (alta/reactivación) → admin-gestionar-cuenta.js.
admin-importar.html      → Alta de socios (CSV o manual) → admin-import-socios.js.
reactivar-cuenta.html    → Público: reactivar cuenta de baja/impago → reactivar-cuenta-solicitar.js.
admin-carrusel.html      → Fotos de portada (fotos_carrusel).
admin-documentos.html    → Newsletters/documentos públicos (tabla documentos).
admin-email.html         → Email masivo (BCC) → enviar-email-masivo.js.
admin-respuestas.html    → Préstamo (⚠️ desactualizada) / Eventos / Alumnos.

formularios.html          → ⚠️ CÓDIGO MUERTO — no tocar (ver §0).
admin-formularios.html    → ⚠️ CÓDIGO MUERTO — no tocar (ver §0).

pruebas/                  → Pruebas automáticas (Playwright) contra la web real.
                           Doble clic en pruebas/ejecutar-pruebas.bat. Ver pruebas/LEEME.md.
                           Configuración secreta en C:\Users\<tú>\ampa-pruebas.env (fuera del proyecto).
                           AL AÑADIR O CAMBIAR UNA FUNCIONALIDAD, AÑADIR/ACTUALIZAR SU PRUEBA AQUÍ.
supabase/schema.sql       → Esquema completo de referencia (despliegue
                           desde cero). Se actualiza cada sesión.
supabase/migracion-*.sql  → Migraciones incrementales, una por
                           funcionalidad. La última: migracion-gestion-cuentas.sql.
```
