/* Стена персонажа в стиле «ВКонтакте» 2010: записи, комментарии, граффити.
   Общие записи лежат в wall.json в репозитории. Публиковать в него может тот, у кого на этом устройстве
   сохранён вход в админку (токен). У остальных записи остаются в браузере, их видит только автор. */
(() => {
  const root = document.documentElement;
  const el = document.getElementById('wall');
  if (!el) return;

  const LS_ADMIN = 'wardrobe-admin', LS_LOCAL = 'wardrobe-wall-local', LS_NAME = 'wardrobe-wall-name';
  const FILE = 'wall.json';
  const $ = (s, r = el) => r.querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const vk = () => root.dataset.style === 'vk';
  const pl = (n, [a, b, c]) => { const x = n % 10, y = n % 100; return x === 1 && y !== 11 ? a : x >= 2 && x <= 4 && (y < 12 || y > 14) ? b : c; };
  const safeImg = s => /^img\/[\w.-]+$/.test(s || '') || /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(s || '') ? s : '';
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 5);

  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } }
  };
  const local = () => { const l = store.get(LS_LOCAL, null); return { posts: Array.isArray(l && l.posts) ? l.posts : [], replies: Array.isArray(l && l.replies) ? l.replies : [] }; };
  const admin = () => { const c = store.get(LS_ADMIN, {}); return c && c.owner && c.repo && c.token ? c : null; };

  /* ---------- GitHub ---------- */
  const toB64 = s => { const b = new TextEncoder().encode(s); let t = ''; b.forEach(x => t += String.fromCharCode(x)); return btoa(t); };
  const fromB64 = s => new TextDecoder().decode(Uint8Array.from(atob(s), c => c.charCodeAt(0)));
  const blobB64 = b => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(b); });
  const gh = (c, path, opt = {}) => fetch('https://api.github.com' + path, { ...opt, headers: { Accept: 'application/vnd.github+json', 'Content-Type': 'application/json', Authorization: 'Bearer ' + c.token } });
  const fileApi = (c, p) => `/repos/${c.owner}/${c.repo}/contents/${p.split('/').map(encodeURIComponent).join('/')}`;
  const fail = async (r, what) => {
    let m = ''; try { m = (await r.json()).message || ''; } catch {}
    const e = new Error(r.status === 401 || r.status === 403 ? 'Токен не подходит или у него нет права Contents: Read and write.' : `${what} (${r.status}${m ? ': ' + m : ''})`);
    e.status = r.status; return e;
  };
  async function ghRead(c) {
    const r = await gh(c, `${fileApi(c, FILE)}?ref=${encodeURIComponent(c.branch || 'main')}&t=${Date.now()}`);
    if (r.status === 404) return { data: [], sha: null };
    if (!r.ok) throw await fail(r, 'Стена не открылась');
    const j = await r.json();
    const d = JSON.parse(fromB64(j.content.replace(/\n/g, '')) || '[]');
    return { data: Array.isArray(d) ? d : [], sha: j.sha };
  }
  async function ghWrite(c, arr, sha, message) {
    const body = { message, content: toB64(JSON.stringify(arr, null, 2) + '\n'), branch: c.branch || 'main' };
    if (sha) body.sha = sha;
    const r = await gh(c, fileApi(c, FILE), { method: 'PUT', body: JSON.stringify(body) });
    if (!r.ok) throw await fail(r, 'Не удалось сохранить');
    return (await r.json()).content.sha;
  }
  /* свежий wall.json → правка → запись; при конфликте одна повторная попытка */
  async function mutate(fn, message) {
    const c = admin();
    for (let t = 0; ; t++) {
      const cur = await ghRead(c);
      const next = fn(cur.data);
      try { return { data: next, sha: await ghWrite(c, next, cur.sha, message) }; }
      catch (e) { if (t === 0 && (e.status === 409 || e.status === 422)) continue; throw e; }
    }
  }
  async function putImage(blob, id) {
    const c = admin(), path = `img/wall-${id}.png`;
    const r = await gh(c, fileApi(c, path), { method: 'PUT', body: JSON.stringify({ message: 'Граффити на стене', content: await blobB64(blob), branch: c.branch || 'main' }) });
    if (!r.ok) throw await fail(r, 'Граффити не загрузилось');
    return path;
  }
  async function rmImage(path) {
    if (!/^img\/wall-[\w.-]+$/.test(path || '')) return;
    const c = admin();
    try {
      const g = await gh(c, `${fileApi(c, path)}?ref=${encodeURIComponent(c.branch || 'main')}&t=${Date.now()}`);
      if (!g.ok) return;
      await gh(c, fileApi(c, path), { method: 'DELETE', body: JSON.stringify({ message: 'Удалено граффити', sha: (await g.json()).sha, branch: c.branch || 'main' }) });
    } catch {}
  }

  /* ---------- состояние ---------- */
  let cur = null;          // персонаж, чья стена открыта
  let remote = null;       // записи из репозитория (null = ещё не загружены)
  let built = false;
  let busy = false;
  const draft = { blob: null, url: '' };

  async function load() {
    try {
      const r = await fetch(FILE + '?t=' + Date.now(), { cache: 'no-store' });
      const d = r.ok ? await r.json() : [];
      remote = Array.isArray(d) ? d.filter(p => p && p.id && p.char) : [];
    } catch { remote = []; }
  }

  /* записи этого персонажа: из репозитория и из браузера, новые сверху */
  function posts() {
    const l = local();
    const rep = id => l.replies.filter(r => r.post === id).map(r => ({ ...r, local: true }));
    return [
      ...(remote || []).filter(p => p.char === cur).map(p => ({ ...p, replies: [...(Array.isArray(p.replies) ? p.replies : []), ...rep(p.id)] })),
      ...l.posts.filter(p => p.char === cur).map(p => ({ ...p, local: true, replies: rep(p.id) }))
    ].sort((a, b) => String(b.ts).localeCompare(String(a.ts)));
  }

  /* ---------- вид ---------- */
  const when = iso => {
    try { return new Date(iso).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).replace(', ', ' в '); } catch { return ''; }
  };
  const hue = s => { let h = 0; for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) % 360; return h; };
  const ava = name => `<span class="w-ava" style="background:hsl(${hue(name)} 32% 52%)">${esc(String(name || '?').charAt(0).toUpperCase())}</span>`;
  const canDel = p => p.local || !!admin();

  function replyHtml(p, r) {
    return `<div class="w-rp">${ava(r.author)}<div class="w-body"><b class="w-au">${esc(r.author)}</b> <span class="w-tx">${esc(r.text)}</span>
      <div class="w-meta"><span>${esc(when(r.ts))}</span>${canDel(r) ? `<button type="button" class="w-lnk" data-a="rdel" data-p="${esc(p.id)}" data-r="${esc(r.id)}">Удалить</button>` : ''}</div></div></div>`;
  }
  function postHtml(p) {
    const img = safeImg(p.img);
    const reps = Array.isArray(p.replies) ? p.replies : [];
    return `<article class="w-post" data-id="${esc(p.id)}">${ava(p.author)}<div class="w-body">
      <b class="w-au">${esc(p.author)}</b>${p.local ? ' <i class="w-loc" title="Эту запись видно только в этом браузере">видно только тебе</i>' : ''}
      ${p.text ? `<div class="w-tx">${esc(p.text)}</div>` : ''}
      ${img ? `<img class="w-img" src="${esc(img)}" alt="Граффити" loading="lazy">` : ''}
      <div class="w-meta"><span>${esc(when(p.ts))}</span><button type="button" class="w-lnk" data-a="reply">Комментировать</button>${canDel(p) ? '<button type="button" class="w-lnk" data-a="del">Удалить</button>' : ''}</div>
      ${reps.length ? `<div class="w-reps">${reps.map(r => replyHtml(p, r)).join('')}</div>` : ''}
      <div class="w-rf" hidden><input maxlength="300" placeholder="Написать комментарий…"><button type="button" class="w-btn" data-a="rsend">Отправить</button></div>
    </div></article>`;
  }
  function renderList() {
    const list = posts();
    $('.w-count').textContent = list.length ? `${list.length} ${pl(list.length, ['запись', 'записи', 'записей'])}` : '';
    $('.w-list').innerHTML = list.length ? list.map(postHtml).join('') : '<p class="w-empty">На стене пока ничего нет. Напиши первым или нарисуй граффити.</p>';
    $('.w-where').textContent = admin() ? 'Запись увидят все' : 'Запись останется только в этом браузере';
  }

  const COLORS = ['#000000', '#8d8d8d', '#ffffff', '#e64646', '#ff9a2e', '#ffd52e', '#3fb04a', '#29b6c6', '#2f6fd6', '#8b4fc8', '#ff6fae', '#8a5a36'];
  function build() {
    if (built) return; built = true;
    el.innerHTML = `
      <h3 class="w-h">Стена <span class="w-count"></span></h3>
      <div class="w-form">
        <input class="w-name" maxlength="30" placeholder="Ваше имя" value="${esc(store.get(LS_NAME, ''))}" aria-label="Ваше имя">
        <textarea class="w-text" maxlength="1000" rows="2" placeholder="Написать на стене…" aria-label="Запись"></textarea>
        <div class="w-att" hidden><img alt="Граффити"><button type="button" class="w-lnk" data-a="unatt">Убрать</button></div>
        <div class="gf" hidden>
          <div class="gf-tools">
            <span class="gf-grp" data-g="tool">
              <button type="button" data-t="pencil" title="Карандаш">Карандаш</button><button type="button" data-t="marker" class="on" title="Маркер">Маркер</button><button type="button" data-t="spray" title="Баллончик">Баллончик</button><button type="button" data-t="eraser" title="Ластик">Ластик</button>
            </span>
            <span class="gf-grp" data-g="size">
              <button type="button" data-s="3" title="Тонко">•</button><button type="button" data-s="8" class="on" title="Средне">●</button><button type="button" data-s="18" title="Толсто">⬤</button>
            </span>
            <span class="gf-grp gf-colors" data-g="color">${COLORS.map((c, i) => `<button type="button" data-c="${c}" class="${i ? '' : 'on'}" style="background:${c}" aria-label="Цвет ${c}"></button>`).join('')}</span>
            <span class="gf-grp"><button type="button" data-a="gundo">Отменить</button><button type="button" data-a="gclear">Очистить</button></span>
          </div>
          <canvas class="gf-cv" width="800" height="340"></canvas>
          <div class="gf-foot"><button type="button" class="w-btn" data-a="gattach">Прикрепить граффити</button><button type="button" class="w-lnk" data-a="gclose">Закрыть</button></div>
        </div>
        <div class="w-bar"><button type="button" class="w-btn" data-a="send">Отправить</button><button type="button" class="w-lnk" data-a="graffiti">Нарисовать граффити</button><span class="w-where"></span></div>
        <p class="w-msg" role="status" hidden></p>
      </div>
      <div class="w-list"></div>`;
    initGraffiti();
  }
  const msg = (t, bad) => { const m = $('.w-msg'); m.textContent = t || ''; m.hidden = !t; m.classList.toggle('bad', !!bad); };

  /* ---------- граффити ---------- */
  const cv = () => $('.gf-cv');
  const gf = { tool: 'marker', size: 8, color: '#000000', down: false, last: null, dirty: false, undo: [] };
  function initGraffiti() {
    const c = cv(), ctx = c.getContext('2d', { willReadFrequently: true });
    const wipe = () => { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); };
    wipe();
    const pos = e => { const r = c.getBoundingClientRect(), k = c.width / r.width; return { x: (e.clientX - r.left) * k, y: (e.clientY - r.top) * k, k }; };
    const spray = (x, y, k) => {
      ctx.fillStyle = gf.color;
      const w = gf.size * k, n = Math.round(w * 1.2) + 8;
      for (let i = 0; i < n; i++) { const a = Math.random() * 6.2832, r = Math.sqrt(Math.random()) * w * 1.6; ctx.fillRect(x + Math.cos(a) * r, y + Math.sin(a) * r, 1.5 * k, 1.5 * k); }
    };
    const width = k => gf.size * k * (gf.tool === 'pencil' ? .45 : gf.tool === 'eraser' ? 2.4 : 1);
    const dot = p => {
      if (gf.tool === 'spray') return spray(p.x, p.y, p.k);
      ctx.fillStyle = gf.tool === 'eraser' ? '#fff' : gf.color;
      ctx.beginPath(); ctx.arc(p.x, p.y, width(p.k) / 2, 0, 6.2832); ctx.fill();
    };
    const line = (a, b) => {
      if (gf.tool === 'spray') {
        const d = Math.hypot(b.x - a.x, b.y - a.y), steps = Math.max(1, Math.ceil(d / (gf.size * b.k * .35)));
        for (let i = 1; i <= steps; i++) spray(a.x + (b.x - a.x) * i / steps, a.y + (b.y - a.y) * i / steps, b.k);
        return;
      }
      ctx.strokeStyle = gf.tool === 'eraser' ? '#fff' : gf.color;
      ctx.lineWidth = width(b.k); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    };
    c.addEventListener('pointerdown', e => {
      e.preventDefault(); c.setPointerCapture(e.pointerId);
      gf.undo.push(ctx.getImageData(0, 0, c.width, c.height)); if (gf.undo.length > 15) gf.undo.shift();
      gf.down = true; gf.last = pos(e); dot(gf.last); gf.dirty = true;
    });
    c.addEventListener('pointermove', e => { if (!gf.down) return; const p = pos(e); line(gf.last, p); gf.last = p; });
    const stop = () => { gf.down = false; };
    c.addEventListener('pointerup', stop); c.addEventListener('pointercancel', stop);
    c._wipe = () => { gf.undo.push(ctx.getImageData(0, 0, c.width, c.height)); wipe(); gf.dirty = false; };
    c._undo = () => { const s = gf.undo.pop(); if (s) ctx.putImageData(s, 0, 0); };
  }
  const pick = (grp, btn) => { grp.querySelectorAll('button').forEach(b => b.classList.toggle('on', b === btn)); };

  function attach() {
    const c = cv();
    if (!gf.dirty) { msg('Сначала нарисуй что-нибудь.', true); return; }
    c.toBlob(b => {
      if (draft.url) URL.revokeObjectURL(draft.url);
      draft.blob = b; draft.url = URL.createObjectURL(b);
      $('.w-att img').src = draft.url; $('.w-att').hidden = false; $('.gf').hidden = true; msg('');
    }, 'image/png');
  }
  function unattach() {
    if (draft.url) URL.revokeObjectURL(draft.url);
    draft.blob = null; draft.url = ''; $('.w-att').hidden = true;
  }
  const dataUrl = b => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(b); });

  /* ---------- действия ---------- */
  const who = () => { const n = ($('.w-name').value.trim() || 'Гость').slice(0, 30); store.set(LS_NAME, n === 'Гость' ? '' : n); return n; };
  const lock = on => { busy = on; el.querySelectorAll('button').forEach(b => { b.disabled = on; }); };

  async function send() {
    const text = $('.w-text').value.trim();
    if (!text && !draft.blob) return msg('Напиши что-нибудь или нарисуй граффити.', true);
    const post = { id: uid(), char: cur, author: who(), text, ts: new Date().toISOString() };
    lock(true); msg('Отправляю…');
    try {
      if (admin()) {
        if (draft.blob) post.img = await putImage(draft.blob, post.id);
        const r = await mutate(arr => [post, ...arr], 'Стена: новая запись');
        remote = r.data.filter(p => p && p.id && p.char);
      } else {
        if (draft.blob) post.img = await dataUrl(draft.blob);
        const l = local(); l.posts.unshift(post);
        if (!store.set(LS_LOCAL, l)) throw new Error('В браузере не хватило места. Попробуй рисунок попроще.');
      }
      $('.w-text').value = ''; unattach(); cv()._wipe(); gf.undo.length = 0;
      renderList(); msg(admin() ? 'Опубликовано. Остальные увидят запись примерно через минуту.' : 'Запись добавлена на твою стену.');
    } catch (e) { msg(e.message, true); }
    lock(false);
  }

  async function reply(postId, text) {
    const post = posts().find(p => p.id === postId);
    if (!post || !text) return;
    const r = { id: uid(), author: who(), text: text.slice(0, 300), ts: new Date().toISOString() };
    lock(true); msg('');
    try {
      if (admin() && !post.local) {
        const res = await mutate(arr => arr.map(p => p.id === postId ? { ...p, replies: [...(Array.isArray(p.replies) ? p.replies : []), r] } : p), 'Стена: комментарий');
        remote = res.data.filter(p => p && p.id && p.char);
      } else {
        const l = local(); l.replies.push({ ...r, post: postId });
        if (!store.set(LS_LOCAL, l)) throw new Error('В браузере не хватило места.');
      }
      renderList();
    } catch (e) { msg(e.message, true); }
    lock(false);
  }

  async function removePost(postId) {
    const post = posts().find(p => p.id === postId); if (!post) return;
    if (!confirm('Удалить запись?')) return;
    lock(true); msg('');
    try {
      if (post.local) {
        const l = local(); l.posts = l.posts.filter(p => p.id !== postId); l.replies = l.replies.filter(r => r.post !== postId); store.set(LS_LOCAL, l);
      } else {
        const res = await mutate(arr => arr.filter(p => p.id !== postId), 'Стена: запись удалена');
        remote = res.data.filter(p => p && p.id && p.char);
        rmImage(post.img);
      }
      renderList();
    } catch (e) { msg(e.message, true); }
    lock(false);
  }
  async function removeReply(postId, rid) {
    const post = posts().find(p => p.id === postId); if (!post) return;
    const rp = (post.replies || []).find(r => r.id === rid); if (!rp || !confirm('Удалить комментарий?')) return;
    lock(true); msg('');
    try {
      if (rp.local) { const l = local(); l.replies = l.replies.filter(r => r.id !== rid); store.set(LS_LOCAL, l); }
      else {
        const res = await mutate(arr => arr.map(p => p.id === postId ? { ...p, replies: (p.replies || []).filter(r => r.id !== rid) } : p), 'Стена: комментарий удалён');
        remote = res.data.filter(p => p && p.id && p.char);
      }
      renderList();
    } catch (e) { msg(e.message, true); }
    lock(false);
  }

  /* ---------- события ---------- */
  el.addEventListener('click', e => {
    if (busy) return;
    const t = e.target.closest('button'); if (!t) return;
    const c = cv();
    if (t.dataset.t) { gf.tool = t.dataset.t; return pick(t.parentNode, t); }
    if (t.dataset.s) { gf.size = +t.dataset.s; return pick(t.parentNode, t); }
    if (t.dataset.c) { gf.color = t.dataset.c; if (gf.tool === 'eraser') { gf.tool = 'marker'; pick($('[data-g="tool"]'), $('[data-t="marker"]')); } return pick(t.parentNode, t); }
    switch (t.dataset.a) {
      case 'graffiti': $('.gf').hidden = !$('.gf').hidden; break;
      case 'gclose': $('.gf').hidden = true; break;
      case 'gundo': c._undo(); break;
      case 'gclear': c._wipe(); break;
      case 'gattach': attach(); break;
      case 'unatt': unattach(); break;
      case 'send': send(); break;
      case 'reply': { const f = t.closest('.w-body').querySelector('.w-rf'); f.hidden = !f.hidden; if (!f.hidden) f.querySelector('input').focus(); break; }
      case 'rsend': { const f = t.closest('.w-rf'); reply(t.closest('.w-post').dataset.id, f.querySelector('input').value.trim()); break; }
      case 'del': removePost(t.closest('.w-post').dataset.id); break;
      case 'rdel': removeReply(t.dataset.p, t.dataset.r); break;
    }
  });
  el.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.matches('.w-rf input')) { e.preventDefault(); e.target.nextElementSibling.click(); }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && e.target.matches('.w-text')) { e.preventDefault(); send(); }
  });

  /* ---------- вход и выход ---------- */
  async function show(id) {
    const same = cur === id && built && remote !== null;   // фильтры и поиск не должны стирать набранное
    cur = id; el.hidden = false;
    if (!vk() || same) return;
    build();
    if (remote === null) { renderList(); await load(); }
    if (cur === id) renderList();
  }
  function hide() { cur = null; el.hidden = true; }
  window.WallUI = { show, hide };
  addEventListener('wardrobe-style', () => { if (cur && vk()) show(cur); });
})();
