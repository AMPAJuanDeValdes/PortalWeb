# Plan de pruebas — Portal AMPA v2

> **Automático:** las secciones 1 (acceso), 2 (Mis datos), 3 (Mochila, solo apuntarse/desapuntarse), 9 (navegación), 11 (seguridad) y 12 (gestión de cuentas) ya se comprueban solas con `pruebas\ejecutar-pruebas.bat` (ver `pruebas/LEEME.md`). Lo que sigue siendo manual: préstamo, uniformes, encuestas, eventos, SEPA y comprobar a ojo los emails.

> Cómo usar esto: ve marcando `[x]` cada caso a medida que lo pruebas.
> Si algo falla, anota debajo del caso qué pasó exactamente (mensaje de
> error, captura, o descripción) para poder diagnosticarlo después —
> no hace falta que lo arregles tú, solo que quede constancia.
>
> Necesitas mínimo: 1 cuenta admin, 2-3 cuentas de socio de prueba (una
> con 1 adulto y 1 alumno, otra con 2 adultos y 2+ alumnos de cursos
> distintos), y acceso a los emails de esas cuentas de prueba para
> comprobar que llegan los correos.

---

## 0. Antes de nada: datos de prueba necesarios

- [ ] Al menos 2 socios de prueba activos, con alumnos de **cursos/etapas
      distintas** (para poder probar elegibilidad por curso y por edad).
- [ ] Al menos 1 socio con **2 adultos** en la misma familia.
- [ ] Alta de ejemplares de libros de prueba (mínimo 2 títulos, con
      varias copias de uno de ellos) desde `admin-libros.html`.
- [ ] Alta de prendas de prueba (mínimo 3 combinaciones tipo+talla, con
      stock variado: alguna con stock ≤2, alguna 3-5, alguna ≥6) desde
      `admin-uniformes.html`.
- [ ] Plantilla del mandato SEPA subida y con los campos colocados
      (`admin-sepa.html`) — si no la has subido siguiendo el mensaje
      anterior, hazlo antes de probar la sección 10.

---

## 1. Autenticación y cuentas

### 1.1 Login normal
- [ ] Login con credenciales correctas → entra a `dashboard.html`.
- [ ] Login con contraseña incorrecta → mensaje genérico de error (no
      debe decir si el email existe o no).
- [ ] Login con un socio en estado `baja` → mismo mensaje genérico que
      credenciales incorrectas (no debe distinguir).

### 1.2 Recuperar contraseña
- [ ] `login.html` → "¿Has olvidado tu contraseña?" con un email real
      de prueba → mensaje de confirmación en pantalla.
- [ ] Llega el email — en **español**, con vuestra marca, **desde
      vuestro propio buzón** (no una dirección genérica de Supabase).
      Si no está así, revisa la configuración de SMTP en Supabase.
- [ ] El botón del email lleva a `cambiar-clave.html` con el título
      **"Restablece tu contraseña"** (no "Elige una nueva contraseña").
- [ ] Pones una contraseña nueva → guarda → te lleva a `dashboard.html`
      (o a `estado-*` si tu socio de prueba está en ese estado).
- [ ] Entras de nuevo con la contraseña nueva → funciona.
- [ ] Abres el mismo enlace del email una segunda vez (ya usado) →
      aparece la pantalla "Enlace no válido o caducado" con botón de
      volver al login (no una pantalla en blanco ni error de consola).

### 1.3 Cambio de contraseña forzado (primer acceso)
- [ ] Admin da de alta un socio nuevo (`admin-importar.html`) → llega
      email con contraseña provisional.
- [ ] Entras con esa contraseña → te redirige automáticamente a
      `cambiar-clave.html` con el título **"Elige una nueva contraseña"**
      (no "Restablece...").
- [ ] Pones contraseña nueva → te deja entrar con normalidad.

### 1.4 Cambio de contraseña voluntario
- [ ] Ya logueado con normalidad, entras en "Mis datos" → pulsas
      "Cambiar mi contraseña" → te lleva a `cambiar-clave.html` sin
      forzarte, la cambias, y vuelves a `dashboard.html`.

