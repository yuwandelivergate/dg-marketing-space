// App registry + small shared UI helpers.
(function () {
  const DG = (window.DG = window.DG || {});
  const svgUri = (s) => 'data:image/svg+xml,' + encodeURIComponent(s);

  DG.LOGO = '../../assets/logo.png';
  DG.favicon = (domain) => `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`;

  // Built-in integrations shown on the taskbar. The DG dashboard URL comes from config.
  DG.webApps = [
    { id: 'dms', name: 'DG Dashboard', url: null, icon: DG.LOGO, color: '#0a5be0' },
    { id: 'gmail', name: 'Gmail', url: 'https://mail.google.com/mail/u/0/', icon: DG.favicon('mail.google.com'), color: '#c5221f' },
    { id: 'drive', name: 'Google Drive', url: 'https://drive.google.com/drive/my-drive', icon: DG.favicon('drive.google.com'), color: '#1e8e3e' },
    { id: 'sheets', name: 'Google Sheets', url: 'https://docs.google.com/spreadsheets/u/0/', icon: DG.favicon('sheets.google.com'), color: '#188038' },
    { id: 'discord', name: 'Discord', url: 'https://discord.com/app', icon: DG.favicon('discord.com'), color: '#5865f2' }
  ];

  DG.sysIcons = {
    library: svgUri('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><rect width="48" height="48" rx="12" fill="#0a5be0"/><g fill="#dcefff"><rect x="11" y="11" width="11" height="11" rx="3"/><rect x="26" y="11" width="11" height="11" rx="3"/><rect x="11" y="26" width="11" height="11" rx="3"/></g><path d="M31.5 26v11M26 31.5h11" stroke="#4fc3fa" stroke-width="3" stroke-linecap="round"/></svg>'),
    settings: svgUri('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><rect width="48" height="48" rx="12" fill="#08205c"/><circle cx="24" cy="24" r="6" fill="none" stroke="#4fc3fa" stroke-width="3"/><path d="M24 10v5M24 33v5M10 24h5M33 24h5M14.1 14.1l3.5 3.5M30.4 30.4l3.5 3.5M14.1 33.9l3.5-3.5M30.4 17.6l3.5-3.5" stroke="#dcefff" stroke-width="3" stroke-linecap="round"/></svg>'),
    web: svgUri('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><rect width="48" height="48" rx="12" fill="#0340b8"/><circle cx="24" cy="24" r="12" fill="none" stroke="#dcefff" stroke-width="2.5"/><path d="M12 24h24M24 12c4 4 4 20 0 24M24 12c-4 4-4 20 0 24" fill="none" stroke="#dcefff" stroke-width="2.5"/></svg>')
  };

  // Favicons reported by the pages themselves are cached and preferred over the defaults.
  DG.faviconCache = {};
  DG.appIcon = (a) => (a.id === 'dms' ? DG.LOGO : DG.faviconCache[a.id] || a.icon);

  // Icon element with a lettered tile fallback when an image is missing or fails to load.
  DG.iconEl = function (src, name, color, size) {
    const wrap = document.createElement('span');
    wrap.className = 'ico';
    wrap.style.setProperty('--s', `${size || 24}px`);
    const tile = () => {
      wrap.replaceChildren();
      wrap.classList.add('ico-tile');
      wrap.textContent = String(name || '?').trim().charAt(0).toUpperCase();
      wrap.style.background = color || 'var(--brand-600)';
    };
    if (!src) { tile(); return wrap; }
    const img = new Image();
    img.alt = '';
    img.decoding = 'async';
    img.draggable = false;
    img.addEventListener('error', tile, { once: true });
    img.src = src;
    wrap.append(img);
    return wrap;
  };

  DG.h = function (tag, attrs, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (v !== false && v != null) el.setAttribute(k, v === true ? '' : v);
    }
    children.flat().forEach((c) => c != null && el.append(c));
    return el;
  };
})();
