(() => {
  const C = window.WARDROBE;
  const $ = (s, r = document) => r.querySelector(s);
  const LS = 'wardrobe-admin';
  const FILE = 'wardrobe.json';
  const MULTI = 'linear-gradient(90deg,#e8a0b4,#e6c84a,#8ec3e6,#7b5ea7)';
  let list = [], sha = null, editing = -1;
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
  const errText = async (r, fallback) => { let m = ''; try { m = (await r.json()).message; } catch {} return m || fallback; };

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
    const cats = [...new Set([...C.cats, ...list.map(e => e.cat).filter(Boolean)])];
    $('#cats').innerHTML = cats.map(c => `<option value="${esc(c)}">`).join('');
    const n = {};
    list.forEach(e => (e.tags || []).forEach(t => { n[t] = (n[t] || 0) + 1; }));
    const top = Object.keys(n).sort((a, b) => n[b] - n[a] || a.localeCompare(b, 'ru')).slice(0, 14);
    $('#sug').innerHTML = top.map(t => `<button type="button" data-t="${esc(t)}">${esc(t)}</button>`).join('');
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

  async function load() {
    const r = await api(`${fileApi(FILE)}?ref=${encodeURIComponent(cfg.branch)}&t=${Date.now()}`);
    if (r.status === 404) { list = []; sha = null; return; }
    if (r.status === 401 || r.status === 403) throw new Error('Токен не подходит или у него нет права Contents: Read and write.');
    if (!r.ok) throw new Error('GitHub ответил ошибкой ' + r.status);
    const j = await r.json();
    sha = j.sha;
    const parsed = JSON.parse(fromB64(j.content.replace(/\n/g, '')) || '[]');
    list = Array.isArray(parsed) ? parsed : [];
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
      $('#p-add').hidden = false; $('#p-list').hidden = false;
      render(); status('Вход выполнен ✓', 'ok');
    } catch (e) { status(e.message, 'err'); }
    busy(false);
  });

  /* ---------- сохранение ---------- */
  async function save(message) {
    const body = { message, content: toB64(JSON.stringify(list, null, 2) + '\n'), branch: cfg.branch };
    if (sha) body.sha = sha;
    const r = await api(fileApi(FILE), { method: 'PUT', body: JSON.stringify(body) });
    if (!r.ok) {
      if (r.status === 409 || r.status === 422) throw new Error('Список изменился в другом месте. Нажми «Войти» ещё раз и повтори.');
      throw new Error(await errText(r, 'Не удалось сохранить (' + r.status + ')'));
    }
    sha = (await r.json()).content.sha;
  }

  $('#form').addEventListener('submit', async e => {
    e.preventDefault();
    const was = editing;
    const old = was >= 0 ? list[was] : null;
    const item = {
      id: old ? old.id : Date.now().toString(36),
      name: $('#f-name').value.trim(),
      cat: $('#f-cat').value.trim(),
      colors: picked.slice(),
      seasons: C.seasons.filter(s => seasons.has(s)),
      tags: uniq(splitTags($('#f-tags').value)),
      note: $('#f-note').value.trim(),
      added: (old && old.added) || new Date().toISOString()
    };
    if (!item.name) return status('Нужно название.', 'err');
    if (!item.cat) return status('Выбери или впиши категорию.', 'err');
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
    renderHints();
    $('#n').textContent = list.length ? `(${list.length})` : '';
    $('#list').innerHTML = list.length ? list.map((e, i) => `
      <li>${(e.images || [])[0] ? `<img class="pre" src="${esc(e.images[0])}" alt="" loading="lazy">` : ''}
      <div class="t"><b>${esc(e.name)}</b><span>${esc([e.cat, (e.colors || []).join(', ')].filter(Boolean).join(', '))}</span></div>
      <button type="button" data-a="edit" data-i="${i}">Править</button>
      <button type="button" class="del" data-a="del" data-i="${i}">Удалить</button></li>`).join('')
      : '<li class="none">Пока пусто. Добавь первую вещь выше.</li>';
  }

  $('#list').addEventListener('click', async e => {
    const b = e.target.closest('button'); if (!b) return;
    const i = +b.dataset.i, it = list[i];
    if (b.dataset.a === 'edit') {
      editing = i;
      $('#f-name').value = it.name; $('#f-cat').value = it.cat || ''; $('#f-note').value = it.note || '';
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

  function resetForm() {
    editing = -1; $('#form').reset();
    picked = []; renderPalette(); seasons.clear(); renderSeasons();
    pics.forEach(p => p.blob && URL.revokeObjectURL(p.preview)); pics = []; renderThumbs();
    $('#form-title').textContent = 'Новая вещь';
    $('#submit').textContent = 'Добавить в гардероб'; $('#cancel').hidden = true;
  }
  $('#cancel').addEventListener('click', () => { resetForm(); status(''); });

  renderPalette(); renderSeasons(); renderHints();
  /* автовход, если токен уже сохранён */
  if (cfg.owner && cfg.repo && cfg.token) $('#connect').click();
})();
