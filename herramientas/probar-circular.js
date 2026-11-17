// Ver en local qué quedaría escrito en la circular de un evento (el PDF y el
// email), sin guardar nada en el correo ni en el historial: solo lee la base
// de datos. Usa el mismo código que el botón «Enviar circular» del panel
// (netlify/functions/circular-borrador.js), así que sale exactamente igual.
// Se lanza con herramientas\probar-circular.bat.
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { createClient } = require('@supabase/supabase-js');
const { cargarEntorno } = require('../pruebas/ayudantes/entorno');
cargarEntorno();
const { prepararCircularEventos, nombrePdfCircular } = require('../netlify/functions/circular-borrador');
const { pdfCircular } = require('../netlify/functions/_lib/pdf-circular');
const { correoCircular } = require('../netlify/functions/_lib/circular');
const { rutaAsset } = require('../netlify/functions/_lib/email');

const SALIDA = path.join(__dirname, 'circulares-de-prueba');
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const preguntar = (t) => new Promise(r => rl.question(t, r));
const fecha = (f) => f ? new Date(f).toLocaleString('es-ES', { timeZone: 'Europe/Madrid', dateStyle: 'medium', timeStyle: 'short' }) : 'sin fecha';

(async () => {
  // Eventos que no han terminado (como en el panel), más recientes primero
  const hace = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { data: eventos, error } = await sb.from('eventos').select('id, titulo, fecha, plantilla, solo_pruebas')
    .or(`fecha.is.null,fecha.gte.${hace}`).order('fecha', { ascending: true, nullsFirst: false });
  if (error) throw error;
  const lista = (eventos || []).filter(e => e.plantilla !== 'loteria');
  if (!lista.length) { console.log('No hay eventos próximos.'); return; }
  console.log('\nEventos:');
  lista.forEach((e, k) => console.log(`  ${String(k + 1).padStart(2)}. ${e.titulo}${e.solo_pruebas ? ' [PRUEBA]' : ''} · ${fecha(e.fecha)}`));
  const n = parseInt(await preguntar('\nNúmero del evento: '), 10);
  const ev = lista[n - 1];
  if (!ev) { console.log('Número no válido.'); return; }

  // Eventos a la misma hora: se pueden juntar en la misma circular
  const { data: pares } = await sb.from('evento_incompatibles').select('evento_a, evento_b').or(`evento_a.eq.${ev.id},evento_b.eq.${ev.id}`);
  const ids = (pares || []).map(x => x.evento_a === ev.id ? x.evento_b : x.evento_a);
  let conjunta = [];
  if (ids.length) {
    const { data: otros } = await sb.from('eventos').select('id, titulo, fecha, plantilla').in('id', ids);
    const posibles = (otros || []).filter(o => o.plantilla !== 'warhammer');
    if (posibles.length) {
      console.log(`\n«${ev.titulo}» es a la misma hora que:`);
      posibles.forEach((o, k) => console.log(`  ${k + 1}. ${o.titulo} · ${fecha(o.fecha)}`));
      const r = await preguntar('¿Cuáles incluyes en la misma circular? (números separados por comas; Enter = ninguno): ');
      conjunta = r.split(/[ ,]+/).map(x => posibles[parseInt(x, 10) - 1]).filter(Boolean).map(o => o.id);
    }
  }

  const web = process.env.SITE_URL;
  const r = await prepararCircularEventos(sb, ev.id, conjunta, web);
  if (r.error) { console.log('[!] ' + r.error); return; }
  const { texto, html } = correoCircular({ ...r.correo, entrada: r.correo.entrada || r.circular.entrada, circular: r.circular, enlaces: r.correo.enlaces });
  fs.mkdirSync(SALIDA, { recursive: true });
  const base = nombrePdfCircular(r.circular).replace(/\.pdf$/, '');
  const pdf = path.join(SALIDA, base + '.pdf');
  const email = path.join(SALIDA, base + ' - email.html');
  fs.writeFileSync(pdf, pdfCircular(r.circular, { logo: rutaAsset('logo-ampa-circular.png') }));
  fs.writeFileSync(email, `<!doctype html><meta charset="utf-8"><title>${r.asunto}</title>
<div style="font-family:Verdana,sans-serif;font-size:10pt;max-width:640px;margin:24px auto;">
<p style="color:#666;margin:0 0 4px;">Asunto:</p><p style="margin:0 0 18px;"><b>${r.asunto.replace(/</g, '&lt;')}</b></p>
<p style="color:#666;margin:0 0 4px;">Adjunto: ${path.basename(pdf).replace(/</g, '&lt;')}</p><hr style="margin:12px 0 18px;">${html}</div>`);
  console.log('\nAsunto: ' + r.asunto + '\n');
  console.log(texto);
  console.log('\nGuardado en ' + SALIDA + ':\n  ' + path.basename(pdf) + '\n  ' + path.basename(email));
  console.log('(No se ha guardado nada en el correo ni en el historial.)');
  // Abrirlos
  const abrir = (f) => require('child_process').exec(process.platform === 'win32' ? `start "" "${f}"` : `xdg-open "${f}"`);
  abrir(pdf); abrir(email);
})().catch(e => { console.error('[!] ' + (e.message || e)); process.exitCode = 1; }).finally(() => rl.close());
