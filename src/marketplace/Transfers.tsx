/**
 * Передача магазина или ПВЗ другому аккаунту. Владелец предлагает @нику → получатель принимает → администрация Market одобряет.
 * Решает всё сервер (проверки, перенос одной транзакцией); здесь — только формы и списки.
 */
import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { C, inputStyle } from './ui';
import { apiMyTransfers, apiStartTransfer, apiTransferAct, apiAdminTransfers, type TransferRow } from './verifyApi';

const ERR: Record<string, string> = {
  not_found: 'Объект не найден или принадлежит не вам.', self_transfer: 'Нельзя передать самому себе.', target_not_found: 'Аккаунт с таким ником не найден.',
  username_required: 'Укажите @ник получателя.', transfer_open: 'По этому объекту уже есть незавершённая передача.', subject_blocked: 'Объект заблокирован или приостановлен — передать нельзя.',
  has_active_orders: 'Сначала завершите все текущие заказы.', has_open_appeals: 'Сначала дождитесь решения по апелляциям.',
  target_has_shop: 'У получателя уже есть свой магазин.', target_not_pvz_eligible: 'Получатель не подходит для ПВЗ: нужен подтверждённый ИП или организация.',
  two_factor_required: 'Введите код аутентификатора.', wrong_state: 'Состояние уже изменилось — обновите список.', not_allowed: 'Недостаточно прав.',
  own_target: 'Нельзя решать передачу, в которой вы участвуете.', reason_required: 'Укажите причину.', transfer_failed: 'Перенос не удался — ничего не изменилось. Сообщите администратору.',
  too_many_requests: 'Слишком часто. Подождите немного.',
};
const errOf = (r: { error?: string; reason?: string }) => ERR[r.error ?? ''] ?? r.reason ?? 'Не получилось.';
const STATUS: Record<string, string> = {
  offered: 'Ждёт ответа получателя', accepted: 'Ждёт решения администрации', approved: 'Передано', rejected: 'Отклонено администрацией',
  declined: 'Отклонено получателем', cancelled: 'Отменено', expired: 'Срок вышел', failed: 'Не удалось',
};
const card = { background: C.l1, border: `1px solid ${C.brd}` } as const;
const Btn = ({ children, onClick, tone = 'main', disabled }: { children: React.ReactNode; onClick: () => void; tone?: 'main' | 'bad' | 'soft'; disabled?: boolean }) => (
  <button type="button" disabled={disabled} onClick={onClick} className="rounded-xl px-3 py-1.5 text-[11px] font-semibold disabled:opacity-60"
    style={{ background: tone === 'main' ? C.acc : tone === 'bad' ? 'rgba(239,68,68,0.12)' : C.l2, color: tone === 'main' ? '#fff' : tone === 'bad' ? C.red : C.t1 }}>{children}</button>
);

export const TransferList = ({ items, onChanged, admin = false, setErr }: { items: TransferRow[]; onChanged: () => void; admin?: boolean; setErr: (s: string) => void }) => {
  const act = async (t: TransferRow, action: Parameters<typeof apiTransferAct>[1]) => {
    let comment: string | undefined;
    if (action === 'reject') { comment = window.prompt('Причина отказа (увидят обе стороны)') ?? ''; if (comment.trim().length < 3) return; }
    if (action === 'approve') { if (!window.confirm(`Передать «${t.title}» от @${t.from.username} к @${t.to.username}? Это действие необратимо.`)) return; comment = window.prompt('Комментарий (необязательно)') ?? ''; }
    const r = await apiTransferAct(t.id, action, comment);
    if (!r.ok) { setErr(errOf(r)); return; }
    setErr(''); onChanged();
  };
  if (items.length === 0) return <p className="text-[12px]" style={{ color: C.t3 }}>Передач нет.</p>;
  return (
    <div className="space-y-2">
      {items.map((t) => (
        <div key={t.id} className="space-y-1.5 rounded-2xl p-3" style={card}>
          <div className="flex items-center justify-between gap-2">
            <p className="min-w-0 truncate text-[13px] font-bold" style={{ color: C.t1 }}><span>{t.kind === 'shop' ? 'Магазин' : 'ПВЗ'}</span> <span translate="no">«{t.title}»</span></p>
            <span className="shrink-0 text-[10px] font-bold" style={{ color: t.status === 'approved' ? C.acc : C.t3 }}>{STATUS[t.status] ?? t.status}</span>
          </div>
          <p className="text-[11px]" style={{ color: C.t3 }} translate="no">@{t.from.username} → @{t.to.username} · ID: {t.subjectId}</p>
          {t.message && <p className="text-[11px]" style={{ color: C.t2 }} translate="no">{t.message}</p>}
          {t.adminComment && <p className="text-[11px]" style={{ color: C.t2 }}>Администрация: <span translate="no">{t.adminComment}</span></p>}
          <div className="flex flex-wrap gap-2">
            {!admin && t.mine === 'to' && t.status === 'offered' && <><Btn onClick={() => void act(t, 'accept')}>Принять</Btn><Btn tone="soft" onClick={() => void act(t, 'decline')}>Отклонить</Btn></>}
            {!admin && t.mine === 'from' && ['offered', 'accepted'].includes(t.status) && <Btn tone="bad" onClick={() => void act(t, 'cancel')}>Отменить</Btn>}
            {admin && t.status === 'accepted' && <><Btn onClick={() => void act(t, 'approve')}>Одобрить</Btn><Btn tone="bad" onClick={() => void act(t, 'reject')}>Отклонить</Btn></>}
          </div>
        </div>
      ))}
    </div>
  );
};

