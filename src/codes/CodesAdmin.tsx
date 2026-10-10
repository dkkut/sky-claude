import { useCallback, useEffect, useState } from 'react';
import { Copy, Download, KeyRound, Loader2, Plus, Ticket, Ban } from 'lucide-react';
import {
  apiBatchCodes, apiBatches, apiCodeItems, apiCodeLog, apiCodeRedemptions, apiCodesStepUp,
  apiCreateBatch, apiExportBatch, apiRevokeBatch, apiRevokeCode, apiRenameCode, apiRevokeSelected, downloadText, rewardText,
  type AdminRedemption, type Batch, type CodeLogRow, type CodeRow, type RewardType,
} from './codesApi';

/* Вкладка «Sky Codes» в админ-панели. Просмотр, отзыв и выгрузка — по праву
   `codes`; создание серий — только владелец и только после подтверждения
   личности (код из приложения или письма). Открытые коды сервер отдаёт один
   раз — в ответе на создание — и больше нигде не хранит и не показывает. */

const ERR: Record<string, string> = {
  not_allowed: 'Нет прав на это действие.',
  lockdown: 'Включён режим блокировки — действие недоступно.',
  step_up_required: 'Нужно подтвердить личность кодом.',
  step_up_invalid: 'Неверный код подтверждения.',
  bad_title: 'Название — от 2 символов.',
  bad_reward: 'Выберите тип награды.',
  bad_count: 'Количество кодов — от 1 до 5000.',
  bad_max_uses: 'Лимит активаций на код указан неверно.',
  bad_amount: 'Сумма вне допустимых пределов (баланс — до 100 000 ₽ на код, баллы — до 1 000 000).',
  bad_days: 'Количество дней вне допустимых пределов.',
  bad_item: 'Такого предмета нет в каталоге.',
  bad_percent: 'Скидка — от 1 до 90%.',
  bad_expiry: 'Срок действия должен быть в будущем (не дальше 5 лет).',
  bound_not_found: 'Пользователь для привязки не найден.',
  bound_needs_single: 'Привязка к человеку возможна только для одного кода.',
  custom_needs_single: 'Собственный код возможен только для серии из одного кода.',
  bad_custom_code: 'Собственный код: 6–32 символа, латиница и цифры.',
  custom_code_taken: 'Такой код уже существует.',
  exposure_too_high: 'Суммарная выдача серии превышает допустимый предел.',
  reason_required: 'Укажите причину (от 3 символов).',
  already_revoked: 'Код уже отозван.',
  bad_label: 'Имя указано неверно.',
  bad_selection: 'Выберите коды (не больше 500).',
  not_found: 'Такой код не найден.',
  too_many_attempts: 'Слишком часто. Подождите минуту.',
  network: 'Нет связи с сервером.',
};
const errText = (e: unknown) => ERR[String(e)] ?? 'Не удалось выполнить действие.';

const TYPE_LABEL: Record<RewardType, string> = {
  balance: 'Пополнение баланса', points: 'Баллы', prime: 'Sky Prime',
  item: 'Цифровой предмет', discount: 'Скидка на Prime',
};
const LOG_LABEL: Record<string, string> = {
  code_batch_create: 'Создана серия', code_revoke: 'Отозван код', code_batch_revoke: 'Отозвана серия',
  code_export: 'Выгрузка CSV', code_redeem: 'Активация',
};

const fmt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

const card = { background: 'var(--bg-l2)', border: '1px solid var(--border)' } as const;
const input = { background: 'var(--bg-l1)', border: '1px solid var(--border)', color: 'var(--t1)' } as const;
const cls = 'w-full rounded-xl px-3 py-2 text-sm outline-none';

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <label className="block">
    <span className="mb-1 block text-[11px] font-semibold" style={{ color: 'var(--t3)' }}>{label}</span>
    {children}
  </label>
);

/* ─── Создание ─────────────────────────────────────────────────────── */

