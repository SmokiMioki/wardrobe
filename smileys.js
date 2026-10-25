/* Анимированные смайлы (Lottie / Telegram .tgs): в тексте пишутся как :dash:, :music: и так далее.
   Файл смайла лежит в smileys/<имя>.json, список имён задаётся в config.js (smileys).
   Библиотека lottie-web грузится только тогда, когда на странице появился хоть один смайл. */
(() => {
  const BASE = 'smileys/';
  const LIB = 'vendor/lottie_light.min.js?v=1';
  const names = () => ((window.WARDROBE && window.WARDROBE.smileys) || []).filter(n => /^[a-z0-9_]+$/.test(n));
  const calm = matchMedia('(prefers-reduced-motion: reduce)');

  /* уже экранированный текст → тот же текст, где :имя: заменено на заглушку смайла */
  const html = s => {
    const list = names();
    if (!list.length) return s;
    return String(s).replace(/:([a-z0-9_]+):/g, (m, n) => list.includes(n)
      ? `<i class="sm" data-sm="${n}" role="img" aria-label="${n}" title=":${n}:"></i>` : m);
  };

  let libP = null;
  const lib = () => libP || (libP = new Promise((ok, no) => {
    if (window.lottie) return ok(window.lottie);
    const s = document.createElement('script');
    s.src = LIB; s.onload = () => ok(window.lottie); s.onerror = () => { libP = null; no(new Error('lottie')); };
    document.head.appendChild(s);
  }));
  const files = {};
  const file = n => files[n] || (files[n] = fetch(BASE + n + '.json').then(r => { if (!r.ok) throw new Error(n); return r.text(); })
    .catch(e => { delete files[n]; throw e; }));

  async function start(el) {
    if (el._sm) return;
    el._sm = 'loading';
    try {
      const [lt, txt] = await Promise.all([lib(), file(el.dataset.sm)]);
      if (!el.isConnected) { el._sm = null; return; }
      el._sm = lt.loadAnimation({ container: el, renderer: 'svg', loop: true, autoplay: false, animationData: JSON.parse(txt) });
      if (calm.matches) el._sm.goToAndStop(0, true);
      else if (el._vis !== false) el._sm.play();
    } catch { el._sm = null; el.classList.add('sm-x'); el.textContent = ':' + el.dataset.sm + ':'; }
  }
  /* крутим только то, что сейчас на экране */
  const seen = (el, on) => {
    el._vis = on;
    if (on) { if (!el._sm) start(el); else if (el._sm !== 'loading' && !calm.matches) el._sm.play(); }
    else if (el._sm && el._sm !== 'loading') el._sm.pause();
  };
  const io = 'IntersectionObserver' in window ? new IntersectionObserver(es => es.forEach(e => seen(e.target, e.isIntersecting)), { rootMargin: '60px' }) : null;

  const mount = root => (root || document).querySelectorAll('.sm:not([data-on])').forEach(el => {
    el.dataset.on = '1';
    if (io) io.observe(el); else seen(el, true);
  });
  /* перед перерисовкой списка: остановить и убрать анимации, чтобы они не копились в памяти */
  const clear = root => (root || document).querySelectorAll('.sm').forEach(el => {
    if (io) io.unobserve(el);
    if (el._sm && el._sm !== 'loading') { try { el._sm.destroy(); } catch {} }
    el._sm = null;
  });

  window.Smileys = { html, mount, clear, names };
})();
