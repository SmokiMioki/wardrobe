(() => {
  const C = window.WARDROBE;
  const $ = (s, r = document) => r.querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const MULTI = 'linear-gradient(90deg,#e8a0b4,#e6c84a,#8ec3e6,#7b5ea7)';
  const NONE = '_none';    // «Без персонажа»: вещи, у которых персонаж не указан

  let data = [];           // все вещи
  let chars = [];          // персонажи
  let catsList = C.cats;   // категории из админки (characters.json), иначе из config.js
  let view = [];           // то, что сейчас показано в сетке (после фильтров и сортировки)
  let intro = true;        // лента цветов «проявляется» только при первом показе
  const state = { char: null, q: '', cat: '', color: '', season: '', sort: 'new' };   // char: null = главная

  const grid = $('#grid'), empty = $('#empty'), modal = $('#modal'), body = $('#modal-body');
  const bar = $('#bar'), tabs = $('#tabs'), seasonsEl = $('#seasons'), resetBtn = $('#reset'), sortSel = $('#sort');
  const wrapEl = $('#wrap'), watchEl = $('#watch'), guideEl = $('#guide'), crumbEl = $('#crumb');
  const yt = () => document.documentElement.dataset.style === 'youtube';   // стиль YouTube: плейлисты и страница просмотра

  /* ---------- цвета ---------- */
  const hexOf = n => C.colors[n];
  const paint = n => hexOf(n) === 'multi' ? MULTI : (hexOf(n) || '#999');
  const isLight = n => {
    const h = hexOf(n);
    if (!h || h === 'multi') return true;
    const [r, g, b] = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
    return r * .299 + g * .587 + b * .114 > 150;
  };
  /* фон-размытие для превью 16:9 (используется только в стиле YouTube) */
  const bgUrl = src => `url("${String(src).replace(/["\\()\s]/g, ch => '%' + ch.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0'))}")`;
  const bgVar = src => `--bg:${bgUrl(src)}`;
  const phStyle = (ar, src) => {
    const s = [ar ? `aspect-ratio:${ar}` : '', src ? bgVar(src) : ''].filter(Boolean).join(';');
    return s ? ` style="${esc(s)}"` : '';
  };
  const dots = list => (list || []).map(n => `<i class="dot" style="background:${paint(n)}" title="${esc(n)}"></i>`).join('');

  /* ---------- мелочи ---------- */
  const pl = (n, [one, few, many]) => {
    const a = n % 10, b = n % 100;
    if (a === 1 && b !== 11) return one;
    if (a >= 2 && a <= 4 && (b < 12 || b > 14)) return few;
    return many;
  };
  const THINGS = ['вещь', 'вещи', 'вещей'];
  const PEOPLE = ['персонаж', 'персонажа', 'персонажей'];
  const seasonText = s => !s || !s.length ? '' : s.length >= C.seasons.length ? 'Всесезон' : s.join(', ');
  const seasonMarks = list => list && list.length ? `<span class="ssn">${esc(seasonText(list))}</span>` : '';
  const dateText = iso => { try { return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }); } catch { return ''; } };
  const NEW_MS = 3 * 864e5;

  function prep(e) {
    e.colors = e.colors || []; e.seasons = e.seasons || []; e.tags = e.tags || []; e.images = e.images || [];
    if (!chars.some(c => c.id === e.char)) e.char = NONE;
    e._hay = [e.name, e.cat, e.note, ...e.colors, ...e.seasons, ...e.tags].join(' ').toLowerCase();
  }
  /* персонажи на главной: свои плюс «Без персонажа», если такие вещи есть */
  const allChars = () => data.some(e => e.char === NONE) ? [...chars, { id: NONE, name: 'Без персонажа' }] : chars;
  const charById = id => allChars().find(c => c.id === id);
  const hashOf = (cid, iid) => cid ? '#' + encodeURIComponent(cid) + (iid ? '/' + encodeURIComponent(iid) : '') : '';
  const setHash = iid => history.replaceState(null, '', location.pathname + location.search + hashOf(state.char, iid));

  /* ---------- фильтрация ---------- */
  function ok(e, skip) {
    if (e.char !== state.char) return false;
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

  /* ---------- главная: персонажи ---------- */
  function renderHome() {
    const list = allChars();
    grid.innerHTML = list.map((c, i) => {
      const n = data.filter(e => e.char === c.id).length;
      const badge = `<span class="plbadge">${n} ${pl(n, THINGS)}</span>`;
      const ph = c.cover
        ? `<span class="ph"${phStyle(c.ar, c.cover)}><img src="${esc(c.cover)}" alt="${esc(c.name)}" loading="lazy" decoding="async">${badge}</span>`
        : `<span class="ph noimg" style="background:linear-gradient(160deg,#ffd9de,#f3a6b0)">${esc((c.name || '?').charAt(0).toUpperCase())}${badge}</span>`;
      return `<a class="item char" href="${hashOf(c.id) || '#'}" style="--i:${Math.min(i, 14)}">${ph}<span class="kicker">${n} ${pl(n, THINGS)}</span><span class="nm">${esc(c.name)}</span>${c.note ? `<span class="cnote">${esc(c.note)}</span>` : ''}</a>`;
    }).join('');
    empty.innerHTML = '<h2>Здесь пока нет персонажей</h2><p>Первого персонажа можно создать в админке. Потом в ней же появятся категории и вещи.</p><a href="admin.html">Открыть админку</a>';
    empty.hidden = list.length > 0;
    $('#count').textContent = list.length ? `${list.length} ${pl(list.length, PEOPLE)}` : '';
  }

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
    const cats = [...new Set([...catsList, ...data.map(e => e.cat)])].filter(c => c && (tot[c] || c === state.cat));
    tabs.innerHTML = [['', 'Все', sum], ...cats.map(c => [c, c, tot[c] || 0])].map(([k, l, n]) =>
      `<button class="tab${state.cat === k ? ' on' : ''}" type="button" data-k="${esc(k)}" aria-pressed="${state.cat === k}">${esc(l)}<span class="n">${n}</span></button>`
    ).join('');
    seasonsEl.innerHTML = C.seasons.map(s =>
      `<button class="pill${state.season === s ? ' on' : ''}" type="button" data-s="${esc(s)}" aria-pressed="${state.season === s}">${esc(s)}</button>`
    ).join('');
    resetBtn.hidden = !(state.cat || state.color || state.season || state.q.trim());
  }

  /* ---------- сетка вещей персонажа ---------- */
  function renderGrid() {
    view = data.filter(e => ok(e)).sort(cmp[state.sort] || cmp.new);
    const base = data.filter(e => e.char === state.char);
    grid.innerHTML = view.map((e, i) => {
      const cover = e.images[0];
      const ph = cover
        ? `<span class="ph"${phStyle(e.ar, cover)}><img src="${esc(cover)}" alt="${esc(e.name)}" loading="lazy" decoding="async"><span class="pin">Открыть</span>${e.images.length > 1 ? `<span class="cnt">${e.images.length}</span>` : ''}</span>`
        : `<span class="ph noimg" style="background:${paint(e.colors[0])}">${esc((e.name || '?').charAt(0).toUpperCase())}</span>`;
      const fresh = e.added && Date.now() - Date.parse(e.added) < NEW_MS;
      const av = `<span class="av${isLight(e.colors[0]) ? ' lt' : ''}" style="background:${paint(e.colors[0])}" aria-hidden="true">${esc((e.name || '?').charAt(0).toUpperCase())}</span>`;
      const cl = e.cat ? `<span class="cl">${esc(e.cat)}</span>` : '';
      return `<button class="item" type="button" data-id="${esc(e.id)}" style="--i:${Math.min(i, 14)}">${fresh ? '<span class="new">new</span>' : ''}<span class="ix">${i + 1}</span>${ph}${av}<span class="nm">${esc(e.name)}</span><span class="sub">${cl}${seasonMarks(e.seasons)}<span class="dots">${dots(e.colors)}</span></span></button>`;
    }).join('');

    const filtered = state.cat || state.color || state.season || state.q.trim();
    if (!base.length) {
      empty.innerHTML = '<h2>Здесь пока пусто</h2><p>У этого персонажа ещё нет вещей. Первая добавляется в админке: фото, категория, цвет.</p><a href="admin.html">Открыть админку</a>';
    } else if (!view.length && filtered) {
      empty.innerHTML = '<h2>Тут ничего нет</h2><p>Под такие фильтры вещей не нашлось. Может, она в стирке?</p><button type="button" id="empty-reset" class="reset">Сбросить фильтры</button>';
    }
    empty.hidden = view.length > 0;
    $('#count').textContent = base.length ? (filtered ? `${view.length} из ${base.length}` : `${base.length} ${pl(base.length, THINGS)}`) : '';
    $('#controls').hidden = !base.length;
    $('#rnd').hidden = !view.length;
  }

  /* боковое меню YouTube: «Главная» и плейлисты (персонажи) */
  const initial = n => esc((n || '?').charAt(0).toUpperCase());
  function renderGuide() {
    const home = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M4 10.5L12 4l8 6.5V20h-5v-6H9v6H4z"/></svg>';
    guideEl.innerHTML = `<a class="g-i${state.char === null ? ' on' : ''}" href="#">${home}<span class="g-n">Главная</span></a>`
      + (allChars().length ? '<p class="g-h">Плейлисты</p>' : '')
      + allChars().map(c => `<a class="g-i${state.char === c.id ? ' on' : ''}" href="${hashOf(c.id)}"><span class="g-a"${c.cover ? ` style="${esc(bgVar(c.cover))}"` : ''}>${c.cover ? '' : initial(c.name)}</span><span class="g-n">${esc(c.name)}</span></a>`).join('');
  }

  function refresh() {
    const home = state.char === null;
    $('#crumb').hidden = home;
    $('#search').hidden = home;
    wrapEl.classList.toggle('char-page', !home);
    renderGuide();
    if (home) {
      $('#spectrum').hidden = true; $('#controls').hidden = true;
      view = []; renderHome();
      return;
    }
    const c = charById(state.char) || { name: '' };
    $('#cname').textContent = c.name;
    $('#cnote').textContent = c.note || '';
    $('#cnote').hidden = !c.note;
    /* шапка плейлиста (видна только в стиле YouTube) */
    const total = data.filter(e => e.char === state.char).length;
    $('#pl-meta').textContent = `Плейлист • ${total} ${pl(total, THINGS)}`;
    $('#pl-cover').hidden = !c.cover;
    if (c.cover) { $('#pl-img').src = c.cover; crumbEl.style.setProperty('--bg', bgUrl(c.cover)); }
    else crumbEl.style.removeProperty('--bg');
    renderSpectrum(); renderTabs(); renderGrid();
  }

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
  /* открыть вещь: в стиле YouTube это переход по адресу (работает кнопка «назад»), в Pinterest — окно */
  const go = id => { if (yt()) location.hash = hashOf(state.char, id); else openItem(id); };
  $('#rnd').addEventListener('click', () => { if (view.length) go(view[Math.floor(Math.random() * view.length)].id); });
  empty.addEventListener('click', e => { if (e.target.id === 'empty-reset') resetAll(); });
  $('#q').addEventListener('input', e => {
    state.q = e.target.value;
    if (!watchEl.hidden) location.hash = hashOf(state.char);   // поиск с «видео» ведёт обратно в плейлист
    refresh();
  });
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
    list = view.some(e => e.id === id) ? view : data.filter(e => e.char === state.char);
    at = list.findIndex(e => e.id === id);
    if (at < 0) return;
    if (yt()) {
      if (modal.open) modal.close();
      showWatch();
    } else {
      closeWatch();
      drawItem();
      if (!modal.open) modal.showModal();
    }
    setHash(id);
  }

  /* ---------- стиль YouTube: страница просмотра ---------- */
  let wi = 0;                          // номер фото в «плеере»
  const baseTitle = document.title;
  const dateShort = iso => { try { return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' }); } catch { return ''; } };
  const avaOf = c => c && c.cover
    ? `<span class="yt-ava" style="${esc(bgVar(c.cover))}"></span>`
    : `<span class="yt-ava" style="background:linear-gradient(160deg,#ff8a9a,#c2185b)">${initial(c && c.name)}</span>`;
  /* строка списка: плейлист справа от плеера и рекомендации */
  const ytRow = (e, cls, lead) => {
    const c = charById(e.char), cover = e.images[0];
    const ph = cover
      ? `<span class="ph"${phStyle(e.ar, cover)}><img src="${esc(cover)}" alt="" loading="lazy" decoding="async">${e.images.length > 1 ? `<span class="cnt">${e.images.length}</span>` : ''}</span>`
      : `<span class="ph noimg" style="background:${paint(e.colors[0])}">${initial(e.name)}</span>`;
    return `<a class="yt-row${cls}" href="${hashOf(e.char, e.id)}">${lead}${ph}<span class="r-t"><b class="r-n">${esc(e.name)}</b><span class="r-m">${esc(c ? c.name : '')}${e.cat ? ' • ' + esc(e.cat) : ''}</span><span class="r-m dots">${dots(e.colors)}</span></span></a>`;
  };

  function showWatch() {
    const e = list[at]; if (!e) return;
    const c = charById(e.char), im = e.images, n = list.length;
    const mates = data.filter(x => x.char === e.char).length;
    wi = 0;

    const player = `<div class="yt-player" style="${esc(im.length ? bgVar(im[0]) : 'background:' + paint(e.colors[0]))}">`
      + (im.length ? `<img id="wimg" src="${esc(im[0])}" alt="${esc(e.name)}">` : `<span class="yt-noimg">${initial(e.name)}</span>`)
      + (im.length > 1 ? `<button class="yt-arrow l" type="button" data-p="-1" aria-label="Предыдущее фото">‹</button><button class="yt-arrow r" type="button" data-p="1" aria-label="Следующее фото">›</button><div class="yt-prog">${im.map((_, k) => `<button type="button" data-k="${k}" class="${k ? '' : 'on'}" aria-label="Фото ${k + 1}"></button>`).join('')}</div>` : '')
      + '</div>';

    const meta = [e.added ? dateShort(e.added) : '', e.cat, seasonText(e.seasons)].filter(Boolean);
    const long = (e.note || '').length > 160;
    const desc = `<div class="yt-desc${long ? '' : ' open'}"><p class="d-h">${meta.map(esc).join(' • ') || 'Без описания'}</p>`
      + (e.colors.length ? `<p class="d-c">${e.colors.map(k => `<span><i class="dot" style="background:${paint(k)}"></i>${esc(k)}</span>`).join('')}</p>` : '')
      + (e.note ? `<p class="d-body">${esc(e.note)}</p>` : '')
      + (e.tags.length ? `<p class="d-t">${e.tags.map(t => '#' + esc(String(t).replace(/^#/, ''))).join(' ')}</p>` : '')
      + (long ? '<button type="button" class="d-more">…ещё</button>' : '') + '</div>';

    const plHref = hashOf(e.char) || '#';
    const chan = `<div class="yt-chan"><a href="${plHref}" aria-label="Плейлист">${avaOf(c)}</a><a class="yt-cn" href="${plHref}"><b>${esc(c ? c.name : '')}</b><span>${mates} ${pl(mates, THINGS)}</span></a><a class="yt-sub" href="${plHref}">Открыть плейлист</a>`
      + (n > 1 ? '<span class="yt-grp"><button type="button" data-d="-1">‹ Назад</button><button type="button" data-d="1">Дальше ›</button></span>' : '') + '</div>';

    /* панель плейлиста: все вещи персонажа, текущая подсвечена */
    const plist = n > 1
      ? `<section class="yt-pl"><header><b>${esc(c ? c.name : '')}</b><span>${at + 1} / ${n}</span></header><div class="yt-pl-list">${list.map((x, k) => ytRow(x, k === at ? ' on' : '', `<span class="r-i">${k === at ? '▶' : k + 1}</span>`)).join('')}</div></section>`
      : '';

    /* рекомендации: другие наряды, похожие по категории, цветам и сезону идут первыми */
    const skip = new Set(list.map(x => x.id));
    const score = x => (e.cat && x.cat === e.cat ? 3 : 0) + x.colors.filter(k => e.colors.includes(k)).length * 2 + x.seasons.filter(k => e.seasons.includes(k)).length;
    const recs = data.filter(x => !skip.has(x.id)).sort((a, b) => score(b) - score(a) || cmp.new(a, b)).slice(0, 24);
    const recHtml = recs.length ? `<h3 class="yt-h">Другие наряды</h3><div class="yt-recs">${recs.map(x => ytRow(x, '', '')).join('')}</div>` : '';

    watchEl.innerHTML = `<div class="yt-main">${player}<h1 class="yt-title">${esc(e.name)}</h1>${chan}${desc}</div><aside class="yt-side">${plist}${recHtml}</aside>`;
    watchEl.hidden = false;
    wrapEl.classList.add('watching');
    document.title = `${e.name} — ${baseTitle}`;
    window.scrollTo(0, 0);
  }
  function closeWatch() {
    if (watchEl.hidden) return;
    watchEl.hidden = true; watchEl.innerHTML = '';
    wrapEl.classList.remove('watching');
    document.title = baseTitle;
  }
  function photo(k) {
    const e = list[at], m = e && e.images.length; if (!m) return;
    wi = (k + m) % m;
    $('#wimg').src = e.images[wi];
    $('.yt-player', watchEl).style.setProperty('--bg', bgUrl(e.images[wi]));
    watchEl.querySelectorAll('.yt-prog button').forEach((b, j) => b.classList.toggle('on', j <= wi));
  }
  watchEl.addEventListener('click', ev => {
    const p = ev.target.closest('[data-p]'); if (p) return photo(wi + +p.dataset.p);
    const k = ev.target.closest('.yt-prog [data-k]'); if (k) return photo(+k.dataset.k);
    const d = ev.target.closest('.yt-grp [data-d]');
    if (d) { const t = list[(at + +d.dataset.d + list.length) % list.length]; location.hash = hashOf(t.char, t.id); return; }
    const box = ev.target.closest('.yt-desc');
    if (box && box.querySelector('.d-more') && !ev.target.closest('a')) box.classList.toggle('open');
  });
  document.addEventListener('keydown', ev => {
    if (watchEl.hidden || /^(INPUT|TEXTAREA|SELECT)$/.test(ev.target.tagName)) return;
    if (ev.key === 'ArrowLeft') photo(wi - 1); else if (ev.key === 'ArrowRight') photo(wi + 1);
  });
  /* смена стиля при открытой вещи: показать её в новом виде */
  addEventListener('wardrobe-style', () => {
    const e = (modal.open || !watchEl.hidden) ? list[at] : null;
    if (modal.open) modal.close();
    closeWatch();
    if (e) openItem(e.id);
  });
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
    setHash(list[at].id);
  };
  body.addEventListener('click', e => { const b = e.target.closest('.mnav button'); if (b) step(+b.dataset.d); });
  modal.addEventListener('keydown', e => {
    if (list.length < 2) return;
    if (e.key === 'ArrowLeft') step(-1); else if (e.key === 'ArrowRight') step(1);
  });
  modal.addEventListener('click', e => { if (e.target === modal) modal.close(); });
  modal.addEventListener('close', () => { if (!yt()) setHash(null); });
  grid.addEventListener('click', e => { const c = e.target.closest('.item'); if (c && c.dataset.id) go(c.dataset.id); });

  /* ---------- адреса: #персонаж и #персонаж/вещь ---------- */
  function route() {
    let h = ''; try { h = decodeURIComponent(location.hash.slice(1)); } catch {}
    let [cid, iid] = h.split('/');
    /* старые ссылки вида #вещь */
    if (cid && !charById(cid)) {
      const it = data.find(e => e.id === cid);
      if (it) { iid = it.id; cid = it.char; } else cid = '';
    }
    const target = cid || null;
    if (target !== state.char) {
      state.char = target;
      state.cat = state.color = state.season = state.q = ''; $('#q').value = '';
      intro = true;
      if (modal.open) modal.close();
      closeWatch();
      refresh();
      window.scrollTo(0, 0);
    }
    if (iid && state.char !== null) { if (data.some(e => e.id === iid && e.char === state.char)) openItem(iid); }
    else { if (modal.open) modal.close(); closeWatch(); }
  }
  addEventListener('hashchange', route);

  /* ---------- загрузка ---------- */
  const getJson = (file, strict) => fetch(file, { cache: 'no-store' })
    .then(r => { if (!r.ok) throw 0; return r.json(); })
    .catch(err => { if (strict) throw err; return null; });

  Promise.all([getJson('wardrobe.json', true), getJson('characters.json', false)])
    .then(([items, meta]) => {
      if (meta && typeof meta === 'object') {
        chars = Array.isArray(meta.characters) ? meta.characters.filter(c => c && c.id) : [];
        if (Array.isArray(meta.cats)) catsList = meta.cats;
      }
      data = Array.isArray(items) ? items : [];
      data.forEach(prep);
      route();
      if (state.char === null) refresh();
    })
    .catch(() => {
      empty.innerHTML = '<h2>Список не открылся</h2><p>Если открываешь файл с диска, запусти сайт через GitHub Pages или локальный сервер.</p>';
      empty.hidden = false;
    });
})();
