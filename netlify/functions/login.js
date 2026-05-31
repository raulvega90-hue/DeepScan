/* ============================================================
   netlify/functions/login.js
   Valida la contraseña DEL LADO SERVIDOR (no en el navegador).
   La contraseña correcta vive en process.env.APP_PASSWORD y
   nunca se descarga al cliente. Si coincide, emite una cookie
   de sesión HttpOnly que la función scan.js exige.
   ============================================================ */

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...extraHeaders }
  });
}

export default async (request) => {
  if (request.method !== 'POST') return json({ error: 'Método no permitido' }, 405);

  let body = {};
  try { body = await request.json(); } catch { /* cuerpo vacío */ }

  const provided = (body.password || '').trim();
  const expected = process.env.APP_PASSWORD || '';
  const token    = process.env.SESSION_TOKEN || '';

  if (!expected || !token)
    return json({ error: 'Servidor mal configurado (faltan variables de entorno).' }, 500);

  if (provided !== expected)
    return json({ ok: false, error: 'Contraseña incorrecta.' }, 401);

  // Cookie de sesión: HttpOnly (JS no puede leerla), Secure, SameSite, 8h de vida
  const cookie = [
    `rv_session=${token}`,
    'HttpOnly',
    'Secure',
    'Path=/',
    'SameSite=Strict',
    'Max-Age=28800'
  ].join('; ');

  return json({ ok: true }, 200, { 'set-cookie': cookie });
};
