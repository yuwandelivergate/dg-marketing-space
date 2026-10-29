// Start menu, desktop icons, App Library (installed software) and Settings windows.
(function () {
  const DG = window.DG;
  const h = DG.h;
  const L = (DG.launcher = { pinned: [], installed: null, ready: false });

  L.init = function () {
    if (this.ready) return;
    this.ready = true;
    this.menu = document.getElementById('start-menu');
    this.search = document.getElementById('sm-search');
    this.startBtn = document.getElementById('start-btn');

    this.startBtn.addEventListener('click', (e) => { e.stopPropagation(); this.toggleMenu(); });
    this.search.addEventListener('input', () => this.renderMenu());
    this.search.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { const first = this.menu.querySelector('.sm-tile'); if (first) first.click(); }
    });
    document.getElementById('sm-library').addEventListener('click', () => this.openLibrary());
    document.getElementById('sm-settings').addEventListener('click', () => this.openSettings());
    document.getElementById('sm-signout').addEventListener('click', () => DG.signOut());

    document.addEventListener('pointerdown', (e) => {
      if (!this.menu.hidden && !e.target.closest('#start-menu, #start-btn')) this.toggleMenu(false);
      if (!e.target.closest('#ctx-menu')) DG.hideContextMenu();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { this.toggleMenu(false); DG.hideContextMenu(); }
    });
  };

  L.toggleMenu = function (force) {
    if (!this.menu) return;
    const open = typeof force === 'boolean' ? force : this.menu.hidden;
    this.menu.hidden = !open;
    this.startBtn.classList.toggle('open', open);
    this.startBtn.setAttribute('aria-expanded', String(open));
    if (open) {
      this.search.value = '';
      this.renderMenu();
      setTimeout(() => this.search.focus(), 30);
    }
  };

  L.refreshPinned = async function () {
    this.pinned = (await window.dg.apps.pinned()) || [];
    this.renderAll();
  };

  L.renderAll = function () {
    this.renderDesktop();
    if (this.menu && !this.menu.hidden) this.renderMenu();
  };

  function tile(name, icon, color, run) {
    return h('button', { class: 'sm-tile', type: 'button', onclick: run },
      DG.iconEl(icon, name, color, 36), h('span', { text: name }));
  }

  function lazyIcon(holder, id, name, size) {
    window.dg.apps.icon(id).then((src) => {
      const old = holder.querySelector('.ico');
      if (src && old) old.replaceWith(DG.iconEl(src, name, null, size));
    });
  }

  L.renderMenu = function () {
    const q = this.search.value.trim().toLowerCase();
    const match = (n) => !q || n.toLowerCase().includes(q);
    const web = document.getElementById('sm-web');
    const local = document.getElementById('sm-local');

    web.replaceChildren(...DG.webApps.filter((a) => match(a.name))
      .map((a) => tile(a.name, DG.appIcon(a), a.color, () => DG.openWebApp(a.id))));

    const locals = this.pinned.filter((a) => match(a.name));
    local.replaceChildren(...locals.map((a) => {
      const t = tile(a.name, null, null, () => this.launch(a));
      lazyIcon(t, a.id, a.name, 36);
      return t;
    }));
    if (!locals.length) {
      local.append(h('p', {
        class: 'sm-empty',
        text: q ? 'No desktop apps match your search.' : 'Add programs like CapCut or Adobe apps from Browse installed apps.'
      }));
    }
  };

  L.launch = async function (a) {
    this.toggleMenu(false);
    DG.toast(`Opening ${a.name}…`);
    const r = await window.dg.apps.launch(a.id);
    if (!r.ok) DG.toast(`${a.name} didn't open: ${r.error}`, 'error');
  };

  // ---------- desktop icons ----------
  L.renderDesktop = function () {
    const box = document.getElementById('desktop-icons');
    const items = [
      { id: '__library', name: 'App Library', icon: DG.sysIcons.library, open: () => this.openLibrary(), system: true },
      ...this.pinned.map((a) => ({ id: a.id, name: a.name, open: () => this.launch(a), app: a }))
    ];
    box.replaceChildren(...items.map((it) => {
      const btn = h('button', { class: 'd-icon', type: 'button', title: it.name },
        DG.iconEl(it.icon || null, it.name, null, 48), h('span', { text: it.name }));
      btn.addEventListener('click', () => {
        box.querySelectorAll('.d-icon.sel').forEach((x) => x.classList.remove('sel'));
        btn.classList.add('sel');
      });
      btn.addEventListener('dblclick', it.open);
      btn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); it.open(); } });
      btn.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const items = [{ label: 'Open', run: it.open }];
        if (!it.system) {
          items.push({
            label: 'Remove from desktop',
            run: async () => { this.pinned = await window.dg.apps.unpin(it.id); this.renderAll(); DG.toast(`${it.name} removed from your desktop`); }
          });
        }
        DG.contextMenu(e.clientX, e.clientY, items);
      });
      if (it.app) lazyIcon(btn, it.id, it.name, 48);
      return btn;
    }));
  };

  // ---------- App Library ----------
  L.openLibrary = function () {
    this.toggleMenu(false);
    if (DG.WM.windows.has('library')) return DG.WM.restore('library');

    const search = h('input', { class: 'field-input', type: 'search', placeholder: 'Search installed apps', 'aria-label': 'Search installed apps' });
    const browse = h('button', { class: 'btn ghost', type: 'button', text: 'Add another program…' });
    const rescan = h('button', { class: 'btn ghost', type: 'button', text: 'Rescan' });
    const status = h('p', { class: 'lib-status', text: 'Looking for installed apps…' });
    const list = h('ul', { class: 'lib-list' });
    const root = h('div', { class: 'lib' }, h('div', { class: 'lib-tools' }, search, rescan, browse), status, list);

    DG.WM.open({ id: 'library', title: 'App Library', icon: DG.sysIcons.library, content: root, width: 780, height: 580 });

    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (!en.isIntersecting) return;
        io.unobserve(en.target);
        lazyIcon(en.target, en.target.dataset.id, en.target.dataset.name, 32);
      });
    }, { root: list });

    const row = (a) => {
      const pinBtn = h('button', { class: 'btn', type: 'button' });
      const setPinned = (on) => { pinBtn.textContent = on ? 'On desktop' : 'Add to desktop'; pinBtn.classList.toggle('done', on); };
      setPinned(this.pinned.some((p) => p.id === a.id));
      pinBtn.addEventListener('click', async () => {
        const isPinned = this.pinned.some((p) => p.id === a.id);
        try {
          this.pinned = isPinned ? await window.dg.apps.unpin(a.id) : await window.dg.apps.pin(a.id);
          setPinned(!isPinned);
          this.renderAll();
          DG.toast(isPinned ? `${a.name} removed from your desktop` : `${a.name} added to your desktop`);
        } catch (err) {
          DG.toast(err.message, 'error');
        }
      });
      const li = h('li', { 'data-id': a.id, 'data-name': a.name },
        DG.iconEl(null, a.name, null, 32),
        h('div', { class: 'lib-meta' }, h('strong', { text: a.name }), h('small', { text: a.source })),
        h('button', { class: 'btn ghost', type: 'button', text: 'Open', onclick: () => this.launch(a) }),
        pinBtn);
      io.observe(li);
      return li;
    };

    const render = () => {
      const q = search.value.trim().toLowerCase();
      const apps = (this.installed || []).filter((a) => !q || a.name.toLowerCase().includes(q));
      list.replaceChildren(...apps.slice(0, 300).map(row));
      status.textContent = apps.length
        ? `${apps.length} of ${this.installed.length} installed apps${apps.length > 300 ? ' — showing the first 300, search to narrow down' : ''}`
        : q ? 'No installed apps match your search.' : 'No installed apps found. Use “Add another program…” to pick one.';
    };

    const scan = () => {
      status.textContent = 'Looking for installed apps…';
      window.dg.apps.scan()
        .then((apps) => { this.installed = apps; render(); })
        .catch((err) => { status.textContent = `Couldn't read installed apps: ${err.message}`; });
    };

    search.addEventListener('input', render);
    rescan.addEventListener('click', scan);
    browse.addEventListener('click', async () => {
      const updated = await window.dg.apps.browse();
      if (updated) { this.pinned = updated; this.renderAll(); render(); DG.toast('Program added to your desktop'); }
    });
    if (this.installed) render(); else scan();
  };

  // ---------- Settings ----------
  L.openSettings = function () {
    this.toggleMenu(false);
    if (DG.WM.windows.has('settings')) return DG.WM.restore('settings');

    const walls = h('div', { class: 'wall-grid' });
    Object.entries(DG.WALLPAPERS).forEach(([key, wp]) => {
      const b = h('button', { class: 'wall-opt', type: 'button', 'aria-label': wp.label },
        h('span', { class: 'wall-thumb', style: `background-image:url('${DG.wallpaperUrl(key)}')` }),
        h('span', { text: wp.label }));
      if (DG.state.wallpaper === key) b.classList.add('sel');
      b.addEventListener('click', async () => {
        await DG.applyWallpaper(key, true);
        walls.querySelectorAll('.wall-opt').forEach((x) => x.classList.toggle('sel', x === b));
      });
      walls.append(b);
    });

    const mon = h('dl', { class: 'kv' });
    const about = h('dl', { class: 'kv' });
    const kv = (dl, pairs) => dl.replaceChildren(...pairs.flatMap(([k, v]) => [h('dt', { text: k }), h('dd', { text: v })]));

    const fillMonitoring = (s) => kv(mon, [
      ['Logging', s.monitoring ? 'On' : 'Off'],
      ['Your status', { active: 'Active', idle: 'Idle', locked: 'Locked', off: 'Signed out' }[s.status] || s.status],
      ['Displays connected', String(s.displays)],
      ['Current app', s.currentApp || '—'],
      ['App tracking', s.appTracking === 'system-wide' ? 'All apps' : 'Workspace apps only'],
      ['Click counting', s.clickTracking === 'system-wide' ? 'All apps' : 'Workspace apps only'],
      ['Idle after', `${Math.round(s.idleThresholdSec / 60)} min without input`]
    ]);
    window.dg.telemetry.status().then(fillMonitoring);
    DG.statusListeners.add(fillMonitoring);

    const c = DG.state.config;
    kv(about, [
      ['Signed in as', `${DG.state.user.display_name || DG.state.user.username} (${DG.state.user.username})`],
      ['Server', c.offlineMode ? 'Offline test mode' : c.apiBase],
      ['Version', c.version]
    ]);

    const root = h('div', { class: 'settings' },
      h('section', null, h('h2', { text: 'Wallpaper' }), walls),
      h('section', null, h('h2', { text: 'Activity logging' }), mon,
        h('p', { class: 'hint', text: 'Reports go to your workspace admin every 30 seconds. Keystrokes, screen contents and passwords are never recorded.' })),
      h('section', null, h('h2', { text: 'About' }), about));

    const w = DG.WM.open({ id: 'settings', title: 'Settings', icon: DG.sysIcons.settings, content: root, width: 640, height: 600 });
    const observer = new MutationObserver(() => {
      if (!w.el.isConnected) { DG.statusListeners.delete(fillMonitoring); observer.disconnect(); }
    });
    observer.observe(DG.WM.area, { childList: true });
  };
})();
