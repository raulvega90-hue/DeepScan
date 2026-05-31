/* ============================================================
   netlify/functions/scan.js
   Proxy serverless. Claves en process.env, nunca al navegador.
   ------------------------------------------------------------
   FUENTES DE DATOS:
   - Precio en vivo  -> Finnhub  /quote          (FINNHUB_KEY)
   - Velas diarias   -> Twelve Data /time_series (TWELVEDATA_KEY)
     (el /stock/candle de Finnhub pasó a ser de pago → daba 403)

   Endpoints expuestos (vía redirect /api/* en netlify.toml):
     /api/quote?symbol=AAPL
     /api/candles?symbol=AAPL
     /api/market-status
   Cada respuesta exige cookie de sesión válida (función login).
   ============================================================ */

const FH = 'https://finnhub.io/api/v1';
const TD = 'https://api.twelvedata.com';

/* ---- Sesión ---- */
function isAuthed(request) {
  const cookie = request.headers.get('cookie') || '';
  const token  = process.env.SESSION_TOKEN || '';
  if (!token) return false;
  return cookie.split(';').some(c => c.trim() === `rv_session=${token}`);
}

/* ---- Caché en memoria ---- */
const cache = new Map();
function cacheGet(key, ttlMs) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < ttlMs) return hit.v;
  return null;
}
function cacheSet(key, v) { cache.set(key, { v, t: Date.now() }); }

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...extraHeaders }
  });
}

/* ---- Finnhub: precio en vivo ---- */
async function fhQuote(symbol) {
  const key = 'fh:quote:' + symbol;
  const c = cacheGet(key, 3000);
  if (c) return c;
  const qs = new URLSearchParams({ symbol, token: process.env.FINNHUB_KEY });
  const r = await fetch(`${FH}/quote?${qs}`);
  if (r.status === 429) throw { code: 429, msg: 'Límite de Finnhub (60/min). Espera ~1 min.' };
  if (!r.ok) throw { code: 502, msg: 'Finnhub respondió ' + r.status };
  const v = await r.json();
  cacheSet(key, v);
  return v;
}

/* ---- Twelve Data: velas diarias (cacheadas 12h: no cambian intradía) ---- */
async function tdCandles(symbol) {
  const key = 'td:candles:' + symbol;
  const c = cacheGet(key, 12 * 60 * 60 * 1000);
  if (c) return c;

  const qs = new URLSearchParams({
    symbol, interval: '1day', outputsize: '250', apikey: process.env.TWELVEDATA_KEY
  });
  const r = await fetch(`${TD}/time_series?${qs}`);
  if (!r.ok) throw { code: 502, msg: 'Twelve Data respondió ' + r.status };
  const j = await r.json();

  // Twelve Data devuelve {status:"error", code, message} en errores (HTTP 200)
  if (j.status === 'error') {
    if (String(j.code) === '429' || /limit/i.test(j.message || ''))
      throw { code: 429, msg: 'Límite de Twelve Data (8/min). Espera un momento.' };
    throw { code: 502, msg: 'Twelve Data: ' + (j.message || 'error') };
  }
  if (!Array.isArray(j.values)) throw { code: 502, msg: 'Twelve Data: sin datos para ' + symbol };

  // Vienen en orden descendente (reciente primero) → invertir a ascendente,
  // y mapear al formato que espera el frontend (estilo Finnhub candle).
  const rows = [...j.values].reverse();
  const out = {
    s: 'ok',
    c: rows.map(x => parseFloat(x.close)),
    h: rows.map(x => parseFloat(x.high)),
    l: rows.map(x => parseFloat(x.low)),
    o: rows.map(x => parseFloat(x.open)),
    v: rows.map(x => parseFloat(x.volume || 0)),
    t: rows.map(x => Math.floor(new Date(x.datetime).getTime() / 1000))
  };
  cacheSet(key, out);
  return out;
}

export default async (request) => {
  if (!isAuthed(request)) return json({ error: 'No autorizado' }, 401);

  const url    = new URL(request.url);
  const path   = url.pathname.replace(/^\/api\//, '');
  const symbol = (url.searchParams.get('symbol') || '').toUpperCase();

  try {
    if (path === 'quote') {
      if (!symbol) return json({ error: 'symbol requerido' }, 400);
      const q = await fhQuote(symbol);
      return json({ symbol, ...q });
    }

    if (path === 'candles') {
      if (!symbol) return json({ error: 'symbol requerido' }, 400);
      const c = await tdCandles(symbol);
      return json({ symbol, ...c });
    }

    if (path === 'market-status') {
      const key = 'fh:mkt';
      let s = cacheGet(key, 30000);
      if (!s) {
        const qs = new URLSearchParams({ exchange: 'US', token: process.env.FINNHUB_KEY });
        const r = await fetch(`${FH}/stock/market-status?${qs}`);
        if (!r.ok) throw { code: 502, msg: 'Finnhub respondió ' + r.status };
        s = await r.json();
        cacheSet(key, s);
      }
      return json(s);
    }

    return json({ error: 'Ruta desconocida' }, 404);
  } catch (e) {
    return json({ error: e.msg || 'Error interno' }, e.code || 500);
  }
};
