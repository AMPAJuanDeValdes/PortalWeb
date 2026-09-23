# Cambios de esta sesión — índice

**Antes de nada: lee `ESTRUCTURA.md`.** Es el documento de referencia
completo del proyecto y hay que mantenerlo actualizado en cada sesión
futura.

⚠️ **`README.md` se ha reescrito y consolidado** en esta ronda (no solo
se le añadió la sección nueva) — repásalo antes de sustituir tu copia,
por si se perdió algún detalle que quisieras conservar tal cual estaba.

## Cómo aplicar esto a tu proyecto YA desplegado

1. Sustituye los archivos `.html`, `shared/*.js`, `shared/styles.css`,
   `README.md` y todo lo de `netlify/functions/` por las versiones de
   este zip (mismas rutas).
2. Sube todo a GitHub y espera el deploy de Netlify.
3. En el SQL Editor de Supabase, ejecuta las migraciones de `supabase/`
   en este orden (sáltate las que ya hayas ejecutado):
   1. `migracion-libros-campos.sql`
   2. `migracion-mochila.sql`
   3. `migracion-prestamo-ejemplares.sql`
   4. `migracion-prestamo-admin.sql`
   5. `migracion-uniformes.sql`
   6. `migracion-encuestas.sql`
   7. `migracion-comentarios.sql`
   8. `migracion-eventos-avanzado.sql`
   9. `migracion-eventos-concurso-flag.sql`
   10. `migracion-concurso-por-alumno.sql`
   11. `migracion-mandato-sepa.sql`
4. **Configura "Recuperar contraseña" en el panel de Supabase** — 3
   pasos manuales, no son código. Están explicados paso a paso en
   `README.md`, sección "Recuperar contraseña — configuración
   obligatoria en Supabase":
   - Añadir la URL de `cambiar-clave.html` a Redirect URLs.
   - Conectar vuestro SMTP propio en Authentication → SMTP Settings.
   - Pegar `plantilla-email-recuperar-contrasena.html` en la plantilla
     "Reset Password".

`supabase/schema.sql` es tu copia de referencia completa (para un
despliegue nuevo desde cero); ya incluye todo lo anterior integrado.

## Qué toca cada cosa

- **Mochila, Préstamo, Uniformes, Encuestas, Comentario directo,
  Eventos avanzado, menú lateral eliminado, Domiciliación SEPA**: ver
  el detalle en `ESTRUCTURA.md` (sección "✅ Completo").
- **Recuperar contraseña**, la novedad de esta ronda:
  - `cambiar-clave.html` reescrito: distingue "recuperación" de
    "cambio forzado" en el título, y muestra una pantalla de "enlace
    caducado" en vez de rebotar en silencio a `login.html`.
  - `mis-datos.html`: enlace nuevo "Cambiar mi contraseña" (la función
    ya existía, solo faltaba el acceso voluntario).
  - `plantilla-email-recuperar-contrasena.html`: plantilla en español
    con la marca del AMPA, para pegar en el panel de Supabase.
  - `README.md`: nueva sección con los 3 pasos de configuración
    obligatoria en Supabase (no son código, hay que hacerlos a mano).

## Pendiente (no incluido en este zip)

- Mochila para no socios (tabla lista, sin frontend).
- Cargar ejemplares de libros y prendas de uniforme reales en la base
  de datos.
- Revisar/actualizar `admin-respuestas.html` pestaña Préstamo.
- `formularios.html` / `admin-formularios.html` son código muerto —
  no tocar (ver `ESTRUCTURA.md` §0).
