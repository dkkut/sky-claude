/**
 * Вкладка «Файрвол»: пять уровней защиты (последний — «Атака»), нагрузка и отказы за последний час, блокировки адресов, журнал, настройки.
 * Просмотр — право security; изменения — только владелец и с кодом подтверждения (step-up `firewall`). Сервер — server/firewall.mjs.
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Loader2, Shield, ShieldAlert, Swords, Ban, Activity } from 'lucide-react';
import { apiCall } from '@/core/auth/api';
import { flash } from '@/shared/flash';

const C = { l1: 'var(--bg-l1)', l2: 'var(--bg-l2)', brd: 'var(--border)', t1: 'var(--t1)', t2: 'var(--t2)', t3: 'var(--t3)', acc: 'var(--accent)', red: 'var(--red)', green: 'var(--green)', amber: 'var(--amber)' };
const field = { background: C.l2, border: `1px solid ${C.brd}`, color: C.t1 };
const A = '/api/admin/firewall';
type D = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const ERR: Record<string, string> = { owner_only: 'Только владелец.', step_up_required: 'Нужен код подтверждения.', step_up_invalid: 'Код не подошёл.', step_up_exhausted: 'Попытки кода исчерпаны — запросите новый.', bad_ip: 'Неверный адрес.', protected_address: 'Свой или внутренний адрес заблокировать нельзя.', bad_field: 'Неверное значение настройки.', bad_level: 'Неверный уровень.' };
const errText = (e?: string) => (e && ERR[e]) || `Не получилось${e ? ` (${e})` : ''}`;
const dt = (s?: string | null) => (s ? new Date(s).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');
const TONE = ['var(--green)', '#3b82f6', 'var(--amber)', '#f97316', 'var(--red)'];
const KIND: Record<string, string> = { level_up: 'Уровень повышен', level_down: 'Уровень снижен', level_manual: 'Уровень изменён вручную', ban: 'Блокировка адреса', unban: 'Блокировка снята', cloudflare: 'Cloudflare', settings: 'Настройки' };
const TH: Record<string, string> = { limited1: 'Отказов за минуту → «Внимание»', limited2: 'Отказов за минуту → «Усиленная»', limited3: 'Отказов за минуту → «Тревога»', attackers3: 'Разных адресов с отказом → «Тревога»', attackers4: 'Разных адресов с отказом → «Атака»', rpm2: 'Запросов за минуту → «Усиленная»', rpm3: 'Запросов за минуту → «Тревога»', rpm4: 'Запросов за минуту → «Атака»' };

const Btn = ({ children, onClick, disabled, tone = 'acc' }: { children: ReactNode; onClick: () => void; disabled?: boolean; tone?: 'acc' | 'red' | 'plain' }) => (
  <button type="button" disabled={disabled} onClick={onClick} className="rounded-xl px-3 py-1.5 text-xs font-bold disabled:opacity-40"
    style={tone === 'acc' ? { background: C.acc, color: '#fff' } : tone === 'red' ? { background: 'rgba(239,68,68,.15)', color: C.red } : { background: C.l2, color: C.t1 }}>{children}</button>);
const Card = ({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) => (
  <section className="space-y-2 rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
    <h3 className="flex items-center gap-2 text-sm font-bold" style={{ color: C.t1 }}>{icon}{title}</h3>{children}</section>);

/** Мини-график «запросов и отказов» по 10-секундным корзинам. */
const Spark = ({ series }: { series: { t: number; req: number; limited: number }[] }) => {
  const max = Math.max(10, ...series.map((s) => s.req));
  return (
    <div className="flex h-14 items-end gap-px" role="img" aria-label="Запросы и отказы за последние минуты">
      {series.map((s) => (
        <div key={s.t} className="relative flex-1" style={{ height: '100%' }}>
          <div className="absolute bottom-0 w-full rounded-sm" style={{ height: `${(s.req / max) * 100}%`, background: 'var(--accent)', opacity: 0.55 }} />
          <div className="absolute bottom-0 w-full rounded-sm" style={{ height: `${(s.limited / max) * 100}%`, background: 'var(--red)' }} />
        </div>))}
    </div>);
};