### 1.5 Alta de socios
- [ ] Alta manual desde `admin-importar.html` → socio queda `activa` al
      instante, llega email a los adultos.
- [ ] Alta por CSV con 1 fila → mismo resultado.
- [ ] Alta autoservicio (`hazte-socio.html`) → socio queda
      `recien_creada`, adulto principal entra con la contraseña que
      él mismo puso (sin esperar email).
- [ ] Ese socio en `recien_creada` intenta entrar a `dashboard.html`
      directamente por URL → le redirige a `estado-recien-creada.html`.

---

## 2. Mis datos

- [ ] Editar datos propios de un adulto → guarda correctamente.
- [ ] Añadir un segundo adulto → llega email con contraseña provisional
      al nuevo adulto, y aparece en la lista de adultos de la familia.
- [ ] Intentar añadir un segundo adulto con el mismo email que el
      primero → error claro, no lo permite.
- [ ] Dar de alta un alumno nuevo → aparece en la lista; queda
      disponible para Préstamo/Uniformes/Eventos de inmediato.
- [ ] Editar un alumno existente (cambiar de curso) → se refleja en
      Préstamo/Eventos (los libros/eventos que ve cambian según el
      nuevo curso).
- [ ] "Dar de baja mi cuenta" → pide confirmación → tras confirmar, el
      socio pasa a `baja` y no puede volver a entrar (ver 1.1).

---

## 3. Mochila Jugona Exploradora

- [ ] Con la cola vacía, un socio se apunta → queda en **posición 1** →
      le llega el email de "te toca la mochila" **al instante** (no
      hace falta esperar a que alguien más se apunte).
- [ ] Un segundo socio se apunta → queda en posición 2, **no** recibe
      email.
- [ ] El primer socio pulsa "Prefiero esperar una semana más" → pasa a
      posición 2, el segundo pasa a posición 1 **y le llega el email**.
- [ ] El socio en posición 1 pulsa "Desapuntarme" → sale de la cola,
      el siguiente (si lo hay) sube y recibe el email.
- [ ] Admin entra en la Mochila y pulsa "Entregar" sobre quien está en
      posición 1 → esa familia pasa a "posición 0" (la tiene ahora),
      el resto sube una posición, y el nuevo posición 1 recibe el email.
- [ ] Con alguien en posición 0, ese socio intenta pulsar "Desapuntarme"
      → la base de datos lo rechaza con un mensaje claro (hay que
      devolverla, no desapuntarse).
- [ ] Admin pulsa "Marcar como devuelta" → esa familia desaparece de la
      cola, aparece en el historial (`mochila_historial`) con sus
      fechas, y el resto de la cola **no** se mueve (posición 1 sigue
      siendo el mismo hasta el próximo "Entregar").
- [ ] Admin pulsa "Pasar una semana" sobre quien está en posición 1 (sin
      que el socio lo haya pedido) → mismo efecto que si lo hiciera el
      socio: baja una posición, el siguiente sube y recibe el email.
- [ ] Admin pulsa "Eliminar" sobre alguien a mitad de la cola (no
      posición 1) → desaparece, los de detrás bajan una posición, y
      **no** se envía ningún email (solo se envía cuando cambia quién
      está en posición 1).

---

## 4. Préstamo de libros

### 4.1 Ciclo básico
- [ ] Admin crea una convocatoria con fecha de cierre en el futuro
      próximo (ej. dentro de 5 minutos, para no esperar).
- [ ] Un socio ve el formulario de petición en `prestamo.html` y pide
      2-3 libros para un alumno.
- [ ] Pasado el cierre, el formulario desaparece y muestra "plazo
      cerrado" — ya no se puede pedir más.
- [ ] Admin pulsa "Repartir" → se asignan ejemplares; el socio ve en
      `prestamo.html` los libros que le tocaron con su código de
      ejemplar.
