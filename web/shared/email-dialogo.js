// Ventana para escribir un email a una persona o a una familia desde el panel
// de la Junta (Socios → ficha, Mochila Jugona Exploradora…). Siempre con vista
// previa: «Enviar» solo se activa después de verla, y si se cambia el texto
// hay que volver a verla. Lleva la firma del AMPA y queda copia en Enviados.
// Lo envía la función enviar-email-masivo (destino: { adultoId } o { mochilaColaId }).
//
//   abrirEmailDialogo({ titulo: 'Email a Lucía Ruiz', para: 'lucia@…' (opcional, se
//                       completa con la vista previa), saludo: 'Lucía', destino: { adultoId } })

(function () {
  const css = document.createElement('style');
  css.textContent = `
  .dialogo-email{ width:min(640px, 94vw); border:1px solid var(--line); border-radius:18px; padding:20px 22px; }
  .dialogo-email::backdrop{ background:rgba(22,35,58,.35); }
  .de-cab{ display:flex; flex-direction:column; gap:2px; margin-bottom:12px; }
  .de-cab b{ font-family:var(--font-title); font-size:20px; }
  .de-cab span{ color:var(--ink-soft); font-size:15px; }`;
  document.head.appendChild(css);
})();

function abrirEmailDialogo({ titulo, para = '', saludo = '', destino }) {
  const escD = (t) => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const d = document.createElement('dialog');
  d.className = 'dialogo-email';
  d.innerHTML = `<div class="de-cab"><b>${escD(titulo)}</b><span class="dePara">${escD(para)}</span></div>
    <div class="field"><label for="deAsunto">Asunto</label><input type="text" id="deAsunto"></div>
    <div class="field"><label for="deCuerpo">Mensaje</label><textarea id="deCuerpo" rows="8"></textarea></div>
    <p style="font-size:14px; color:var(--ink-soft); margin:6px 0 0;">Al final se añade la firma del AMPA con el logo.</p>
    <div class="de-vista" hidden><p class="section-label" style="margin:12px 0 6px;">Así lo recibirá</p>
      <iframe title="Vista previa del email" sandbox="" style="width:100%; min-height:300px; border:1px solid var(--line); border-radius:12px; background:#fff;"></iframe></div>
    <p class="de-msg" hidden></p>
    <div class="acciones">
      <button type="button" class="btn btn-outline deVista">Vista previa</button>
      <button type="button" class="btn btn-primary deEnviar" disabled title="Mira antes la vista previa">Enviar</button>
      <button type="button" class="linklike deCerrar">Cerrar</button>
    </div>`;
  document.body.appendChild(d);
  const $d = (sel) => d.querySelector(sel);
  $d('#deCuerpo').value = saludo ? `Hola ${saludo},\n\n` : '';
  const msg = (ok, t) => { const m = $d('.de-msg'); m.hidden = false; m.className = 'de-msg ' + (ok ? 'msg-ok' : 'msg-error'); m.textContent = t; };
  const llamar = async (extra) => {
    const asunto = $d('#deAsunto').value.trim(), cuerpo = $d('#deCuerpo').value.trim();
    if (!asunto || !cuerpo) throw new Error('Escribe el asunto y el mensaje.');
    const session = await getSession();
    const resp = await fetch('/.netlify/functions/enviar-email-masivo', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + session.access_token },
      body: JSON.stringify({ asunto, cuerpo, ...destino, ...extra })
    });
    const r = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(r.error || 'No se pudo completar (error ' + resp.status + ').');
    return r;
  };
  ['#deAsunto', '#deCuerpo'].forEach(sel => $d(sel).addEventListener('input', () => { $d('.deEnviar').disabled = true; $d('.de-vista').hidden = true; }));
  $d('.deVista').addEventListener('click', async (e) => {
    e.target.disabled = true; $d('.de-msg').hidden = true;
    try {
      const r = await llamar({ vista: true });
      if (r.para) $d('.dePara').textContent = 'Para: ' + r.para;
      $d('.de-vista iframe').srcdoc = '<!doctype html><meta charset="utf-8"><body style="margin:16px;">' + r.html + '</body>';
      $d('.de-vista').hidden = false; $d('.deEnviar').disabled = false;
    } catch (err) { msg(false, err.message); }
    e.target.disabled = false;
  });
  $d('.deEnviar').addEventListener('click', async (e) => {
    e.target.disabled = true; e.target.textContent = 'Enviando...';
    try {
      const r = await llamar({});
      msg(true, 'Enviado a ' + r.a + '. Queda una copia en Enviados del correo del AMPA.');
      $d('.deVista').disabled = true; $d('#deAsunto').disabled = true; $d('#deCuerpo').disabled = true;
      e.target.textContent = 'Enviado';
    } catch (err) { msg(false, err.message); e.target.disabled = false; e.target.textContent = 'Enviar'; }
  });
  $d('.deCerrar').addEventListener('click', () => d.close());
  d.addEventListener('close', () => d.remove());
  d.showModal();
  $d('#deAsunto').focus();
}