export const FirewallTab = () => {
  const [d, setD] = useState<D | null>(null); const [failed, setFailed] = useState('');
  const [pending, setPending] = useState<null | { run: (code: string) => Promise<void>; title: string }>(null); const [code, setCode] = useState('');
  const [draft, setDraft] = useState<D | null>(null); const [ip, setIp] = useState(''); const [hours, setHours] = useState(3);

  const load = useCallback(async () => {
    const r = await apiCall<D>(A);
    if (r.ok) { setD(r.data ?? {}); setFailed(''); } else setFailed(errText(r.error));
  }, []);
  useEffect(() => { void load(); const t = setInterval(() => { if (!document.hidden) void load(); }, 10000); return () => clearInterval(t); }, [load]);

  const needCode = async (title: string, run: (code: string) => Promise<void>) => {
    const r = await apiCall(`${A}/step-up`, { method: 'POST', body: '{}' });
    if (!r.ok) { flash(errText(r.error)); return; }
    setCode(''); setPending({ title, run });
  };
  const confirm = async () => { if (!pending) return; await pending.run(code.trim()); setPending(null); };
  const send = async (path: string, method: string, body: D, ok: string, stepUpCode?: string) => {
    const r = await apiCall<D>(`${A}${path}`, { method, body: JSON.stringify({ ...body, ...(stepUpCode ? { stepUpCode } : {}) }) });
    flash(r.ok ? ok : errText(r.error)); await load(); return r;
  };

  if (failed) return <p className="text-sm" style={{ color: C.red }}>{failed}</p>;
  if (!d) return <Loader2 size={16} className="animate-spin" style={{ color: C.t3 }} />;
  const edit = Boolean(d.canEdit); const lv = d.state.level as number; const st = d.stats;
  const s = draft ?? d.settings;
  const setLevel = (n: number) => void needCode(`Уровень «${d.levels[n].name}»`, async (c) => { await send('/level', 'POST', { level: n, hours: n >= 4 ? 3 : 6, reason: 'вручную из админки' }, `Уровень: ${d.levels[n].name}`, c); });

  return (
    <div className="space-y-4">
      <div className="rounded-2xl p-4" style={{ background: lv >= 3 ? 'rgba(239,68,68,.12)' : C.l1, border: `1px solid ${TONE[lv]}` }}>
        <div className="flex items-center gap-2 text-base font-bold" style={{ color: TONE[lv] }}>{lv >= 3 ? <ShieldAlert size={20} /> : <Shield size={20} />}Уровень: {d.levels[lv].name}</div>
        <p className="mt-1 text-xs" style={{ color: C.t2 }}>{d.levels[lv].hint}</p>
        {lv > 0 && <p className="mt-1 text-xs" style={{ color: C.t3 }}>{d.state.reason ? `${d.state.reason}. ` : ''}{d.state.setBy ? 'Выставлен вручную' : 'Выставлен автоматически'} · с {dt(d.state.setAt)}{d.state.pinnedUntil ? ` · удерживается до ${dt(d.state.pinnedUntil)}` : ' · снизится сам, когда станет тихо'}</p>}
        <div className="mt-3 grid grid-cols-5 gap-1.5">
          {(d.levels as D[]).map((l) => (
            <button key={l.id} type="button" disabled={!edit || l.id === lv} onClick={() => setLevel(l.id)} className="rounded-xl px-1 py-2 text-[11px] font-bold disabled:opacity-100"
              style={{ background: l.id === lv ? TONE[l.id] : C.l2, color: l.id === lv ? '#fff' : C.t1, border: `1px solid ${l.id === lv ? TONE[l.id] : C.brd}`, cursor: edit && l.id !== lv ? 'pointer' : 'default' }}>
              {l.id === 4 && <Swords size={12} className="mx-auto mb-0.5" />}{l.name}</button>))}
        </div>
        {!edit && <p className="mt-2 text-xs" style={{ color: C.t3 }}>Менять уровень может только владелец.</p>}
      </div>

      {pending && <div className="space-y-2 rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.acc}` }}>
        <b className="text-sm" style={{ color: C.t1 }}>{pending.title}</b>
        <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 8))} inputMode="numeric" placeholder="Код подтверждения" className="w-full rounded-xl px-3 py-2 text-sm" style={field} />
        <div className="flex gap-2"><Btn disabled={code.length < 6} onClick={() => void confirm()}>Подтвердить</Btn><Btn tone="plain" onClick={() => setPending(null)}>Отмена</Btn></div></div>}

      <Card title="Сейчас" icon={<Activity size={15} />}>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 text-center">
          {([['Запросов в минуту', st.reqPerMin], ['Отказов в минуту', st.limitedPerMin], ['Адресов с отказом', st.attackers], ['Блокировок в минуту', st.bannedPerMin]] as [string, number][]).map(([k, v]) => (
            <div key={k} className="rounded-xl p-2" style={{ background: C.l2 }}><div className="text-lg font-bold" style={{ color: C.t1 }}>{v}</div><div className="text-[11px]" style={{ color: C.t3 }}>{k}</div></div>))}
        </div>
        <Spark series={st.series} />
        <p className="text-[11px]" style={{ color: C.t3 }}>Синее — запросы к API, красное — отказы файрвола (по 10 секунд, последние 10 минут). Счётчики одного процесса сервера.</p>
      </Card>

      <Card title="Как это работает" icon={<Shield size={15} />}>
        <p className="text-xs" style={{ color: C.t2 }}>Файрвол работает в самом сервере: считает запросы по адресам, отвечает 429 тем, кто превышает предел уровня, на «Тревоге» оставляет анонимам только вход и публичные страницы, блокирует настойчивых нарушителей, на «Атаке» закрывает новые регистрации и откладывает необязательные работы. Уровень сам растёт по сигналам и по ступени снижается, когда тихо.</p>
        <p className="text-xs" style={{ color: C.amber }}>Объёмную атаку (DDoS), которая забивает канал, приложение отбить не может — для этого нужен Cloudflare или защита у хостера. {d.cloudflare.configured ? 'Cloudflare подключён: на «Атаке» включается режим Under Attack.' : 'Cloudflare не подключён (нужны CF_API_TOKEN и CF_ZONE_ID в .env сервера).'}</p>
        <p className="text-xs" style={{ color: C.t3 }}>Не ограничиваются: локальная сеть, доверенные адреса из настроек, проверка здоровья, шлюз SSH, сторож и агент сервера, вебхуки платежей, эта вкладка.</p>
      </Card>

      <Card title="Заблокированные адреса" icon={<Ban size={15} />}>
        {d.bans.length === 0 ? <p className="text-xs" style={{ color: C.t3 }}>Нет.</p> : d.bans.map((b: D) => (
          <div key={b.ipFp} className="flex items-center justify-between gap-2 text-xs" style={{ color: C.t1 }}><span translate="no">{b.ip || b.ipFp.slice(0, 8)} · {b.reason} · до {dt(b.expiresAt)}</span>
            {edit && <Btn tone="plain" onClick={() => void needCode('Снять блокировку адреса', async (c) => { const r = await apiCall<D>(`${A}/bans/${b.ipFp}?code=${encodeURIComponent(c)}`, { method: 'DELETE' }); flash(r.ok ? 'Адрес разблокирован' : errText(r.error)); await load(); })}>Снять</Btn>}</div>))}
        {edit && <div className="flex flex-wrap gap-2">
          <input value={ip} onChange={(e) => setIp(e.target.value.trim())} placeholder="Адрес (IPv4 или IPv6)" className="min-w-0 flex-1 rounded-xl px-3 py-1.5 text-xs" style={field} translate="no" />
          <input type="number" min={1} max={168} value={hours} onChange={(e) => setHours(Number(e.target.value))} className="w-20 rounded-xl px-2 py-1.5 text-xs" style={field} aria-label="Часов" />
          <Btn disabled={!ip} onClick={() => void needCode('Заблокировать адрес', async (c) => { await send('/bans', 'POST', { ip, hours }, 'Адрес заблокирован', c); setIp(''); })}>Заблокировать</Btn></div>}
      </Card>

      <Card title="Журнал" icon={<Activity size={15} />}>
        {d.events.length === 0 ? <p className="text-xs" style={{ color: C.t3 }}>Пока пусто.</p> : d.events.map((e: D) => (
          <div key={e.id} className="text-xs" style={{ color: C.t1 }}><span style={{ color: TONE[e.level] }}>●</span> {dt(e.at)} · <b>{KIND[e.kind] ?? e.kind}</b> · <span style={{ color: C.t2 }}>{e.detail}</span></div>))}
      </Card>

      <Card title="Настройки" icon={<Shield size={15} />}>
        <label className="flex items-center gap-2 text-xs" style={{ color: C.t1 }}><input type="checkbox" disabled={!edit} checked={s.autoEscalate} onChange={(e) => setDraft({ ...s, autoEscalate: e.target.checked })} />Сам повышать и снижать уровень по сигналам</label>
        <label className="flex items-center gap-2 text-xs" style={{ color: C.t1 }}><input type="checkbox" disabled={!edit} checked={s.autoAttack} onChange={(e) => setDraft({ ...s, autoAttack: e.target.checked })} />Разрешить автоматически доходить до «Атаки»</label>
        <label className="flex items-center gap-2 text-xs" style={{ color: C.t1 }}><input type="checkbox" disabled={!edit} checked={s.cloudflare} onChange={(e) => setDraft({ ...s, cloudflare: e.target.checked })} />На «Атаке» включать Cloudflare Under Attack (если подключён)</label>
        <label className="text-[11px]" style={{ color: C.t2 }}>Тишина до снижения на ступень, минут
          <input type="number" disabled={!edit} value={s.calmMinutes} onChange={(e) => setDraft({ ...s, calmMinutes: Number(e.target.value) })} className="mt-0.5 w-full rounded-lg px-2 py-1 text-xs" style={field} /></label>
        <label className="text-[11px]" style={{ color: C.t2 }}>Доверенные адреса (через пробел или запятую) — не ограничиваются
          <input disabled={!edit} value={(s.trustedIps as string[]).join(' ')} onChange={(e) => setDraft({ ...s, trustedIps: e.target.value.split(/[\s,;]+/).filter(Boolean) })} className="mt-0.5 w-full rounded-lg px-2 py-1 text-xs" style={field} translate="no" /></label>
        <div className="grid gap-2 sm:grid-cols-2">{Object.keys(TH).map((k) => (
          <label key={k} className="text-[11px]" style={{ color: C.t2 }}>{TH[k]}
            <input type="number" disabled={!edit} value={s.thresholds[k]} onChange={(e) => setDraft({ ...s, thresholds: { ...s.thresholds, [k]: Number(e.target.value) } })} className="mt-0.5 w-full rounded-lg px-2 py-1 text-xs" style={field} /></label>))}</div>
        {edit ? <div className="flex gap-2"><Btn disabled={!draft} onClick={() => void needCode('Сохранить настройки файрвола', async (c) => { const r = await send('/settings', 'PUT', { settings: draft }, 'Сохранено', c); if (r.ok) setDraft(null); })}>Сохранить</Btn>
          {draft && <Btn tone="plain" onClick={() => setDraft(null)}>Сбросить правку</Btn>}</div>
          : <p className="text-xs" style={{ color: C.t3 }}>Менять настройки может только владелец.</p>}
      </Card>
    </div>
  );
};
