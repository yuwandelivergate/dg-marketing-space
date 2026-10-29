// In-shell window manager: draggable, resizable windows with minimize / maximize / close,
// z-order focus, and <webview> hosting for web apps.
(function () {
  const DG = window.DG;

  const svg = {
    min: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 6.5h7"/></svg>',
    max: '<svg viewBox="0 0 12 12" aria-hidden="true"><rect x="2.5" y="2.5" width="7" height="7" rx="1.2"/></svg>',
    restore: '<svg viewBox="0 0 12 12" aria-hidden="true"><rect x="2" y="4" width="6" height="6" rx="1"/><path d="M4 4V2.8c0-.4.4-.8.8-.8h4.4c.4 0 .8.4.8.8v4.4c0 .4-.4.8-.8.8H8"/></svg>',
    close: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 3l6 6M9 3l-6 6"/></svg>',
    back: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3.5L5.5 8l4.5 4.5"/></svg>',
    fwd: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3.5L10.5 8 6 12.5"/></svg>',
    reload: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M13 8a5 5 0 1 1-1.6-3.7M13 2.5v3h-3"/></svg>',
    home: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 7.5L8 3l5.5 4.5M4 6.5V13h8V6.5"/></svg>'
  };
  DG.svg = svg;

  const WM = {
    windows: new Map(),
    z: 20,
    focusedId: null,
    area: null,
    cascade: 0,
    partition: 'persist:dg-default',
    listeners: new Set()
  };
  DG.WM = WM;

  WM.init = function (area) {
    this.area = area;
    window.addEventListener('resize', () => this.windows.forEach((w) => this.clamp(w)));
  };
  WM.onChange = function (fn) { this.listeners.add(fn); };
  WM.emit = function () { this.listeners.forEach((fn) => fn()); };

  WM.open = function (opts) {
    const existing = this.windows.get(opts.id);
    if (existing) { this.restore(opts.id); return existing; }

    const el = document.createElement('section');
    el.className = 'win opening';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', opts.title);
    el.innerHTML = `
      <header class="win-bar">
        <div class="win-title"><span class="win-icon"></span><span class="win-name"></span></div>
        <div class="win-nav"${opts.url ? '' : ' hidden'}>
          <button data-act="back" title="Back" aria-label="Back">${svg.back}</button>
          <button data-act="fwd" title="Forward" aria-label="Forward">${svg.fwd}</button>
          <button data-act="reload" title="Reload" aria-label="Reload">${svg.reload}</button>
          <button data-act="home" title="Home" aria-label="Home">${svg.home}</button>
          <span class="win-url"></span>
        </div>
        <div class="win-controls">
          <button data-act="min" title="Minimize" aria-label="Minimize">${svg.min}</button>
          <button data-act="max" title="Maximize" aria-label="Maximize">${svg.max}</button>
          <button data-act="close" class="close" title="Close" aria-label="Close">${svg.close}</button>
        </div>
        <div class="win-progress"></div>
      </header>
      <div class="win-body"></div>
      <div class="win-resize" aria-hidden="true"></div>`;

    const w = {
      id: opts.id, title: opts.title, appName: opts.appName || opts.title,
      icon: opts.icon, color: opts.color, el,
      url: opts.url || null, homeUrl: opts.url || null,
      minimized: false, maximized: false, webview: null
    };
    el.querySelector('.win-name').textContent = opts.title;
    el.querySelector('.win-icon').append(DG.iconEl(opts.icon, opts.title, opts.color, 16));

    const body = el.querySelector('.win-body');
    if (opts.url) {
      w.webview = this.createWebview(w, opts.url);
      body.append(w.webview);
    } else if (opts.content) {
      body.classList.add('panel-body');
      body.append(opts.content);
    }

    const A = this.area.getBoundingClientRect();
    const width = Math.min(opts.width || 1100, A.width - 40);
    const height = Math.min(opts.height || 720, A.height - 40);
    const offset = (this.cascade++ % 7) * 28;
    el.style.width = `${width}px`;
    el.style.height = `${height}px`;
    el.style.left = `${Math.max(12, (A.width - width) / 2 - 84 + offset)}px`;
    el.style.top = `${Math.max(12, (A.height - height) / 2 - 56 + offset)}px`;

    this.area.append(el);
    this.windows.set(w.id, w);
    this.bind(w);
    if (opts.maximized) this.setMaximized(w, true);
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.remove('opening')));
    this.focus(w.id, true);
    return w;
  };

  WM.createWebview = function (w, url) {
    const wv = document.createElement('webview');
    wv.setAttribute('partition', this.partition);
    wv.setAttribute('allowpopups', '');
    wv.setAttribute('src', url);
    const urlEl = w.el.querySelector('.win-url');

    const setUrl = (u) => {
      w.url = u;
      try { const x = new URL(u); urlEl.textContent = x.host + (x.pathname === '/' ? '' : x.pathname); } catch { urlEl.textContent = u; }
      if (this.focusedId === w.id) this.reportFocus(w);
    };
    wv.addEventListener('did-start-loading', () => w.el.classList.add('loading'));
    wv.addEventListener('did-stop-loading', () => w.el.classList.remove('loading'));
    wv.addEventListener('did-navigate', (e) => { setUrl(e.url); window.dg.telemetry.visit(e.url); });
    wv.addEventListener('did-navigate-in-page', (e) => {
      if (!e.isMainFrame) return;
      setUrl(e.url);
      window.dg.telemetry.visit(e.url);
    });
    wv.addEventListener('page-title-updated', (e) => { w.el.querySelector('.win-title').title = e.title; });
    wv.addEventListener('page-favicon-updated', (e) => {
      if (e.favicons && e.favicons[0] && DG.onFavicon) DG.onFavicon(w.id, e.favicons[0]);
    });
    wv.addEventListener('did-fail-load', (e) => {
      if (e.isMainFrame && e.errorCode !== -3) DG.toast(`${w.title} couldn't load: ${e.errorDescription || 'network error'}. Check your connection, then press Reload.`, 'error');
    });
    wv.addEventListener('focus', () => this.focus(w.id));
    return wv;
  };

  WM.bind = function (w) {
    const { el } = w;
    const bar = el.querySelector('.win-bar');

    el.addEventListener('pointerdown', () => this.focus(w.id), true);

    bar.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-act]');
      if (!btn) return;
      const act = btn.dataset.act;
      if (act === 'min') return this.minimize(w.id);
      if (act === 'max') return this.toggleMaximize(w.id);
      if (act === 'close') return this.close(w.id);
      const wv = w.webview;
      if (!wv) return;
      if (act === 'back' && wv.canGoBack()) wv.goBack();
      if (act === 'fwd' && wv.canGoForward()) wv.goForward();
      if (act === 'reload') wv.reload();
      if (act === 'home') wv.loadURL(w.homeUrl);
    });

    bar.addEventListener('dblclick', (e) => {
      if (!e.target.closest('button')) this.toggleMaximize(w.id);
    });

    bar.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.target.closest('button') || w.maximized) return;
      gesture(e, bar, el, (dx, dy, s) => {
        el.style.left = `${s.left + dx}px`;
        el.style.top = `${Math.max(0, s.top + dy)}px`;
      }, () => this.clamp(w));
    });

    const grip = el.querySelector('.win-resize');
    grip.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || w.maximized) return;
      e.stopPropagation();
      gesture(e, grip, el, (dx, dy, s) => {
        el.style.width = `${Math.max(420, s.width + dx)}px`;
        el.style.height = `${Math.max(260, s.height + dy)}px`;
      });
    });
  };

  // Pointer-captured drag; webviews ignore the pointer while it runs so they can't steal it.
  function gesture(e, target, el, onMove, onEnd) {
    const s = { x: e.clientX, y: e.clientY, left: el.offsetLeft, top: el.offsetTop, width: el.offsetWidth, height: el.offsetHeight };
    target.setPointerCapture(e.pointerId);
    document.body.classList.add('wm-gesture');
    let frame = 0;
    const move = (ev) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => onMove(ev.clientX - s.x, ev.clientY - s.y, s));
    };
    const end = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', end);
      target.removeEventListener('pointercancel', end);
      document.body.classList.remove('wm-gesture');
      if (onEnd) onEnd();
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', end);
    target.addEventListener('pointercancel', end);
  }

  WM.clamp = function (w) {
    if (w.maximized) return;
    const A = this.area.getBoundingClientRect();
    const el = w.el;
    el.style.left = `${Math.min(Math.max(el.offsetLeft, 120 - el.offsetWidth), A.width - 120)}px`;
    el.style.top = `${Math.min(Math.max(el.offsetTop, 0), A.height - 44)}px`;
  };

  WM.reportFocus = function (w) {
    window.dg.telemetry.focus(w ? { appId: w.id, appName: w.appName, url: w.url } : { appId: 'desktop', appName: 'Desktop' });
  };

  WM.focus = function (id, force) {
    const w = this.windows.get(id);
    if (!w) return;
    if (!force && this.focusedId === id && !w.minimized) return;
    this.focusedId = id;
    w.el.style.zIndex = String(++this.z);
    this.windows.forEach((x) => x.el.classList.toggle('focused', x.id === id));
    this.reportFocus(w);
    this.emit();
  };

  WM.blurAll = function () {
    if (this.focusedId === null) return;
    this.focusedId = null;
    this.windows.forEach((x) => x.el.classList.remove('focused'));
    this.reportFocus(null);
    this.emit();
  };

  WM.focusTopmost = function () {
    const visible = [...this.windows.values()].filter((w) => !w.minimized);
    if (!visible.length) return this.blurAll();
    visible.sort((a, b) => Number(b.el.style.zIndex) - Number(a.el.style.zIndex));
    this.focus(visible[0].id, true);
  };

  WM.minimize = function (id) {
    const w = this.windows.get(id);
    if (!w) return;
    w.minimized = true;
    w.el.classList.add('minimized');
    if (this.focusedId === id) { this.focusedId = null; this.focusTopmost(); } else this.emit();
  };

  WM.restore = function (id) {
    const w = this.windows.get(id);
    if (!w) return;
    if (w.minimized) { w.minimized = false; w.el.classList.remove('minimized'); }
    this.focus(id, true);
  };

  WM.setMaximized = function (w, on) {
    w.maximized = on;
    w.el.classList.toggle('maximized', on);
    const btn = w.el.querySelector('[data-act="max"]');
    btn.innerHTML = on ? svg.restore : svg.max;
    btn.title = on ? 'Restore' : 'Maximize';
    btn.setAttribute('aria-label', btn.title);
  };

  WM.toggleMaximize = function (id) {
    const w = this.windows.get(id);
    if (!w) return;
    this.setMaximized(w, !w.maximized);
    if (!w.maximized) this.clamp(w);
  };

  WM.close = function (id, immediate) {
    const w = this.windows.get(id);
    if (!w) return;
    this.windows.delete(id);
    if (immediate) w.el.remove();
    else { w.el.classList.add('closing'); setTimeout(() => w.el.remove(), 160); }
    if (this.focusedId === id) { this.focusedId = null; this.focusTopmost(); } else this.emit();
  };

  WM.closeAll = function () {
    [...this.windows.keys()].forEach((id) => this.close(id, true));
    this.cascade = 0;
  };
})();