- [ ] Admin pulsa "Repartir" una segunda vez sobre la misma convocatoria
      → error claro ("ya se repartió"), no repite el proceso ni duplica
      asignaciones.

### 4.2 Algoritmo de reparto (lo importante)
Recrea el escenario que ya validamos por escrito: varias familias
pidiendo un número distinto de copias del mismo título, con menos
copias que peticiones. Comprueba que:
- [ ] Nadie que pidió **más** libros en total termina con **menos**
      asignados que alguien que pidió menos (la regla de oro).
- [ ] Si sobra algún ejemplar sin poder asignarse a nadie de la familia
      que le tocaba (porque ya agotó sus opciones), no se desperdicia:
      pasa a la siguiente familia con hueco.

### 4.3 Edición manual tras el reparto
- [ ] Admin usa "Quitar" sobre una asignación → el ejemplar vuelve a
      estar disponible (compruébalo en la pestaña Ejemplares: pasa a
      `disponible`).
- [ ] Admin usa el desplegable para "Asignar" ese ejemplar liberado a
      otra solicitud → funciona, y el ejemplar puesto vuelve a
      `prestado`.
- [ ] Admin pulsa "Anular todo el reparto y volver a empezar" → todas
      las solicitudes vuelven a `pendiente`, todos los ejemplares antes
      asignados vuelven a `disponible`, y el botón "Repartir" vuelve a
      estar disponible.

### 4.4 Donaciones
- [ ] Un socio ofrece una donación (sin necesitar convocatoria abierta)
      → se guarda correctamente en cualquier momento.

---

## 5. Entrega de uniformes

### 5.1 Ciclo básico
- [ ] Admin crea convocatoria con fecha de cierre próxima.
- [ ] Un socio con 2+ alumnos elige 3 prioridades (prenda+talla) **por
      cada alumno**.
- [ ] El semáforo de color se respeta: la 2ª prioridad nunca ofrece
      combinaciones 🔴 (stock ≤2), la 3ª solo ofrece 🟢 (stock ≥6).
- [ ] No se puede elegir la misma prenda en dos prioridades del mismo
      alumno (al elegirla en una, desaparece de las otras dos
      desplegables).
- [ ] Tras el cierre, admin pulsa "Repartir".

### 5.2 Algoritmo (aceptación diferida)
Recrea el ejemplo de la sudadera contestada: 3 alumnos piden la misma
combinación con stock insuficiente.
- [ ] Se resuelve por sorteo aleatorio quién se queda con la 1ª opción;
      los demás pasan a comprobar su 2ª, y si hace falta su 3ª.
- [ ] Ningún alumno recibe más de 1 prenda en total.
- [ ] Un alumno que agota sus 3 prioridades sin conseguir hueco queda
      como "sin asignar", sin romper el reparto de los demás.

### 5.3 Edición manual
- [ ] Admin "Quita" una prenda asignada → el stock de esa combinación
      sube en 1.
- [ ] Admin "Asigna" manualmente una prenda **que no estaba entre las 3
      elegidas** por la familia a un alumno sin asignar → funciona, y
      queda registrado como ajuste manual.
- [ ] "Anular todo el reparto" → todo el stock consumido se devuelve,
      los pedidos originales (prioridad 1/2/3) vuelven a `pendiente`,
      y los ajustes manuales (prioridad 0) desaparecen.

---

## 6. Encuestas

- [ ] Admin crea una encuesta con una pregunta de cada tipo (opción
      única, opción múltiple, texto libre), **no anónima**.
- [ ] Un socio la responde → aparece marcada como "ya respondida" si
      vuelve a entrar (no le deja responder dos veces).
- [ ] Admin ve los resultados agregados correctamente (conteos por
      opción, lista de textos libres).
- [ ] Repite creando una encuesta **anónima** → tras responder, el
      admin **no puede** ver qué socio contestó qué (comprueba
      directamente en la tabla `encuesta_envios` que `socio_id` es
      `null` para esa encuesta).
