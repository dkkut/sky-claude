/**
 * Вкладка «Sky Prime»: правила кэшбэка Prime Points, каталог наград, очередь ручной выдачи и журнал кэшбэка.
 * Сервер: server/primecashback.mjs, server/primerewards.mjs, право `prime`. Любое изменение — с подтверждением личности (код).
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Loader2, KeyRound } from 'lucide-react';
import { apiCall } from '@/core/auth/api';
import { flash } from '@/shared/flash';

const C = { l1: 'var(--bg-l1)', l2: 'var(--bg-l2)', brd: 'var(--border)', t1: 'var(--t1)', t2: 'var(--t2)', t3: 'var(--t3)', acc: 'var(--accent)', red: 'var(--red)', green: 'var(--green)' };
const field = { background: C.l2, border: `1px solid ${C.brd}`, color: C.t1 };
const A = '/api/admin/prime';
type Data = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const ERR: Record<string, string> = {
  not_allowed: 'Недостаточно прав.', step_up_required: 'Нужно подтверждение личности.', step_up_invalid: 'Код не подошёл.', step_up_exhausted: 'Слишком много неверных кодов — запросите новый.',
  bad_field: 'Проверьте значение поля.', rule_ended: 'Завершённое правило не возобновить.', not_found: 'Не найдено.', not_pending: 'Уже обработано.', reason_required: 'Укажите причину (от 3 знаков).', too_many_requests: 'Слишком часто, подождите минуту.',
};
const errText = (e?: string, f?: string) => ((e && ERR[e]) || `Не получилось${e ? ` (${e})` : ''}`) + (f ? ` Поле: ${f}.` : '');
const dt = (s?: string | null) => (s ? new Date(s).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');
const Btn = ({ children, onClick, disabled, tone = 'acc' }: { children: ReactNode; onClick: () => void; disabled?: boolean; tone?: 'acc' | 'red' | 'plain' }) => (
  <button type="button" disabled={disabled} onClick={onClick} className="rounded-xl px-3 py-1.5 text-xs font-bold disabled:opacity-40"
    style={tone === 'acc' ? { background: C.acc, color: '#fff' } : tone === 'red' ? { background: 'rgba(239,68,68,.15)', color: C.red } : { background: C.l2, color: C.t1, border: `1px solid ${C.brd}` }}>{children}</button>
);
const Card = ({ title, children }: { title: string; children: ReactNode }) => (
  <div className="space-y-2 rounded-2xl p-4" style={{ background: C.l1, border: `1px solid ${C.brd}` }}><p className="text-sm font-bold" style={{ color: C.t1 }}>{title}</p>{children}</div>
);
const Num = ({ label, value, onChange, w = 'w-28' }: { label: string; value: unknown; onChange: (v: string) => void; w?: string }) => (
  <label className="text-[11px]" style={{ color: C.t3 }}>{label}
    <input value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} inputMode="decimal" className={`mt-0.5 block ${w} rounded-lg px-2 py-1.5 text-sm`} style={field} />
  </label>
);

const blankRule: Data = { title: '', trigger: 'go_taxi', tab: 'music', kind: 'percent', percent: '3', fixedPoints: '10', minAmountRub: '0', maxPointsEvent: '500', perUserDayEvents: '0', perUserMonthPoints: '5000', primeOnly: false, holdDays: '3', startsAt: '', endsAt: '', budgetPoints: '', status: 'paused' };
const STATUS_RU: Record<string, string> = { active: 'действует', paused: 'на паузе', ended: 'завершено' };
const localDt = (s?: string | null) => (s ? new Date(new Date(s).getTime() - new Date(s).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '');

/** Правила «за что и сколько»: заказ такси, вкладка, процент с покупки Prime… Каждое изменение — с кодом подтверждения личности. */
const RulesCard = ({ guarded, write }: { guarded: (fn: (c: string) => Promise<void>) => Promise<void>; write: (m: string, path: string, body: Data, ok: string, c: string) => Promise<boolean> }) => {
  const [d, setD] = useState<Data | null>(null);
  const [edit, setEdit] = useState<Data | null>(null);
  const load = useCallback(async () => { const r = await apiCall<Data>(`${A}/cashback/rules`); if (r.ok) setD(r.data ?? {}); }, []);
  useEffect(() => { void load(); }, [load]);
  if (!d) return <Loader2 size={16} className="animate-spin" style={{ color: C.t3 }} />;
  const meta = d.meta as Data;
  const rules = d.rules as Data[];
  const isTab = edit?.trigger === 'tab_visit';
  const fixedOnly = isTab || edit?.trigger === 'kassa_scan';   // у вкладки и у сканирования QR нет суммы — только фиксированные баллы
  const save = (b: Data, method: string, path: string, ok: string) => guarded(async (c) => { if (await write(method, path, b, ok, c)) { setEdit(null); await load(); } });
  const sum = (r: Data) => `${r.kind === 'percent' ? `${r.percent}% от суммы` : `${r.fixedPoints} б. за раз`}${r.minAmountRub ? ` · от ${r.minAmountRub} ₽` : ''} · до ${r.maxPointsEvent} б. за раз${r.perUserDayEvents ? ` · ${r.perUserDayEvents}/сутки` : ''} · до ${r.perUserMonthPoints} б. в месяц на человека${r.primeOnly ? ' · только Prime' : ''}${r.holdDays ? ` · холд ${r.holdDays} дн.` : ''}${r.budgetPoints != null ? ` · бюджет ${r.spentPoints}/${r.budgetPoints} б.` : ''}${r.endsAt ? ` · до ${dt(r.endsAt)}` : ''}`;
  return (
    <Card title="За что начисляется кэшбэк">
      <p className="text-[11px] leading-relaxed" style={{ color: C.t3 }}>
        Правило = повод + сколько баллов. Повод: заказ такси, доставки, еды или жилья в Sky GO (по подтверждённой исполнителем оплате), покупка Prime, пополнение кошелька, заказ в Market, пользование вкладкой (раз в сутки).
        Если подходят несколько действующих правил, баллы начисляются по каждому. Новое правило создаётся на паузе. Начисляются только Prime Points; один повод — одно начисление по правилу.
      </p>
      {rules.length === 0 && <p className="text-xs" style={{ color: C.t3 }}>Правил пока нет — людям ничего не начисляется по этому разделу.</p>}
      {rules.map((r) => (
        <div key={r.id} className="flex flex-wrap items-center gap-2 rounded-lg px-3 py-2 text-xs" style={{ background: C.l2, color: C.t2 }}>
          <span translate="no" className="font-bold" style={{ color: C.t1 }}>{r.title}</span>
          <span>{`${r.triggerLabel}${r.tabLabel ? ` · ${r.tabLabel}` : ''}`}</span>
          <span>{sum(r)}</span>
          <span style={{ color: r.status === 'active' ? C.green : C.t3 }}>{STATUS_RU[r.status]}</span>
          <span style={{ color: C.t3 }}>{`выдано ${(r.grants?.paid?.points ?? 0)} б.${r.grants?.pending ? ` · ждёт ${r.grants.pending.points} б.` : ''}`}</span>
          <span className="ml-auto flex gap-1.5">
            {r.status !== 'ended' && <Btn tone="plain" onClick={() => void save({ status: r.status === 'active' ? 'paused' : 'active' }, 'POST', `/cashback/rules/${r.id}/status`, r.status === 'active' ? 'Правило на паузе' : 'Правило включено')}>{r.status === 'active' ? 'Пауза' : 'Включить'}</Btn>}
            {r.status !== 'ended' && <Btn tone="red" onClick={() => void save({ status: 'ended' }, 'POST', `/cashback/rules/${r.id}/status`, 'Правило завершено')}>Завершить</Btn>}
            <Btn tone="plain" onClick={() => setEdit({ ...r, startsAt: localDt(r.startsAt), endsAt: localDt(r.endsAt), budgetPoints: r.budgetPoints ?? '' })}>Изменить</Btn>
          </span>
        </div>
      ))}
      {!edit && <Btn tone="plain" onClick={() => setEdit({ ...blankRule })}>Добавить правило</Btn>}
      {edit && (
        <div className="space-y-2 rounded-xl p-3" style={{ background: C.l2, border: `1px solid ${C.brd}` }}>
          <input value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} placeholder="Название правила (видят люди)" aria-label="Название правила" className="w-full rounded-lg px-3 py-2 text-sm" style={field} />
          <div className="flex flex-wrap gap-2">
            <label className="text-[11px]" style={{ color: C.t3 }}>За что
              <select value={edit.trigger} onChange={(e) => setEdit({ ...edit, trigger: e.target.value, ...(e.target.value === 'tab_visit' ? { kind: 'fixed', perUserDayEvents: '1', holdDays: '0' } : e.target.value === 'kassa_scan' ? { kind: 'fixed', perUserDayEvents: '3', holdDays: '0', primeOnly: true } : {}) })} className="mt-0.5 block rounded-lg px-2 py-1.5 text-sm" style={field}>
                {(meta.triggers as Data[]).map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
              </select>
            </label>
            {isTab && (
              <label className="text-[11px]" style={{ color: C.t3 }}>Вкладка
                <select value={edit.tab ?? 'music'} onChange={(e) => setEdit({ ...edit, tab: e.target.value })} className="mt-0.5 block rounded-lg px-2 py-1.5 text-sm" style={field}>
                  {(meta.tabs as Data[]).map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
                </select>
              </label>
            )}
            {!fixedOnly && (
              <label className="text-[11px]" style={{ color: C.t3 }}>Сколько
                <select value={edit.kind} onChange={(e) => setEdit({ ...edit, kind: e.target.value })} className="mt-0.5 block rounded-lg px-2 py-1.5 text-sm" style={field}>
                  <option value="percent">Процент от суммы</option><option value="fixed">Фиксированно баллов</option>
                </select>
              </label>
            )}
            {edit.kind === 'percent' && !fixedOnly ? <Num label="Процент, %" value={edit.percent} onChange={(v) => setEdit({ ...edit, percent: v })} /> : <Num label="Баллов за раз" value={edit.fixedPoints} onChange={(v) => setEdit({ ...edit, fixedPoints: v })} />}
            {!fixedOnly && <Num label="Мин. сумма, ₽" value={edit.minAmountRub} onChange={(v) => setEdit({ ...edit, minAmountRub: v })} />}
            <Num label="Макс. баллов за раз" value={edit.maxPointsEvent} onChange={(v) => setEdit({ ...edit, maxPointsEvent: v })} />
            {!isTab && <Num label="Раз в сутки (0 — без предела)" value={edit.perUserDayEvents} onChange={(v) => setEdit({ ...edit, perUserDayEvents: v })} w="w-40" />}
            <Num label="Макс. в месяц на человека" value={edit.perUserMonthPoints} onChange={(v) => setEdit({ ...edit, perUserMonthPoints: v })} />
            {!fixedOnly && <Num label="Холд, дней" value={edit.holdDays} onChange={(v) => setEdit({ ...edit, holdDays: v })} />}
            <Num label="Бюджет, баллов (пусто — без предела)" value={edit.budgetPoints} onChange={(v) => setEdit({ ...edit, budgetPoints: v })} w="w-44" />
            <label className="text-[11px]" style={{ color: C.t3 }}>Начало<input type="datetime-local" value={edit.startsAt ?? ''} onChange={(e) => setEdit({ ...edit, startsAt: e.target.value })} className="mt-0.5 block rounded-lg px-2 py-1.5 text-sm" style={field} /></label>
            <label className="text-[11px]" style={{ color: C.t3 }}>Конец<input type="datetime-local" value={edit.endsAt ?? ''} onChange={(e) => setEdit({ ...edit, endsAt: e.target.value })} className="mt-0.5 block rounded-lg px-2 py-1.5 text-sm" style={field} /></label>
          </div>
          <label className="flex items-center gap-2 text-xs" style={{ color: C.t2 }}><input type="checkbox" checked={Boolean(edit.primeOnly)} onChange={(e) => setEdit({ ...edit, primeOnly: e.target.checked })} />Только для владельцев Prime</label>
          <div className="flex gap-2">
            <Btn onClick={() => void save({ ...edit, startsAt: edit.startsAt ? new Date(edit.startsAt).toISOString() : '', endsAt: edit.endsAt ? new Date(edit.endsAt).toISOString() : '' }, edit.id ? 'PUT' : 'POST', edit.id ? `/cashback/rules/${edit.id}` : '/cashback/rules', 'Правило сохранено')}>Сохранить</Btn>
            <Btn tone="plain" onClick={() => setEdit(null)}>Отмена</Btn>
          </div>
        </div>
      )}
    </Card>
  );
};

export const PrimeTab = () => {
  const [d, setD] = useState<Data | null>(null);
  const [failed, setFailed] = useState('');
  const [s, setS] = useState<Data | null>(null);
  const [edit, setEdit] = useState<Data | null>(null);
  const [ask, setAsk] = useState<null | ((code: string) => Promise<void>)>(null);
  const [method, setMethod] = useState('');
  const [code, setCode] = useState('');
  const [reason, setReason] = useState('');

  const load = useCallback(async () => {
    const r = await apiCall<Data>(A);
    if (r.ok) { setD(r.data ?? {}); setS(r.data?.settings ?? null); setFailed(''); } else setFailed(errText(r.error));
  }, []);
  useEffect(() => { void load(); }, [load]);

  // Любое изменение: сначала код подтверждения личности, затем запрос с ним
  const guarded = async (fn: (code: string) => Promise<void>) => {
    const r = await apiCall<Data>(`${A}/step-up`, { method: 'POST', body: '{}' });
    if (!r.ok) { flash(errText(r.error)); return; }
    setMethod(String(r.data?.method ?? 'email')); setCode(''); setAsk(() => fn);
  };
  const write = async (method2: string, path: string, body: Data, ok: string, c: string) => {
    const r = await apiCall<Data>(`${A}${path}`, { method: method2, body: JSON.stringify({ ...body, stepUpCode: c }) });
    if (!r.ok) { flash(errText(r.error, r.data?.field)); return false; }
    flash(ok); await load(); return true;
  };

  if (failed) return <p className="text-sm" style={{ color: C.red }}>{failed}</p>;
  if (!d || !s) return <Loader2 size={16} className="animate-spin" style={{ color: C.t3 }} />;
  const set = (k: string, v: string) => setS({ ...s, [k]: v });
  const tot = d.cashback?.totals ?? {};

  return (
    <div className="space-y-4">
      {ask && (
        <div className="space-y-2 rounded-xl p-3" style={{ background: C.l2, border: `1px solid ${C.acc}` }}>
          <p className="flex items-center gap-1.5 text-xs font-bold" style={{ color: C.t1 }}><KeyRound size={13} style={{ color: C.acc }} />Подтвердите личность</p>
          <p className="text-[11px]" style={{ color: C.t3 }}>{method === 'app' ? 'Код из приложения двухэтапной защиты.' : 'Код отправлен на почту, действует пять минут.'}</p>
          <div className="flex gap-2">
            <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" placeholder="000000" aria-label="Код подтверждения" className="flex-1 rounded-lg px-3 py-2 text-sm tracking-[0.3em]" style={field} />
            <Btn disabled={code.length < 6} onClick={() => { const f = ask; const c = code; setAsk(null); void f(c); }}>Подтвердить</Btn>
          </div>
          <button type="button" onClick={() => setAsk(null)} className="text-[11px]" style={{ color: C.t3 }}>Отмена</button>
        </div>
      )}

      <RulesCard guarded={guarded} write={write} />

      <Card title="Правила кэшбэка Prime Points">
        <p className="text-[11px] leading-relaxed" style={{ color: C.t3 }}>
          Кэшбэк начисляется баллами за завершённые заказы Sky Market (заказ оплачивается напрямую продавцу — Sky денег не видит). Баллы «созревают» несколько дней, чтобы хватило времени на спор и возврат.
          Один заказ — один кэшбэк; покупатель и продавец не могут быть одним аккаунтом. Правила — решение платформы, не юридическое заключение.
        </p>
        <label className="flex items-center gap-2 text-xs" style={{ color: C.t2 }}><input type="checkbox" checked={Boolean(s.enabled)} onChange={(e) => setS({ ...s, enabled: e.target.checked })} />Кэшбэк включён</label>
        <div className="flex flex-wrap gap-2">
          <Num label="% для Prime" value={s.primePercent} onChange={(v) => set('primePercent', v)} />
          <Num label="% для остальных" value={s.basePercent} onChange={(v) => set('basePercent', v)} />
          <Num label="Мин. заказ, ₽" value={s.minOrderRub} onChange={(v) => set('minOrderRub', v)} />
          <Num label="Макс. баллов с заказа" value={s.maxPointsPerOrder} onChange={(v) => set('maxPointsPerOrder', v)} />
          <Num label="Макс. в месяц на человека" value={s.maxPointsPerMonth} onChange={(v) => set('maxPointsPerMonth', v)} />
          <Num label="Макс. в месяц на продавца" value={s.maxPointsPerSellerMonth} onChange={(v) => set('maxPointsPerSellerMonth', v)} />
          <Num label="Холд, дней" value={s.holdDays} onChange={(v) => set('holdDays', v)} />
        </div>
        <Btn onClick={() => void guarded((c) => write('PUT', '/cashback/settings', { settings: s }, 'Правила сохранены', c).then(() => undefined))}>Сохранить правила</Btn>
        <p className="text-[11px]" style={{ color: C.t3 }}>
          {`Ожидает: ${tot.pending?.points ?? 0} б. (${tot.pending?.count ?? 0}) · Зачислено: ${tot.paid?.points ?? 0} б. (${tot.paid?.count ?? 0}) · Отменено: ${tot.cancelled?.count ?? 0}`}
        </p>
      </Card>

      <Card title="Каталог наград">
        <p className="text-[11px]" style={{ color: C.t3 }}>Награды «Prime на N дней» выдаются сразу; «Вручную» — оформляет сотрудник в очереди ниже. Пока нет активных наград, у людей каталог пуст.</p>
        {(d.rewards as Data[]).map((r) => (
          <div key={r.id} className="flex flex-wrap items-center gap-2 rounded-lg px-3 py-2 text-xs" style={{ background: C.l2, color: C.t2 }}>
            <span translate="no" className="font-bold" style={{ color: C.t1 }}>{r.title}</span>
            <span>{`${r.cost} б. · ${r.kind === 'prime_days' ? `Prime +${r.valueDays} дн.` : 'вручную'}${r.stock != null ? ` · осталось ${r.stock}` : ''}${r.perUserLimit ? ` · до ${r.perUserLimit} на человека` : ''}${r.minTier ? ` · от ${r.minTier}` : ''}`}</span>
            <span style={{ color: r.active ? C.green : C.t3 }}>{r.active ? 'включена' : 'выключена'}</span>
            <span className="ml-auto"><Btn tone="plain" onClick={() => setEdit({ ...r })}>Изменить</Btn></span>
          </div>
        ))}
        {!edit && <Btn tone="plain" onClick={() => setEdit({ title: '', description: '', cost: 100, kind: 'manual', valueDays: 30, stock: '', perUserLimit: '', minTier: '', active: false })}>Добавить награду</Btn>}
        {edit && (
          <div className="space-y-2 rounded-xl p-3" style={{ background: C.l2, border: `1px solid ${C.brd}` }}>
            <input value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} placeholder="Название" aria-label="Название" className="w-full rounded-lg px-3 py-2 text-sm" style={field} />
            <input value={edit.description ?? ''} onChange={(e) => setEdit({ ...edit, description: e.target.value })} placeholder="Описание" aria-label="Описание" className="w-full rounded-lg px-3 py-2 text-sm" style={field} />
            <div className="flex flex-wrap gap-2">
              <Num label="Цена, баллов" value={edit.cost} onChange={(v) => setEdit({ ...edit, cost: v })} />
              <label className="text-[11px]" style={{ color: C.t3 }}>Тип
                <select value={edit.kind} onChange={(e) => setEdit({ ...edit, kind: e.target.value })} className="mt-0.5 block rounded-lg px-2 py-1.5 text-sm" style={field}>
                  <option value="manual">Вручную (сотрудник)</option><option value="prime_days">Prime на N дней</option>
                </select>
              </label>
              {edit.kind === 'prime_days' && <Num label="Дней Prime" value={edit.valueDays} onChange={(v) => setEdit({ ...edit, valueDays: v })} />}
              <Num label="Остаток (пусто — без предела)" value={edit.stock} onChange={(v) => setEdit({ ...edit, stock: v })} w="w-40" />
              <Num label="На человека (пусто — без предела)" value={edit.perUserLimit} onChange={(v) => setEdit({ ...edit, perUserLimit: v })} w="w-44" />
              <label className="text-[11px]" style={{ color: C.t3 }}>Мин. уровень
                <select value={edit.minTier ?? ''} onChange={(e) => setEdit({ ...edit, minTier: e.target.value })} className="mt-0.5 block rounded-lg px-2 py-1.5 text-sm" style={field}>
                  <option value="">любой</option><option value="gold">Gold</option><option value="platinum">Platinum</option><option value="diamond">Diamond</option>
                </select>
              </label>
            </div>
            <label className="flex items-center gap-2 text-xs" style={{ color: C.t2 }}><input type="checkbox" checked={Boolean(edit.active)} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} />Показывать людям</label>
            <div className="flex gap-2">
              <Btn onClick={() => void guarded(async (c) => { if (await write(edit.id ? 'PUT' : 'POST', edit.id ? `/rewards/${edit.id}` : '/rewards', edit, 'Награда сохранена', c)) setEdit(null); })}>Сохранить</Btn>
              <Btn tone="plain" onClick={() => setEdit(null)}>Отмена</Btn>
            </div>
          </div>
        )}
      </Card>

      <Card title={`Очередь ручной выдачи (${(d.queue as Data[]).length})`}>
        {(d.queue as Data[]).length === 0 && <p className="text-xs" style={{ color: C.t3 }}>Заявок нет.</p>}
        {(d.queue as Data[]).length > 0 && <input value={reason} onChange={(e) => setReason(e.target.value.slice(0, 160))} placeholder="Комментарий / причина отказа" aria-label="Комментарий" className="w-full rounded-lg px-3 py-2 text-sm" style={field} />}
        {(d.queue as Data[]).map((z) => (
          <div key={z.id} className="flex flex-wrap items-center gap-2 rounded-lg px-3 py-2 text-xs" style={{ background: C.l2, color: C.t2 }}>
            <span translate="no" className="font-bold" style={{ color: C.t1 }}>{z.title}</span><span translate="no">@{z.user}</span><span>{`${z.cost} б. · ${dt(z.createdAt)}`}</span>
            <span className="ml-auto flex gap-1.5">
              <Btn onClick={() => void guarded((c) => write('POST', `/redemptions/${z.id}/approve`, { note: reason }, 'Отмечено выданным', c).then(() => undefined))}>Выдано</Btn>
              <Btn tone="red" onClick={() => void guarded((c) => write('POST', `/redemptions/${z.id}/reject`, { note: reason }, 'Отказ, баллы возвращены', c).then(() => undefined))}>Отказать и вернуть баллы</Btn>
            </span>
          </div>
        ))}
      </Card>

      <Card title="Журнал кэшбэка">
        {(d.cashback?.items as Data[]).length === 0 && <p className="text-xs" style={{ color: C.t3 }}>Начислений ещё не было.</p>}
        {(d.cashback?.items as Data[]).map((c) => (
          <div key={c.id} className="flex flex-wrap items-center gap-2 rounded-lg px-3 py-2 text-xs" style={{ background: C.l2, color: C.t2 }}>
            <span translate="no">@{c.buyer} ← @{c.seller}</span><span>{`${c.totalRub} ₽ · ${c.percent}% = `}<b style={{ color: C.t1 }}>{`${c.points} б.`}</b></span>
            <span>{c.status === 'pending' ? `ждёт до ${dt(c.releaseAt)}` : c.status === 'paid' ? 'зачислено' : `отменено${c.reason ? `: ${c.reason}` : ''}`}</span>
            {c.status === 'pending' && <span className="ml-auto"><Btn tone="red" onClick={() => void guarded((code2) => write('POST', `/cashback/${c.id}/cancel`, { reason: reason || 'отменено сотрудником' }, 'Кэшбэк отменён', code2).then(() => undefined))}>Отменить</Btn></span>}
          </div>
        ))}
      </Card>
    </div>
  );
};
