// Tour guiado interactivo (sin librerías): resalta elementos, muestra un tooltip y
// va navegando entre vistas (clic en la bottom-nav) paso por paso.
let _i = 0, _steps = [], _block, _spot, _tip, _onKey, _onResize;

function _nav(view) {
  const b = document.querySelector(`.bottom-nav [data-view="${view}"]`);
  if (b) b.click();
}

function _ensure() {
  if (_block) return;
  _block = document.createElement('div'); _block.className = 'tour-block';
  _spot  = document.createElement('div'); _spot.className  = 'tour-spot';
  _tip   = document.createElement('div'); _tip.className   = 'tour-tip';
  document.body.append(_block, _spot, _tip);
}

function _go(i) { _i = i; _render(); }

function _render() {
  const step = _steps[_i];
  if (!step) return endTour();
  if (step.nav) _nav(step.nav);
  setTimeout(() => {
    const target = step.el ? document.querySelector(step.el) : null;
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setTimeout(() => _draw(step, target), 240);
    } else {
      _draw(step, null);
    }
  }, step.nav ? 300 : 50);
}

function _draw(step, target) {
  _ensure();
  _block.style.display = 'block';
  _block.style.background = target ? 'transparent' : 'rgba(5,12,24,.72)';
  if (target) {
    const r = target.getBoundingClientRect(); const p = 6;
    Object.assign(_spot.style, {
      display: 'block', top: (r.top - p) + 'px', left: (r.left - p) + 'px',
      width: (r.width + p * 2) + 'px', height: (r.height + p * 2) + 'px',
    });
  } else {
    _spot.style.display = 'none';
  }
  const n = _steps.length;
  _tip.innerHTML = `
    <div class="tour-tip-title">${step.title || ''}</div>
    <div class="tour-tip-text">${step.text || ''}</div>
    <div class="tour-tip-foot">
      <span class="tour-tip-count">${_i + 1} / ${n}</span>
      <div class="tour-tip-btns">
        <button class="tour-skip">Salir</button>
        ${_i > 0 ? '<button class="tour-prev">Atrás</button>' : ''}
        <button class="tour-next">${_i === n - 1 ? 'Terminar' : 'Siguiente'}</button>
      </div>
    </div>`;
  _tip.style.display = 'block';
  _posTip(target);
  _tip.querySelector('.tour-skip').onclick = endTour;
  _tip.querySelector('.tour-next').onclick = () => _go(_i + 1);
  const pv = _tip.querySelector('.tour-prev');
  if (pv) pv.onclick = () => _go(Math.max(0, _i - 1));
}

function _posTip(target) {
  const tw = _tip.offsetWidth, th = _tip.offsetHeight, vw = innerWidth, vh = innerHeight, m = 12;
  let top, left;
  if (target) {
    const r = target.getBoundingClientRect();
    top = (r.bottom + th + 16 < vh) ? r.bottom + 12 : Math.max(m, r.top - th - 12);
    left = Math.min(Math.max(m, r.left + r.width / 2 - tw / 2), vw - tw - m);
  } else {
    top = vh / 2 - th / 2; left = vw / 2 - tw / 2;
  }
  _tip.style.top = Math.max(m, top) + 'px';
  _tip.style.left = Math.max(m, left) + 'px';
}

export function startAppTour(steps) {
  _steps = steps || []; _i = 0; _ensure();
  _onKey = (e) => {
    if (e.key === 'Escape') endTour();
    else if (e.key === 'ArrowRight') _go(Math.min(_steps.length - 1, _i + 1));
    else if (e.key === 'ArrowLeft') _go(Math.max(0, _i - 1));
  };
  _onResize = () => { const s = _steps[_i]; if (s) _draw(s, s.el ? document.querySelector(s.el) : null); };
  document.addEventListener('keydown', _onKey);
  window.addEventListener('resize', _onResize);
  _render();
}

export function endTour() {
  [_block, _spot, _tip].forEach(e => { if (e) e.style.display = 'none'; });
  document.removeEventListener('keydown', _onKey);
  window.removeEventListener('resize', _onResize);
  try { localStorage.setItem('sqy_tour_done', '1'); } catch (_) {}
}

export function tourSeen() {
  try { return localStorage.getItem('sqy_tour_done') === '1'; } catch (_) { return true; }
}
