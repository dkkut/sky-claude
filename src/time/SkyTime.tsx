/**
 * Sky Time — три вещи про время, всё на настоящих данных:
 *  — Капсулы времени: письмо себе или другу, которое сервер физически не отдаёт до выбранной даты;
 *  — Sky Balance: мягкий учёт, сколько времени человек проводит в разделах Sky (учёт включает сам, ничего не блокируется);
 *  — «В этот день»: что было в вашем Sky в этот же день в прошлые годы (только ваши данные).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Hourglass, Gauge, CalendarHeart, Lock, Unlock, Plus, Trash2, Send } from 'lucide-react';
import { apiCall } from '@/core/auth/api';
import { visibleTick } from '@/shared/visibleTick';
import { SkyLoader } from '@/shared/SkyLoader';
import { timeApi, type BalanceSettings, type Capsule, type CapsuleList, type ThisDayItem, type UsageReport } from './api';
import { moduleTitle } from './usageTracker';

type Section = 'capsules' | 'balance' | 'today';
const SECTIONS: { id: Section; label: string; Icon: typeof Hourglass }[] = [
  { id: 'capsules', label: 'Капсулы', Icon: Hourglass },
  { id: 'balance', label: 'Баланс', Icon: Gauge },
  { id: 'today', label: 'В этот день', Icon: CalendarHeart },
];

const ERR: Record<string, string> = {
  bad_text: 'Напишите хотя бы пару слов.', bad_date: 'Выберите дату вскрытия.', too_soon: 'Капсулу можно запечатать минимум на час.',
  too_far: 'Дальше чем на 10 лет капсулу не запечатать.', not_friend: 'Отправить капсулу можно только другу.',
  limit_reached: 'Запечатанных капсул уже максимум — дождитесь вскрытия или отмените одну.', daily_limit: 'За сутки можно запечатать не больше 10 капсул.',
  locked: 'Эту капсулу нельзя отменить — вы запечатали её без права отмены.', not_found: 'Капсула не найдена.', not_sealed: 'Капсула уже вскрыта.',
  bad_value: 'Проверьте значения.', quiet_both: 'Укажите и начало, и конец тихих часов.',
};
const errText = (e?: string) => ERR[e ?? ''] ?? (e ? `Не удалось выполнить (${e})` : 'Не удалось выполнить');

const fmtDur = (sec: number) => {
  const m = Math.round(sec / 60);
  if (m < 1) return sec > 0 ? '<1 мин' : '0 мин';
  return m >= 60 ? `${Math.floor(m / 60)} ч ${m % 60} мин` : `${m} мин`;
};
const fmtDate = (iso: string) => new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const left = (iso: string) => {
  const ms = Date.parse(iso) - Date.now();
  if (ms <= 0) return 'вот-вот вскроется';
  const d = Math.floor(ms / 86_400_000), h = Math.floor((ms % 86_400_000) / 3_600_000), m = Math.floor((ms % 3_600_000) / 60_000);
  return d > 0 ? `${d} дн ${h} ч` : h > 0 ? `${h} ч ${m} мин` : `${m} мин`;
};

const card: React.CSSProperties = { background: 'var(--bg-l1)', border: '1px solid var(--border)', borderRadius: 20, padding: 16 };
const inputCls = 'w-full rounded-xl px-3 py-2 text-sm outline-none';
const inputSt: React.CSSProperties = { background: 'var(--bg-l2)', color: 'var(--t1)', border: '1px solid var(--border)' };
const btn = 'rounded-full px-4 py-2 text-sm font-semibold active:scale-95 transition-transform disabled:opacity-50';

export const SkyTime = () => {
  const [sec, setSec] = useState<Section>('capsules');
  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden" style={{ color: 'var(--t1)' }}>
      <div className="shrink-0 px-4 pt-4">
        <div className="glass-pill flex items-center gap-1 p-1" role="tablist">
          {SECTIONS.map(({ id, label, Icon }) => (
            <button key={id} type="button" role="tab" aria-selected={sec === id} onClick={() => setSec(id)}
              className="relative isolate flex min-h-[40px] flex-1 items-center justify-center gap-1.5 rounded-full px-2 text-[13px] font-semibold">
              {sec === id && <motion.span layoutId="time-lens" className="glass-lens absolute inset-0 -z-10 rounded-full" transition={{ type: 'spring', stiffness: 420, damping: 34 }} />}
              <Icon size={15} />{label}
            </button>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-4 pb-24 pt-4">
        {sec === 'capsules' && <Capsules />}
        {sec === 'balance' && <Balance />}
        {sec === 'today' && <Today />}
      </div>
    </div>
  );
};

/* ─────────── Капсулы ─────────── */