- [ ] Consulta cruzada entre dos preguntas de opción → la tabla de
      cruce muestra números coherentes con lo que has respondido en las
      pruebas.
- [ ] Encuesta con fecha de cierre ya pasada → el socio ya no puede
      responder; admin puede cerrarla a mano con el botón "Cerrar
      encuesta" en cualquier momento aunque no tenga fecha.

---

## 7. Comentario directo por email

- [ ] Desde `dashboard.html` (logueado), envías un comentario → llega
      el email al buzón del AMPA, y si tu socio de prueba tiene 2
      adultos, **ambos** aparecen en el Reply-To (compruébalo dándole a
      "Responder" en el cliente de correo y viendo a quién va).
- [ ] Desde `index.html` (sin sesión, web pública), envías un
      comentario con tu email → llega igual, con Reply-To a ese único
      email.
- [ ] En ambos casos, queda guardada una copia en la tabla
      `comentarios` (solo visible para el admin).

---

## 8. Eventos — por cada tipo de mecánica

### 8.1 Taller normal (aforo, público y/o privado)
- [ ] Evento privado (solo socios): un adulto/alumno se apunta desde
      `eventos.html`, se descuenta del aforo mostrado.
- [ ] Evento marcado `abierto_no_socios`: aparece en `publico.html`
      para alguien sin sesión, que puede apuntarse escribiendo los
      datos del alumno a mano.
- [ ] Con `fecha_apertura_socios` en el futuro: el socio ve el mensaje
      de apertura futura, no el formulario.
- [ ] Con `fecha_apertura_no_socios` distinta de la de socios: comprueba
      que un no-socio no puede apuntarse antes de esa fecha aunque el
      socio ya pueda.
- [ ] Aforo completo → el botón desaparece y muestra "Completo" para
      quien no esté ya apuntado.
- [ ] Actividades dentro del evento (ej. Barbacoa con talleres
      anidados): cada una respeta su propio aforo y elegibilidad.
- [ ] Exclusiones entre actividades: apuntado a la actividad A, la
      actividad B marcada como excluyente con A no deja apuntarse.

### 8.2 Cabalgata (pareja obligatoria + sorteo)
- [ ] Se forma una pareja adulto socio + alumno → aparecen juntos en
      "Parejas apuntadas".
- [ ] Se forma una pareja con un adulto **no socio** (nombre escrito a
      mano) + alumno → funciona igual.
- [ ] "Quitar pareja" borra las dos inscripciones (adulto y alumno) a
      la vez, nunca solo una.
- [ ] Con más parejas que aforo, admin pulsa "Sortear" → **si pierde
      un miembro de la pareja, pierde el otro también** (nunca gana uno
      y pierde el otro).
- [ ] Tras el sorteo, cada familia ve en su pareja "Ganadores 🎉" o
      "No salieron en el sorteo", nunca resultados mixtos dentro de la
      misma pareja.
- [ ] Pulsar "Sortear" una segunda vez → rechazado, no se repite.

### 8.3 Comedor (prioridad histórica)
- [ ] Con 0 o 1 adultos marcados como "ya visitó" entre los apuntados,
      confirma que estos participan igual que el resto en el sorteo si
      hay ≤1 "nuevo" (revisa la regla exacta: solo entran si hay 0 o 1
      que nunca han ido).
- [ ] Con 2+ adultos que nunca han ido apuntados, los que ya visitaron
      antes **no** entran en el sorteo de las 2 plazas.
- [ ] Tras el sorteo, comprueba en la tabla `adultos` que los 2
      ganadores que **no habían visitado antes** quedan marcados
      `ya_visito_comedor = true` (para que la próxima edición ya cuente
      con eso).

### 8.4 Concurso literario (anónimo, por alumno)
- [ ] Un socio envía un texto a nombre de un alumno concreto.
- [ ] Ese mismo alumno **no puede** enviar un segundo texto (el sistema
      lo bloquea con un mensaje claro).
- [ ] Otro alumno de la misma familia **sí puede** enviar el suyo,
      independientemente del primero.
