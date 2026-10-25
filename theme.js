(() => {
  const root = document.documentElement;
  const meta = document.querySelector('meta[name="theme-color"]');
  const BAR = { pinterest: { light: '#ffffff', dark: '#111111' }, youtube: { light: '#ffffff', dark: '#0f0f0f' } };
  const sync = () => {
    if (meta) meta.content = (BAR[root.dataset.style] || BAR.pinterest)[root.dataset.theme === 'dark' ? 'dark' : 'light'];
  };

  /* ---------- светлая / тёмная ---------- */
  const applyTheme = t => { root.dataset.theme = t; sync(); };
  applyTheme(root.dataset.theme === 'dark' ? 'dark' : 'light');
  document.getElementById('theme').addEventListener('click', () => {
    const t = root.dataset.theme === 'dark' ? 'light' : 'dark';
    applyTheme(t);
    try { localStorage.setItem('wardrobe-theme', t); } catch {}
  });

  /* ---------- стиль сайта: Pinterest / YouTube ---------- */
  const btn = document.getElementById('style');
  const menu = document.getElementById('style-menu');
  const applyStyle = s => {
    root.dataset.style = s === 'youtube' ? 'youtube' : 'pinterest';
    sync();
    if (menu) menu.querySelectorAll('[data-pick]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.pick === root.dataset.style)));
  };
  applyStyle(root.dataset.style);

  if (btn && menu) {
    const close = (back) => {
      menu.hidden = true; btn.setAttribute('aria-expanded', 'false');
      if (back) btn.focus();
    };
    btn.addEventListener('click', () => {
      const open = menu.hidden;
      menu.hidden = !open; btn.setAttribute('aria-expanded', String(open));
      if (open) (menu.querySelector('[aria-checked="true"]') || menu.querySelector('[data-pick]')).focus();
    });
    menu.addEventListener('click', e => {
      const b = e.target.closest('[data-pick]'); if (!b) return;
      applyStyle(b.dataset.pick);
      try { localStorage.setItem('wardrobe-style', root.dataset.style); } catch {}
      window.dispatchEvent(new Event('wardrobe-style'));
      close(true);
    });
    document.addEventListener('click', e => { if (!menu.hidden && !e.target.closest('.stylewrap')) close(false); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !menu.hidden) close(true); });
  }
})();
