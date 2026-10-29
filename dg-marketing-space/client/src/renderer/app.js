// Shell bootstrap: loading → sign in → desktop. Taskbar, clock, status chips, toasts.
(function () {
  const DG = window.DG;
  const dg = window.dg;
  const WM = DG.WM;
  const $ = (s) => document.querySelector(s);
  const delay = (ms) => new Promise((r) => setTimeout(r, ms));

  const state = (DG.state = { config: null, user: null, wallpaper: 'dgsig' });
  DG.statusListeners = new Set();

  DG.WALLPAPERS = {
    dgsig: { file: 'w_dgsig.webp', label: 'Signature', light: false },
    dgleft: { file: 'w_dgleft.webp', label: 'Beam left', light: false },
    dgwhite: { file: 'w_dgwhite.webp', label: 'Daylight', light: true }
  };
  DG.wallpaperUrl = (key) => `../../assets/wallpapers/${(DG.WALLPAPERS[key] || DG.WALLPAPERS.dgsig).file}`;

  // ---------- generic UI ----------
  DG.toast = function (message, kind = 'info') {
    const box = $('#toasts');
    const t = DG.h('div', { class: `toast ${kind}`, role: kind === 'error' ? 'alert' : 'status', text: message });
    box.append(t);
    while (box.children.length > 3) box.firstChild.remove();
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 250); }, kind === 'error' ? 6500 : 3200);
  };

  DG.contextMenu = function (x, y, items) {
    const menu = $('#ctx-menu');
    menu.replaceChildren(...items.map((it) => DG.h('button', {
      type: 'button', role: 'menuitem', text: it.label,
      onclick: () => { DG.hideContextMenu(); it.run(); }
    })));
    menu.hidden = false;
    const r = menu.getBoundingClientRect();
    menu.style.left = `${Math.min(x, innerWidth - r.width - 8)}px`;
    menu.style.top = `${Math.min(y, innerHeight - r.height - 8)}px`;
    menu.querySelector('button')?.focus();
  };
  DG.hideContextMenu = () => { $('#ctx-menu').hidden = true; };

  function showScreen(name) {
    document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === `screen-${name}`));
    $('#chrome').hidden = name === 'desktop';
  }

  // ---------- frameless window controls ----------
  function bindShellControls() {
    document.querySelectorAll('[data-shell]').forEach((btn) => {
      const act = btn.dataset.shell;
      btn.innerHTML = DG.svg[act === 'max' ? 'max' : act];
      btn.addEventListener('click', () => {
        if (act === 'min') dg.window.minimize();
        if (act === 'max') dg.window.toggleMaximize();
        if (act === 'close') dg.window.close();
      });
    });
    dg.window.onState((s) => {
      document.querySelectorAll('[data-shell="max"]').forEach((b) => {
        b.innerHTML = s === 'maximized' ? DG.svg.restore : DG.svg.max;
        b.title = s === 'maximized' ? 'Restore' : 'Maximize';
      });
    });
  }

  // ---------- favicons ----------
  async function loadFavicons() {
    DG.faviconCache = (await dg.settings.get('favicons')) || {};
  }
  DG.onFavicon = function (id, url) {
    if (id === 'dms' || !DG.webApps.some((a) => a.id === id) || !/^https:\/\//.test(url)) return;
    if (DG.faviconCache[id] === url) return;
    DG.faviconCache[id] = url;
    dg.settings.set('favicons', DG.faviconCache);
    renderTaskbar();
  };

  // ---------- wallpaper ----------
  DG.applyWallpaper = async function (key, save) {
    if (!DG.WALLPAPERS[key]) key = 'dgsig';
    state.wallpaper = key;
    $('#wallpaper').style.backgroundImage = `url('${DG.wallpaperUrl(key)}')`;
    $('#screen-desktop').classList.toggle('light-wall', DG.WALLPAPERS[key].light);
    if (save) await dg.settings.set('wallpaper', key);
  };

  // ---------- apps ----------
  DG.openWebApp = function (id) {
    const a = DG.webApps.find((x) => x.id === id);
    if (!a) return;
    DG.launcher.toggleMenu(false);
    WM.open({ id: a.id, title: a.name, url: a.url, icon: DG.appIcon(a), color: a.color, maximized: a.id === 'dms', width: 1180, height: 760 });
  };

  DG.openUrl = function (url) {
    let host;
    try { host = new URL(url).hostname.replace(/^www\./, ''); } catch { return; }
    WM.open({ id: `web-${Date.now()}`, title: host, url, icon: DG.favicon(host) || DG.sysIcons.web, width: 1100, height: 720 });
  };

  // ---------- taskbar ----------
  function taskButton(id, name, icon, color, openFn) {
    const w = WM.windows.get(id);
    const b = DG.h('button', { class: 'task', type: 'button', title: name, 'aria-label': name },
      DG.iconEl(icon, name, color, 26));
    if (w) b.classList.add('running');
    if (w && WM.focusedId === id && !w.minimized) b.classList.add('active');
    b.addEventListener('click', () => {
      const cur = WM.windows.get(id);
      if (!cur) return openFn && openFn();
      if (cur.minimized) WM.restore(id);
      else if (WM.focusedId === id) WM.minimize(id);
      else WM.focus(id, true);
    });
    return b;
  }

  function renderTaskbar() {
    const box = $('#task-apps');
    const builtIn = new Set(DG.webApps.map((a) => a.id));
    const items = DG.webApps.map((a) => taskButton(a.id, a.name, DG.appIcon(a), a.color, () => DG.openWebApp(a.id)));
    const extras = [...WM.windows.values()].filter((w) => !builtIn.has(w.id));
    if (extras.length) {
      items.push(DG.h('div', { class: 'task-divider' }));
      extras.forEach((w) => items.push(taskButton(w.id, w.title, w.icon, w.color)));
    }
    box.replaceChildren(...items);
    const focused = WM.focusedId && WM.windows.get(WM.focusedId);
    $('#tb-active').textContent = focused ? focused.title : 'Desktop';
  }

  // ---------- status chips & clock ----------
  function renderStatus(s) {
    if (!s) return;
    const chip = $('#chip-monitor');
    chip.dataset.status = s.monitoring ? s.status : 'off';
    chip.querySelector('span').textContent = !s.monitoring ? 'Logging off'
      : ({ active: 'Active', idle: 'Idle', locked: 'Locked' }[s.status] || 'Active');
    chip.title = s.monitoring ? 'Activity logging is on' : 'Activity logging is off';
    const displays = $('#chip-displays');
    displays.querySelector('span').textContent = s.displays;
    displays.title = s.displays > 1
      ? `${s.displays} displays connected${s.currentDisplay ? ` — working on ${s.currentDisplay}` : ''}`
      : '1 display connected';
    DG.statusListeners.forEach((fn) => fn(s));
  }

  function startClock() {
    const fmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    const tick = () => { $('#tb-clock').textContent = fmt.format(new Date()); };
    tick();
    setInterval(tick, 15_000);
  }

  // ---------- sign in / out ----------
  function showLogin(message) {
    showScreen('login');
    const err = $('#login-error');
    err.hidden = !message;
    err.textContent = message || '';
    $('#login-pass').value = '';
    setTimeout(() => ($('#login-user').value ? $('#login-pass') : $('#login-user')).focus(), 60);
  }

  function bindLogin() {
    const form = $('#login-form');
    const toggle = $('#pw-toggle');
    toggle.addEventListener('click', () => {
      const pass = $('#login-pass');
      const show = pass.type === 'password';
      pass.type = show ? 'text' : 'password';
      toggle.textContent = show ? 'Hide' : 'Show';
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = $('#login-submit');
      const err = $('#login-error');
      const user = $('#login-user').value.trim();
      const pass = $('#login-pass').value;
      if (!user || !pass) { err.textContent = 'Enter your username and password.'; err.hidden = false; return; }
      btn.disabled = true;
      btn.textContent = 'Signing in…';
      err.hidden = true;
      const r = await dg.auth.login(user, pass);
      btn.disabled = false;
      btn.textContent = 'Sign in';
      if (!r.ok) { err.textContent = r.error; err.hidden = false; $('#login-pass').select(); return; }
      showScreen('loading');
      $('#loading-msg').textContent = 'Opening your workspace…';
      await delay(600);
      enterDesktop(r.user);
    });
  }

  DG.signOut = async function (message) {
    DG.launcher.toggleMenu(false);
    WM.closeAll();
    await dg.auth.logout();
    state.user = null;
    showLogin(message);
  };

  // ---------- desktop ----------
  let desktopBound = false;
  function bindDesktopOnce() {
    if (desktopBound) return;
    desktopBound = true;
    WM.init($('#windows'));
    WM.onChange(renderTaskbar);
    DG.launcher.init();
    startClock();
    dg.telemetry.onStatus(renderStatus);
    dg.auth.onExpired(() => DG.signOut('Your session has expired. Sign in again to continue.'));
    dg.onOpenUrl((url) => DG.openUrl(url));
    $('#desktop-area').addEventListener('pointerdown', (e) => {
      if (e.target.closest('.win, .d-icon')) return;
      document.querySelectorAll('.d-icon.sel').forEach((x) => x.classList.remove('sel'));
      WM.blurAll();
    });
  }

  async function enterDesktop(user) {
    state.user = user;
    WM.partition = `persist:dg-${String(user.username).replace(/[^a-z0-9._-]/gi, '')}`;
    bindDesktopOnce();

    const name = user.display_name || user.username;
    $('#chip-user').textContent = name;
    $('#sm-user').textContent = name;
    $('#sm-role').textContent = user.role === 'admin' ? 'Administrator' : 'Team member';

    await DG.applyWallpaper((await dg.settings.get('wallpaper')) || 'dgsig');
    await DG.launcher.refreshPinned();
    renderStatus(await dg.telemetry.status());
    showScreen('desktop');
    renderTaskbar();
    requestAnimationFrame(() => DG.openWebApp('dms'));
  }

  // ---------- boot ----------
  async function boot() {
    bindShellControls();
    bindLogin();
    state.config = await dg.config();
    DG.webApps.find((a) => a.id === 'dms').url = state.config.defaultAppUrl;
    $('#offline-badge').hidden = !state.config.offlineMode;
    document.body.dataset.platform = state.config.platform;
    await loadFavicons();

    const [restored] = await Promise.all([dg.auth.restore().catch(() => null), delay(1300)]);
    if (restored) enterDesktop(restored.user);
    else showLogin();
  }

  boot();
})();
