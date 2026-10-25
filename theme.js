(() => {
  const root = document.documentElement;
  const meta = document.querySelector('meta[name="theme-color"]');
  const apply = t => {
    root.dataset.theme = t;
    if (meta) meta.content = t === 'dark' ? '#111111' : '#ffffff';
  };
  apply(root.dataset.theme === 'dark' ? 'dark' : 'light');
  document.getElementById('theme').addEventListener('click', () => {
    const t = root.dataset.theme === 'dark' ? 'light' : 'dark';
    apply(t);
    try { localStorage.setItem('wardrobe-theme', t); } catch {}
  });
})();
