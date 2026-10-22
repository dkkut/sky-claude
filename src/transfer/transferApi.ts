/** Sky Transfer: запросы к серверу и движок передачи (куски, хеши, возобновление, скорость). Сервер — server/transfer.mjs. */
import { create } from 'zustand';
import { apiCall, apiRawAuthed } from '@/core/auth/api';

export interface TDevice { id: string; name: string; kind: string; status: 'pending' | 'approved' | 'revoked'; canReceive: boolean; online: boolean; current: boolean; createdAt: string }
export interface TTransfer {
  id: string; name: string; size: number; mime: string; chunks: number; chunkSize: number;
  status: 'uploading' | 'ready' | 'awaiting_accept' | 'downloading' | 'delivered' | 'cancelled' | 'rejected' | 'failed' | 'expired';
  error: string | null; from: string; to: string; direction: 'in' | 'out'; bytesUp: number; bytesDown: number;
  createdAt: string; updatedAt: string; expiresAt: string; finishedAt: string | null; filesGone: boolean;
}
export interface TPrefs { accept: 'own' | 'off'; confirm: boolean; keepHours: number; historyDays: number }
export interface TOverview { device: TDevice | null; devices: TDevice[]; prefs: TPrefs; active: TTransfer[]; history: TTransfer[]; limits: { maxFileBytes: number; minChunk: number; maxChunk: number; blockedExt: string[] } }

const REASON: Record<string, string> = {
  no_device: 'Это устройство не удалось определить. Обновите страницу.', unknown_device: 'Устройство не зарегистрировано в Sky Transfer.',
  device_not_approved: 'Устройство ещё не подтверждено. Подтвердите его с другого вашего устройства.', device_revoked: 'Это устройство удалено из Sky Transfer.',
  recipient_not_trusted: 'Получатель не подтверждён.', recipient_cannot_receive: 'Это устройство не принимает файлы (ТВ и машина не могут сохранять файлы).',
  transfers_disabled: 'Приём файлов отключён в настройках.', type_not_allowed: 'Такой тип файла передавать нельзя (исполняемые программы).',
  file_too_large: 'Файл слишком большой.', too_many_active: 'Слишком много активных передач. Дождитесь завершения или отмените лишние.',
  hash_mismatch: 'Кусок файла повреждён при передаче.', integrity_failed: 'Файл не прошёл проверку целостности и удалён.',
  awaiting_accept: 'Получатель ещё не подтвердил приём.', not_ready: 'Файл ещё не готов.', storage_unavailable: 'Хранилище временно недоступно. Повторите.',
  rate_limited: 'Слишком часто. Подождите немного.', not_found: 'Передача не найдена (возможно, удалена или просрочена).', bad_state: 'Передача уже завершена или отменена.',
  same_device: 'Выберите другое устройство.', invalid_name: 'Недопустимое имя файла.',
};
export const tReason = (r: { error?: string; reason?: string }) => REASON[r.error ?? ''] ?? r.reason ?? 'Не получилось. Повторите.';

