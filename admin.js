(() => {
  const C = window.WARDROBE;
  const $ = (s, r = document) => r.querySelector(s);
  const LS = 'wardrobe-admin';
  const FILE = 'wardrobe.json';
  const CFILE = 'characters.json';   // персонажи и категории
  const MULTI = 'linear-gradient(90deg,#e8a0b4,#e6c84a,#8ec3e6,#7b5ea7)';
  let list = [], sha = null, editing = -1;
  let chars = [], cats = [], csha = null, cedit = -1, cpic = null;   // персонажи, категории, обложка в форме
  let picked = [];                 // выбранные цвета по порядку
  const seasons = new Set();       // выбранные сезоны
  let pics = [];                   // { path, preview } уже в репо; { blob, preview, w, h } ещё нет
  const cfg = { owner: '', repo: '', branch: 'main', token: '' };

  /* ---------- служебное ---------- */
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toB64 = s => { const b = new TextEncoder().encode(s); let t = ''; b.forEach(x => t += String.fromCharCode(x)); return btoa(t); };
  const fromB64 = s => { const t = atob(s); return new TextDecoder().decode(Uint8Array.from(t, c => c.charCodeAt(0))); };
  const status = (msg, kind = 'wait') => { const el = $('#status'); el.textContent = msg; el.className = 'status ' + kind; el.hidden = !msg; };
  const busy = on => document.querySelectorAll('button').forEach(b => b.disabled = on);
  const paint = n => C.colors[n] === 'multi' ? MULTI : (C.colors[n] || '#999');

  async function api(path, opt = {}) {
    const h = { Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' };
    if (cfg.token) h.Authorization = 'Bearer ' + cfg.token;
    return fetch('https://api.github.com' + path, { ...opt, headers: h });
  }
  const fileApi = p => `/repos/${cfg.owner}/${cfg.repo}/contents/${p.split('/').map(encodeURIComponent).join('/')}`;
  const blobB64 = b => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(b); });
  const errText = async (r, fallback) => {
    let m = ''; try { m = (await r.json()).message; } catch {}
    if (/not accessible|bad credentials|requires authentication/i.test(m || '') || r.status === 401 || r.status === 403)
      return 'У токена нет прав на запись в этот репозиторий. Нужно: Repository access включает ' + (cfg.repo || 'репозиторий') + ' и Contents: Read and write. Аккаунт-владелец токена должен быть ' + (cfg.owner || 'тот же, что у репозитория') + '.';
    return m || fallback;
  };

  /* ---------- цвета и сезоны ---------- */
  function renderPalette() {
    $('#palette').innerHTML = Object.keys(C.colors).map(n => {
      const o = picked.indexOf(n) + 1;
      return `<button class="sw" type="button" data-c="${esc(n)}" style="background:${paint(n)}" title="${esc(n)}" aria-label="${esc(n)}" aria-pressed="${o > 0}"${o ? ` data-o="${o}"` : ''}></button>`;
    }).join('');
  }
  $('#palette').addEventListener('click', e => {
    const b = e.target.closest('.sw'); if (!b) return;
    const n = b.dataset.c, i = picked.indexOf(n);
    if (i >= 0) picked.splice(i, 1);
    else if (picked.length >= 2) return status('Не больше двух цветов. Сними один, чтобы выбрать другой.', 'err');
    else picked.push(n);
    status(''); renderPalette();
  });

  function renderSeasons() {
    const all = C.seasons.every(s => seasons.has(s));
    $('#seasons').innerHTML = C.seasons.map(s =>
      `<button class="pill${seasons.has(s) ? ' on' : ''}" type="button" data-s="${esc(s)}" aria-pressed="${seasons.has(s)}">${esc(s)}</button>`
    ).join('') + `<button class="pill${all ? ' on' : ''}" type="button" data-s="*" aria-pressed="${all}">Всесезон</button>`;
  }
  $('#seasons').addEventListener('click', e => {
    const b = e.target.closest('.pill'); if (!b) return;
    if (b.dataset.s === '*') {
      const all = C.seasons.every(s => seasons.has(s));
      C.seasons.forEach(s => all ? seasons.delete(s) : seasons.add(s));
    } else seasons.has(b.dataset.s) ? seasons.delete(b.dataset.s) : seasons.add(b.dataset.s);
    renderSeasons();
  });

  /* ---------- категории и теги: подсказки из уже существующих ---------- */
  const splitTags = s => s.split(',').map(t => t.trim()).filter(Boolean);
  const uniq = arr => { const seen = new Set(); return arr.filter(t => !seen.has(t.toLowerCase()) && seen.add(t.toLowerCase())); };
  function renderHints() {
    const n = {};
    list.forEach(e => (e.tags || []).forEach(t => { n[t] = (n[t] || 0) + 1; }));
    const top = Object.keys(n).sort((a, b) => n[b] - n[a] || a.localeCompare(b, 'ru')).slice(0, 14);
    $('#sug').innerHTML = top.map(t => `<button type="button" data-t="${esc(t)}">${esc(t)}</button>`).join('');
  }
  function renderSelects() {
    const curChar = $('#f-char').value, curCat = $('#f-cat').value;
    const all = cats.slice(); if (curCat && !all.includes(curCat)) all.push(curCat);
    $('#f-char').innerHTML = '<option value="">Выбери персонажа</option>' + chars.map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
    $('#f-cat').innerHTML = '<option value="">Выбери категорию</option>' + all.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
    $('#f-char').value = curChar; $('#f-cat').value = curCat;
    const hint = !chars.length ? 'Сначала создай хотя бы одного персонажа выше.' : !cats.length ? 'Сначала создай хотя бы одну категорию выше.' : '';
    $('#f-hint').textContent = hint; $('#f-hint').hidden = !hint;
  }
  $('#sug').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    const f = $('#f-tags');
    f.value = uniq([...splitTags(f.value), b.dataset.t]).join(', ');
  });

  /* ---------- фото ---------- */
  async function shrink(file) {
    let bmp;
    try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
    catch { bmp = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file); }); }
    const w0 = bmp.width || bmp.naturalWidth, h0 = bmp.height || bmp.naturalHeight;
    const k = Math.min(1, C.imgMax / Math.max(w0, h0));
    const c = document.createElement('canvas');
    c.width = Math.round(w0 * k); c.height = Math.round(h0 * k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const toBlob = (t, q) => new Promise(r => c.toBlob(r, t, q));
    let b = await toBlob('image/webp', .84);
    if (!b || b.type !== 'image/webp') b = await toBlob('image/jpeg', .86);
    return { blob: b, w: c.width, h: c.height };
  }
  const measure = url => new Promise(res => {
    const i = new Image();
    i.onload = () => res(i.naturalWidth && i.naturalHeight ? +(i.naturalWidth / i.naturalHeight).toFixed(3) : 0);
    i.onerror = () => res(0);
    i.src = url;
  });

  async function putImage(blob, id, k) {
    const ext = blob.type === 'image/webp' ? 'webp' : blob.type === 'image/jpeg' ? 'jpg' : 'png';
    const path = `img/${id}-${Date.now().toString(36)}${k}.${ext}`;
    const r = await api(fileApi(path), { method: 'PUT', body: JSON.stringify({ message: 'Add image: ' + id, content: await blobB64(blob), branch: cfg.branch }) });
    if (!r.ok) throw new Error('Фото не загрузилось: ' + await errText(r, r.status));
    return { path, sha: (await r.json()).content.sha };
  }
  async function rmFile(path, fsha) {
    if (!/^img\/[\w.-]+$/.test(path)) return;
    try {
      if (!fsha) {
        const g = await api(`${fileApi(path)}?ref=${encodeURIComponent(cfg.branch)}&t=${Date.now()}`);
        if (!g.ok) return;
        fsha = (await g.json()).sha;
      }
      await api(fileApi(path), { method: 'DELETE', body: JSON.stringify({ message: 'Remove image', sha: fsha, branch: cfg.branch }) });
    } catch {}
  }

  function renderThumbs() {
    $('#thumbs').innerHTML = pics.map((p, i) => `<div class="tb${i ? '' : ' first'}" data-i="${i}"><img src="${esc(p.preview)}" alt=""><button class="rm" type="button" data-i="${i}" aria-label="Убрать">×</button></div>`).join('');
  }
  $('#add-img').addEventListener('click', () => $('#f-files').click());
  $('#f-files').addEventListener('change', async e => {
    const files = [...e.target.files].filter(f => f.type.startsWith('image/'));
    e.target.value = '';
    if (!files.length) return;
    const room = C.maxImages - pics.length;
    if (room <= 0) return status(`Максимум ${C.maxImages} фото.`, 'err');
    busy(true); status('Сжимаю…');
    try {
      for (const f of files.slice(0, room)) {
        const s = await shrink(f);
        pics.push({ blob: s.blob, w: s.w, h: s.h, preview: URL.createObjectURL(s.blob) });
      }
      renderThumbs();
      status(files.length > room ? `Влезло только ${room}, остальные пропущены.` : '', files.length > room ? 'err' : 'wait');
    } catch { status('Не смог прочитать фото.', 'err'); }
    busy(false);
  });
  $('#thumbs').addEventListener('click', e => {
    const rm = e.target.closest('.rm');
    if (rm) {
      const [p] = pics.splice(+rm.dataset.i, 1);
      if (p.blob) URL.revokeObjectURL(p.preview);
      renderThumbs(); return;
    }
    const th = e.target.closest('.tb');
    if (!th || th.dataset.i === '0') return;
    pics.unshift(...pics.splice(+th.dataset.i, 1));
    renderThumbs();
  });

  /* ---------- вход ---------- */
  try { Object.assign(cfg, JSON.parse(localStorage.getItem(LS) || '{}')); } catch {}
  if (!cfg.owner) {
    const m = location.hostname.match(/^(.+)\.github\.io$/);
    if (m) { cfg.owner = m[1]; cfg.repo = location.pathname.split('/')[1] || (m[1] + '.github.io'); }
  }
  $('#owner').value = cfg.owner; $('#repo').value = cfg.repo;
  $('#branch').value = cfg.branch || 'main'; $('#token').value = cfg.token || '';

  async function loadJson(file) {
    const r = await api(`${fileApi(file)}?ref=${encodeURIComponent(cfg.branch)}&t=${Date.now()}`);
    if (r.status === 404) return { data: null, sha: null };
    if (r.status === 401 || r.status === 403) throw new Error('Токен не подходит или у него нет права Contents: Read and write.');
    if (!r.ok) throw new Error('GitHub ответил ошибкой ' + r.status);
    const j = await r.json();
    return { data: JSON.parse(fromB64(j.content.replace(/\n/g, '')) || 'null'), sha: j.sha };
  }
  async function load() {
    const w = await loadJson(FILE);
    list = Array.isArray(w.data) ? w.data : []; sha = w.sha;
    const m = await loadJson(CFILE);
    csha = m.sha;
    const md = m.data && typeof m.data === 'object' ? m.data : null;
    chars = md && Array.isArray(md.characters) ? md.characters : [];
    cats = md ? (Array.isArray(md.cats) ? md.cats : []) : C.cats.slice();   // впервые: заготовка из config.js, потом правишь сама
  }

  $('#connect').addEventListener('click', async () => {
    cfg.owner = $('#owner').value.trim();
    cfg.repo = $('#repo').value.trim();
    cfg.branch = $('#branch').value.trim() || 'main';
    cfg.token = $('#token').value.trim();
    if (!cfg.owner || !cfg.repo || !cfg.token) return status('Заполни аккаунт, репозиторий и токен.', 'err');
    busy(true); status('Подключаюсь…');
    try {
      await load();
      try { if ($('#remember').checked) localStorage.setItem(LS, JSON.stringify(cfg)); else localStorage.removeItem(LS); } catch {}
      $('#p-chars').hidden = false; $('#p-cats').hidden = false; $('#p-add').hidden = false; $('#p-list').hidden = false;
      render(); status('Вход выполнен ✓', 'ok');
    } catch (e) { status(e.message, 'err'); }
    busy(false);
  });

  /* ---------- сохранение ---------- */
  async function putJson(file, obj, curSha, message) {
    const body = { message, content: toB64(JSON.stringify(obj, null, 2) + '\n'), branch: cfg.branch };
    if (curSha) body.sha = curSha;
    const r = await api(fileApi(file), { method: 'PUT', body: JSON.stringify(body) });
    if (!r.ok) {
      if (r.status === 409 || r.status === 422) throw new Error('Данные изменились в другом месте. Нажми «Войти» ещё раз и повтори.');
      throw new Error(await errText(r, 'Не удалось сохранить (' + r.status + ')'));
    }
    return (await r.json()).content.sha;
  }
  const save = async message => { sha = await putJson(FILE, list, sha, message); };
  const saveMeta = async message => { csha = await putJson(CFILE, { characters: chars, cats }, csha, message); };

  $('#form').addEventListener('submit', async e => {
    e.preventDefault();
    const was = editing;
    const old = was >= 0 ? list[was] : null;
    const item = {
      id: old ? old.id : Date.now().toString(36),
      name: $('#f-name').value.trim(),
      char: $('#f-char').value,
      cat: $('#f-cat').value.trim(),
      colors: picked.slice(),
      seasons: C.seasons.filter(s => seasons.has(s)),
      tags: uniq(splitTags($('#f-tags').value)),
      note: $('#f-note').value.trim(),
      added: (old && old.added) || new Date().toISOString()
    };
    if (!item.name) return status('Нужно название.', 'err');
    if (!item.char) return status('Выбери персонажа.', 'err');
    if (!item.cat) return status('Выбери категорию.', 'err');
    if (!pics.length) return status('Добавь хотя бы одно фото.', 'err');

    const prev = list.slice();
    const oldImgs = old ? (old.images || []) : [];
    const fresh = pics.filter(p => p.blob);
    busy(true);
    try {
      /* сначала фото, потом список: чтобы на сайте не было битых картинок */
      let n = 0;
      for (const p of fresh) {
        status(`Загружаю фото ${++n}/${fresh.length}…`);
        Object.assign(p, await putImage(p.blob, item.id, n));
      }
      item.images = pics.map(p => p.path);
      const cover = pics[0];
      const ar = cover.w && cover.h ? +(cover.w / cover.h).toFixed(3) : await measure(cover.preview);
      if (ar) item.ar = ar;
      status('Сохраняю…');
      if (was >= 0) list[was] = item; else list.push(item);
      await save((was >= 0 ? 'Update: ' : 'Add: ') + item.name);
      for (const p of oldImgs) if (!item.images.includes(p)) await rmFile(p);
      resetForm(); render();
      status('Сохранено ✓ Сайт обновится через минуту.', 'ok');
    } catch (err) {
      list = prev; render(); status(err.message, 'err');
      for (const p of fresh) if (p.sha) { await rmFile(p.path, p.sha); delete p.path; delete p.sha; }
    }
    busy(false);
  });

  /* ---------- список ---------- */
  function render() {
    renderHints(); renderSelects(); renderChars(); renderCats();
    $('#n').textContent = list.length ? `(${list.length})` : '';
    $('#list').innerHTML = list.length ? list.map((e, i) => `
      <li>${(e.images || [])[0] ? `<img class="pre" src="${esc(e.images[0])}" alt="" loading="lazy">` : ''}
      <div class="t"><b>${esc(e.name)}</b><span>${esc([(chars.find(c => c.id === e.char) || {}).name || 'без персонажа', e.cat, (e.colors || []).join(', ')].filter(Boolean).join(' · '))}</span></div>
      <button type="button" data-a="edit" data-i="${i}">Править</button>
      <button type="button" class="del" data-a="del" data-i="${i}">Удалить</button></li>`).join('')
      : '<li class="none">Пока пусто. Добавь первую вещь выше.</li>';
  }

  $('#list').addEventListener('click', async e => {
    const b = e.target.closest('button'); if (!b) return;
    const i = +b.dataset.i, it = list[i];
    if (b.dataset.a === 'edit') {
      editing = i;
      $('#f-name').value = it.name;
      $('#f-char').value = chars.some(c => c.id === it.char) ? it.char : '';
      if (it.cat && ![...$('#f-cat').options].some(o => o.value === it.cat)) $('#f-cat').add(new Option(it.cat, it.cat));
      $('#f-cat').value = it.cat || ''; $('#f-note').value = it.note || '';
      $('#f-tags').value = (it.tags || []).join(', ');
      picked = (it.colors || []).filter(n => n in C.colors); renderPalette();
      seasons.clear(); (it.seasons || []).forEach(s => seasons.add(s)); renderSeasons();
      pics.forEach(p => p.blob && URL.revokeObjectURL(p.preview));
      pics = (it.images || []).map(p => ({ path: p, preview: p })); renderThumbs();
      $('#form-title').textContent = 'Правка: ' + it.name;
      $('#submit').textContent = 'Сохранить изменения'; $('#cancel').hidden = false;
      $('#p-add').scrollIntoView({ behavior: 'smooth' });
    } else if (b.dataset.a === 'del') {
      if (!confirm(`Удалить «${it.name}» из гардероба?`)) return;
      const prev = list.slice(); list.splice(i, 1);
      busy(true); status('Удаляю…');
      try {
        await save('Remove: ' + it.name);
        for (const p of it.images || []) await rmFile(p);
        resetForm(); render(); status('Удалено ✓', 'ok');
      } catch (err) { list = prev; render(); status(err.message, 'err'); }
      busy(false);
    }
  });

  /* ---------- персонажи ---------- */
  function renderCharPrev() {
    $('#c-prev').innerHTML = cpic ? `<img src="${esc(cpic.preview)}" alt="">` : '<span>без обложки</span>';
    $('#c-add-img').textContent = cpic ? 'Заменить обложку' : 'Выбрать обложку';
  }
  function resetChar() {
    cedit = -1; $('#cform').reset();
    if (cpic && cpic.blob) URL.revokeObjectURL(cpic.preview);
    cpic = null; renderCharPrev();
    $('#c-form-title').textContent = 'Новый персонаж';
    $('#c-submit').textContent = 'Добавить персонажа'; $('#c-cancel').hidden = true;
  }
  function renderChars() {
    $('#clist').innerHTML = chars.length ? chars.map((c, i) => {
      const n = list.filter(e => e.char === c.id).length;
      return `<li>${c.cover ? `<img class="pre" src="${esc(c.cover)}" alt="" loading="lazy">` : ''}
      <div class="t"><b>${esc(c.name)}</b><span>${n} ${n === 1 ? 'вещь' : (n > 1 && n < 5 ? 'вещи' : 'вещей')}${c.note ? ' · ' + esc(c.note) : ''}</span></div>
      <button type="button" data-a="cedit" data-i="${i}">Править</button>
      <button type="button" class="del" data-a="cdel" data-i="${i}">Удалить</button></li>`;
    }).join('') : '<li class="none">Персонажей пока нет. Создай первого ниже.</li>';
  }
  $('#c-add-img').addEventListener('click', () => $('#c-file').click());
  $('#c-file').addEventListener('change', async e => {
    const f = [...e.target.files].find(x => x.type.startsWith('image/'));
    e.target.value = '';
    if (!f) return;
    busy(true); status('Сжимаю…');
    try {
      const s = await shrink(f);
      if (cpic && cpic.blob) URL.revokeObjectURL(cpic.preview);
      cpic = { blob: s.blob, w: s.w, h: s.h, preview: URL.createObjectURL(s.blob) };
      renderCharPrev(); status('');
    } catch { status('Не смог прочитать фото.', 'err'); }
    busy(false);
  });
  $('#c-cancel').addEventListener('click', () => { resetChar(); status(''); });
  $('#cform').addEventListener('submit', async e => {
    e.preventDefault();
    const name = $('#c-name').value.trim();
    if (!name) return status('Нужно имя.', 'err');
    const old = cedit >= 0 ? chars[cedit] : null;
    const c = { id: old ? old.id : 'c' + Date.now().toString(36), name, note: $('#c-note').value.trim(), added: (old && old.added) || new Date().toISOString() };
    if (old && old.cover) { c.cover = old.cover; if (old.ar) c.ar = old.ar; }
    const prev = chars.slice();
    let up = null;
    busy(true);
    try {
      if (cpic && cpic.blob) {
        status('Загружаю обложку…');
        up = await putImage(cpic.blob, c.id, 'c');
        c.cover = up.path; c.ar = +(cpic.w / cpic.h).toFixed(3);
      }
      status('Сохраняю…');
      if (old) chars[cedit] = c; else chars.push(c);
      await saveMeta((old ? 'Update character: ' : 'Add character: ') + name);
      if (old && old.cover && old.cover !== c.cover) await rmFile(old.cover);
      resetChar(); render();
      status('Сохранено ✓ Сайт обновится через минуту.', 'ok');
    } catch (err) {
      chars = prev; render(); status(err.message, 'err');
      if (up) await rmFile(up.path, up.sha);
    }
    busy(false);
  });
  $('#clist').addEventListener('click', async e => {
    const b = e.target.closest('button'); if (!b) return;
    const i = +b.dataset.i, c = chars[i];
    if (b.dataset.a === 'cedit') {
      cedit = i;
      $('#c-name').value = c.name; $('#c-note').value = c.note || '';
      if (cpic && cpic.blob) URL.revokeObjectURL(cpic.preview);
      cpic = c.cover ? { path: c.cover, preview: c.cover } : null; renderCharPrev();
      $('#c-form-title').textContent = 'Правка: ' + c.name;
      $('#c-submit').textContent = 'Сохранить изменения'; $('#c-cancel').hidden = false;
      $('#cform').scrollIntoView({ behavior: 'smooth' });
    } else if (b.dataset.a === 'cdel') {
      const n = list.filter(x => x.char === c.id).length;
      if (n) return status(`У персонажа ${c.name} есть вещи (${n}). Сначала удали их или перенеси другому персонажу кнопкой «Править» у вещи.`, 'err');
      if (!confirm(`Удалить персонажа «${c.name}»?`)) return;
      const prev = chars.slice(); chars.splice(i, 1);
      busy(true); status('Удаляю…');
      try {
        await saveMeta('Remove character: ' + c.name);
        if (c.cover) await rmFile(c.cover);
        resetChar(); render(); status('Удалено ✓', 'ok');
      } catch (err) { chars = prev; render(); status(err.message, 'err'); }
      busy(false);
    }
  });

  /* ---------- категории ---------- */
  function renderCats() {
    $('#catlist').innerHTML = cats.length ? cats.map((c, i) => {
      const n = list.filter(e => e.cat === c).length;
      return `<span class="chip">${esc(c)}${n ? `<i>${n}</i>` : ''}<button type="button" data-i="${i}" aria-label="Удалить категорию ${esc(c)}">×</button></span>`;
    }).join('') : '<span class="small">Категорий пока нет. Добавь первую ниже.</span>';
  }
  $('#catform').addEventListener('submit', async e => {
    e.preventDefault();
    const v = $('#cat-new').value.trim();
    if (!v) return;
    if (cats.some(c => c.toLowerCase() === v.toLowerCase())) return status('Такая категория уже есть.', 'err');
    const prev = cats.slice(); cats.push(v);
    busy(true); status('Сохраняю…');
    try { await saveMeta('Add category: ' + v); $('#cat-new').value = ''; render(); status('Категория добавлена ✓', 'ok'); }
    catch (err) { cats = prev; render(); status(err.message, 'err'); }
    busy(false);
  });
  $('#catlist').addEventListener('click', async e => {
    const b = e.target.closest('button'); if (!b) return;
    const i = +b.dataset.i, c = cats[i];
    const n = list.filter(x => x.cat === c).length;
    if (n) return status(`В категории «${c}» есть вещи (${n}). Сначала перенеси или удали их.`, 'err');
    if (!confirm(`Удалить категорию «${c}»?`)) return;
    const prev = cats.slice(); cats.splice(i, 1);
    busy(true); status('Удаляю…');
    try { await saveMeta('Remove category: ' + c); render(); status('Удалено ✓', 'ok'); }
    catch (err) { cats = prev; render(); status(err.message, 'err'); }
    busy(false);
  });

  function resetForm() {
    editing = -1; $('#form').reset();
    picked = []; renderPalette(); seasons.clear(); renderSeasons();
    pics.forEach(p => p.blob && URL.revokeObjectURL(p.preview)); pics = []; renderThumbs();
    $('#form-title').textContent = 'Новая вещь';
    $('#submit').textContent = 'Добавить в гардероб'; $('#cancel').hidden = true;
  }
  $('#cancel').addEventListener('click', () => { resetForm(); status(''); });

  renderPalette(); renderSeasons(); renderHints(); renderSelects(); renderCharPrev();
  /* автовход, если токен уже сохранён */
  if (cfg.owner && cfg.repo && cfg.token) $('#connect').click();
})();
