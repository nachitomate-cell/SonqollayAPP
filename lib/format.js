// Helpers puros (sin estado de módulo ni DOM) extraídos de app.js.
// Formato de moneda/fechas, utilidades de seguimiento y generación de .ics.

export const formatCLP = (v) =>
  (v == null || v === '' || isNaN(v)) ? '—' : '$ ' + Number(v).toLocaleString('es-CL');

export const formatCLPShort = (v) => {
  if (v == null || v === '' || isNaN(v)) return '—';
  const n = Number(v);
  if (n >= 1_000_000_000) return `$ ${(n / 1_000_000_000).toLocaleString('es-CL', { maximumFractionDigits: 2 })} MM`;
  if (n >= 1_000_000)     return `$ ${(n / 1_000_000).toLocaleString('es-CL', { maximumFractionDigits: 1 })} M`;
  if (n >= 1_000)         return `$ ${(n / 1_000).toLocaleString('es-CL', { maximumFractionDigits: 0 })} K`;
  return formatCLP(n);
};

// Lee un monto escrito en formato chileno: el punto separa miles y la coma los decimales.
// Number() a secas no sirve: "6.292.532" da NaN (el monto se perdía al guardar) y "6.292"
// daría 6,292 pesos en vez de 6292. Acepta además $, espacios y texto suelto ("CLP", "UF").
export const parseValor = (s) => {
  if (s == null || s === '') return null;
  let str = String(s).trim().replace(/[^\d.,-]/g, '');
  const negativo = str.includes('-');
  str = str.replace(/-/g, '');
  if (!str) return null;
  if (str.includes(',')) {
    str = str.replace(/\./g, '').replace(',', '.');   // 1.234,56 → 1234.56
  } else if (/^\d{1,3}(\.\d{3})+$/.test(str)) {
    str = str.replace(/\./g, '');                     // 6.292.532 → 6292532
  }
  const n = Number(str);
  if (isNaN(n)) return null;
  return negativo ? -n : n;
};

// "En revisión" se renombró a "En seguimiento" (agosto 2026). Los documentos guardados antes
// de la migración pueden seguir trayendo el texto antiguo, así que se normaliza al leer.
export const ESTADO_LEGACY = 'En revisión';
export const ESTADO_SEGUIMIENTO = 'En seguimiento';
export const normalizeEstado = (e) => (e === ESTADO_LEGACY ? ESTADO_SEGUIMIENTO : e);

export const formatDate = (iso) => {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return y ? `${d}-${m}-${y}` : iso;
};

export const daysUntil = (iso) => {
  if (!iso) return Infinity;
  const t = new Date(); t.setHours(0, 0, 0, 0);
  // Parsear "YYYY-MM-DD" como fecha LOCAL (no UTC) para evitar el desfase de un día.
  const [y, mo, d] = String(iso).slice(0, 10).split('-').map(Number);
  if (!y || !mo || !d) return Infinity;
  const x = new Date(y, mo - 1, d);
  return Math.round((x - t) / 86400000);
};

export function daysSinceUpdated(q) {
  if (q.updatedAt?.toDate) return Math.round((Date.now() - q.updatedAt.toDate().getTime()) / 86400000);
  if (q.fecha) return Math.round((Date.now() - new Date(q.fecha).getTime()) / 86400000);
  return 0;
}

export function nextVersionNumero(numero) {
  const m = (numero || '').match(/^(.+?)_v(\d+)$/i);
  if (m) return `${m[1]}_v${String(parseInt(m[2]) + 1).padStart(2, '0')}`;
  return `${numero}_v02`;
}

export const escapeHtml = (s) =>
  String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function getSeguimientoStatus(q) {
  if (!q.seguimiento) return null;
  const estado = (q.estado || '').toLowerCase();
  if (estado === 'adjudicada' || estado === 'perdida' || estado === 'backlog') return null;
  const d = daysUntil(q.seguimiento);
  if (d === 0)  return { key: 'red',    label: 'Vence hoy' };
  if (d < 0)    return { key: 'red',    label: d === -1 ? 'Venció ayer' : `Venció hace ${-d}d` };
  if (d <= 3)   return { key: 'yellow', label: `Vence en ${d}d` };
  if (d <= 30)  return { key: 'green',  label: `En ${d}d` };
  return               { key: 'muted',  label: formatDate(q.seguimiento) };
}

export function generateICS(q) {
  if (!q.seguimiento) return null;
  const dateStr = q.seguimiento.replace(/-/g, '');
  const [y, mo, d] = q.seguimiento.split('-').map(Number);
  const end = new Date(y, mo - 1, d + 1);
  const endStr = `${end.getFullYear()}${String(end.getMonth() + 1).padStart(2, '0')}${String(end.getDate()).padStart(2, '0')}`;
  const desc = [
    q.descripcion,
    `Valor: ${formatCLP(q.valor)}`,
    `Estado: ${q.estado || 'Borrador'}`,
    q.contactos ? `Contactos: ${q.contactos}` : null,
  ].filter(Boolean).join('\\n');
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//SonqollayAPP//ES',
    'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'BEGIN:VEVENT',
    `UID:seg-${q.id}-${q.seguimiento}@sonqollayapp`,
    `DTSTART;VALUE=DATE:${dateStr}`, `DTEND;VALUE=DATE:${endStr}`,
    `SUMMARY:Seguimiento: ${q.numero} · ${q.empresa}`,
    `DESCRIPTION:${desc}`,
    'STATUS:CONFIRMED', 'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n');
}

export function fmtDuration(sec) {
  if (!sec || sec < 60) return '< 1m';
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m`;
}

export function timeAgo(date) {
  const s = Math.round((Date.now() - date.getTime()) / 1000);
  if (s < 60)  return 'hace un momento';
  const m = Math.round(s / 60);
  if (m < 60)  return `hace ${m}m`;
  const h = Math.round(m / 60);
  if (h < 24)  return `hace ${h}h`;
  const d = Math.round(h / 24);
  if (d < 30)  return `hace ${d}d`;
  return date.toLocaleDateString('es-CL', { day: 'numeric', month: 'short' });
}