- [ ] Admin entra en el panel "Concurso" del evento → ve el texto pero
      **no** quién lo escribió.
- [ ] Admin marca un envío como "ganador" → **inmediatamente** aparece
      el nombre del alumno y de la familia junto a ese envío.
- [ ] Los envíos que **no** se marcan ganadores siguen sin mostrar
      identidad, incluso después de que otros ya se hayan revelado.

### 8.5 Concurso de Christmas (sin inscripción)
- [ ] Aparece en `eventos.html` como tarjeta informativa, sin ningún
      botón de apuntarse ni formulario.

### 8.6 Chocolatada (invitados de pago, solo desde la cuenta del socio)
- [ ] Un socio invita a alguien pagando (nombre + comprobante) desde
      `eventos.html` → aparece en su lista de invitados.
- [ ] Ese mismo evento **no aparece** en `publico.html` (comprueba que
      `abierto_no_socios` es `false` para este evento en concreto).

### 8.7 Voluntariado
- [ ] Un adulto se apunta como voluntario → aparece en la lista.
- [ ] Sin ningún adulto voluntario todavía, **no** debe aparecer la
      opción de apuntar a un alumno como voluntario.
- [ ] En cuanto hay un adulto voluntario, aparece la opción de apuntar
      a un alumno "acompañando" → funciona.
- [ ] Intenta forzar (por API/consola, si sabes cómo) apuntar a un
      alumno como voluntario sin ningún adulto voluntario en ese
      evento → la base de datos lo rechaza (el trigger debe bloquearlo
      aunque el frontend no lo intente).

### 8.8 Documentos de evento (firma)
- [ ] En un evento con documento configurado (o crea uno de prueba
      distinto al SEPA), un adulto/alumno elegible ve "Rellenar y
      firmar", completa el PDF renderizado, firma con el ratón/dedo, y
      al confirmar se sube la imagen final y queda marcado "Completado".
- [ ] Si edita algún dato precargado (ej. cambia su nombre respecto al
      que había en la ficha), queda marcado "(con datos editados)"
      para que el admin lo note.

---

## 9. Navegación

- [ ] En cualquier página que no sea `dashboard.html`, aparece el botón
      **"‹ Inicio"** arriba y funciona.
- [ ] En `dashboard.html` **no** aparece ese botón (tiene sentido, ya
      estás ahí).
- [ ] "Cerrar sesión" funciona desde cualquier página.
- [ ] Con un usuario **no admin**, la sección "Administración" de
      `dashboard.html` **no aparece**.
- [ ] Con un usuario admin, aparecen los 11 tiles de administración y
      todos llevan a la página correcta.
- [ ] Ninguna página muestra ya el menú lateral antiguo.

---

## 10. Domiciliación SEPA

- [ ] Con la plantilla ya subida y configurada (ver sección 0), un
      socio entra en "Mis datos" → "Domiciliar / cambiar cuenta
      bancaria" → ve el PDF con el logo del AMPA y los datos del
      acreedor ya escritos.
- [ ] Rellena sus datos, IBAN y firma → al confirmar, su `forma_pago`
      cambia a "Domiciliación Bancaria" **al instante**, sin que un
      admin tenga que aprobar nada.
- [ ] El socio puede ver el IBAN que quedó guardado reflejado en "Mis
      datos".
- [ ] El mismo socio vuelve a firmar con un IBAN **distinto** (cambio
      de cuenta) → el mandato anterior queda marcado como "Sustituido"
      en `admin-sepa.html`, y el nuevo como "Vigente"; `socios.iban` se
      actualiza al nuevo.
- [ ] El socio puede ver su propio documento firmado (enlace en algún
      punto de "Mis datos" o donde lo hayas dejado) — comprueba que el
      enlace funciona (URL firmada, no un 403).
- [ ] Admin ve el listado completo de mandatos de **todos** los socios
      en `admin-sepa.html`, con enlace a cada documento firmado.