interface Friend { id: string; name: string; username?: string }

const Capsules = () => {
  const [data, setData] = useState<CapsuleList | null>(null);
  const [failed, setFailed] = useState('');
  const [form, setForm] = useState(false);
  const [, tick] = useState(0);
  const load = useCallback(async () => {
    const r = await timeApi.capsules();
    if (r.ok && r.data) { setData(r.data); setFailed(''); } else setFailed(errText(r.error));
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { const t = window.setInterval(visibleTick(() => { tick((n) => n + 1); void load(); }), 30_000); return () => window.clearInterval(t); }, [load]);

  if (!data) return failed ? <p className="text-sm" role="alert">{failed} <button type="button" className="underline" onClick={() => void load()}>Повторить</button></p> : <SkyLoader />;
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <div style={card}>
        <h2 className="text-lg font-bold">Капсулы времени</h2>
        <p className="mt-1 text-sm" style={{ color: 'var(--t2)' }}>
          Напишите письмо себе или другу и выберите дату вскрытия. До этого дня текст не может прочитать никто — даже вы: сервер просто его не отдаёт.
        </p>
        <button type="button" onClick={() => setForm((v) => !v)} className={`${btn} mt-3 inline-flex items-center gap-2`} style={{ background: 'var(--accent)', color: '#fff' }}>
          <Plus size={16} />{form ? 'Закрыть' : 'Новая капсула'}
        </button>
        <p className="mt-2 text-xs" style={{ color: 'var(--t3)' }}>{`Запечатано: ${data.sealed.length} из ${data.limits.sealed}`}</p>
      </div>
      {form && <CapsuleForm limit={data.limits.textMax} onDone={() => { setForm(false); void load(); }} />}
      <Block title="Запечатаны" empty="Запечатанных капсул пока нет.">
        {data.sealed.map((c) => <SealedRow key={c.id} c={c} onChange={load} />)}
      </Block>
      <Block title="Вскрыты" empty="Вскрытых капсул пока нет.">
        {data.opened.map((c) => <OpenedRow key={c.id} c={c} />)}
      </Block>
    </div>
  );
};

const Block = ({ title, empty, children }: { title: string; empty: string; children: React.ReactNode[] }) => (
  <section className="flex flex-col gap-2">
    <h3 className="px-1 text-sm font-semibold" style={{ color: 'var(--t2)' }}>{title}</h3>
    {children.length ? children : <p className="px-1 text-sm" style={{ color: 'var(--t3)' }}>{empty}</p>}
  </section>
);


const SealedRow = ({ c, onChange }: { c: Capsule; onChange: () => void }) => {
  const [err, setErr] = useState('');
  const cancel = async () => {
    if (!window.confirm('Отменить капсулу? Текст будет удалён.')) return;
    const r = await timeApi.cancelCapsule(c.id);
    if (r.ok) onChange(); else setErr(errText(r.error));
  };
  return (
    <div style={card} className="flex items-center gap-3">
      <Lock size={20} style={{ color: 'var(--accent)' }} />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold">{c.toSelf ? 'Себе' : <>{c.fromMe ? 'Для' : 'От'}{' '}<span translate="no">{c.peer.name}</span></>}</div>
        <div className="text-xs" style={{ color: 'var(--t2)' }}>{`Вскроется ${fmtDate(c.openAt)} · через ${left(c.openAt)}`}</div>
        {c.locked && <div className="text-xs" style={{ color: 'var(--t3)' }}>Без права отмены</div>}
        {err && <div className="text-xs" role="alert" style={{ color: '#ef4444' }}>{err}</div>}
      </div>
      {!c.locked && c.fromMe && <button type="button" aria-label="Отменить капсулу" onClick={() => void cancel()} className="rounded-full p-2" style={{ background: 'var(--bg-l2)' }}><Trash2 size={16} /></button>}
    </div>
  );
};