export const T = {
  overview: () => apiCall<TOverview>('/api/transfer'),
  register: (name: string, kind: string) => apiCall<{ id: string; status: string }>('/api/transfer/devices/register', { method: 'POST', body: JSON.stringify({ name, kind }) }),
  heartbeat: () => apiCall('/api/transfer/devices/heartbeat', { method: 'POST', body: '{}' }),
  approve: (id: string) => apiCall(`/api/transfer/devices/${id}/approve`, { method: 'POST', body: '{}' }),
  removeDevice: (id: string) => apiCall(`/api/transfer/devices/${id}`, { method: 'DELETE' }),
  rename: (id: string, name: string) => apiCall(`/api/transfer/devices/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) }),
  setPrefs: (p: Partial<TPrefs>) => apiCall<TPrefs>('/api/transfer/prefs', { method: 'PUT', body: JSON.stringify(p) }),
  cancel: (id: string) => apiCall(`/api/transfer/t/${id}/cancel`, { method: 'POST', body: '{}' }),
  accept: (id: string) => apiCall(`/api/transfer/t/${id}/accept`, { method: 'POST', body: '{}' }),
  reject: (id: string) => apiCall(`/api/transfer/t/${id}/reject`, { method: 'POST', body: '{}' }),
  deleteRecord: (id: string) => apiCall(`/api/transfer/t/${id}`, { method: 'DELETE' }),
  clearHistory: () => apiCall('/api/transfer/history', { method: 'DELETE' }),
};

/* ── Тип устройства и имя по умолчанию ── */
export const detectKind = (): string => {
  const d = document.documentElement.dataset.skyMode;
  if (d === 'tv' || d === 'car') return d;
  if (d === 'console') return 'tv';
  const w = window as unknown as { Capacitor?: { isNativePlatform?: () => boolean }; sky?: unknown };
  if (w.Capacitor?.isNativePlatform?.()) return 'phone';
  if (w.sky) return 'desktop';
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ? 'phone' : 'web';
};
export const defaultName = (): string => {
  const ua = navigator.userAgent;
  const os = /Windows/i.test(ua) ? 'Windows' : /Android/i.test(ua) ? 'Android' : /iPhone|iPad|iPod/i.test(ua) ? 'iOS' : /Mac OS/i.test(ua) ? 'macOS' : /Linux/i.test(ua) ? 'Linux' : 'устройство';
  const br = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Браузер';
  const w = window as unknown as { Capacitor?: { isNativePlatform?: () => boolean }; sky?: unknown };
  return w.Capacitor?.isNativePlatform?.() ? `Sky на ${os}` : w.sky ? `Sky для ${os}` : `${br} · ${os}`;
};

/* ── Движок: загрузка и скачивание в этом окне ── */
export interface Job { id: string; kind: 'up' | 'down'; done: number; total: number; speed: number; error?: string; file?: File; abort: AbortController; to?: string }
export const useJobs = create<{ jobs: Record<string, Job>; set: (j: Job) => void; drop: (id: string) => void }>((s) => ({
  jobs: {}, set: (j) => s((x) => ({ jobs: { ...x.jobs, [j.id]: j } })), drop: (id) => s((x) => { const n = { ...x.jobs }; delete n[id]; return { jobs: n }; }),
}));

const hex = (b: ArrayBuffer) => Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, '0')).join('');
const sha256 = async (buf: ArrayBuffer) => hex(await crypto.subtle.digest('SHA-256', buf));
const sha256Text = async (t: string) => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t)));
export const CHUNK = 1024 * 1024;
const sleep = (ms: number, sig: AbortSignal) => new Promise<void>((ok, bad) => { const t = setTimeout(ok, ms); sig.addEventListener('abort', () => { clearTimeout(t); bad(new Error('aborted')); }, { once: true }); });

/** Скорость считаем по фактически переданным байтам за последние секунды (скользящее окно), а не по оценке. */
class Meter {
  private pts: { t: number; b: number }[] = [];
  add(bytes: number) { const t = performance.now(); this.pts.push({ t, b: bytes }); this.pts = this.pts.filter((p) => t - p.t < 4000); }
  get speed() { if (this.pts.length < 2) return 0; const span = (this.pts[this.pts.length - 1].t - this.pts[0].t) / 1000; return span > 0.2 ? this.pts.reduce((a, p) => a + p.b, 0) / span : 0; }
}

const authedFetch = (path: string, init: RequestInit = {}) => apiRawAuthed(path, init);

/** Отправка файла: хеши → создание передачи → куски с повторами и возобновлением. Возвращает null при успехе или текст ошибки. */
export const sendFile = async (file: File, toDevice: string, onDone: () => void): Promise<string | null> => {
  const abort = new AbortController();
  const tmp = `tmp-${crypto.randomUUID()}`;
  const st = useJobs.getState();
  st.set({ id: tmp, kind: 'up', done: 0, total: file.size, speed: 0, file, abort, to: toDevice });
  try {
    const hashes: string[] = [];
    const n = Math.ceil(file.size / CHUNK);
    for (let i = 0; i < n; i++) hashes.push(await sha256(await file.slice(i * CHUNK, (i + 1) * CHUNK).arrayBuffer()));
    const c = await apiCall<{ transfer: TTransfer }>('/api/transfer/send', { method: 'POST', body: JSON.stringify({ toDevice, name: file.name, size: file.size, mime: file.type, chunkSize: CHUNK, hashes }) });
    if (!c.ok || !c.data) { st.drop(tmp); return tReason(c); }
    const id = c.data.transfer.id;
    st.drop(tmp);
    st.set({ id, kind: 'up', done: 0, total: file.size, speed: 0, file, abort, to: toDevice });
    return await uploadChunks(id, file, abort, onDone);
  } catch (e) { st.drop(tmp); return (e as Error).message === 'aborted' ? 'Отменено' : 'Не удалось подготовить файл.'; }
};

/** Дозагрузка недостающих кусков (также для возобновления): спрашивает у сервера, что уже принято. */
export const uploadChunks = async (id: string, file: File, abort: AbortController, onDone: () => void): Promise<string | null> => {
  const jobs = useJobs.getState(); const meter = new Meter();
  const upd = (done: number, extra: Partial<Job> = {}) => jobs.set({ id, kind: 'up', done, total: file.size, speed: meter.speed, file, abort, ...extra });
  try {
    const s = await apiCall<{ transfer: TTransfer; received: number[]; hashes: string[] }>(`/api/transfer/t/${id}/status`);
    if (!s.ok || !s.data) return tReason(s);
    if (s.data.transfer.status !== 'uploading') { jobs.drop(id); onDone(); return s.data.transfer.status === 'ready' || s.data.transfer.status === 'awaiting_accept' ? null : 'Передача уже завершена или отменена.'; }
    const have = new Set(s.data.received); const cs = s.data.transfer.chunkSize; const total = s.data.transfer.chunks;
    let done = 0; for (const i of have) done += Math.min(cs, file.size - i * cs);
    upd(done);
    for (let i = 0; i < total; i++) {
      if (have.has(i)) continue;
      const buf = await file.slice(i * cs, (i + 1) * cs).arrayBuffer();
      let attempt = 0;
      for (;;) {
        if (abort.signal.aborted) throw new Error('aborted');
        try {
          const r = await authedFetch(`/api/transfer/t/${id}/chunk/${i}`, { method: 'PUT', body: buf, headers: { 'Content-Type': 'application/octet-stream' }, signal: abort.signal });
          if (r.ok) break;
          const d = await r.json().catch(() => ({}));
          if (r.status >= 400 && r.status < 500 && r.status !== 429) { jobs.set({ id, kind: 'up', done, total: file.size, speed: 0, file, abort, error: tReason({ error: d?.error }) }); return tReason({ error: d?.error }); }
        } catch (e) { if ((e as Error).name === 'AbortError') throw new Error('aborted'); }
        attempt++;
        if (attempt > 6) { jobs.set({ id, kind: 'up', done, total: file.size, speed: 0, file, abort, error: 'Нет связи. Передача сохранена — нажмите «Повторить», чтобы продолжить.' }); return 'Нет связи. Передача сохранена — нажмите «Повторить», чтобы продолжить.'; }
        await sleep(Math.min(8000, 500 * 2 ** attempt), abort.signal);   // обрыв сети: пауза и повтор того же куска
      }
      done += buf.byteLength; meter.add(buf.byteLength); upd(done);
    }
    jobs.drop(id); onDone(); return null;
  } catch (e) {
    if ((e as Error).message === 'aborted') { jobs.drop(id); return 'Отменено'; }
    return 'Передача прервана. Повторите — загрузка продолжится.';
  }
};

/** Скачивание: куски с проверкой каждого по хешу, итоговый digest → сервер подтверждает доставку. Сохранение файла — через ссылку. */
export const receiveFile = async (t: TTransfer, onDone: () => void): Promise<string | null> => {
  const abort = new AbortController(); const jobs = useJobs.getState(); const meter = new Meter();
  jobs.set({ id: t.id, kind: 'down', done: 0, total: t.size, speed: 0, abort });
  try {
    const s = await apiCall<{ hashes: string[]; digest: string }>(`/api/transfer/t/${t.id}/status`);
    if (!s.ok || !s.data) { jobs.drop(t.id); return tReason(s); }
    const parts: ArrayBuffer[] = []; let done = 0;
    for (let i = 0; i < t.chunks; i++) {
      let buf: ArrayBuffer | null = null; let attempt = 0;
      while (!buf) {
        if (abort.signal.aborted) throw new Error('aborted');
        try {
          const r = await authedFetch(`/api/transfer/t/${t.id}/chunk/${i}`, { signal: abort.signal });
          if (r.ok) {
            const b = await r.arrayBuffer();
            if ((await sha256(b)) !== s.data.hashes[i]) { attempt++; if (attempt > 3) { await apiCall(`/api/transfer/t/${t.id}/fail`, { method: 'POST', body: JSON.stringify({ reason: 'integrity' }) }); jobs.drop(t.id); onDone(); return 'Файл повреждён при передаче и удалён.'; } continue; }
            buf = b; break;
          }
          const d = await r.json().catch(() => ({}));
          if (r.status >= 400 && r.status < 500 && r.status !== 429) { jobs.drop(t.id); return tReason({ error: d?.error }); }
        } catch (e) { if ((e as Error).name === 'AbortError') throw new Error('aborted'); }
        attempt++;
        if (attempt > 6) { jobs.set({ id: t.id, kind: 'down', done, total: t.size, speed: 0, abort, error: 'Нет связи. Нажмите «Повторить», чтобы продолжить.' }); return 'Нет связи. Нажмите «Повторить».'; }
        await sleep(Math.min(8000, 500 * 2 ** attempt), abort.signal);
      }
      parts.push(buf); done += buf.byteLength; meter.add(buf.byteLength);
      jobs.set({ id: t.id, kind: 'down', done, total: t.size, speed: meter.speed, abort });
    }
    const digest = await sha256Text(s.data.hashes.join(''));
    const c = await apiCall(`/api/transfer/t/${t.id}/complete`, { method: 'POST', body: JSON.stringify({ digest }) });
    if (!c.ok) { jobs.drop(t.id); onDone(); return tReason(c); }
    const blob = new Blob(parts, { type: 'application/octet-stream' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = t.name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    jobs.drop(t.id); onDone(); return null;
  } catch (e) { jobs.drop(t.id); return (e as Error).message === 'aborted' ? 'Отменено' : 'Скачивание прервано. Повторите.'; }
};
