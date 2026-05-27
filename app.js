(() => {
  'use strict';

  const STORAGE_KEY = 'sonqollay_db_v1';

  // ---------- Datos iniciales (desde respaldo 22-07-2025) ----------
  const seedQuotes = [
    { empresa: 'Arcadis', numero: 'P014_v01', fecha: '2026-03-16', descripcion: 'Celdas flotación División Andina - Codelco', valor: 93230280, contactos: 'juan.sarquis@arcadis.com; ricardo.bravo@arcadis.com', estado: 'Enviada' },
    { empresa: 'Arcadis', numero: 'P015_v01', fecha: '2026-04-10', descripcion: 'Tranque Ovejería Etapa V (Codelco VP)', valor: 461530100, contactos: 'carolina.cofre@arcadis.com', estado: 'Enviada' },
    { empresa: 'Arcadis', numero: 'P016_v01', fecha: '2026-05-08', descripcion: 'Capacitación', valor: 8200000, contactos: '', estado: 'Enviada' },
    { empresa: 'Keypro', numero: 'P002', fecha: '2026-05-05', descripcion: 'Consultoría', valor: null, contactos: '', estado: 'Borrador' },
    { empresa: 'Keypro', numero: 'P003', fecha: '2026-04-06', descripcion: 'Capacitación', valor: null, contactos: '', estado: 'Borrador' },
    { empresa: 'Keypro', numero: 'P004_v02', fecha: '2026-05-19', descripcion: 'Tranque Ovejería Etapa V (Codelco VP)', valor: 444453283, contactos: 'marien.teran@keyproingenieria.com', estado: 'Enviada' },
    { empresa: 'Worley', numero: 'P002_01', fecha: '2026-03-20', descripcion: 'Capacitación', valor: 14000000, contactos: '', estado: 'Enviada' },
    { empresa: 'JRI', numero: 'P005_v02', fecha: '2026-04-10', descripcion: 'PMChS Obras de Acceso Nivel 2', valor: 8800000, contactos: 'dmellado@jri.cl', estado: 'Enviada' },
    { empresa: 'WSP', numero: 'P001_v01', fecha: '2026-05-11', descripcion: 'Ing. Detalle y Terreno TOVE 5', valor: null, contactos: '', estado: 'Borrador' },
    { empresa: 'Salfa', numero: 'P001_v01', fecha: '2026-05-11', descripcion: 'Mina Chuquicamata Subterránea PMCHS', valor: 99000000, contactos: 'mcabezasg@salfamontajes.com; gacastroy@salfamontajes.com', estado: 'Enviada' },
    { empresa: 'Techint', numero: 'P001_v01', fecha: '2026-05-21', descripcion: 'Apoyo propuestas BHP', valor: 8000000, contactos: 'teapju@techint.com; juanlovrics@techint.com', estado: 'Enviada' },
    { empresa: 'R&Q', numero: 'P003_v01', fecha: '2026-05-20', descripcion: 'APOYO PROCESO IMPLEMENTACIÓN NORMA ISO 19650', valor: 19680000, contactos: '', estado: 'Enviada' },
  ];

  function buildClientsFromQuotes(quotes) {
    const byCompany = new Map();
    for (const q of quotes) {
      if (!byCompany.has(q.empresa)) {
        byCompany.set(q.empresa, { empresa: q.empresa, contactos: new Set() });
      }
      if (q.contactos) {
        q.contactos.split(';').map(s => s.trim()).filter(Boolean).forEach(c => byCompany.get(q.empresa).contactos.add(c));
      }
    }
    const out = [];
    for (const c of byCompany.values()) {
      const emails = Array.from(c.contactos);
      out.push({
        id: uid(),
        empresa: c.empresa,
        nombre: '',
        email: emails[0] || '',
        emailExtras: emails.slice(1).join('; '),
        telefono: '',
        cargo: '',
        notas: '',
      });
    }
    return out;
  }

  // ---------- Helpers ----------
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

  function formatCLP(val) {
    if (val === null || val === undefined || val === '' || isNaN(val)) return '—';
    return '$ ' + Number(val).toLocaleString('es-CL');
  }

  function parseValor(str) {
    if (str === null || str === undefined || str === '') return null;
    const n = Number(String(str).replace(/[^\d.-]/g, ''));
    return isNaN(n) ? null : n;
  }

  function formatDate(iso) {
    if (!iso) return '—';
    const [y, m, d] = iso.split('-');
    if (!y) return iso;
    return `${d}-${m}-${y}`;
  }

  function daysUntil(iso) {
    if (!iso) return Infinity;
    const today = new Date(); today.setHours(0,0,0,0);
    const target = new Date(iso); target.setHours(0,0,0,0);
    return Math.round((target - today) / 86400000);
  }

  function showToast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => t.classList.add('hidden'), 2200);
  }

  // ---------- Estado / persistencia ----------
  let db = { quotes: [], clients: [] };

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        db = JSON.parse(raw);
        if (!db.quotes) db.quotes = [];
        if (!db.clients) db.clients = [];
        return;
      }
    } catch (e) { console.warn(e); }
    seed();
  }

  function seed() {
    db.quotes = seedQuotes.map(q => ({ id: uid(), seguimiento: '', notas: '', ...q }));
    db.clients = buildClientsFromQuotes(seedQuotes);
    save();
  }

  function save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
  }

  // ---------- Render ----------
  function renderAll() {
    renderDashboard();
    renderQuotes();
    renderClients();
    renderCompaniesDatalist();
  }

  function renderDashboard() {
    document.getElementById('kpi-quotes').textContent = db.quotes.length;
    document.getElementById('kpi-clients').textContent = db.clients.length;
    const total = db.quotes.reduce((s, q) => s + (Number(q.valor) || 0), 0);
    document.getElementById('kpi-total').textContent = formatCLP(total);

    const followUps = db.quotes
      .filter(q => q.seguimiento)
      .sort((a, b) => a.seguimiento.localeCompare(b.seguimiento))
      .slice(0, 5);

    const fuEl = document.getElementById('follow-ups');
    if (!followUps.length) {
      fuEl.innerHTML = '<div class="empty">Sin seguimientos programados</div>';
    } else {
      fuEl.innerHTML = followUps.map(q => {
        const d = daysUntil(q.seguimiento);
        let label = `${formatDate(q.seguimiento)}`;
        if (d === 0) label += ' · Hoy';
        else if (d > 0) label += ` · en ${d}d`;
        else label += ` · hace ${-d}d`;
        return cardQuoteHtml(q, label);
      }).join('');
      bindQuoteCards(fuEl);
    }

    const recent = [...db.quotes]
      .sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''))
      .slice(0, 5);
    const recEl = document.getElementById('recent-quotes');
    recEl.innerHTML = recent.length
      ? recent.map(q => cardQuoteHtml(q)).join('')
      : '<div class="empty">Aún no hay cotizaciones</div>';
    bindQuoteCards(recEl);
  }

  function cardQuoteHtml(q, extra) {
    const estadoClass = (q.estado || 'Borrador').split(' ')[0];
    return `
      <div class="card" data-quote-id="${q.id}">
        <div class="card-row">
          <div class="card-title">${escapeHtml(q.numero)} · ${escapeHtml(q.empresa)}</div>
          <span class="tag estado-${escapeHtml(estadoClass)}">${escapeHtml(q.estado || 'Borrador')}</span>
        </div>
        <div class="card-sub">${escapeHtml(q.descripcion || '—')}</div>
        <div class="card-row">
          <span class="card-meta">${formatDate(q.fecha)}${extra ? ' · ' + escapeHtml(extra) : ''}</span>
          <span class="card-meta"><strong style="color:var(--text)">${formatCLP(q.valor)}</strong></span>
        </div>
      </div>`;
  }

  function bindQuoteCards(root) {
    root.querySelectorAll('[data-quote-id]').forEach(el => {
      el.addEventListener('click', () => openQuoteDetail(el.dataset.quoteId));
    });
  }

  function renderQuotes() {
    const q = (document.getElementById('search-quotes').value || '').toLowerCase().trim();
    let list = [...db.quotes].sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));
    if (q) {
      list = list.filter(x =>
        (x.empresa||'').toLowerCase().includes(q) ||
        (x.numero||'').toLowerCase().includes(q) ||
        (x.descripcion||'').toLowerCase().includes(q) ||
        (x.contactos||'').toLowerCase().includes(q)
      );
    }
    const el = document.getElementById('quotes-list');
    el.innerHTML = list.length
      ? list.map(x => cardQuoteHtml(x)).join('')
      : '<div class="empty">Sin resultados</div>';
    bindQuoteCards(el);
  }

  function renderClients() {
    const q = (document.getElementById('search-clients').value || '').toLowerCase().trim();
    let list = [...db.clients].sort((a, b) => a.empresa.localeCompare(b.empresa));
    if (q) {
      list = list.filter(x =>
        (x.empresa||'').toLowerCase().includes(q) ||
        (x.nombre||'').toLowerCase().includes(q) ||
        (x.email||'').toLowerCase().includes(q)
      );
    }
    const el = document.getElementById('clients-list');
    if (!list.length) {
      el.innerHTML = '<div class="empty">Sin clientes</div>';
      return;
    }
    el.innerHTML = list.map(c => {
      const count = db.quotes.filter(q => q.empresa === c.empresa).length;
      return `
        <div class="card" data-client-id="${c.id}">
          <div class="card-row">
            <div class="card-title">${escapeHtml(c.empresa)}</div>
            <span class="tag">${count} cot.</span>
          </div>
          <div class="card-sub">${escapeHtml(c.nombre || c.email || '—')}</div>
          ${c.email ? `<div class="card-meta">${escapeHtml(c.email)}</div>` : ''}
        </div>`;
    }).join('');
    el.querySelectorAll('[data-client-id]').forEach(node => {
      node.addEventListener('click', () => openClientForm(node.dataset.clientId));
    });
  }

  function renderCompaniesDatalist() {
    const dl = document.getElementById('companies');
    const names = [...new Set(db.clients.map(c => c.empresa).concat(db.quotes.map(q => q.empresa)))];
    dl.innerHTML = names.sort().map(n => `<option value="${escapeHtml(n)}"></option>`).join('');
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    }[c]));
  }

  // ---------- Navegación ----------
  function showView(name) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById('view-' + name).classList.add('active');
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.view === name));
    window.scrollTo(0, 0);
  }

  document.querySelectorAll('.nav-btn').forEach(b => {
    b.addEventListener('click', () => showView(b.dataset.view));
  });

  // ---------- FAB ----------
  const fab = document.getElementById('fab');
  const sheet = document.getElementById('fabMenu');
  fab.addEventListener('click', () => sheet.classList.remove('hidden'));
  document.getElementById('closeSheet').addEventListener('click', () => sheet.classList.add('hidden'));
  sheet.addEventListener('click', (e) => { if (e.target === sheet) sheet.classList.add('hidden'); });
  sheet.querySelectorAll('[data-new]').forEach(btn => {
    btn.addEventListener('click', () => {
      sheet.classList.add('hidden');
      if (btn.dataset.new === 'quote') openQuoteForm();
      else openClientForm();
    });
  });

  // ---------- Modal Cotización ----------
  const quoteModal = document.getElementById('quoteModal');
  const quoteForm = document.getElementById('quoteForm');
  let editingQuoteId = null;

  function openQuoteForm(id) {
    editingQuoteId = id || null;
    quoteForm.reset();
    document.getElementById('quoteTitle').textContent = id ? 'Editar cotización' : 'Nueva cotización';
    document.getElementById('quoteDelete').hidden = !id;
    if (id) {
      const q = db.quotes.find(x => x.id === id);
      if (q) {
        quoteForm.empresa.value = q.empresa || '';
        quoteForm.numero.value = q.numero || '';
        quoteForm.fecha.value = q.fecha || '';
        quoteForm.descripcion.value = q.descripcion || '';
        quoteForm.valor.value = q.valor != null ? q.valor : '';
        quoteForm.contactos.value = q.contactos || '';
        quoteForm.estado.value = q.estado || 'Borrador';
        quoteForm.seguimiento.value = q.seguimiento || '';
        quoteForm.notas.value = q.notas || '';
      }
    } else {
      quoteForm.fecha.value = new Date().toISOString().slice(0,10);
      quoteForm.estado.value = 'Borrador';
    }
    quoteModal.classList.remove('hidden');
  }

  document.getElementById('quoteClose').addEventListener('click', () => quoteModal.classList.add('hidden'));

  document.getElementById('quoteSave').addEventListener('click', () => {
    const data = {
      empresa: quoteForm.empresa.value.trim(),
      numero: quoteForm.numero.value.trim(),
      fecha: quoteForm.fecha.value,
      descripcion: quoteForm.descripcion.value.trim(),
      valor: parseValor(quoteForm.valor.value),
      contactos: quoteForm.contactos.value.trim(),
      estado: quoteForm.estado.value,
      seguimiento: quoteForm.seguimiento.value,
      notas: quoteForm.notas.value.trim(),
    };
    if (!data.empresa || !data.numero || !data.fecha) {
      showToast('Empresa, N° y fecha son obligatorios');
      return;
    }
    if (editingQuoteId) {
      const i = db.quotes.findIndex(q => q.id === editingQuoteId);
      db.quotes[i] = { ...db.quotes[i], ...data };
    } else {
      db.quotes.push({ id: uid(), ...data });
      ensureClientForCompany(data.empresa, data.contactos);
    }
    save();
    renderAll();
    quoteModal.classList.add('hidden');
    showToast('Cotización guardada');
  });

  document.getElementById('quoteDelete').addEventListener('click', () => {
    if (!editingQuoteId) return;
    if (!confirm('¿Eliminar esta cotización?')) return;
    db.quotes = db.quotes.filter(q => q.id !== editingQuoteId);
    save();
    renderAll();
    quoteModal.classList.add('hidden');
    showToast('Cotización eliminada');
  });

  function ensureClientForCompany(empresa, contactos) {
    if (!empresa) return;
    if (db.clients.some(c => c.empresa.toLowerCase() === empresa.toLowerCase())) return;
    const emails = (contactos || '').split(';').map(s => s.trim()).filter(Boolean);
    db.clients.push({
      id: uid(),
      empresa,
      nombre: '',
      email: emails[0] || '',
      emailExtras: emails.slice(1).join('; '),
      telefono: '',
      cargo: '',
      notas: '',
    });
  }

  // ---------- Detalle Cotización ----------
  const detailModal = document.getElementById('quoteDetail');
  let detailQuoteId = null;

  function openQuoteDetail(id) {
    const q = db.quotes.find(x => x.id === id);
    if (!q) return;
    detailQuoteId = id;
    const emails = (q.contactos || '').split(';').map(s => s.trim()).filter(Boolean);
    const estadoClass = (q.estado || 'Borrador').split(' ')[0];

    document.getElementById('detailBody').innerHTML = `
      <h3>${escapeHtml(q.numero)}</h3>
      <div class="det-company">${escapeHtml(q.empresa)}</div>
      <span class="tag estado-${escapeHtml(estadoClass)}">${escapeHtml(q.estado || 'Borrador')}</span>

      <div class="detail-row"><span class="lbl">Fecha</span><span class="val">${formatDate(q.fecha)}</span></div>
      <div class="detail-row"><span class="lbl">Valor</span><span class="val"><strong>${formatCLP(q.valor)}</strong></span></div>
      <div class="detail-row"><span class="lbl">Descripción</span><span class="val">${escapeHtml(q.descripcion || '—')}</span></div>
      <div class="detail-row"><span class="lbl">Seguimiento</span><span class="val">${q.seguimiento ? formatDate(q.seguimiento) : '—'}</span></div>
      <div class="detail-row"><span class="lbl">Contactos</span><span class="val">${
        emails.length
          ? emails.map(e => `<div><a href="mailto:${escapeHtml(e)}">${escapeHtml(e)}</a></div>`).join('')
          : '—'
      }</span></div>
      ${q.notas ? `<div class="detail-row"><span class="lbl">Notas</span><span class="val">${escapeHtml(q.notas).replace(/\n/g,'<br>')}</span></div>` : ''}

      <div class="detail-actions">
        ${emails.length ? `<a class="btn" href="mailto:${escapeHtml(emails.join(','))}?subject=${encodeURIComponent('Cotización ' + q.numero + ' - ' + q.empresa)}">✉ Enviar correo</a>` : ''}
        <button class="btn btn-outline" id="detailShare">Compartir</button>
      </div>
    `;
    detailModal.classList.remove('hidden');

    const shareBtn = document.getElementById('detailShare');
    if (shareBtn) {
      shareBtn.addEventListener('click', async () => {
        const text = `${q.numero} · ${q.empresa}\n${q.descripcion || ''}\nFecha: ${formatDate(q.fecha)}\nValor: ${formatCLP(q.valor)}\nEstado: ${q.estado || ''}`;
        if (navigator.share) {
          try { await navigator.share({ title: q.numero, text }); } catch {}
        } else {
          try { await navigator.clipboard.writeText(text); showToast('Copiado al portapapeles'); }
          catch { showToast('No se pudo compartir'); }
        }
      });
    }
  }

  document.getElementById('detailClose').addEventListener('click', () => detailModal.classList.add('hidden'));
  document.getElementById('detailEdit').addEventListener('click', () => {
    detailModal.classList.add('hidden');
    openQuoteForm(detailQuoteId);
  });

  // ---------- Modal Cliente ----------
  const clientModal = document.getElementById('clientModal');
  const clientForm = document.getElementById('clientForm');
  let editingClientId = null;

  function openClientForm(id) {
    editingClientId = id || null;
    clientForm.reset();
    document.getElementById('clientTitle').textContent = id ? 'Editar cliente' : 'Nuevo cliente';
    document.getElementById('clientDelete').hidden = !id;
    if (id) {
      const c = db.clients.find(x => x.id === id);
      if (c) {
        clientForm.empresa.value = c.empresa || '';
        clientForm.nombre.value = c.nombre || '';
        clientForm.email.value = c.email || '';
        clientForm.telefono.value = c.telefono || '';
        clientForm.cargo.value = c.cargo || '';
        clientForm.notas.value = c.notas || '';
      }
    }
    clientModal.classList.remove('hidden');
  }

  document.getElementById('clientClose').addEventListener('click', () => clientModal.classList.add('hidden'));

  document.getElementById('clientSave').addEventListener('click', () => {
    const data = {
      empresa: clientForm.empresa.value.trim(),
      nombre: clientForm.nombre.value.trim(),
      email: clientForm.email.value.trim(),
      telefono: clientForm.telefono.value.trim(),
      cargo: clientForm.cargo.value.trim(),
      notas: clientForm.notas.value.trim(),
    };
    if (!data.empresa) { showToast('La empresa es obligatoria'); return; }
    if (editingClientId) {
      const i = db.clients.findIndex(c => c.id === editingClientId);
      db.clients[i] = { ...db.clients[i], ...data };
    } else {
      db.clients.push({ id: uid(), ...data });
    }
    save();
    renderAll();
    clientModal.classList.add('hidden');
    showToast('Cliente guardado');
  });

  document.getElementById('clientDelete').addEventListener('click', () => {
    if (!editingClientId) return;
    if (!confirm('¿Eliminar este cliente?')) return;
    db.clients = db.clients.filter(c => c.id !== editingClientId);
    save();
    renderAll();
    clientModal.classList.add('hidden');
    showToast('Cliente eliminado');
  });

  // ---------- Buscadores ----------
  document.getElementById('search-quotes').addEventListener('input', renderQuotes);
  document.getElementById('search-clients').addEventListener('input', renderClients);

  // ---------- Settings ----------
  document.getElementById('exportBtn').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(db, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sonqollay_backup_${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  document.getElementById('exportCsvBtn').addEventListener('click', () => {
    const headers = ['Empresa','N° Cotización','Fecha','Descripción','Valor','Contacto','Estado','Seguimiento','Notas'];
    const rows = db.quotes.map(q => [q.empresa, q.numero, q.fecha, q.descripcion, q.valor ?? '', q.contactos, q.estado, q.seguimiento ?? '', q.notas ?? '']);
    const csv = [headers, ...rows].map(r =>
      r.map(v => `"${String(v ?? '').replace(/"/g,'""')}"`).join(',')
    ).join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cotizaciones_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  });

  document.getElementById('importFile').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (!data.quotes || !data.clients) throw new Error('Archivo inválido');
        if (!confirm('Reemplazar los datos actuales con el respaldo?')) return;
        db = data;
        save();
        renderAll();
        showToast('Respaldo importado');
      } catch (err) {
        showToast('Error: ' + err.message);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  });

  document.getElementById('resetBtn').addEventListener('click', () => {
    if (!confirm('Esto borrará tus cambios y volverá a los datos iniciales. ¿Continuar?')) return;
    seed();
    renderAll();
    showToast('Datos restablecidos');
  });

  // ---------- Service worker (PWA) ----------
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    });
  }

  // ---------- Inicio ----------
  load();
  renderAll();
})();