const OpenedRow = ({ c }: { c: Capsule }) => (
  <div style={card}>
    <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--t2)' }}>
      <Unlock size={14} />{c.toSelf ? 'Письмо себе' : c.fromMe ? 'Вы написали' : 'Вам написали'}{!c.toSelf && <span translate="no">{` · ${c.peer.name}`}</span>}
      <span className="ml-auto">{`Вскрыта ${fmtDate(c.openedAt ?? c.openAt)}`}</span>
    </div>
    {c.title && <div className="mt-2 text-base font-bold" style={{ color: "var(--t1)" }} translate="no">{c.title}</div>}
    <p className="mt-1 whitespace-pre-wrap break-words text-sm" translate="no">{c.text}</p>
  </div>
);

const CapsuleForm = ({ limit, onDone }: { limit: number; onDone: () => void }) => {
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [date, setDate] = useState('');
  const [to, setTo] = useState('self');
  const [locked, setLocked] = useState(false);
  const [friends, setFriends] = useState<Friend[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => {
    void apiCall<{ myFriends: Friend[] }>('/api/maps/friends').then((r) => { if (r.ok && r.data) setFriends(r.data.myFriends ?? []); });
  }, []);
  const minDate = useMemo(() => new Date(Date.now() + 3_600_000 - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16), []);
  const submit = async () => {
    setErr('');
    if (!date) { setErr(errText('bad_date')); return; }
    setBusy(true);
    const r = await timeApi.createCapsule({ text, title, openAt: new Date(date).toISOString(), to, locked });
    setBusy(false);
    if (r.ok) onDone(); else setErr(errText(r.error));
  };
  return (
    <div style={card} className="flex flex-col gap-3">
      <input className={inputCls} style={inputSt} placeholder="Заголовок (необязательно)" maxLength={80} value={title} onChange={(e) => setTitle(e.target.value)} translate="no" />
      <textarea className={inputCls} style={{ ...inputSt, minHeight: 120 }} placeholder="Что вы хотите сказать будущему?" maxLength={limit} value={text} onChange={(e) => setText(e.target.value)} translate="no" />
      <div className="text-right text-xs" style={{ color: 'var(--t3)' }}>{text.length} / {limit}</div>
      <label className="text-sm">Когда вскрыть
        <input type="datetime-local" className={`${inputCls} mt-1`} style={inputSt} min={minDate} value={date} onChange={(e) => setDate(e.target.value)} />
      </label>
      <label className="text-sm">Кому
        <select className={`${inputCls} mt-1`} style={inputSt} value={to} onChange={(e) => setTo(e.target.value)}>
          <option value="self">Себе</option>
          {friends.map((f) => <option key={f.id} value={f.id} translate="no">{f.name}</option>)}
        </select>
      </label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={locked} onChange={(e) => setLocked(e.target.checked)} />Нельзя отменить после запечатывания</label>
      {err && <p className="text-sm" role="alert" style={{ color: '#ef4444' }}>{err}</p>}
      <button type="button" disabled={busy || text.trim().length < 2} onClick={() => void submit()} className={`${btn} inline-flex items-center justify-center gap-2`} style={{ background: 'var(--accent)', color: '#fff' }}>
        <Send size={16} />Запечатать
      </button>
    </div>
  );
};

/* ─────────── Sky Balance ─────────── */

