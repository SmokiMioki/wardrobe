/* Четвёртый стиль: «ICQ 2009». Слева контакт-лист (общий чат и персонажи), справа окно сообщений.
   Переписка — это та же стена из wall.js, только показанная как чат: сюда она переезжает на время стиля.
   Звук «ой-ой» и конвертик у непрочитанных. Новые сообщения подтягиваются раз в 20 секунд
   (сайт обновляется с задержкой около минуты, это ограничение GitHub Pages). */
(() => {
  const root = document.documentElement;
  const shell = document.getElementById('icq');
  const wallEl = document.getElementById('wall');
  if (!shell || !wallEl || !window.WallUI) return;

  const GENERAL = '_none';   // общий чат: сообщения «без персонажа»
  const LS_SEEN = 'wardrobe-icq-seen', LS_LAST = 'wardrobe-icq-chat', LS_SND = 'wardrobe-icq-sound', LS_NAME = 'wardrobe-wall-name';
  const wallHome = wallEl.parentNode;
  const baseTitle = document.title;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
  };

  let chars = [], cur = null, active = false, built = false, timer = 0, loaded = false;
  let seen = store.get(LS_SEEN, null);   // персонаж → время последнего прочитанного сообщения
  const known = new Set();               // номера сообщений, о которых уже знаем (для звука)
  let knownReady = false;

  /* ---------- значки ---------- */
  const flower = c => '<svg class="icq-fl" viewBox="0 0 16 16" aria-hidden="true"><g fill="' + c + '" stroke="#000" stroke-opacity=".3" stroke-width=".6">'
    + [0, 72, 144, 216, 288].map(a => '<ellipse cx="8" cy="4.3" rx="2.5" ry="3.3" transform="rotate(' + a + ' 8 8)"/>').join('')
    + '</g><circle cx="8" cy="8" r="1.9" fill="#ffe34a" stroke="#000" stroke-opacity=".25" stroke-width=".5"/></svg>';
  const ENV = '<svg class="icq-env" viewBox="0 0 16 16" aria-hidden="true"><rect x="1.5" y="3.5" width="13" height="9" rx="1" fill="#fff" stroke="#6b7b8c"/><path d="M2 4.5l6 4.6 6-4.6" fill="none" stroke="#6b7b8c"/></svg>';
  const GREEN = '#52b83a';

  /* ---------- непрочитанное ---------- */
  const items = () => WallUI.remote() || [];
  const mineItem = (id, author) => WallUI.isMine(id, author);
  function latest(id) {
    let m = '';
    for (const p of items()) {
      if (p.char !== id) continue;
      if ((p.ts || '') > m) m = p.ts;
      for (const r of p.replies || []) if ((r.ts || '') > m) m = r.ts;
    }
    return m;
  }
  function unread(id) {
    const s = (seen && seen[id]) || '';
    let n = 0;
    for (const p of items()) {
      if (p.char !== id) continue;
      if ((p.ts || '') > s && !mineItem(p.id, p.author)) n++;
      for (const r of p.replies || []) if ((r.ts || '') > s && !mineItem(r.id, r.author)) n++;
    }
    return n;
  }
  function markSeen(id) {
    if (!id) return;
    seen = seen || {};
    seen[id] = latest(id);
    store.set(LS_SEEN, seen);
  }
  const contacts = () => [{ id: GENERAL, name: 'Общий чат', general: true }, ...chars];
  const totalUnread = () => contacts().reduce((n, c) => n + (c.id === cur && !document.hidden ? 0 : unread(c.id)), 0);

  /* ---------- звук «ой-ой» ---------- */
  let ac = null;
  const sndOn = () => store.get(LS_SND, true) !== false;
  const ctx = () => { try { ac = ac || new (window.AudioContext || window.webkitAudioContext)(); if (ac.state === 'suspended') ac.resume(); } catch {} return ac; };
  function uhoh() {
    if (!sndOn() || !ctx()) return;
    try {
      const t = ac.currentTime;
      [[740, 0, .12], [554, .14, .22]].forEach(([f, s, d]) => {
        const o = ac.createOscillator(), g = ac.createGain();
        o.type = 'triangle'; o.frequency.value = f;
        g.gain.setValueAtTime(0, t + s); g.gain.linearRampToValueAtTime(.2, t + s + .015); g.gain.exponentialRampToValueAtTime(.001, t + s + d);
        o.connect(g); g.connect(ac.destination); o.start(t + s); o.stop(t + s + d + .03);
      });
    } catch {}
  }
  document.addEventListener('pointerdown', () => { if (active && !ac) ctx(); });   // браузер разрешает звук только после касания

  /* ---------- оболочка ---------- */
  const q = s => shell.querySelector(s);
  function build() {
    if (built) return; built = true;
    shell.innerHTML = `
      <div class="icq-win icq-cl">
        <div class="icq-tb"><span class="icq-tt">${flower('#fff')}<b>ICQ</b></span><span class="icq-wb" aria-hidden="true"><i>–</i><i>□</i><i>×</i></span></div>
        <div class="icq-me">${flower(GREEN)}<div class="icq-mi"><b class="icq-nick"></b><small>В сети</small></div><button type="button" class="icq-snd" aria-label="Звук"></button></div>
        <div class="icq-cts" id="icq-cts"></div>
        <div class="icq-foot"><span>${flower(GREEN)}</span><small>Новые сообщения подтягиваются сами</small></div>
      </div>
      <div class="icq-win icq-ch">
        <div class="icq-tb"><button type="button" class="icq-back">‹ Контакты</button><span class="icq-tt"><b id="icq-title"></b></span><span class="icq-wb" aria-hidden="true"><i>–</i><i>□</i><i>×</i></span></div>
        <div class="icq-chat" id="icq-chat"></div>
      </div>`;
    q('#icq-chat').appendChild(wallEl);
    q('.icq-back').addEventListener('click', () => { shell.dataset.pane = 'list'; });
    q('.icq-snd').addEventListener('click', () => { store.set(LS_SND, !sndOn()); drawSound(); if (sndOn()) uhoh(); });
    q('#icq-cts').addEventListener('click', e => { const b = e.target.closest('[data-id]'); if (b) open(b.dataset.id); });
    drawSound(); drawNick();
  }
  const drawSound = () => { const b = q('.icq-snd'); if (!b) return; b.textContent = sndOn() ? 'Звук: вкл' : 'Звук: выкл'; b.setAttribute('aria-pressed', String(sndOn())); };
  const drawNick = v => { const n = q('.icq-nick'); if (n) n.textContent = (v != null ? String(v).trim() : String(store.get(LS_NAME, '') || '').trim()) || 'Гость'; };

  function drawContacts() {
    const box = q('#icq-cts'); if (!box) return;
    const row = c => {
      const n = c.id === cur && !document.hidden ? 0 : unread(c.id);
      return `<button type="button" class="icq-ct${c.id === cur ? ' on' : ''}${n ? ' new' : ''}" data-id="${esc(c.id)}"${c.id === cur ? ' aria-current="true"' : ''}>${n ? ENV : flower(c.general ? '#3d8fe0' : GREEN)}<span class="icq-cn">${esc(c.name)}</span>${n ? `<span class="icq-un">${n}</span>` : ''}</button>`;
    };
    box.innerHTML = `<p class="icq-gh">Общее</p>${row(contacts()[0])}<p class="icq-gh">Контакты в сети (${chars.length}/${chars.length})</p>${chars.map(row).join('') || '<p class="icq-none">Контактов пока нет</p>'}`;
    const t = totalUnread();
    document.title = t ? `(${t}) ICQ` : 'ICQ';
  }

  async function open(id, stay) {
    cur = id; store.set(LS_LAST, id);
    const c = contacts().find(x => x.id === id) || contacts()[0];
    q('#icq-title').textContent = c.general ? 'Общий чат' : 'Сообщения: ' + c.name;
    if (!stay) shell.dataset.pane = 'chat';
    drawContacts();
    await WallUI.show(c.id);
    if (cur !== c.id) return;
    markSeen(c.id); drawContacts();
  }

  /* ---------- обновления ---------- */
  function onUpdate() {
    if (!active) return;
    const all = [];
    for (const p of items()) { all.push([p.id, p.author]); for (const r of p.replies || []) all.push([r.id, r.author]); }
    if (seen === null) { seen = {}; contacts().forEach(c => { seen[c.id] = latest(c.id); }); store.set(LS_SEEN, seen); }   // первый запуск: старое считаем прочитанным
    const fresh = all.filter(([id]) => !known.has(id));
    all.forEach(([id]) => known.add(id));
    if (knownReady && fresh.some(([id, au]) => !mineItem(id, au))) uhoh();
    if (items().length || loaded) knownReady = true;
    if (cur && !document.hidden) markSeen(cur);
    drawContacts();
  }
  addEventListener('wall-updated', onUpdate);
  wallEl.addEventListener('input', e => { if (active && e.target.matches('.w-name')) drawNick(e.target.value); });
  document.addEventListener('visibilitychange', () => {
    if (!active) return;
    if (!document.hidden) { markSeen(cur); drawContacts(); WallUI.poll(); } else drawContacts();
  });

  /* ---------- включение и выключение стиля ---------- */
  async function loadChars() {
    if (loaded) return;
    try {
      const r = await fetch('characters.json?t=' + Date.now(), { cache: 'no-store' });
      const d = r.ok ? await r.json() : null;
      chars = d && Array.isArray(d.characters) ? d.characters.filter(c => c && c.id && c.id !== GENERAL) : [];
    } catch { chars = []; }
    loaded = true;
  }
  const hashChar = () => { try { return decodeURIComponent(location.hash.slice(1)).split('/')[0]; } catch { return ''; } };

  async function apply() {
    const on = root.dataset.style === 'icq';
    if (on === active) return;
    active = on;
    if (on) {
      shell.hidden = false; build();
      document.title = 'ICQ';
      await loadChars();
      if (!active) return;
      const last = store.get(LS_LAST, GENERAL);
      shell.dataset.pane = 'list';
      await open(contacts().some(c => c.id === last) ? last : GENERAL, true);
      if (!active) return;
      onUpdate();
      clearInterval(timer);
      timer = setInterval(() => { if (!document.hidden) WallUI.poll(); }, 20000);
    } else {
      clearInterval(timer);
      shell.hidden = true;
      wallHome.appendChild(wallEl);   // стена возвращается на страницу персонажа
      built = false; shell.innerHTML = '';
      document.title = baseTitle;
      const cid = hashChar();
      if (cid && (cid === GENERAL || chars.some(c => c.id === cid))) WallUI.show(cid); else WallUI.hide();
    }
  }
  addEventListener('wardrobe-style', apply);
  apply();
})();
