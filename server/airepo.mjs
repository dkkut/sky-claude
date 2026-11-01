/**
 * Sky AI → «Код»: чтение репозиториев GitHub (только чтение).
 *
 * Ходит сервер, и только на api.github.com (адрес зашит, из запроса берутся лишь «владелец/репозиторий», ветка и пути — они проверены
 * по строгим образцам, поэтому увести запрос на другой адрес или вверх по каталогам нельзя). Личный токен GitHub человека (для закрытых
 * репозиториев) приходит в теле запроса, уходит только в заголовок к GitHub и нигде не хранится и не пишется в журнал.
 * Ничего не записывается в репозиторий: изменённые файлы человек скачивает и коммитит сам.
 */
const API = 'https://api.github.com';
const REPO_RE = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;
const REF_RE = /^[A-Za-z0-9_./-]{1,100}$/;
const TIMEOUT_MS = 12_000;
export const LIMITS = { tree: 3000, files: 12, fileBytes: 200_000, totalBytes: 500_000 };
const SKIP_DIR = /(^|\/)(node_modules|\.git|dist|build|vendor|\.next|\.cache|coverage|__pycache__|\.venv)(\/|$)/;
const SKIP_EXT = /\.(png|jpe?g|gif|webp|ico|svg|pdf|zip|gz|tgz|rar|7z|mp3|mp4|mov|avi|woff2?|ttf|eot|otf|jar|exe|dll|so|dylib|bin|class|lock|map)$/i;

export const parseRepo = (v) => {
  let s = String(v ?? '').trim().replace(/^(?:https?:\/\/)?(?:www\.)?github\.com\//i, '').replace(/\.git$/i, '').replace(/\/+$/, '');
  const m = s.match(/^([^/]+\/[^/]+)(?:\/tree\/(.+))?$/);
  if (!m) return null;
  return REPO_RE.test(m[1]) && !m[1].split('/').some((x) => /^\.+$/.test(x)) ? { repo: m[1], ref: m[2] && REF_RE.test(m[2]) ? m[2] : '' } : null;
};

const gh = async (path, token, accept = 'application/vnd.github+json') => {
  const headers = { Accept: accept, 'User-Agent': 'SkyAI-Code/1.0', 'X-GitHub-Api-Version': '2022-11-28' };
  if (token) headers.Authorization = `Bearer ${token}`;
  let res;
  try { res = await fetch(`${API}${path}`, { headers, redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS) }); }
  catch { return { error: 'github_unreachable' }; }
  if (res.status === 404) return { error: token ? 'repo_not_found' : 'repo_not_found_or_private' };
  if (res.status === 401) return { error: 'bad_token' };
  if (res.status === 403 || res.status === 429) return { error: res.headers.get('x-ratelimit-remaining') === '0' ? 'github_rate_limited' : 'github_forbidden' };
  if (!res.ok) return { error: 'github_error' };
  return { res };
};

const cleanToken = (t) => { const s = String(t ?? '').trim(); return /^[A-Za-z0-9_\-]{20,255}$/.test(s) ? s : ''; };

/** Дерево файлов: только текстовые по расширению, без служебных каталогов. */
export const repoTree = async ({ repo, ref, token }) => {
  const p = parseRepo(repo); if (!p) return { error: 'bad_repo' };
  const tk = cleanToken(token); if (token && !tk) return { error: 'bad_token' };
  const r0 = await gh(`/repos/${p.repo}`, tk); if (r0.error) return r0;
  const info = await r0.res.json().catch(() => ({}));
  const branch = (ref && REF_RE.test(ref) ? ref : p.ref) || info.default_branch || 'main';
  const r1 = await gh(`/repos/${p.repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`, tk);
  if (r1.error) return r1.error === 'repo_not_found' || r1.error === 'repo_not_found_or_private' ? { error: 'ref_not_found' } : r1;
  const data = await r1.res.json().catch(() => ({}));
  const all = Array.isArray(data.tree) ? data.tree.filter((e) => e.type === 'blob') : [];
  const files = all.filter((e) => !SKIP_DIR.test(e.path) && !SKIP_EXT.test(e.path) && e.size <= LIMITS.fileBytes)
    .slice(0, LIMITS.tree).map((e) => ({ path: e.path, size: e.size ?? 0 }));
  return { ok: true, repo: p.repo, ref: branch, description: String(info.description ?? '').slice(0, 300), private: !!info.private, truncated: !!data.truncated || all.length > files.length, files };
};

const okPath = (s) => typeof s === 'string' && s.length <= 300 && !s.startsWith('/') && !s.includes('..') && !s.includes('\\') && !/[\u0000-\u001f]/.test(s);

/** Содержимое выбранных файлов (текст до 200 КБ каждый, не больше 12 файлов и 500 КБ всего). */
export const repoFiles = async ({ repo, ref, paths, token }) => {
  const p = parseRepo(repo); if (!p) return { error: 'bad_repo' };
  const tk = cleanToken(token); if (token && !tk) return { error: 'bad_token' };
  const branch = ref && REF_RE.test(ref) ? ref : p.ref;
  const list = [...new Set((Array.isArray(paths) ? paths : []).filter(okPath))].slice(0, LIMITS.files);
  if (!list.length) return { error: 'no_files' };
  const out = []; const skipped = []; let total = 0;
  for (const path of list) {
    const q = branch ? `?ref=${encodeURIComponent(branch)}` : '';
    const r = await gh(`/repos/${p.repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}${q}`, tk, 'application/vnd.github.raw+json');
    if (r.error) { if (['github_rate_limited', 'bad_token', 'github_unreachable'].includes(r.error)) return r; skipped.push({ path, reason: r.error }); continue; }
    const buf = Buffer.from(await r.res.arrayBuffer());
    if (buf.length > LIMITS.fileBytes) { skipped.push({ path, reason: 'too_big' }); continue; }
    if (buf.includes(0)) { skipped.push({ path, reason: 'binary' }); continue; }
    if (total + buf.length > LIMITS.totalBytes) { skipped.push({ path, reason: 'total_limit' }); continue; }
    total += buf.length;
    out.push({ path, text: buf.toString('utf8') });
  }
  return { ok: true, files: out, skipped, bytes: total };
};
