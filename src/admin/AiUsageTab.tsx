/**
 * Вкладка «AI — ресурсы и токены»: реальный расход Sky AI, бюджет и предупреждения.
 * Сервер: server/aiusage.mjs. Токены модели и деньги у поставщика — разные показатели; остаток квоты у поставщика обычно неизвестен,
 * тогда показывается наша оценка расхода против лимита, который задал владелец. Ключи не показываются: только отпечаток и последние знаки.
 * Лимиты и блокировку меняет только владелец, с подтверждением личности.
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Loader2, KeyRound, TriangleAlert } from 'lucide-react';
import { apiCall } from '@/core/auth/api';
import { flash } from '@/shared/flash';

const C = { l1: 'var(--bg-l1)', l2: 'var(--bg-l2)', brd: 'var(--border)', t1: 'var(--t1)', t2: 'var(--t2)', t3: 'var(--t3)', acc: 'var(--accent)', red: 'var(--red)', green: 'var(--green)', amber: 'var(--amber)' };
const field = { background: C.l2, border: `1px solid ${C.brd}`, color: C.t1 };
const A = '/api/admin/ai-usage';
type Data = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const ERR: Record<string, string> = {
  not_allowed: 'Недостаточно прав.', owner_only: 'Менять лимиты может только владелец.', step_up_required: 'Нужно подтверждение личности.', step_up_invalid: 'Код не подошёл.',
  step_up_exhausted: 'Слишком много неверных кодов — запросите новый.', bad_field: 'Проверьте значение поля.', too_many_requests: 'Слишком часто, подождите минуту.',
};
const errText = (e?: string, f?: string) => ((e && ERR[e]) || `Не получилось${e ? ` (${e})` : ''}`) + (f ? ` Поле: ${f}.` : '');
const n = (v: number) => Number(v ?? 0).toLocaleString('ru-RU');
const dt = (s?: string | null) => (s ? new Date(s).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');
const EVENT: Record<string, string> = { error: 'Ошибка', rate_limit: 'Лимит поставщика', budget: 'Бюджет', alert: 'Предупреждение', settings: 'Настройки' };

const Btn = ({ children, onClick, disabled, tone = 'acc' }: { children: ReactNode; onClick: () => void; disabled?: boolean; tone?: 'acc' | 'plain' }) => (
  <button type="button" disabled={disabled} onClick={onClick} className="rounded-xl px-3 py-1.5 text-xs font-bold disabled:opacity-40"
    style={tone === 'acc' ? { background: C.acc, color: '#fff' } : { background: C.l2, color: C.t1, border: `1px solid ${C.brd}` }}>{children}</button>
);
const Card = ({ title, children }: { title: string; children: ReactNode }) => (
  <div className="space-y-2 rounded-2xl p-4" style={{ background: C.l1, border: `1px solid ${C.brd}` }}><p className="text-sm font-bold" style={{ color: C.t1 }}>{title}</p>{children}</div>
);
const Stat = ({ label, value, sub }: { label: string; value: ReactNode; sub?: string }) => (
  <div className="rounded-xl px-3 py-2" style={{ background: C.l2 }}><p className="text-[11px]" style={{ color: C.t3 }}>{label}</p><p className="text-sm font-bold" style={{ color: C.t1 }}>{value}</p>{sub && <p className="text-[10.5px]" style={{ color: C.t3 }}>{sub}</p>}</div>
);
const Bar = ({ used, limit }: { used: number; limit: number | null }) => {
  if (!limit) return <p className="text-[11px]" style={{ color: C.t3 }}>Лимит не задан.</p>;
  const pct = Math.min(100, (used / limit) * 100);
  return (
    <div>
      <div className="h-2 w-full overflow-hidden rounded-full" style={{ background: C.l2 }}><div className="h-full rounded-full" style={{ width: `${pct}%`, background: pct >= 95 ? C.red : pct >= 80 ? C.amber : C.green }} /></div>
      <p className="mt-0.5 text-[11px]" style={{ color: C.t3 }}>{`${n(used)} из ${n(limit)} токенов (${Math.round(pct)}%)`}</p>
    </div>
  );
};

/** Помощники по сервисам: у каждого сервиса свои переключатель, модель, потолок ответа, суточный лимит и дополнение к инструкции. */
const ServicesCard = ({ days }: { days: number }) => {
  const [d, setD] = useState<Data | null>(null);
  const [open, setOpen] = useState('');
  const [f, setF] = useState<Data>({});
  const [ask, setAsk] = useState(false);
  const [code, setCode] = useState('');
  const load = useCallback(async () => { const r = await apiCall<Data>(`${A}/services?days=${days}`); if (r.ok) setD(r.data ?? {}); }, [days]);
  useEffect(() => { void load(); }, [load]);
  if (!d) return <Card title="Помощники по сервисам"><Loader2 size={14} className="animate-spin" style={{ color: C.t3 }} /></Card>;
  const edit = (x: Data) => { setOpen(x.id); setAsk(false); setCode(''); setF({ enabled: x.enabled, model: x.model, maxTokens: x.maxTokens, dailyTokens: x.dailyTokens, instructions: x.instructions }); };
  const begin = async () => {
    const r = await apiCall<Data>(`${A}/step-up`, { method: 'POST', body: '{}' });
    if (!r.ok) { flash(errText(r.error)); return; }
    setCode(''); setAsk(true);
  };
  const save = async () => {
    const r = await apiCall<Data>(`${A}/services/${open}`, { method: 'PUT', body: JSON.stringify({ settings: f, stepUpCode: code }) });
    if (!r.ok) { flash(errText(r.error, r.data?.field)); return; }
    flash('Сохранено'); setAsk(false); setOpen(''); await load();
  };
  return (
    <Card title="Помощники по сервисам">
      <p className="text-[11px]" style={{ color: C.t3 }}>Один поставщик и ключ, но у каждого сервиса свой помощник: можно отключить его, назначить модель, ограничить ответ и расход за сутки, добавить инструкцию. Расход — токены из ответов поставщика, где их нет — оценка.</p>
      {(d.services as Data[]).map((x) => (
        <div key={x.id} className="rounded-xl p-3" style={{ background: C.l2 }}>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px]" style={{ color: C.t2 }}>
            <span className="font-bold" style={{ color: C.t1 }}>{x.title}</span>
            <span style={{ color: x.enabled ? C.green : C.red }}>{x.enabled ? 'Включён' : 'Отключён'}</span>
            <span translate="no">{x.model || 'общая модель'}</span>
            <span>{`Запросов: ${n(x.requests)} · ошибок: ${n(x.errors)}`}</span>
            <span>{`Токены: ${n(x.inputTokens + x.outputTokens)}${x.estimatedTokens ? ` + оценка ${n(x.estimatedTokens)}` : ''}`}</span>
            {d.canEdit && <button type="button" onClick={() => (open === x.id ? setOpen('') : edit(x))} className="ml-auto text-[11px] font-bold" style={{ color: C.acc }}>{open === x.id ? 'Закрыть' : 'Настроить'}</button>}
          </div>
          <p className="text-[11px]" style={{ color: C.t3 }}>{x.hint}</p>
          {x.dailyTokens > 0 && <Bar used={x.todayTokens} limit={x.dailyTokens} />}
          {open === x.id && (
            <div className="mt-2 space-y-2">
              <label className="flex items-center gap-2 text-xs" style={{ color: C.t2 }}><input type="checkbox" checked={Boolean(f.enabled)} onChange={(e) => setF({ ...f, enabled: e.target.checked })} />Сервис включён</label>
              <div className="flex flex-wrap gap-2 text-[11px]" style={{ color: C.t3 }}>
                <label>Модель (пусто — общая)<input value={String(f.model ?? '')} onChange={(e) => setF({ ...f, model: e.target.value })} className="mt-0.5 block w-56 rounded-lg px-2 py-1.5 text-sm" style={field} /></label>
                <label>Потолок ответа, токенов (0 — нет)<input value={String(f.maxTokens ?? 0)} onChange={(e) => setF({ ...f, maxTokens: e.target.value })} className="mt-0.5 block w-40 rounded-lg px-2 py-1.5 text-sm" style={field} /></label>
                <label>Лимит в сутки, токенов (0 — нет)<input value={String(f.dailyTokens ?? 0)} onChange={(e) => setF({ ...f, dailyTokens: e.target.value })} className="mt-0.5 block w-44 rounded-lg px-2 py-1.5 text-sm" style={field} /></label>
              </div>
              <label className="block text-[11px]" style={{ color: C.t3 }}>Дополнение к инструкции (до 600 знаков)
                <textarea value={String(f.instructions ?? '')} maxLength={600} rows={3} onChange={(e) => setF({ ...f, instructions: e.target.value })} className="mt-0.5 block w-full rounded-lg px-2 py-1.5 text-sm" style={field} />
              </label>
              {!ask && <Btn onClick={() => void begin()}>Сохранить</Btn>}
              {ask && (
                <div className="flex gap-2">
                  <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" placeholder="000000" aria-label="Код подтверждения" className="flex-1 rounded-lg px-3 py-2 text-sm tracking-[0.3em]" style={field} />
                  <Btn disabled={code.length < 6} onClick={() => void save()}>Подтвердить кодом аутентификатора</Btn>
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </Card>
  );
};

export const AiUsageTab = () => {
  const [d, setD] = useState<Data | null>(null);
  const [days, setDays] = useState(30);
  const [failed, setFailed] = useState('');
  const [f, setF] = useState<Data | null>(null);
  const [ask, setAsk] = useState(false);
  const [method, setMethod] = useState('');
  const [code, setCode] = useState('');

  const load = useCallback(async () => {
    const r = await apiCall<Data>(`${A}?days=${days}`);
    if (r.ok) { setD(r.data ?? {}); setF((cur) => cur ?? { ...(r.data?.settings ?? {}) }); setFailed(''); } else setFailed(errText(r.error));
  }, [days]);
  useEffect(() => { void load(); }, [load]);

  const begin = async () => {
    const r = await apiCall<Data>(`${A}/step-up`, { method: 'POST', body: '{}' });
    if (!r.ok) { flash(errText(r.error)); return; }
    setMethod(String(r.data?.method ?? 'app')); setCode(''); setAsk(true);
  };
  const save = async () => {
    const r = await apiCall<Data>(`${A}/settings`, { method: 'PUT', body: JSON.stringify({ settings: f, stepUpCode: code }) });
    if (!r.ok) { flash(errText(r.error, r.data?.field)); return; }
    flash('Сохранено'); setAsk(false); setF(null); await load();
  };

  if (failed) return <p className="text-sm" style={{ color: C.red }}>{failed}</p>;
  if (!d || !f) return <Loader2 size={16} className="animate-spin" style={{ color: C.t3 }} />;
  const max = Math.max(1, ...(d.series as Data[]).map((x) => x.input + x.output));
  const set = (k: string, v: unknown) => setF({ ...f, [k]: v });
  const sp = d.spend;
  const warn = (sp.dailyLimit && sp.today / sp.dailyLimit >= f.warnPercent / 100) || (sp.monthlyLimit && sp.month / sp.monthlyLimit >= f.warnPercent / 100);

  return (
    <div className="space-y-4">
      {warn && (
        <p className="flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-bold" style={{ background: 'rgba(245,158,11,.12)', color: C.amber }}>
          <TriangleAlert size={14} />Расход приближается к заданному лимиту.
        </p>
      )}

      <Card title="Поставщики и модели">
        {([['Языковая модель', d.chat], ['Расшифровка речи', d.stt]] as [string, Data][]).map(([title, p]) => (
          <div key={title} className="grid gap-2 sm:grid-cols-4">
            <Stat label={title} value={<span translate="no">{p.configured ? p.model || '—' : 'не настроено'}</span>} sub={p.configured ? p.provider : undefined} />
            <Stat label="Доступность" value={!p.configured ? 'Не настроен' : title === 'Языковая модель' && d.health.recentErrors15m > 0 ? `Есть ошибки (${d.health.recentErrors15m} за 15 мин)` : 'Доступен'} sub={d.health.lastErrorAt && title === 'Языковая модель' ? `Последняя ошибка: ${dt(d.health.lastErrorAt)}` : undefined} />
            <Stat label="Ключ" value={p.key.configured ? <span translate="no">{`${p.key.masked} · ${p.key.fingerprint}`}</span> : 'не задан'} sub="Целиком не показывается" />
            <Stat label="Остаток квоты у поставщика" value="Неизвестно" sub="Поставщик не отдаёт его по обычному ключу" />
          </div>
        ))}
        <p className="text-[11px]" style={{ color: C.t3 }}>Токены модели и деньги на счёте поставщика — разные вещи. Баланс денег здесь не показывается и не выдумывается.</p>
      </Card>

      <Card title="Расход и лимиты (по нашему учёту)">
        <div className="grid gap-2 sm:grid-cols-2">
          <div><p className="text-[11px] font-bold" style={{ color: C.t2 }}>Сегодня (UTC)</p><Bar used={sp.today} limit={sp.dailyLimit} />{sp.dailyLeft != null && <p className="text-[11px]" style={{ color: C.t3 }}>{`Осталось по нашему лимиту: ${n(sp.dailyLeft)}`}</p>}</div>
          <div><p className="text-[11px] font-bold" style={{ color: C.t2 }}>Этот месяц</p><Bar used={sp.month} limit={sp.monthlyLimit} />{sp.monthlyLeft != null && <p className="text-[11px]" style={{ color: C.t3 }}>{`Осталось по нашему лимиту: ${n(sp.monthlyLeft)}`}</p>}</div>
        </div>
        <p className="text-[11px]" style={{ color: C.t3 }}>Токены берутся из ответов поставщика; если он их не прислал, запрос считается оценкой (знаков / 4) и показывается отдельно.</p>
      </Card>

      <ServicesCard days={days} />

      <Card title="По моделям">
        <div className="flex items-center gap-2 text-xs" style={{ color: C.t2 }}>Период:
          {[7, 30, 90].map((x) => <Btn key={x} tone={days === x ? 'acc' : 'plain'} onClick={() => setDays(x)}>{`${x} дн.`}</Btn>)}
        </div>
        {(d.models as Data[]).length === 0 && <p className="text-xs" style={{ color: C.t3 }}>За период запросов не было.</p>}
        {(d.models as Data[]).map((m, i) => (
          <div key={i} className="grid gap-1 rounded-lg px-3 py-2 text-[12px] sm:grid-cols-6" style={{ background: C.l2, color: C.t2 }}>
            <span translate="no" className="font-bold" style={{ color: C.t1 }}>{`${m.model} · ${m.kind === 'chat' ? 'чат' : 'речь'}`}</span>
            <span>{`Запросов: ${n(m.requests)}`}</span><span>{`Ошибок: ${n(m.errors)}`}</span>
            <span>{m.kind === 'chat' ? `Вход: ${n(m.inputTokens)} · выход: ${n(m.outputTokens)}` : '—'}</span>
            <span>{m.estRequests ? `Оценка (без usage): ${n(m.estInputTokens + m.estOutputTokens)} ток., ${m.estRequests} запр.` : ''}</span>
            <span>{m.kind === 'chat' ? (m.cost == null ? 'Стоимость: не рассчитана (укажите ставки)' : `Стоимость ≈ ${m.cost} ${f.currency}`) : ''}</span>
          </div>
        ))}
        <div className="flex items-end gap-1 pt-2" style={{ height: 90 }} aria-label="Расход токенов по дням">
          {(d.series as Data[]).map((x) => (
            <div key={x.day} title={`${x.day}: ${n(x.input + x.output)} токенов, запросов ${x.requests}, ошибок ${x.errors}`} className="flex-1 rounded-t" style={{ height: `${Math.max(3, ((x.input + x.output) / max) * 100)}%`, background: x.errors ? C.amber : C.acc, minWidth: 3 }} />
          ))}
        </div>
      </Card>

      <Card title="Ограничения расхода и предупреждения">
        {!d.canEdit && <p className="text-[11px]" style={{ color: C.t3 }}>Менять лимиты может только владелец.</p>}
        <div className="flex flex-wrap gap-2 text-[11px]" style={{ color: C.t3 }}>
          {([['dailyTokenLimit', 'Лимит в день, токенов (0 — нет)'], ['monthlyTokenLimit', 'Лимит в месяц, токенов (0 — нет)'], ['warnPercent', 'Предупреждение, %'], ['criticalPercent', 'Критический, %'],
            ['priceInPerMTok', 'Цена входа за 1 млн'], ['priceOutPerMTok', 'Цена выхода за 1 млн'], ['currency', 'Валюта']] as [string, string][]).map(([k, label]) => (
            <label key={k}>{label}
              <input value={String(f[k] ?? '')} disabled={!d.canEdit} onChange={(e) => set(k, e.target.value)} className="mt-0.5 block w-36 rounded-lg px-2 py-1.5 text-sm" style={field} />
            </label>
          ))}
        </div>
        <label className="flex items-center gap-2 text-xs" style={{ color: C.t2 }}>
          <input type="checkbox" disabled={!d.canEdit} checked={Boolean(f.blockWhenExhausted)} onChange={(e) => set('blockWhenExhausted', e.target.checked)} />
          При исчерпании лимита отклонять новые запросы к модели
        </label>
        {d.canEdit && !ask && <Btn onClick={() => void begin()}>Сохранить</Btn>}
        {ask && (
          <div className="space-y-2 rounded-xl p-3" style={{ background: C.l2, border: `1px solid ${C.acc}` }}>
            <p className="flex items-center gap-1.5 text-xs font-bold" style={{ color: C.t1 }}><KeyRound size={13} style={{ color: C.acc }} />Подтвердите личность</p>
            <p className="text-[11px]" style={{ color: C.t3 }}>{'Введите код из приложения-аутентификатора.'}</p>
            <div className="flex gap-2">
              <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" placeholder="000000" aria-label="Код подтверждения" className="flex-1 rounded-lg px-3 py-2 text-sm tracking-[0.3em]" style={field} />
              <Btn disabled={code.length < 6} onClick={() => void save()}>Подтвердить</Btn>
            </div>
            <button type="button" onClick={() => setAsk(false)} className="text-[11px]" style={{ color: C.t3 }}>Отмена</button>
          </div>
        )}
        <p className="text-[11px]" style={{ color: C.t3 }}>Владелец получает уведомление при достижении порога предупреждения, критического порога и при исчерпании — по разу за день и за месяц.</p>
      </Card>

      <Card title="Журнал ошибок и превышений">
        {(d.events as Data[]).length === 0 && <p className="text-xs" style={{ color: C.t3 }}>Событий нет.</p>}
        {(d.events as Data[]).map((e, i) => (
          <p key={i} className="text-[11.5px]" style={{ color: C.t2 }}>{`${dt(e.at)} · ${EVENT[e.kind] ?? e.kind}${e.code ? ` · ${e.code}` : ''}${e.detail ? ` — ${e.detail}` : ''}`}</p>
        ))}
      </Card>
    </div>
  );
};
