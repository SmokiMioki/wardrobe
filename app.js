(() => {
  const C = window.WARDROBE;
  const $ = (s, r = document) => r.querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const MULTI = 'linear-gradient(90deg,#e8a0b4,#e6c84a,#8ec3e6,#7b5ea7)';

  let data = [];
  let view = [];           // то, что сейчас показано в сетке (после фильтров и сортировки)
  let intro = true;        // лента цветов «проявляется» только при первом показе
  const state = { q: '', cat: '', color: '', season: '', sort: 'new' };

  const grid = $('#grid'), empty = $('#empty'), modal = $('#modal'), body = $('#modal-body');
  const bar = $('#bar'), tabs = $('#tabs'), seasonsEl = $('#seasons'), resetBtn = $('#reset'), sortSel = $('#sort');

  /* ---------- цвета ---------- */
  const hexOf = n => C.colors[n];
  const paint = n => hexOf(n) === 'multi' ? MULTI : (hexOf(n) || '#999');
  const isLight = n => {
    const h = hexOf(n);
    if (!h || h === 'multi') return true;
    const [r, g, b] = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
    return r * .299 + g * .587 + b * .114 > 150;
  };
  const dots = list => (list || []).map(n => `<i class="dot" style="background:${paint(n)}" title="${esc(n)}"></i>`).join('');

  /* ---------- мелочи ---------- */
  const plural = n => {
    const a = n % 10, b = n % 100;
    if (a === 1 && b !== 11) return 'вещь';
    if (a >= 2 && a <= 4 && (b < 12 || b > 14)) return 'вещи';
    return 'вещей';
  };
  const seasonText = s => !s || !s.length ? '' : s.length >= C.seasons.length ? 'Всесезон' : s.join(', ');
  const dateText = iso => { try { return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }); } catch { return ''; } };

  function prep(e) {
    e.colors = e.colors || []; e.seasons = e.seasons || []; e.tags = e.tags || []; e.images = e.images || [];
    e._hay = [e.name, e.cat, e.note, ...e.colors, ...e.seasons, ...e.tags].join(' ').toLowerCase();
  }

  /* ---------- фильтрация ---------- */
  function ok(e, skip) {
    if (skip !== 'cat' && state.cat && e.cat !== state.cat) return false;
    if (skip !== 'color' && state.color && !e.colors.includes(state.color)) return false;
    if (state.season && !e.seasons.includes(state.season)) return false;
    const q = state.q.trim().toLowerCase();
    return !q || e._hay.includes(q);
  }
  const cmp = {
    new: (a, b) => (b.added || '').localeCompare(a.added || ''),
    old: (a, b) => (a.added || '9').localeCompare(b.added || '9'),
    name: (a, b) => a.name.localeCompare(b.name, 'ru')
  };

  /* ---------- цветовая лента ---------- */
  function renderSpectrum() {
    const cnt = {};
    data.forEach(e => { if (ok(e, 'color')) e.colors.forEach(c => { cnt[c] = (cnt[c] || 0) + 1; }); });
    const names = Object.keys(C.colors).filter(n => cnt[n] || n === state.color);
    const total = names.reduce((s, n) => s + (cnt[n] || 0), 0);
    $('#spectrum').hidden = !names.length;
    bar.className = 'bar' + (state.color ? ' has-sel' : '') + (intro && names.length ? ' reveal' : '');
    bar.innerHTML = names.map(n => {
      const k = cnt[n] || 0, share = total ? k / total : 0;
      return `<button class="seg${state.color === n ? ' on' : ''}${share >= .09 ? ' wide' : ''}${isLight(n) ? ' lt' : ''}" type="button" data-c="${esc(n)}" style="--n:${k || .2};background:${paint(n)}" title="${esc(n)}: ${k}" aria-pressed="${state.color === n}"><span class="l"><b>${esc(n)}</b>${k}</span></button>`;
    }).join('');
    if (names.length) intro = false;
    $('#spec-note').textContent = state.color ? `Цвет: ${state.color.toLowerCase()}. Нажми на полосу ещё раз, чтобы снять.` : '';
  }

  /* ---------- вкладки категорий и сезоны ---------- */
  function renderTabs() {
    const tot = {};
    data.forEach(e => { if (ok(e, 'cat')) tot[e.cat] = (tot[e.cat] || 0) + 1; });
    const sum = Object.values(tot).reduce((a, b) => a + b, 0);
    const cats = [...new Set([...C.cats, ...data.map(e => e.cat)])].filter(c => c && (tot[c] || c === state.cat));
    tabs.innerHTML = [['', 'Все', sum], ...cats.map(c => [c, c, tot[c] || 0])].map(([k, l, n]) =>
      `<button class="tab${state.cat === k ? ' on' : ''}" type="button" data-k="${esc(k)}" aria-pressed="${state.cat === k}">${esc(l)}<span class="n">${n}</span></button>`
    ).join('');
    seasonsEl.innerHTML = C.seasons.map(s =>
      `<button class="pill${state.season === s ? ' on' : ''}" type="button" data-s="${esc(s)}" aria-pressed="${state.season === s}">${esc(s)}</button>`
    ).join('');
    resetBtn.hidden = !(state.cat || state.color || state.season || state.q.trim());
  }

  /* ---------- сетка ---------- */
  function renderGrid() {
    view = data.filter(e => ok(e)).sort(cmp[state.sort] || cmp.new);
    grid.innerHTML = view.map(e => {
      const cover = e.images[0];
      const ph = cover
        ? `<span class="ph"${e.ar ? ` style="aspect-ratio:${e.ar}"` : ''}><img src="${esc(cover)}" alt="${esc(e.name)}" loading="lazy" decoding="async">${e.images.length > 1 ? `<span class="cnt">${e.images.length}</span>` : ''}</span>`
        : `<span class="ph noimg" style="background:${paint(e.colors[0])}">${esc((e.name || '?').charAt(0).toUpperCase())}</span>`;
      return `<button class="item" type="button" data-id="${esc(e.id)}">${ph}<span class="nm">${esc(e.name)}</span><span class="sub"><span class="dots">${dots(e.colors)}</span>${esc(e.cat || '')}</span></button>`;
    }).join('');

    const filtered = state.cat || state.color || state.season || state.q.trim();
    if (!data.length) {
      empty.innerHTML = '<h2>Здесь пока пусто</h2><p>Первая вещь добавляется в админке: фото, категория, цвет.</p><a href="admin.html">Открыть админку</a>';
    } else if (!view.length && filtered) {
      empty.innerHTML = '<h2>Ничего не нашлось</h2><p>Под такие фильтры вещей нет.</p><button type="button" id="empty-reset" class="reset">Сбросить фильтры</button>';
    }
    empty.hidden = view.length > 0;
    $('#count').textContent = data.length ? (filtered ? `${view.length} из ${data.length}` : `${data.length} ${plural(data.length)}`) : '';
    $('#controls').hidden = !data.length;
  }

  const refresh = () => { renderSpectrum(); renderTabs(); renderGrid(); };

  bar.addEventListener('click', e => {
    const b = e.target.closest('.seg'); if (!b) return;
    state.color = state.color === b.dataset.c ? '' : b.dataset.c; refresh();
  });
  tabs.addEventListener('click', e => {
    const b = e.target.closest('.tab'); if (!b) return;
    state.cat = b.dataset.k; refresh();
  });
  seasonsEl.addEventListener('click', e => {
    const b = e.target.closest('.pill'); if (!b) return;
    state.season = state.season === b.dataset.s ? '' : b.dataset.s; refresh();
  });
  const resetAll = () => { state.cat = state.color = state.season = state.q = ''; $('#q').value = ''; refresh(); };
  resetBtn.addEventListener('click', resetAll);
  empty.addEventListener('click', e => { if (e.target.id === 'empty-reset') resetAll(); });
  $('#q').addEventListener('input', e => { state.q = e.target.value; refresh(); });
  try { const sv = localStorage.getItem('wardrobe-sort'); if (sv && cmp[sv]) state.sort = sv; } catch {}
  sortSel.value = state.sort;
  sortSel.addEventListener('change', () => {
    state.sort = sortSel.value;
    try { localStorage.setItem('wardrobe-sort', state.sort); } catch {}
    renderGrid();
  });

  /* ---------- карточка вещи ---------- */
  let list = [], at = 0;
  function openItem(id) {
    list = view.some(e => e.id === id) ? view : data;
    at = list.findIndex(e => e.id === id);
    if (at < 0) return;
    drawItem();
    if (!modal.open) modal.showModal();
    history.replaceState(null, '', location.pathname + location.search + '#' + encodeURIComponent(id));
  }
  function drawItem() {
    const e = list[at], im = e.images;
    const gal = im.length
      ? `<div class="gal"><div class="gm"><img id="gimg" src="${esc(im[0])}" alt="${esc(e.name)}"></div>${im.length > 1 ? `<div class="strip">${im.map((p, k) => `<button class="th${k ? '' : ' on'}" type="button" data-k="${k}" aria-label="Фото ${k + 1}"><img src="${esc(p)}" alt="" loading="lazy"></button>`).join('')}</div>` : ''}</div>`
      : '<div class="gal"></div>';
    const facts = [];
    if (e.colors.length) facts.push(['Цвет', `<span class="sw-line">${e.colors.map(n => `<span><i class="dot" style="background:${paint(n)}"></i>${esc(n)}</span>`).join('')}</span>`]);
    if (e.seasons.length) facts.push(['Сезон', esc(seasonText(e.seasons))]);
    if (e.tags.length) facts.push(['Теги', esc(e.tags.join(', '))]);
    if (e.added) facts.push(['Добавлено', esc(dateText(e.added))]);
    body.innerHTML = `<div class="m">${gal}<div class="info">
      <h2>${esc(e.name)}</h2>
      ${e.cat ? `<p class="cat">${esc(e.cat)}</p>` : ''}
      ${facts.length ? `<dl class="facts">${facts.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>` : ''}
      ${e.note ? `<p class="note">${esc(e.note)}</p>` : ''}
      ${list.length > 1 ? '<div class="mnav"><button type="button" data-d="-1">Назад</button><button type="button" data-d="1">Дальше</button></div>' : ''}
    </div></div>`;
    const strip = $('.strip', body);
    if (strip) strip.addEventListener('click', ev => {
      const t = ev.target.closest('.th'); if (!t) return;
      $('#gimg').src = e.images[+t.dataset.k];
      body.querySelectorAll('.th').forEach(b => b.classList.toggle('on', b === t));
    });
  }
  const step = d => {
    at = (at + d + list.length) % list.length; drawItem(); modal.scrollTop = 0;
    history.replaceState(null, '', location.pathname + location.search + '#' + encodeURIComponent(list[at].id));
  };
  body.addEventListener('click', e => { const b = e.target.closest('.mnav button'); if (b) step(+b.dataset.d); });
  modal.addEventListener('keydown', e => {
    if (list.length < 2) return;
    if (e.key === 'ArrowLeft') step(-1); else if (e.key === 'ArrowRight') step(1);
  });
  modal.addEventListener('click', e => { if (e.target === modal) modal.close(); });
  modal.addEventListener('close', () => history.replaceState(null, '', location.pathname + location.search));
  grid.addEventListener('click', e => { const c = e.target.closest('.item'); if (c) openItem(c.dataset.id); });
  const fromHash = () => {
    let h = ''; try { h = decodeURIComponent(location.hash.slice(1)); } catch {}
    if (h && data.some(e => e.id === h)) openItem(h);
  };
  addEventListener('hashchange', fromHash);

  /* ---------- загрузка ---------- */
  fetch('wardrobe.json', { cache: 'no-store' })
    .then(r => { if (!r.ok) throw 0; return r.json(); })
    .then(j => {
      data = Array.isArray(j) ? j : [];
      data.forEach(prep);
      refresh();
      fromHash();
    })
    .catch(() => {
      empty.innerHTML = '<h2>Список не открылся</h2><p>Если открываешь файл с диска, запусти сайт через GitHub Pages или локальный сервер.</p>';
      empty.hidden = false;
    });
})();