/** Блок «Передача»: форма для объекта (магазин — свой, ПВЗ — по id) и список своих передач. */
export const TransferPanel = ({ kind, subjectId, title }: { kind: 'shop' | 'pvz'; subjectId?: string; title: string }) => {
  const [items, setItems] = useState<TransferRow[] | null>(null);
  const [to, setTo] = useState('');
  const [msg, setMsg] = useState('');
  const [code, setCode] = useState('');
  const [needCode, setNeedCode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const load = useCallback(async () => { const r = await apiMyTransfers(); if (r.ok) setItems(r.data.items); else { setItems([]); setErr(errOf(r)); } }, []);
  useEffect(() => { void load(); }, [load]);
  const send = async () => {
    if (!window.confirm(`Предложить передачу «${title}» аккаунту @${to.replace(/^@/, '')}? Получатель должен принять, затем решит администрация.`)) return;
    setBusy(true); setErr(''); setOk('');
    const r = await apiStartTransfer({ kind, subjectId, toUsername: to, message: msg, twoFactorCode: code || undefined });
    setBusy(false);
    if (!r.ok) { if (r.error === 'two_factor_required') setNeedCode(true); setErr(errOf(r)); return; }
    setOk('Предложение отправлено получателю.'); setTo(''); setMsg(''); setCode(''); void load();
  };
  const relevant = (items ?? []).filter((t) => (t.kind === kind && (kind === 'shop' || t.subjectId === subjectId)) || t.mine === 'to');
  return (
    <div className="space-y-2 rounded-2xl p-3" style={card}>
      <p className="text-[12px] font-bold" style={{ color: C.t1 }}>{kind === 'shop' ? 'Передать магазин другому аккаунту' : 'Передать ПВЗ другому аккаунту'}</p>
      <p className="text-[10.5px]" style={{ color: C.t3 }}>
        {kind === 'shop'
          ? 'К новому владельцу перейдут товары, витрина, отзывы, акции и завершённые заказы. Ваши документы и налоговый статус остаются у вас, реквизиты выплат стираются, новый владелец проходит проверку продавца заново. Нужно завершить все текущие заказы.'
          : 'К новому владельцу перейдёт право владения точкой; ячейки, история и сотрудники остаются. Реквизиты владельца стираются. Получатель должен быть подтверждённым ИП или организацией.'}
        {' '}Передачу принимает получатель и одобряет администрация Market.
      </p>
      <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="@ник получателя" translate="no" className="w-full rounded-xl px-3 py-2 text-[12px]" style={inputStyle} />
      <input value={msg} onChange={(e) => setMsg(e.target.value.slice(0, 300))} placeholder="Сообщение получателю (необязательно)" translate="no" className="w-full rounded-xl px-3 py-2 text-[12px]" style={inputStyle} />
      {needCode && <input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" placeholder="Код аутентификатора" className="w-full rounded-xl px-3 py-2 text-[12px]" style={inputStyle} />}
      {err && <p role="alert" className="text-[11px]" style={{ color: C.red }}>{err}</p>}
      {ok && <p className="text-[11px]" style={{ color: C.acc }}>{ok}</p>}
      <Btn disabled={busy || to.trim().length < 2} onClick={() => void send()}>{busy ? 'Отправка…' : 'Предложить передачу'}</Btn>
      {!items ? <Loader2 className="animate-spin" size={16} /> : relevant.length > 0 && (<><p className="pt-1 text-[11px] font-semibold" style={{ color: C.t2 }}>Передачи</p><TransferList items={relevant} onChanged={() => void load()} setErr={setErr} /></>)}
    </div>
  );
};

/** Вкладка администрации: очередь передач. */
export const TransfersAdmin = () => {
  const [status, setStatus] = useState('accepted');
  const [items, setItems] = useState<TransferRow[] | null>(null);
  const [err, setErr] = useState('');
  const load = useCallback(async () => { const r = await apiAdminTransfers(status); if (r.ok) { setItems(r.data.items); } else { setItems([]); setErr(errOf(r)); } }, [status]);
  useEffect(() => { void load(); }, [load]);
  return (
    <div className="space-y-2">
      <div className="flex gap-1 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
        {[['accepted', 'Ждут решения'], ['approved', 'Переданы'], ['rejected', 'Отклонены'], ['all', 'Все']].map(([k, l]) => (
          <button key={k} type="button" onClick={() => setStatus(k)} className="shrink-0 rounded-xl px-3 py-1.5 text-[11px] font-semibold" style={{ background: status === k ? C.acc : C.l2, color: status === k ? '#fff' : C.t3 }}>{l}</button>
        ))}
      </div>
      {err && <p role="alert" className="text-[11px]" style={{ color: C.red }}>{err}</p>}
      {!items ? <Loader2 className="animate-spin" size={16} /> : <TransferList items={items} admin onChanged={() => void load()} setErr={setErr} />}
    </div>
  );
};