const CreateForm = ({ onDone }: { onDone: () => void }) => {
  const [f, setF] = useState({
    title: '', note: '', rewardType: 'balance' as RewardType, amount: '', days: '', item: '', percent: '',
    count: '1', maxUses: '1', expiresAt: '', boundTo: '', customCode: '',
  });
  const [items, setItems] = useState<{ id: string; category: string }[]>([]);
  const [step, setStep] = useState<null | 'asking' | 'code'>(null);
  const [method, setMethod] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ title: string; codes: string[] } | null>(null);
  const [saved, setSaved] = useState(false);
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));

  useEffect(() => { void apiCodeItems().then((r) => r.ok && setItems(r.data.items)); }, []);

  const ask = async () => {
    setError('');
    if (f.title.trim().length < 2) { setError(ERR.bad_title); return; }
    setStep('asking');
    const r = await apiCodesStepUp();
    if (!r.ok) { setStep(null); setError(errText(r.error)); return; }
    setMethod(r.data.method ?? null); setStep('code');
  };

  const create = async () => {
    setBusy(true); setError('');
    const num = (v: string) => (v.trim() === '' ? undefined : Number(v));
    const r = await apiCreateBatch({
      title: f.title.trim(), note: f.note.trim() || undefined, rewardType: f.rewardType,
      amount: num(f.amount), days: num(f.days), item: f.item || undefined, percent: num(f.percent),
      count: Number(f.count) || 0, maxUses: Number(f.maxUses) || 0,
      expiresAt: f.expiresAt ? new Date(f.expiresAt).toISOString() : undefined,
      boundTo: f.boundTo.trim() || undefined, customCode: f.customCode.trim() || undefined,
      stepUpCode: code,
    });
    setBusy(false);
    if (!r.ok) {
      setError(errText(r.error));
      if (r.error === 'step_up_invalid' || r.error === 'step_up_required') { setCode(''); setStep(null); }
      return;
    }
    setResult({ title: r.data.batch.title, codes: r.data.codes });
  };

  const csv = (r: { title: string; codes: string[] }) =>
    `﻿code,title\r\n${r.codes.map((c) => `${c},"${r.title.replace(/"/g, '""')}"`).join('\r\n')}\r\n`;

  if (result) {
    return (
      <div className="space-y-3 rounded-2xl p-4" style={{ ...card, border: '1px solid var(--amber)' }}>
        <p className="text-sm font-bold" style={{ color: 'var(--t1)' }}>{`Серия создана · кодов: ${result.codes.length}`}</p>
        <p className="text-[11px]" style={{ color: 'var(--amber)' }}>
          Коды показаны только сейчас. На сервере хранятся лишь их хеши — потом открыть их нельзя.
          Сохраните их прямо сейчас.
        </p>
        <div className="max-h-56 space-y-1 overflow-y-auto rounded-xl p-2 font-mono text-xs" translate="no"
          style={{ background: 'var(--bg-l1)', color: 'var(--t1)', userSelect: 'all' }}>
          {result.codes.map((c) => <div key={c}>{c}</div>)}
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold"
            style={{ background: 'var(--l2)', border: '1px solid var(--border)', color: 'var(--t1)' }}
            onClick={() => { void navigator.clipboard?.writeText(result.codes.join('\n')); setSaved(true); }}>
            <Copy size={13} /> Скопировать
          </button>
          <button type="button" className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold text-white"
            style={{ background: 'var(--accent)' }}
            onClick={() => { downloadText('sky-codes-secret.csv', csv(result)); setSaved(true); }}>
            <Download size={13} /> Скачать CSV с кодами
          </button>
        </div>
        <button type="button" onClick={() => {
          if (!saved && !window.confirm('Вы не сохранили коды. Закрыть и потерять их навсегда?')) return;
          setResult(null); onDone();
        }} className="text-[11px]" style={{ color: 'var(--t3)' }}>Готово, закрыть</button>
      </div>
    );
  }

  const t = f.rewardType;
  return (
    <div className="space-y-3 rounded-2xl p-4" style={card}>
      <p className="text-sm font-bold" style={{ color: 'var(--t1)' }}>Новая серия кодов</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Название (видно администраторам и в истории)">
          <input className={cls} style={input} value={f.title} maxLength={80} onChange={(e) => set('title', e.target.value)} />
        </Field>
        <Field label="Тип награды">
          <select className={cls} style={input} value={t} onChange={(e) => set('rewardType', e.target.value)}>
            {(Object.keys(TYPE_LABEL) as RewardType[]).map((k) => <option key={k} value={k}>{TYPE_LABEL[k]}</option>)}
          </select>
        </Field>
        {(t === 'balance' || t === 'points') && (
          <Field label={t === 'balance' ? 'Сумма на код, ₽' : 'Баллов на код'}>
            <input className={cls} style={input} inputMode="numeric" value={f.amount} onChange={(e) => set('amount', e.target.value.replace(/\D/g, ''))} />
          </Field>
        )}
        {(t === 'prime' || t === 'discount') && (
          <Field label={t === 'prime' ? 'Дней Prime' : 'Срок действия скидки, дней'}>
            <input className={cls} style={input} inputMode="numeric" value={f.days} onChange={(e) => set('days', e.target.value.replace(/\D/g, ''))} />
          </Field>
        )}
        {t === 'discount' && (
          <Field label="Скидка на Prime, %">
            <input className={cls} style={input} inputMode="numeric" value={f.percent} onChange={(e) => set('percent', e.target.value.replace(/\D/g, ''))} />
          </Field>
        )}
        {t === 'item' && (
          <Field label="Предмет из каталога кастомизации">
            <select className={cls} style={input} value={f.item} onChange={(e) => set('item', e.target.value)}>
              <option value="">— выберите —</option>
              {items.map((i) => <option key={i.id} value={i.id}>{i.category} · {i.id}</option>)}
            </select>
          </Field>
        )}
        <Field label="Сколько кодов (1–5000)">
          <input className={cls} style={input} inputMode="numeric" value={f.count} onChange={(e) => set('count', e.target.value.replace(/\D/g, ''))} />
        </Field>
        <Field label="Активаций на один код (1 — одноразовый)">
          <input className={cls} style={input} inputMode="numeric" value={f.maxUses} onChange={(e) => set('maxUses', e.target.value.replace(/\D/g, ''))} />
        </Field>
        <Field label="Действует до (пусто — без срока)">
          <input type="datetime-local" className={cls} style={input} value={f.expiresAt} onChange={(e) => set('expiresAt', e.target.value)} />
        </Field>
        <Field label="Привязать к пользователю (@ник, только 1 код)">
          <input className={cls} style={input} value={f.boundTo} onChange={(e) => set('boundTo', e.target.value)} placeholder="@username" />
        </Field>
        <Field label="Свой код вместо случайного (только 1 код)">
          <input className={cls} style={input} translate="no" value={f.customCode} onChange={(e) => set('customCode', e.target.value)} placeholder="SKYPROMO2026" />
        </Field>
        <Field label="Заметка">
          <input className={cls} style={input} value={f.note} maxLength={300} onChange={(e) => set('note', e.target.value)} />
        </Field>
      </div>

      {error && <p role="alert" className="text-xs" style={{ color: 'var(--red)' }}>{error}</p>}

      {step === null && (
        <button type="button" onClick={() => void ask()} className="flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold text-white"
          style={{ background: 'var(--accent)' }}>
          <KeyRound size={13} /> Создать (потребуется подтверждение)
        </button>
      )}
      {step === 'asking' && <Loader2 size={15} className="animate-spin" style={{ color: 'var(--t3)' }} />}
      {step === 'code' && (
        <div className="rounded-xl p-3" style={{ background: 'var(--bg-l1)', border: '1px solid var(--accent)' }}>
          <p className="text-[11px]" style={{ color: 'var(--t3)' }}>
            {method === 'app' ? 'Введите код из приложения двухэтапной защиты.' : 'Код отправлен на вашу почту. Он действует пять минут.'}
          </p>
          <div className="mt-2 flex gap-2">
            <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric"
              placeholder="000000" className={`${cls} flex-1 tracking-widest`} style={input} />
            <button type="button" disabled={code.length < 6 || busy} onClick={() => void create()}
              className="rounded-xl px-4 py-2 text-xs font-bold text-white disabled:opacity-40" style={{ background: 'var(--accent)' }}>
              {busy ? '…' : 'Подтвердить'}
            </button>
          </div>
          <button type="button" onClick={() => { setStep(null); setCode(''); }} className="mt-2 text-[11px]" style={{ color: 'var(--t3)' }}>Отмена</button>
        </div>
      )}
    </div>
  );
};

