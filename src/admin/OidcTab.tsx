/**
 * Вкладка «Sky ID для сервисов»: реестр доверенных клиентов OpenID Connect (сайты и приложения, входящие через Sky ID),
 * их адреса возврата и разрешения, смена секрета, приостановка, ключи подписи и журнал. Сервер — server/oidc.mjs, право `oidc`.
 * Создание клиента, смена секрета/адресов/статуса и ротация ключа — только с подтверждением личности (код).
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Loader2, KeyRound, Copy, RefreshCw, Plus } from 'lucide-react';
import { apiCall } from '@/core/auth/api';
import { flash } from '@/shared/flash';

const C = { l1: 'var(--bg-l1)', l2: 'var(--bg-l2)', brd: 'var(--border)', t1: 'var(--t1)', t2: 'var(--t2)', t3: 'var(--t3)', acc: 'var(--accent)', red: 'var(--red)', green: 'var(--green)', amber: 'var(--amber)' };
const field = { background: C.l2, border: `1px solid ${C.brd}`, color: C.t1 };
const A = '/api/admin/oidc';
type Data = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const ERR: Record<string, string> = {
  not_allowed: 'Недостаточно прав.', step_up_required: 'Нужно подтверждение личности.', step_up_invalid: 'Код не подошёл.', step_up_exhausted: 'Слишком много неверных кодов — запросите новый.',
  no_second_factor: 'Нужен аутентификатор: включите его в Профиль → Sky ID.', bad_name: 'Название — от 2 знаков.', bad_kind: 'Выберите тип клиента.', bad_redirect_uris: 'Адреса возврата: https, либо http://127.0.0.1…, для приложений — своя схема. Без пробелов и #.',
  bad_scopes: 'Разрешения заданы неверно.', bad_homepage: 'Сайт — адрес https://…', not_found: 'Не найдено.', public_client_has_no_secret: 'У публичного клиента нет секрета.', lockdown: 'Панель закрыта.',
};
const errText = (e?: string) => (e && ERR[e]) || `Не получилось${e ? ` (${e})` : ''}`;
const call = async (method: string, path: string, body?: unknown) => {
  const r = await apiCall<Data>(`${A}${path}`, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return r.ok ? { ok: true as const, data: (r.data ?? {}) as Data } : { ok: false as const, error: r.error, data: (r.data ?? {}) as Data };
};
const dt = (s: string | null) => (s ? new Date(s).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');
const Wait = () => <Loader2 size={14} className="animate-spin" style={{ color: C.t3 }} />;
const Btn = ({ children, onClick, disabled, tone = 'acc' }: { children: ReactNode; onClick: () => void; disabled?: boolean; tone?: 'acc' | 'red' | 'plain' }) => (
  <button type="button" disabled={disabled} onClick={onClick} className="rounded-xl px-3 py-1.5 text-xs font-bold disabled:opacity-40"
    style={tone === 'acc' ? { background: C.acc, color: '#fff' } : tone === 'red' ? { background: 'rgba(239,68,68,.15)', color: C.red } : { background: C.l2, color: C.t1, border: `1px solid ${C.brd}` }}>{children}</button>
);

const ALL_SCOPES = [['openid', 'openid (обязательно)'], ['profile', 'profile — имя и @username'], ['email', 'email — подтверждённая почта'], ['phone', 'phone — подтверждённый номер']] as const;

/** Подтверждение личности для опасного действия: запрашивает код, потом выполняет действие с ним. */
const Guard = ({ title, onRun, onCancel }: { title: string; onRun: (code: string) => Promise<void>; onCancel: () => void }) => {
  const [method, setMethod] = useState<string | null>(null); const [code, setCode] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => { void call('POST', '/step-up', {}).then((r) => { if (r.ok) setMethod(String(r.data.method ?? 'app')); else flash(errText(r.error)); }); }, []);
  return (
    <div className="space-y-2 rounded-xl p-3" style={{ background: C.l2, border: `1px solid ${C.acc}` }}>
      <p className="flex items-center gap-1.5 text-xs font-bold" style={{ color: C.t1 }}><KeyRound size={13} style={{ color: C.acc }} />{title}: подтвердите личность</p>
      {method && <p className="text-[11px]" style={{ color: C.t3 }}>{'Введите код из приложения-аутентификатора.'}</p>}
      <div className="flex gap-2">
        <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" placeholder="000000" aria-label="Код подтверждения" className="flex-1 rounded-lg px-3 py-2 text-sm tracking-[0.3em]" style={field} />
        <Btn disabled={code.length < 6 || busy} onClick={() => { setBusy(true); void onRun(code).finally(() => setBusy(false)); }}>Подтвердить</Btn>
      </div>
      <button type="button" onClick={onCancel} className="text-[11px]" style={{ color: C.t3 }}>Отмена</button>
    </div>
  );
};

