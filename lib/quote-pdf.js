// Generación de PDF profesional de una cotización.
// jsPDF + autoTable se cargan de forma diferida (solo al generar) desde CDN.
import { formatCLP, formatDate, parseValor } from './format.js';

const JSPDF_URL = 'https://cdn.jsdelivr.net/npm/jspdf@2.5.2/+esm';
const AUTOTABLE_URL = 'https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.2/+esm';

let _libs = null;
async function loadLibs() {
  if (_libs) return _libs;
  const [{ jsPDF }, autoMod] = await Promise.all([
    import(JSPDF_URL),
    import(AUTOTABLE_URL),
  ]);
  _libs = { jsPDF, autoTable: autoMod.default || autoMod.autoTable };
  return _libs;
}

async function imgDataUrl(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise((resolve) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = () => resolve(null);
      fr.readAsDataURL(blob);
    });
  } catch { return null; }
}

// Colores de marca
const ORANGE = [249, 115, 22];
const DARK = [31, 41, 55];
const GRAY = [107, 116, 128];
const LIGHT = [243, 244, 246];

// Construye y devuelve { blob, filename } de la cotización.
export async function buildQuotePdf(q, opts = {}) {
  const { jsPDF, autoTable } = await loadLibs();
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = 210, M = 15, CW = W - M * 2;

  // ── Encabezado ──
  const logo = await imgDataUrl(opts.logoUrl || '/icon-512.png');
  if (logo) { try { doc.addImage(logo, 'PNG', M, 14, 20, 20); } catch (_) {} }

  doc.setFont('helvetica', 'bold'); doc.setFontSize(17); doc.setTextColor(...DARK);
  doc.text('Sonqollay', M + 25, 22);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...GRAY);
  doc.text('Consultoría · Academia · AURA', M + 25, 28);

  doc.setFont('helvetica', 'bold'); doc.setFontSize(20); doc.setTextColor(...ORANGE);
  doc.text('COTIZACIÓN', W - M, 21, { align: 'right' });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(...DARK);
  doc.text(`N° ${q.numero || '—'}`, W - M, 28, { align: 'right' });
  doc.setTextColor(...GRAY);
  doc.text(formatDate(q.fecha), W - M, 33, { align: 'right' });

  doc.setDrawColor(...ORANGE); doc.setLineWidth(0.7);
  doc.line(M, 38, W - M, 38);

  // ── Cliente + estado ──
  let y = 48;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(...GRAY);
  doc.text('CLIENTE', M, y);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(...DARK);
  doc.text(q.empresa || '—', M, y + 6);

  // Badge de estado (derecha)
  const estado = q.estado || 'Borrador';
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
  const bw = doc.getTextWidth(estado) + 10;
  doc.setFillColor(...LIGHT);
  doc.roundedRect(W - M - bw, y - 4, bw, 8, 2, 2, 'F');
  doc.setTextColor(...ORANGE);
  doc.text(estado, W - M - bw / 2, y + 1.5, { align: 'center' });

  y += 11;
  if (q.contactos) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...GRAY);
    doc.text(`Contacto: ${q.contactos}`, M, y);
    y += 5;
  }
  if (q.tipoServicio || q.industria) {
    doc.setFontSize(9); doc.setTextColor(...GRAY);
    doc.text([q.tipoServicio, q.industria].filter(Boolean).join('  ·  '), M, y);
    y += 5;
  }

  // ── Descripción ──
  if (q.descripcion) {
    y += 3;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(...GRAY);
    doc.text('DESCRIPCIÓN', M, y); y += 5;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(...DARK);
    const lines = doc.splitTextToSize(q.descripcion, CW);
    doc.text(lines, M, y);
    y += lines.length * 5 + 2;
  }

  // ── Tabla de ítems ──
  const items = Array.isArray(q.items) ? q.items.filter(i => (i.descripcion || '').trim() || i.valorUnit) : [];
  let total = 0;
  if (items.length) {
    const body = items.map(it => {
      const cant = Number(it.cantidad) || 1;
      const unit = parseValor(it.valorUnit) || 0;
      const sub = cant * unit;
      total += sub;
      return [it.descripcion || '—', String(cant), formatCLP(unit), formatCLP(sub)];
    });
    autoTable(doc, {
      startY: y + 2,
      head: [['Detalle', 'Cant.', 'Valor unit.', 'Subtotal']],
      body,
      theme: 'grid',
      headStyles: { fillColor: DARK, textColor: 255, fontStyle: 'bold', fontSize: 9 },
      bodyStyles: { fontSize: 9, textColor: DARK },
      alternateRowStyles: { fillColor: [250, 250, 251] },
      columnStyles: { 0: { cellWidth: 'auto' }, 1: { cellWidth: 18, halign: 'center' }, 2: { cellWidth: 35, halign: 'right' }, 3: { cellWidth: 35, halign: 'right' } },
      margin: { left: M, right: M },
    });
    y = doc.lastAutoTable.finalY + 4;
  } else {
    total = parseValor(q.valor) || 0;
    y += 2;
  }

  // ── Total ──
  const totalStr = formatCLP(total);
  doc.setFillColor(...ORANGE);
  const boxW = 80, boxX = W - M - boxW;
  doc.roundedRect(boxX, y, boxW, 14, 2, 2, 'F');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(255, 255, 255);
  doc.text('TOTAL', boxX + 5, y + 9);
  doc.setFontSize(13);
  doc.text(totalStr, boxX + boxW - 5, y + 9, { align: 'right' });
  y += 18;

  if (opts.ufValue && total) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...GRAY);
    doc.text(`≈ ${(total / opts.ufValue).toLocaleString('es-CL', { maximumFractionDigits: 1 })} UF  (UF ${formatCLP(opts.ufValue)})`, W - M, y, { align: 'right' });
    y += 6;
  }

  // ── Condiciones ──
  y += 4;
  const validez = opts.validezDias || 30;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(...GRAY);
  doc.text('CONDICIONES', M, y); y += 5;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...DARK);
  const cond = [
    `• Cotización válida por ${validez} días desde la fecha de emisión.`,
    '• Valores expresados en pesos chilenos (CLP).' + (opts.ufValue ? ' Conversión UF referencial del día.' : ''),
    '• Precios no incluyen impuestos salvo que se indique lo contrario.',
  ];
  cond.forEach(c => { doc.text(c, M, y); y += 5; });

  // ── Pie de página ──
  const fy = 285;
  doc.setDrawColor(...LIGHT); doc.setLineWidth(0.4);
  doc.line(M, fy - 5, W - M, fy - 5);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...GRAY);
  if (opts.emitter) doc.text(`Emitido por: ${opts.emitter}`, M, fy);
  doc.text('Generado con SonqollayAPP', W - M, fy, { align: 'right' });

  const safeNum = (q.numero || 'cotizacion').replace(/[^a-zA-Z0-9_-]/g, '_');
  const safeEmp = (q.empresa || '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 24);
  const filename = `Cotizacion_${safeNum}${safeEmp ? '_' + safeEmp : ''}.pdf`;
  return { blob: doc.output('blob'), filename };
}