/* ─── Серия: коды, отзыв ───────────────────────────────────────────── */

const BatchCard = ({ b, onChanged }: { b: Batch; onChanged: () => void }) => {
  const [open, setOpen] = useState(false);
  const [codes, setCodes] = useState<CodeRow[] | null>(null);
  const [reason, setReason] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const s = b.stats;

  const loadCodes = useCallback(async () => {
    const r = await apiBatchCodes(b.id);
    if (r.ok) setCodes(r.data.items); else setMsg(errText(r.error));
  }, [b.id]);

  useEffect(() => { if (open && codes === null) void loadCodes(); }, [open, codes, loadCodes]);

  const need = () => { if (reason.trim().length < 3) { setMsg(ERR.reason_required); return false; } return true; };
  const revokeOne = async (id: string) => {
    if (!need()) return;
    setBusy(true); const r = await apiRevokeCode(id, reason.trim()); setBusy(false);
    if (!r.ok) { setMsg(errText(r.error)); return; }
    setMsg('Код отозван.'); void loadCodes(); onChanged();
  };
  const revokeAll = async () => {
    if (!need()) return;
    if (!window.confirm('Отозвать все неиспользованные коды серии?')) return;
    setBusy(true); const r = await apiRevokeBatch(b.id, reason.trim()); setBusy(false);
    if (!r.ok) { setMsg(errText(r.error)); return; }
    setMsg(`Отозвано кодов: ${r.data.revoked}`); void loadCodes(); onChanged();
  };
  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const revokePicked = async () => {
    if (!need() || picked.size === 0) return;
    if (!window.confirm(`Отозвать выбранные коды: ${picked.size}?`)) return;
    setBusy(true); const r = await apiRevokeSelected({ ids: [...picked], reason: reason.trim() }); setBusy(false);
    if (!r.ok) { setMsg(errText(r.error)); return; }
    setMsg(`Отозвано кодов: ${r.data.revoked}`); setPicked(new Set()); void loadCodes(); onChanged();
  };
  const saveLabel = async (id: string) => {
    const r = await apiRenameCode(id, draft);
    if (!r.ok) { setMsg(errText(r.error)); return; }
    setEditing(null); void loadCodes();
  };
  const exportCsv = async () => {
    const r = await apiExportBatch(b.id);
    setMsg(r.ok ? 'CSV скачан (без открытых кодов).' : 'Не удалось выгрузить.');
  };

  const expired = b.expiresAt && new Date(b.expiresAt).getTime() < Date.now();

  return (
    <div className="rounded-2xl p-3" style={card}>
      <button type="button" className="flex w-full items-start gap-3 text-left" onClick={() => setOpen((o) => !o)}>
        <Ticket size={16} style={{ color: 'var(--purple)', marginTop: 2 }} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold" style={{ color: 'var(--t1)' }} translate="no">{b.title}</p>
          <p className="text-[11px]" style={{ color: 'var(--t3)' }}>
            <span>{rewardText(b.reward)}</span> · <span>×{b.maxUses}</span> ·{' '}
            <span>{b.boundUsername ? `для @${b.boundUsername}` : 'для всех'}</span>
            {b.expiresAt && <span> · {`до ${fmt(b.expiresAt)}`}{expired ? ' ' : ''}{expired && <span>(истёк)</span>}</span>}
          </p>
          {s && (
            <p className="text-[11px]" style={{ color: 'var(--t3)' }}>
              {`кодов ${s.total} · активных ${s.active} · отозвано ${s.revoked} · активаций ${s.uses}`}
            </p>
          )}
        </div>
      </button>

      {open && (
        <div className="mt-3 space-y-2">
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void exportCsv()} className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[11px] font-bold"
              style={{ background: 'var(--bg-l1)', border: '1px solid var(--border)', color: 'var(--t1)' }}>
              <Download size={12} /> CSV
            </button>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Причина отзыва"
              className="min-w-[10rem] flex-1 rounded-xl px-3 py-1.5 text-xs outline-none" style={input} />
            <button type="button" disabled={busy} onClick={() => void revokeAll()} className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[11px] font-bold disabled:opacity-40"
              style={{ background: 'color-mix(in srgb, var(--red) 14%, transparent)', color: 'var(--red)' }}>
              <Ban size={12} /> Отозвать неиспользованные
            </button>
            {picked.size > 0 && (
              <button type="button" disabled={busy} onClick={() => void revokePicked()} className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[11px] font-bold disabled:opacity-40"
                style={{ background: 'var(--red)', color: '#fff' }}>
                <Ban size={12} /> {`Отозвать выбранные (${picked.size})`}
              </button>
            )}
          </div>
          {msg && <p className="text-[11px]" style={{ color: 'var(--t2)' }}>{msg}</p>}
          {codes === null ? <Loader2 size={14} className="animate-spin" style={{ color: 'var(--t3)' }} /> : (
            <div className="max-h-64 space-y-1 overflow-y-auto">
              {codes.map((c) => (
                <div key={c.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-[11px]" style={{ background: 'var(--bg-l1)' }}>
                  {c.status === 'active' && (
                    <input type="checkbox" aria-label="Выбрать код" checked={picked.has(c.id)} onChange={() => toggle(c.id)} />
                  )}
                  <span className="font-mono" translate="no" style={{ color: 'var(--t1)' }}>…{c.hint}</span>
                  {editing === c.id ? (
                    <input autoFocus value={draft} maxLength={60} translate="no" onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') void saveLabel(c.id); if (e.key === 'Escape') setEditing(null); }}
                      onBlur={() => void saveLabel(c.id)}
                      className="min-w-0 flex-1 rounded-md px-2 py-0.5 text-[11px] outline-none" style={input} />
                  ) : (
                    <button type="button" translate="no" onClick={() => { setEditing(c.id); setDraft(c.label); }}
                      title="Изменить имя" className="max-w-[40%] truncate rounded-md px-1.5 py-0.5 text-[11px] font-semibold"
                      style={{ background: 'color-mix(in srgb, var(--accent) 12%, transparent)', color: c.label ? 'var(--accent)' : 'var(--t3)' }}>
                      {c.label || '+ имя'}
                    </button>
                  )}
                  <span style={{ color: c.status === 'revoked' ? 'var(--red)' : c.uses >= c.maxUses ? 'var(--t3)' : 'var(--green)' }}>
                    {c.status === 'revoked' ? 'отозван' : c.uses >= c.maxUses ? 'использован' : 'активен'}
                  </span>
                  <span style={{ color: 'var(--t3)' }}>{c.uses}/{c.maxUses}{c.lastUsedAt ? ` · ${fmt(c.lastUsedAt)}` : ''}</span>
                  {c.revokeReason && <span className="truncate" style={{ color: 'var(--t3)' }} translate="no">{c.revokeReason}</span>}
                  {c.status === 'active' && c.uses === 0 && (
                    <button type="button" disabled={busy} onClick={() => void revokeOne(c.id)} className="ml-auto font-bold disabled:opacity-40" style={{ color: 'var(--red)' }}>
                      Отозвать
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

/* ─── Вкладка ──────────────────────────────────────────────────────── */

type Sub = 'batches' | 'uses' | 'log';

const RevokeByCode = ({ onDone }: { onDone: () => void }) => {
  const [code, setCode] = useState('');
  const [reason, setReason] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true); setMsg('');
    const r = await apiRevokeSelected({ code, reason: reason.trim() });
    setBusy(false);
    if (!r.ok) { setMsg(errText(r.error)); return; }
    setMsg('Код отозван.'); setCode(''); onDone();
  };
  return (
    <div className="space-y-2 rounded-2xl p-3" style={card}>
      <p className="text-xs font-bold" style={{ color: 'var(--t1)' }}>Отозвать конкретный ключ по его тексту</p>
      <div className="flex flex-wrap gap-2">
        <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="SKY-XXXX-XXXX-XXXX-XXXX" translate="no" autoComplete="off"
          className="min-w-[12rem] flex-1 rounded-xl px-3 py-1.5 font-mono text-xs outline-none" style={input} />
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Причина"
          className="min-w-[8rem] flex-1 rounded-xl px-3 py-1.5 text-xs outline-none" style={input} />
        <button type="button" disabled={busy || code.trim().length < 4} onClick={() => void go()}
          className="rounded-xl px-3 py-1.5 text-[11px] font-bold disabled:opacity-40" style={{ background: 'var(--red)', color: '#fff' }}>
          Отозвать
        </button>
      </div>
      {msg && <p className="text-[11px]" style={{ color: 'var(--t2)' }}>{msg}</p>}
    </div>
  );
};

export const CodesAdminSection = ({ owner }: { owner: boolean }) => {
  const [sub, setSub] = useState<Sub>('batches');
  const [batches, setBatches] = useState<Batch[] | null>(null);
  const [uses, setUses] = useState<AdminRedemption[] | null>(null);
  const [log, setLog] = useState<CodeLogRow[] | null>(null);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);

  const loadBatches = useCallback(async () => {
    const r = await apiBatches();
    if (r.ok) { setBatches(r.data.items); setError(''); } else { setBatches([]); setError(errText(r.error)); }
  }, []);

  useEffect(() => { void loadBatches(); }, [loadBatches]);
  useEffect(() => {
    if (sub === 'uses' && uses === null) void apiCodeRedemptions().then((r) => r.ok ? setUses(r.data.items) : (setUses([]), setError(errText(r.error))));
    if (sub === 'log' && log === null) void apiCodeLog().then((r) => r.ok ? setLog(r.data.items) : (setLog([]), setError(errText(r.error))));
  }, [sub, uses, log]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {([['batches', 'Серии'], ['uses', 'Активации'], ['log', 'Журнал']] as [Sub, string][]).map(([k, l]) => (
          <button key={k} type="button" onClick={() => setSub(k)} className="rounded-xl px-3 py-1.5 text-[11px] font-semibold"
            style={{ background: sub === k ? 'var(--accent)' : 'var(--bg-l2)', color: sub === k ? '#fff' : 'var(--t3)' }}>{l}</button>
        ))}
        {owner && sub === 'batches' && (
          <button type="button" onClick={() => setCreating((c) => !c)} className="ml-auto flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[11px] font-bold text-white"
            style={{ background: 'linear-gradient(135deg, var(--accent), var(--purple))' }}>
            <Plus size={13} /> Создать серию
          </button>
        )}
      </div>

      {error && <p role="alert" className="text-xs" style={{ color: 'var(--red)' }}>{error}</p>}

      {sub === 'batches' && (
        <>
          {!owner && <p className="text-[11px]" style={{ color: 'var(--t3)' }}>Создавать серии кодов может только владелец. Вы можете просматривать, отзывать и выгружать.</p>}
          {owner && creating && <CreateForm onDone={() => { setCreating(false); void loadBatches(); }} />}
          <RevokeByCode onDone={() => void loadBatches()} />
          {batches === null && <Loader2 size={16} className="animate-spin" style={{ color: 'var(--t3)' }} />}
          {batches?.length === 0 && !error && <p className="text-xs" style={{ color: 'var(--t3)' }}>Серий пока нет.</p>}
          {batches?.map((b) => <BatchCard key={b.id} b={b} onChanged={() => void loadBatches()} />)}
        </>
      )}

      {sub === 'uses' && (uses === null ? <Loader2 size={16} className="animate-spin" style={{ color: 'var(--t3)' }} /> : (
        <div className="space-y-1.5">
          {uses.length === 0 && <p className="text-xs" style={{ color: 'var(--t3)' }}>Активаций ещё не было.</p>}
          {uses.map((u) => (
            <div key={u.id} className="rounded-xl p-2.5 text-[11px]" style={card}>
              <p style={{ color: 'var(--t1)' }}><b translate="no">{u.name ?? '—'}</b> <span translate="no" style={{ color: 'var(--t3)' }}>@{u.username}</span> · {rewardText(u.reward)}</p>
              <p style={{ color: 'var(--t3)' }}><span translate="no">{u.title}</span> · …<span translate="no">{u.hint}</span> · {fmt(u.redeemedAt)}</p>
            </div>
          ))}
        </div>
      ))}

      {sub === 'log' && (log === null ? <Loader2 size={16} className="animate-spin" style={{ color: 'var(--t3)' }} /> : (
        <div className="space-y-1.5">
          {log.length === 0 && <p className="text-xs" style={{ color: 'var(--t3)' }}>Записей нет.</p>}
          {log.map((l) => (
            <div key={l.id} className="rounded-xl p-2.5 text-[11px]" style={card}>
              <p style={{ color: 'var(--t1)' }}>
                <b>{LOG_LABEL[l.type] ?? l.type}</b>
                {l.result === 'denied' && <span style={{ color: 'var(--red)' }}> · отказано</span>}
              </p>
              <p style={{ color: 'var(--t3)' }} translate="no">{l.detail}</p>
              <p style={{ color: 'var(--t3)' }}>{l.actorName ?? 'система'} · {fmt(l.createdAt)}</p>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
};
