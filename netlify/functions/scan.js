/* ============================================================
   netlify/functions/scan.js
   Proxy serverless a Finnhub. La clave vive en process.env,
   NUNCA se descarga al navegador.
   ------------------------------------------------------------
   Endpoints (vía /api/... gracias al redirect en netlify.toml):
     /api/quote?symbol=AAPL
     /api/candles?symbol=AAPL
     /api/market-status
   Cada respuesta exige una cookie de sesión válida (puesta por
   la función login). Sin sesión → 401.
   ============================================================ */

const FH = 'https://finnhub.io/api/v1';

/* ---- Verificación de sesión ---- */
function isAuthed(request) {
  const cookie = request.headers.get('cookie') || '';
  const token  = process.env.SESSION_TOKEN || '';
  if (!token) return false;
  return cookie.split(';').some(c => c.trim() === `rv_session=${token}`);
}

/* ---- Caché en memoria (vive mientras la función esté "caliente") ---- */
const cache = new Map();
async function finnhub(endpoint, params, ttlMs) {
  const key = endpoint + '?' + new URLSearchParams(params).toString();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < ttlMs) return hit.v;

  const qs  = new URLSearchParams({ ...params, token: process.env.FINNHUB_KEY }).toString();
  const res = await fetch(`${FH}/${endpoint}?${qs}`);
  if (res.status === 429) throw { code: 429, msg: 'Límite de Finnhub (60/min). Espera ~1 min.' };
  if (!res.ok)            throw { code: 502, msg: 'Finnhub respondió ' + res.status };
  const v = await res.json();
  cache.set(key, { v, t: Date.now() });
  return v;
}

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...extraHeaders }
  });
}

export default async (request) => {
  // Bloqueo por sesión
  if (!isAuthed(request)) return json({ error: 'No autorizado' }, 401);

  const url    = new URL(request.url);
  const path   = url.pathname.replace(/^\/api\//, '');   // quote | candles | market-status
  const symbol = (url.searchParams.get('symbol') || '').toUpperCase();

  try {
    if (path === 'quote') {
      if (!symbol) return json({ error: 'symbol requerido' }, 400);
      const q = await finnhub('quote', { symbol }, 3000);
      return json({ symbol, ...q });
    }

    if (path === 'candles') {
      if (!symbol) return json({ error: 'symbol requerido' }, 400);
      const to = Math.floor(Date.now() / 1000);
      const from = to - 120 * 24 * 60 * 60;
      const c = await finnhub('stock/candle', { symbol, resolution: 'D', from, to }, 60000);
      return json({ symbol, ...c });
    }

    if (path === 'market-status') {
      const s = await finnhub('stock/market-status', { exchange: 'US' }, 30000);
      return json(s);
    }

    return json({ error: 'Ruta desconocida' }, 404);
  } catch (e) {
    return json({ error: e.msg || 'Error interno' }, e.code || 500);
  }
};