const hm = (min: number | null) => min == null ? '' : `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
const toMin = (v: string) => { if (!v) return null; const [h, m] = v.split(':').map(Number); return h * 60 + m; };

const Balance = () => {
  const [set, setSet] = useState<BalanceSettings | null>(null);
  const [rep, setRep] = useState<UsageReport | null>(null);
  const [days, setDays] = useState(7);
  const [err, setErr] = useState('');
  const [saved, setSaved] = useState(false);
  const loadRep = useCallback(async () => { const r = await timeApi.report(days); if (r.ok && r.data) setRep(r.data); }, [days]);
  useEffect(() => { void timeApi.balance().then((r) => { if (r.ok && r.data) setSet(r.data); else setErr(errText(r.error)); }); }, []);
  useEffect(() => { void loadRep(); }, [loadRep]);
  if (!set) return err ? <p className="text-sm" role="alert">{err}</p> : <SkyLoader />;

  const save = async (next: BalanceSettings) => {
    setErr(''); setSaved(false);
    const r = await timeApi.saveBalance({ ...next, tzOffset: -new Date().getTimezoneOffset() });
    if (r.ok && r.data) { setSet(r.data); setSaved(true); window.dispatchEvent(new Event('sky:balance-changed')); void loadRep(); } else setErr(errText(r.error));
  };
  const wipe = async () => {
    if (!window.confirm('Стереть всю статистику времени? Это нельзя отменить.')) return;
    const r = await timeApi.clearUsage();
    if (r.ok) void loadRep(); else setErr(errText(r.error));
  };
  const max = Math.max(1, ...(rep?.byDay.map((d) => d.seconds) ?? [1]));
  const delta = rep && rep.previous > 0 ? Math.round(((rep.total - rep.previous) / rep.previous) * 100) : null;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <div style={card}>
        <h2 className="text-lg font-bold">Sky Balance</h2>
        <p className="mt-1 text-sm" style={{ color: 'var(--t2)' }}>
          Мягкий самоконтроль: Sky считает, сколько вы проводите в разделах, и по желанию напоминает о лимите. Ничего не блокируется — решаете вы. Учёт выключен, пока вы сами его не включите; считаются только секунды по разделам, без содержимого.
        </p>
        <label className="mt-3 flex items-center gap-2 text-sm font-semibold">
          <input type="checkbox" checked={set.tracking} onChange={(e) => void save({ ...set, tracking: e.target.checked })} />Вести учёт времени
        </label>
      </div>

      {set.tracking && (
        <div style={card} className="flex flex-col gap-3">
          <h3 className="text-sm font-semibold">Напоминания</h3>
          <label className="text-sm">Общий лимит в день, минут (пусто — без лимита)
            <input type="number" min={5} max={1440} className={`${inputCls} mt-1`} style={inputSt} value={set.dailyTotal ?? ''}
              onChange={(e) => setSet({ ...set, dailyTotal: e.target.value ? Number(e.target.value) : null })} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm">Тихие часы с
              <input type="time" className={`${inputCls} mt-1`} style={inputSt} value={hm(set.quietFrom)} onChange={(e) => setSet({ ...set, quietFrom: toMin(e.target.value) })} />
            </label>
            <label className="text-sm">до
              <input type="time" className={`${inputCls} mt-1`} style={inputSt} value={hm(set.quietTo)} onChange={(e) => setSet({ ...set, quietTo: toMin(e.target.value) })} />
            </label>
          </div>
          <p className="text-xs" style={{ color: 'var(--t3)' }}>В тихие часы напоминания не показываются.</p>
          {rep && rep.byModule.length > 0 && (
            <div className="flex flex-col gap-2">
              <div className="text-sm">Лимит по разделам, минут</div>
              {rep.byModule.slice(0, 6).map((m) => (
                <label key={m.module} className="flex items-center gap-2 text-sm">
                  <span className="min-w-0 flex-1 truncate">{moduleTitle(m.module)}</span>
                  <input type="number" min={5} max={1440} className="w-24 rounded-xl px-2 py-1 text-sm outline-none" style={inputSt} value={set.limits[m.module] ?? ''}
                    onChange={(e) => { const l = { ...set.limits }; if (e.target.value) l[m.module] = Number(e.target.value); else delete l[m.module]; setSet({ ...set, limits: l }); }} />
                </label>
              ))}
            </div>
          )}
          <button type="button" className={btn} style={{ background: 'var(--accent)', color: '#fff' }} onClick={() => void save(set)}>Сохранить</button>
          {saved && <p className="text-xs" role="status" style={{ color: 'var(--t2)' }}>Сохранено.</p>}
        </div>
      )}
      {err && <p className="text-sm" role="alert" style={{ color: '#ef4444' }}>{err}</p>}

      <div style={card}>
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold">Отчёт</h3>
          <div className="ml-auto flex gap-1">
            {[7, 30].map((d) => <button key={d} type="button" onClick={() => setDays(d)} className="rounded-full px-3 py-1 text-xs font-semibold" style={{ background: days === d ? 'var(--accent)' : 'var(--bg-l2)', color: days === d ? '#fff' : 'var(--t1)' }}>{`${d} дн`}</button>)}
          </div>
        </div>
        {!rep ? <SkyLoader /> : rep.total === 0 ? (
          <p className="mt-3 text-sm" style={{ color: 'var(--t3)' }}>{set.tracking ? 'Данных пока нет — они появятся по мере использования Sky.' : 'Учёт выключен — данных нет.'}</p>
        ) : (
          <>
            <div className="mt-3 grid grid-cols-3 gap-2 text-center">
              <Stat label="Всего" value={fmtDur(rep.total)} />
              <Stat label="В день" value={fmtDur(rep.avgPerActiveDay)} />
              <Stat label="К прошлому периоду" value={delta == null ? '—' : `${delta > 0 ? '+' : ''}${delta}%`} />
            </div>
            <div className="mt-4 flex h-28 items-end gap-1" role="img" aria-label="Время по дням">
              {rep.byDay.map((d) => <div key={d.day} title={`${d.day}: ${fmtDur(d.seconds)}`} className="min-w-0 flex-1 rounded-t" style={{ height: `${Math.max(3, (d.seconds / max) * 100)}%`, background: d.seconds ? 'var(--accent)' : 'var(--bg-l2)' }} />)}
            </div>
            <div className="mt-4 flex flex-col gap-1.5">
              {rep.byModule.slice(0, 8).map((m) => (
                <div key={m.module} className="text-sm">
                  <div className="flex justify-between"><span>{moduleTitle(m.module)}</span><span style={{ color: 'var(--t2)' }}>{fmtDur(m.seconds)}</span></div>
                  <div className="mt-0.5 h-1.5 rounded-full" style={{ background: 'var(--bg-l2)' }}><div className="h-full rounded-full" style={{ width: `${(m.seconds / rep.total) * 100}%`, background: 'var(--accent)' }} /></div>
                </div>
              ))}
            </div>
          </>
        )}
        <button type="button" onClick={() => void wipe()} className="mt-4 text-xs underline" style={{ color: 'var(--t3)' }}>Стереть статистику</button>
      </div>
    </div>
  );
};

const Stat = ({ label, value }: { label: string; value: string }) => (
  <div className="rounded-2xl p-2" style={{ background: 'var(--bg-l2)' }}>
    <div className="text-base font-bold">{value}</div><div className="text-[11px]" style={{ color: 'var(--t2)' }}>{label}</div>
  </div>
);

/* ─────────── В этот день ─────────── */

const KIND: Record<ThisDayItem['kind'], string> = { registered: '🎉', post: '📝', friend: '🤝', music: '🎵', capsule: '⏳' };

const Today = () => {
  const [items, setItems] = useState<ThisDayItem[] | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    const d = new Date();
    const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    void timeApi.today(date).then((r) => { if (r.ok && r.data) setItems(r.data.items); else setErr(errText(r.error)); });
  }, []);
  if (!items) return err ? <p className="text-sm" role="alert">{err}</p> : <SkyLoader />;
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-3">
      <div style={card}>
        <h2 className="text-lg font-bold">В этот день</h2>
        <p className="mt-1 text-sm" style={{ color: 'var(--t2)' }}>Что происходило в вашем Sky в этот же день в прошлые годы. Показываются только ваши собственные данные.</p>
      </div>
      {items.length === 0 ? <p className="px-1 text-sm" style={{ color: 'var(--t3)' }}>В прошлые годы в этот день у вас ничего не было — зато сегодня можно создать новое воспоминание.</p> :
        items.map((it, i) => (
          <div key={i} style={card} className="flex items-start gap-3">
            <div className="text-2xl" aria-hidden>{KIND[it.kind]}</div>
            <div className="min-w-0 flex-1">
              <div className="text-xs" style={{ color: 'var(--t2)' }}>{it.year}</div>
              <div className="text-sm font-semibold">{it.title}{it.peer && <span translate="no">{` — ${it.peer.name}`}</span>}</div>
              {it.text && <p className="mt-1 break-words text-sm" style={{ color: 'var(--t2)' }} translate="no">{it.text}</p>}
            </div>
          </div>
        ))}
    </div>
  );
};

export default SkyTime;
