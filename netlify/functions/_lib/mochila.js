// Utilidad compartida: cuando una entrada pasa a ser la nueva posición 1
// en la cola de la Mochila Jugona Exploradora, hay que avisarla por email.
// La usan todas las funciones que pueden mover la cola (apuntarse,
// posponer, desapuntarse, y las acciones de admin).
//
// Recibe SIEMPRE el cliente de Supabase con la SERVICE ROLE KEY, porque
// para socios necesita leer el email de OTRA familia (la que pasa a ser
// la nueva posición 1), algo que las políticas RLS no permiten al socio
// que disparó la acción.

const { enviarEmail, plantillaMochilaTurno } = require('./email');

async function notificarNuevoTurno(supabaseAdmin, nuevoP1Id) {
  if (!nuevoP1Id) return;

  const { data: entrada, error } = await supabaseAdmin
    .from('mochila_cola')
    .select('tipo, socio_id, nombre_contacto, email_contacto')
    .eq('id', nuevoP1Id)
    .single();
  if (error || !entrada) return;

  let nombre, email;
  if (entrada.tipo === 'socio') {
    const { data: adulto } = await supabaseAdmin
      .from('adultos')
      .select('nombre, email')
      .eq('socio_id', entrada.socio_id)
      .order('created_at')
      .limit(1)
      .single();
    if (!adulto) return;
    nombre = adulto.nombre;
    email = adulto.email;
  } else {
    nombre = entrada.nombre_contacto;
    email = entrada.email_contacto;
  }

  const { subject, text } = plantillaMochilaTurno({ nombre });
  await enviarEmail({ to: email, subject, text });
}

module.exports = { notificarNuevoTurno };
