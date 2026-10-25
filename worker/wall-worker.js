/* Посредник для стены «Гардероба» (Cloudflare Workers).
   Принимает записи и комментарии от гостей сайта и сам коммитит их в репозиторий:
   записи и комментарии → wall.json, граффити → папка wall/.
   Токен GitHub хранится только здесь (секрет воркера) и на сайт не попадает.

   Переменные воркера (Settings → Variables and Secrets):
     GITHUB_TOKEN   секрет, fine-grained токен с правом Contents: Read and write на этот репозиторий
     GITHUB_REPO    например SmokiMioki/wardrobe
     GITHUB_BRANCH  например main
     ALLOWED_ORIGIN адрес сайта, например https://smokimioki.github.io (можно несколько через запятую)
*/

const FILE = 'wall.json';
const MAX_BODY = 600_000;          // байт на весь запрос
const MAX_IMG = 400_000;           // байт на одно граффити
const LIMIT = { count: 10, windowMs: 10 * 60 * 1000 };   // не больше 10 отправок за 10 минут с одного адреса
const hits = new Map();            // память воркера; для защиты от случайного спама хватает

const clean = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, n);
const okId = s => typeof s === 'string' && /^[a-z0-9]{6,24}$/.test(s);

const toB64 = s => { const b = new TextEncoder().encode(s); let t = ''; b.forEach(x => t += String.fromCharCode(x)); return btoa(t); };
const fromB64 = s => new TextDecoder().decode(Uint8Array.from(atob(s), c => c.charCodeAt(0)));

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }

export default {
  async fetch(req, env) {
    const origin = req.headers.get('Origin') || '';
    const allowed = String(env.ALLOWED_ORIGIN || '').split(',').map(s => s.trim()).filter(Boolean);
    const originOk = !allowed.length || allowed.includes(origin);
    const cors = {
      'Access-Control-Allow-Origin': originOk && origin ? origin : (allowed[0] || '*'),
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin'
    };
    const reply = (status, obj) => new Response(JSON.stringify(obj), { status, headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' } });

    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (req.method !== 'POST') return reply(405, { ok: false, error: 'Только POST.' });
    if (!originOk) return reply(403, { ok: false, error: 'Этот сайт не разрешён.' });
    if (!env.GITHUB_TOKEN || !env.GITHUB_REPO) return reply(500, { ok: false, error: 'Воркер не настроен: нет GITHUB_TOKEN или GITHUB_REPO.' });

    try {
      /* ограничение частоты */
      const ip = req.headers.get('CF-Connecting-IP') || 'unknown', now = Date.now();
      const list = (hits.get(ip) || []).filter(t => now - t < LIMIT.windowMs);
      if (list.length >= LIMIT.count) throw new HttpError(429, 'Слишком часто. Попробуй чуть позже.');
      list.push(now); hits.set(ip, list);
      if (hits.size > 2000) hits.clear();

      const len = +req.headers.get('Content-Length') || 0;
      if (len > MAX_BODY) throw new HttpError(413, 'Слишком большой запрос.');
      const raw = await req.text();
      if (raw.length > MAX_BODY) throw new HttpError(413, 'Слишком большой запрос.');
      let d; try { d = JSON.parse(raw); } catch { throw new HttpError(400, 'Не разобрать запрос.'); }
      if (d && d.website) return reply(200, { ok: true });   // «приманка» для ботов: настоящее поле всегда пустое

      const gh = makeGithub(env);
      if (d.type === 'post') return reply(200, await addPost(gh, d));
      if (d.type === 'reply') return reply(200, await addReply(gh, d));
      throw new HttpError(400, 'Неизвестное действие.');
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 502;
      return reply(status, { ok: false, error: e instanceof HttpError ? e.message : 'GitHub не ответил: ' + (e.message || e) });
    }
  }
};

/* ---------- действия ---------- */
async function addPost(gh, d) {
  if (!okId(d.id)) throw new HttpError(400, 'Плохой номер записи.');
  const text = clean(d.text, 1000), author = clean(d.author, 30) || 'Гость';
  if (!text && !d.img) throw new HttpError(400, 'Пустая запись.');
  await checkChar(gh, d.char);

  const post = { id: d.id, char: d.char, author, text, ts: new Date().toISOString() };
  if (d.img) {
    const bytes = pngBytes(d.img);
    post.img = `wall/${d.id}.png`;
    await gh.putFile(post.img, bytes, 'Стена: граффити от гостя');
  }
  await gh.mutate(arr => {
    if (arr.some(p => p && p.id === post.id)) throw new HttpError(409, 'Такая запись уже есть.');
    return [post, ...arr];
  }, 'Стена: запись от гостя');
  return { ok: true, id: post.id };
}

async function addReply(gh, d) {
  if (!okId(d.id) || !okId(d.post)) throw new HttpError(400, 'Плохой номер.');
  const text = clean(d.text, 300), author = clean(d.author, 30) || 'Гость';
  if (!text) throw new HttpError(400, 'Пустой комментарий.');
  const r = { id: d.id, author, text, ts: new Date().toISOString() };
  await gh.mutate(arr => {
    const p = arr.find(x => x && x.id === d.post);
    if (!p) throw new HttpError(404, 'Записи уже нет.');
    p.replies = Array.isArray(p.replies) ? p.replies : [];
    if (p.replies.some(x => x && x.id === r.id)) throw new HttpError(409, 'Такой комментарий уже есть.');
    p.replies.push(r);
    return arr;
  }, 'Стена: комментарий от гостя');
  return { ok: true, id: r.id };
}

/* PNG из base64: проверяем размер и подпись файла, чтобы в репозиторий не попало ничего другого */
function pngBytes(b64) {
  if (typeof b64 !== 'string' || !/^[A-Za-z0-9+/]+=*$/.test(b64)) throw new HttpError(400, 'Плохая картинка.');
  let bin; try { bin = atob(b64); } catch { throw new HttpError(400, 'Плохая картинка.'); }
  if (bin.length > MAX_IMG) throw new HttpError(413, 'Граффити слишком тяжёлое. Нарисуй попроще.');
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bin.length < 16 || sig.some((v, i) => bin.charCodeAt(i) !== v)) throw new HttpError(400, 'Нужен PNG.');
  return b64;   // в GitHub файл тоже уходит как base64
}

async function checkChar(gh, id) {
  if (id === '_none') return;
  if (typeof id !== 'string' || !id || id.length > 64) throw new HttpError(400, 'Неизвестный персонаж.');
  const f = await gh.readJson('characters.json', null);
  const list = f && Array.isArray(f.data && f.data.characters) ? f.data.characters : [];
  if (!list.some(c => c && c.id === id)) throw new HttpError(400, 'Неизвестный персонаж.');
}

/* ---------- GitHub ---------- */
function makeGithub(env) {
  const repo = env.GITHUB_REPO, branch = env.GITHUB_BRANCH || 'main';
  const call = (path, opt = {}) => fetch('https://api.github.com' + path, {
    ...opt,
    headers: {
      Accept: 'application/vnd.github+json', 'Content-Type': 'application/json',
      Authorization: 'Bearer ' + env.GITHUB_TOKEN, 'User-Agent': 'wardrobe-wall-worker', 'X-GitHub-Api-Version': '2022-11-28'
    }
  });
  const api = p => `/repos/${repo}/contents/${p.split('/').map(encodeURIComponent).join('/')}`;

  async function readJson(file, fallback) {
    const r = await call(`${api(file)}?ref=${encodeURIComponent(branch)}`);
    if (r.status === 404) return { data: fallback, sha: null };
    if (!r.ok) throw new Error('чтение ' + file + ': ' + r.status);
    const j = await r.json();
    let data; try { data = JSON.parse(fromB64(String(j.content).replace(/\n/g, '')) || 'null'); } catch { data = fallback; }
    return { data, sha: j.sha };
  }
  async function putFile(path, b64, message) {
    const r = await call(api(path), { method: 'PUT', body: JSON.stringify({ message, content: b64, branch }) });
    if (!r.ok) throw new Error('запись ' + path + ': ' + r.status);
  }
  /* прочитать свежий wall.json, изменить, записать; при конфликте повторить */
  async function mutate(fn, message) {
    for (let t = 0; ; t++) {
      const cur = await readJson(FILE, []);
      const arr = Array.isArray(cur.data) ? cur.data : [];
      const next = fn(arr);
      const body = { message, content: toB64(JSON.stringify(next, null, 2) + '\n'), branch };
      if (cur.sha) body.sha = cur.sha;
      const r = await call(api(FILE), { method: 'PUT', body: JSON.stringify(body) });
      if (r.ok) return next;
      if (t < 3 && (r.status === 409 || r.status === 422)) continue;
      throw new Error('запись ' + FILE + ': ' + r.status);
    }
  }
  return { readJson, putFile, mutate };
}
