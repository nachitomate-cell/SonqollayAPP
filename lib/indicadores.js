// Indicadores económicos de Chile (dólar observado y UF) desde mindicador.cl (API gratis, con CORS).
// Cachea en localStorage para no pegarle a la API en cada carga y para tener fallback offline.

const API = 'https://mindicador.cl/api';
const KEY = 'sqy_rates';
const TTL = 3 * 60 * 60 * 1000; // 3 horas

function readCache() {
  try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; }
}

// Devuelve { dolar:Number|null, uf:Number|null, fecha:String|null }.
// force=true ignora la caché. Si la red falla, devuelve lo último conocido.
export async function getRates({ force = false } = {}) {
  const cached = readCache();
  if (!force && cached && (Date.now() - cached.ts) < TTL) return cached.data;
  try {
    const res = await fetch(API, { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const j = await res.json();
    const data = {
      dolar: j?.dolar?.valor ?? null,
      uf: j?.uf?.valor ?? null,
      fecha: j?.dolar?.fecha || j?.fecha || null,
    };
    localStorage.setItem(KEY, JSON.stringify({ ts: Date.now(), data }));
    return data;
  } catch (e) {
    if (cached) return cached.data; // fallback al último valor cacheado
    throw e;
  }
}

// Valor UF más reciente conocido sin pegarle a la red (para conversiones en el form).
export function cachedUf() {
  return readCache()?.data?.uf ?? null;
}