- [ ] Un socio intenta acceder directamente (por URL) al archivo
      firmado de **otro** socio en el bucket `mandatos-sepa` → debe
      fallar (403), el bucket es privado y las políticas restringen por
      `socio_id`.

---

## 11. Seguridad / aislamiento entre socios (importante, no os saltéis esto)

Para cada una de estas, usa las herramientas de desarrollador del
navegador (o Postman/curl con el `anon key`) para intentar acceder a
datos de OTRO socio distinto al que tiene la sesión abierta, y confirma
que la respuesta es vacía o un error de permisos, nunca los datos:

- [ ] Leer `adultos`/`alumnos` de otro socio.
- [ ] Leer `mochila_cola`, `prestamo_items`, `uniformes_pedidos`,
      `encuesta_envios`, `mandatos_sepa` de otro socio.
- [ ] Leer `concurso_identidades` de un envío ajeno que no sea ganador.
- [ ] Llamar a una función de Netlify de admin (ej.
      `mochila-admin-entregar`, `prestamo-repartir`,
      `enviar-email-masivo`) con el token de un socio normal → debe
      devolver 403.
- [ ] Llamar a cualquier función de Netlify sin token en absoluto →
      debe devolver 401.

---

## 12. Gestión de cuentas (nuevo)

- [ ] Hazte socio sin rellenar nada → todos los campos obligatorios en rojo, incluido el comprobante.
- [ ] Hazte socio con alumno sin fecha de nacimiento → fecha en rojo, no deja continuar.
- [ ] Hazte socio con el email de una cuenta de baja → te lleva a "Reactivar mi cuenta".
- [ ] Hazte socio con el email de una cuenta activa → mensaje con enlace a iniciar sesión; **no** aparece ninguna solicitud vacía en Admin → Socios.
- [ ] Admin → Socios → Solicitudes: se ven todos los datos y el comprobante. "Activar" → llega email de bienvenida con el nº de socio.
- [ ] "Rechazar…" sin motivo → no deja. Con motivo → llega email con el motivo y la cuenta pasa a "De baja".
- [ ] Login con cuenta de baja (contraseña correcta) → panel "Usuario dado de baja" con botón Reactivar.
- [ ] Reactivar cuenta (email + DNI + comprobante) → aparece en Solicitudes como "Reactivación" → Activar → email "vuelve a estar activa" y ya puede entrar.
- [ ] Recuperar contraseña con email de baja o inexistente → no se envía nada.
- [ ] Recuperar contraseña dos veces seguidas → la segunda dice que esperes 15 min.
- [ ] Abrir el enlace del correo por segunda vez → "Enlace no válido o caducado".
- [ ] Admin → Lista de socios: buscar, filtrar por estado, exportar CSV.
- [ ] Admin cambia el nº secuencial a uno que ya existe → error claro. A uno libre → se guarda.
- [ ] Admin cambia el email de un adulto → esa persona entra con el email nuevo.
- [ ] Admin quita un alumno con inscripciones → se borra sin error.
- [ ] Admin quita el 2º adulto → desaparece y ya no puede entrar. No deja quitar al único adulto.
- [ ] Alta manual de admin con un alumno solo con nombre, apellidos y etapa → se crea.
- [ ] Mis datos → "Añadir segundo adulto" (formulario) → el móvil aparece en su ficha.
- [ ] Adulto 1 edita el móvil del adulto 2 y guarda → al recargar sigue ahí.
- [ ] Mochila → "Apuntarme" funciona.
- [ ] Seguridad: desde la consola, `sb.from('adultos').update({role:'admin'}).eq('id', <tu id>)` → error.

---

## Cómo reportar lo que falle

Por cada caso marcado como fallido, apunta:
1. Qué paso exacto seguiste.
2. Qué esperabas que pasara (según este documento).
3. Qué pasó realmente (mensaje de error tal cual, o descripción).
4. Si hay un error en la consola del navegador (F12), cópialo también.

Con eso puedo diagnosticar y corregir sin tener que volver a pedirte
que reproduzcas el problema paso a paso.