export const OidcTab = () => {
  const [clients, setClients] = useState<Data[] | null>(null);
  const [events, setEvents] = useState<Data[]>([]);
  const [secret, setSecret] = useState<{ id: string; value: string } | null>(null);
  const [guard, setGuard] = useState<{ title: string; run: (code: string) => Promise<void> } | null>(null);
  const [form, setForm] = useState({ name: '', description: '', homepageUrl: '', kind: 'confidential', redirectUris: '', scopes: ['openid'] as string[] });
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    const [c, e] = await Promise.all([call('GET', '/clients'), call('GET', '/events?limit=40')]);
    if (c.ok) setClients(c.data.clients); else flash(errText(c.error));
    if (e.ok) setEvents(e.data.events);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const guarded = (title: string, fn: (code: string) => Promise<{ ok: boolean; error?: string; data?: Data }>, after?: (d: Data) => void) =>
    setGuard({ title, run: async (code) => { const r = await fn(code); if (!r.ok) { flash(errText(r.error)); return; } flash('Выполнено'); setGuard(null); after?.(r.data ?? {}); void load(); } });

  const create = () => guarded('Создание клиента', (stepUpCode) => call('POST', '/clients', {
    name: form.name, description: form.description, homepageUrl: form.homepageUrl, kind: form.kind, scopes: form.scopes, stepUpCode,
    redirectUris: form.redirectUris.split(/\s+/).map((x) => x.trim()).filter(Boolean),
  }), (d) => { if (d.clientSecret) setSecret({ id: d.client.id, value: d.clientSecret }); setCreating(false); setForm({ name: '', description: '', homepageUrl: '', kind: 'confidential', redirectUris: '', scopes: ['openid'] }); });

  const iss = `${location.origin}/api/oidc`;
  if (!clients) return <Wait />;
  return (
    <div className="space-y-3">
      <div className="space-y-2 rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
        <p className="text-sm font-bold" style={{ color: C.t1 }}>Sky ID для сторонних сервисов</p>
        <p className="text-[11px]" style={{ color: C.t3 }}>OpenID Connect: код авторизации + PKCE. Сервис получает случайный идентификатор, уникальный для него; имя, почта и телефон — только по отдельному согласию человека. Sky при этом видит, в какие сервисы входит человек.</p>
        <p className="flex items-center gap-2 text-[11px]" style={{ color: C.t2 }}>Адрес конфигурации: <code translate="no">{iss}/.well-known/openid-configuration</code>
          <button type="button" aria-label="Копировать" onClick={() => void navigator.clipboard?.writeText(`${iss}/.well-known/openid-configuration`)}><Copy size={12} /></button></p>
        <div className="flex flex-wrap gap-2">
          <Btn onClick={() => setCreating((v) => !v)}><Plus size={12} className="mr-1 inline" />Новый клиент</Btn>
          <Btn tone="plain" onClick={() => guarded('Смена ключа подписи', (stepUpCode) => call('POST', '/keys/rotate', { stepUpCode }))}><RefreshCw size={12} className="mr-1 inline" />Сменить ключ подписи</Btn>
        </div>
      </div>

      {secret && (
        <div className="space-y-1 rounded-xl p-3" style={{ background: 'rgba(245,158,11,.12)', border: `1px solid ${C.amber}` }}>
          <p className="text-xs font-bold" style={{ color: C.t1 }}>Секрет клиента — показан один раз</p>
          <code className="block break-all text-[12px]" style={{ color: C.t1 }} translate="no">{secret.value}</code>
          <p className="text-[11px]" style={{ color: C.t3 }}>Передайте его владельцу сервиса безопасным способом. Позже увидеть его нельзя — только сменить.</p>
          <Btn tone="plain" onClick={() => setSecret(null)}>Я сохранил, скрыть</Btn>
        </div>
      )}

      {creating && (
        <div className="space-y-2 rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Название сервиса" aria-label="Название" maxLength={80} className="w-full rounded-lg px-3 py-2 text-sm" style={field} />
          <input value={form.homepageUrl} onChange={(e) => setForm({ ...form, homepageUrl: e.target.value })} placeholder="Сайт (https://…)" aria-label="Сайт" className="w-full rounded-lg px-3 py-2 text-sm" style={field} />
          <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })} aria-label="Тип" className="w-full rounded-lg px-3 py-2 text-sm" style={field}>
            <option value="confidential">Сайт с сервером (есть секрет)</option><option value="public">Приложение или одностраничный сайт (без секрета, только PKCE)</option>
          </select>
          <textarea value={form.redirectUris} onChange={(e) => setForm({ ...form, redirectUris: e.target.value })} rows={3} placeholder="Точные адреса возврата — по одному в строке" aria-label="Адреса возврата" className="w-full resize-none rounded-lg px-3 py-2 text-sm" style={field} />
          <div className="flex flex-wrap gap-3 text-xs" style={{ color: C.t2 }}>
            {ALL_SCOPES.map(([id, label]) => (
              <label key={id} className="flex items-center gap-1"><input type="checkbox" checked={form.scopes.includes(id)} disabled={id === 'openid'}
                onChange={(e) => setForm({ ...form, scopes: e.target.checked ? [...form.scopes, id] : form.scopes.filter((x) => x !== id) })} />{label}</label>
            ))}
          </div>
          <p className="text-[11px]" style={{ color: C.t3 }}>Разрешения — это то, что сервис вообще МОЖЕТ запросить; человек всё равно выбирает, что отдать.</p>
          <Btn disabled={form.name.trim().length < 2 || !form.redirectUris.trim()} onClick={create}>Создать (нужен код)</Btn>
        </div>
      )}

      {guard && <Guard title={guard.title} onRun={guard.run} onCancel={() => setGuard(null)} />}

      {clients.length === 0 && <p className="text-xs" style={{ color: C.t3 }}>Клиентов пока нет.</p>}
      {clients.map((c) => (
        <div key={c.id} className="space-y-1.5 rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-bold" style={{ color: C.t1 }} translate="no">{c.name}</p>
            <span className="rounded-lg px-2 py-0.5 text-[10px] font-bold" style={{ background: c.status === 'active' ? 'rgba(52,211,153,.15)' : 'rgba(239,68,68,.15)', color: c.status === 'active' ? C.green : C.red }}>{c.status === 'active' ? 'активен' : 'приостановлен'}</span>
          </div>
          <p className="text-[11px]" style={{ color: C.t3 }}><code translate="no">{c.id}</code> · {c.kind === 'confidential' ? 'с секретом' : 'публичный (PKCE)'} · разрешения: <span translate="no">{c.scopes.join(', ')}</span></p>
          <p className="break-all text-[11px]" style={{ color: C.t2 }} translate="no">{c.redirectUris.join('  ·  ')}</p>
          <div className="flex flex-wrap gap-2">
            {c.status === 'active'
              ? <Btn tone="red" onClick={() => guarded('Приостановка', (stepUpCode) => call('POST', `/clients/${c.id}/status`, { status: 'suspended', stepUpCode }))}>Приостановить (отзывает токены)</Btn>
              : <Btn tone="plain" onClick={() => guarded('Включение', (stepUpCode) => call('POST', `/clients/${c.id}/status`, { status: 'active', stepUpCode }))}>Включить</Btn>}
            {c.kind === 'confidential' && <Btn tone="plain" onClick={() => guarded('Смена секрета', (stepUpCode) => call('POST', `/clients/${c.id}/rotate-secret`, { stepUpCode }), (d) => setSecret({ id: c.id, value: d.clientSecret }))}>Сменить секрет</Btn>}
            <Btn tone="red" onClick={() => guarded('Удаление', (stepUpCode) => call('POST', `/clients/${c.id}/status`, { status: 'deleted', stepUpCode }))}>Удалить</Btn>
          </div>
        </div>
      ))}

      <div className="rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
        <p className="mb-1 text-sm font-bold" style={{ color: C.t1 }}>Журнал (без кодов, токенов и персональных данных)</p>
        {events.length === 0 ? <p className="text-xs" style={{ color: C.t3 }}>Событий пока нет.</p>
          : events.map((e) => <p key={e.id} className="text-[11px]" style={{ color: C.t2 }} translate="no">{dt(e.at)} · {e.kind} · {e.clientId ?? '—'}</p>)}
      </div>
    </div>
  );
};
