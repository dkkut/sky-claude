/**
 * «Модули» → блокировка отдельных вкладок отдельным людям и очередь заявок на вывод остатка (server/modblocks.mjs).
 * Выдать блокировку — право `modules`; провести выплату — право `finance` (вторым — без права очередь просто не показывается).
 */
import { useCallback, useEffect, useState } from 'react';
import { Ban, Check, Loader2, Wallet, X } from 'lucide-react';
import { apiCall } from '@/core/auth/api';
import { flash } from '@/shared/flash';

const C = { l1: 'var(--bg-l1)', l2: 'var(--bg-l2)', brd: 'var(--border)', t1: 'var(--t1)', t2: 'var(--t2)', t3: 'var(--t3)', acc: 'var(--accent)', red: 'var(--red)' };
const field = { background: C.l2, border: `1px solid ${C.brd}`, color: C.t1 };
const ERR: Record<string, string> = {
  not_allowed: 'Недостаточно прав.', reason_required: 'Укажите причину (от 3 знаков).', user_not_found: 'Такого @ника нет.', self_block: 'Себя блокировать нельзя.', owner_protected: 'Владельца блокировать нельзя.',
  bad_value: 'Выберите вкладки и укажите @ник.', bad_state: 'Заявка уже решена.', insufficient_funds: 'На балансе меньше заявленной суммы.', self_review: 'Свою заявку решать нельзя.',
};
const fmt = (iso: string) => new Date(iso).toLocaleString([], { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

interface Block { profileId: string; username: string; name: string; module: string; moduleLabel: string; reason: string; showReason: boolean; at: string }
interface Req { id: string; profileId: string; username: string; name: string; amountRub: number; balance: number; details: string; at: string }

const Withdrawals = () => {
  const [list, setList] = useState<Req[] | null>(null);
  const [denied, setDenied] = useState(false);
  const [busy, setBusy] = useState('');
  const load = useCallback(async () => {
    const r = await apiCall<{ requests: Req[] }>('/api/admin/withdrawals?status=pending');
    if (r.ok && r.data) setList(r.data.requests); else setDenied(true);
  }, []);
  useEffect(() => { void load(); }, [load]);
  if (denied) return null;
  if (!list) return null;
  const decide = async (x: Req, action: 'paid' | 'reject') => {
    let reason = '';
    if (action === 'reject') { reason = window.prompt('Причина отказа (увидит человек):') ?? ''; if (reason.trim().length < 3) return; }
    else if (!window.confirm(`Вы перевели ${x.amountRub} ₽ по указанным данным? Остаток спишется с баланса.`)) return;
    setBusy(x.id);
    const r = await apiCall(`/api/admin/withdrawals/${x.id}/${action}`, { method: 'POST', body: JSON.stringify({ reason }) });
    setBusy('');
    if (!r.ok) { flash(ERR[r.error ?? ''] ?? r.reason ?? 'Не получилось'); return; }
    flash(action === 'paid' ? 'Отмечено как выплачено' : 'Заявка отклонена'); void load();
  };
  return (
    <div className="space-y-2" data-withdrawals>
      <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider" style={{ color: C.t3 }}><Wallet size={12} /> Заявки на вывод остатка ({list.length})</p>
      {list.length === 0 && <p className="text-xs" style={{ color: C.t3 }}>Заявок нет.</p>}
      {list.map((x) => (
        <div key={x.id} className="rounded-xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
          <p className="text-sm font-semibold" style={{ color: C.t1 }}><span translate="no">@{x.username}</span> · <span translate="no">{x.amountRub.toLocaleString('ru-RU')} ₽</span> <span className="text-[11px] font-normal" style={{ color: C.t3 }}>(на балансе {x.balance.toLocaleString('ru-RU')} ₽) · {fmt(x.at)}</span></p>
          <p className="mt-1 whitespace-pre-wrap break-words rounded-lg p-2 text-xs" translate="no" style={{ background: C.l2, color: C.t2 }}>{x.details}</p>
          <div className="mt-2 flex gap-2">
            <button type="button" disabled={busy === x.id} onClick={() => void decide(x, 'paid')} className="inline-flex flex-1 items-center justify-center gap-1 rounded-lg py-1.5 text-xs font-bold disabled:opacity-40" style={{ background: C.acc, color: '#fff' }}><Check size={12} /> Перевёл</button>
            <button type="button" disabled={busy === x.id} onClick={() => void decide(x, 'reject')} className="inline-flex flex-1 items-center justify-center gap-1 rounded-lg py-1.5 text-xs font-bold disabled:opacity-40" style={{ background: C.l2, color: C.t1, border: `1px solid ${C.brd}` }}><X size={12} /> Отклонить</button>
          </div>
        </div>
      ))}
    </div>
  );
};

export const UserBlocksPanel = ({ modules }: { modules: { key: string; label: string; group: string }[] }) => {
  const [list, setList] = useState<Block[] | null>(null);
  const [q, setQ] = useState('');
  const [username, setUsername] = useState('');
  const [pick, setPick] = useState<Set<string>>(new Set());
  const [reason, setReason] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const r = await apiCall<{ blocks: Block[] }>(`/api/admin/module-blocks?q=${encodeURIComponent(q.trim())}`);
    if (r.ok && r.data) setList(r.data.blocks); else setList([]);
  }, [q]);
  useEffect(() => { const t = window.setTimeout(() => void load(), 250); return () => window.clearTimeout(t); }, [load]);
  const toggle = (k: string) => setPick((p) => { const n = new Set(p); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const block = async () => {
    if (!username.trim() || !pick.size) { flash(ERR.bad_value); return; }
    if (reason.trim().length < 3) { flash(ERR.reason_required); return; }
    setBusy(true);
    const r = await apiCall('/api/admin/module-blocks', { method: 'POST', body: JSON.stringify({ username, modules: [...pick], reason, showReason: show }) });
    setBusy(false);
    if (!r.ok) { flash(ERR[r.error ?? ''] ?? r.reason ?? 'Не получилось'); return; }
    flash('Заблокировано'); setPick(new Set()); setReason(''); void load();
  };
  const unblock = async (b: Block | { profileId: string; module?: string }) => {
    const r = await apiCall(`/api/admin/module-blocks?profileId=${encodeURIComponent(b.profileId)}${b.module ? `&module=${b.module}` : ''}`, { method: 'DELETE' });
    if (!r.ok) { flash(ERR[r.error ?? ''] ?? 'Не получилось'); return; }
    flash('Разблокировано'); void load();
  };
  const groups = [...new Set(modules.map((m) => m.group))];
  const byUser = new Map<string, Block[]>();
  (list ?? []).forEach((b) => byUser.set(b.profileId, [...(byUser.get(b.profileId) ?? []), b]));
  return (
    <div className="space-y-3" data-user-blocks>
      <div className="rounded-xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
        <p className="flex items-center gap-1.5 text-sm font-bold" style={{ color: C.t1 }}><Ban size={14} /> Блокировка вкладок для человека</p>
        <p className="mt-1 text-[11px]" style={{ color: C.t3 }}>Человек теряет доступ только к выбранным вкладкам (сервер закрывает и запросы к ним). В закрытой вкладке ему видна кнопка «Заявка на вывод остатка», если на балансе есть деньги.</p>
        <input value={username} onChange={(e) => setUsername(e.target.value)} maxLength={40} placeholder="@ник человека" aria-label="Ник человека" className="mt-2 w-full rounded-xl px-3 py-2 text-sm outline-none" style={field} />
        {groups.map((g) => (
          <div key={g} className="mt-2">
            <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: C.t3 }}>{g}</p>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {modules.filter((m) => m.group === g).map((m) => (
                <button key={m.key} type="button" aria-pressed={pick.has(m.key)} onClick={() => toggle(m.key)} className="rounded-full px-2.5 py-1 text-[11px] font-semibold"
                  style={pick.has(m.key) ? { background: C.red, color: '#fff' } : { background: C.l2, color: C.t2, border: `1px solid ${C.brd}` }}>{m.label}</button>
              ))}
            </div>
          </div>
        ))}
        <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder="Причина (обязательно, в журнал)" aria-label="Причина блокировки" className="mt-3 w-full rounded-xl px-3 py-2 text-sm outline-none" style={field} />
        <label className="mt-2 flex items-center gap-2 text-[11px]" style={{ color: C.t2 }}><input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} /> Показывать причину человеку</label>
        <button type="button" disabled={busy} onClick={() => void block()} className="mt-2 w-full rounded-xl py-2 text-sm font-bold disabled:opacity-40" style={{ background: C.red, color: '#fff' }}>{busy ? 'Блокирую…' : `Заблокировать${pick.size ? ` (${pick.size})` : ''}`}</button>
      </div>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Найти по @нику среди заблокированных" aria-label="Поиск среди блокировок" className="w-full rounded-xl px-3 py-2 text-sm outline-none" style={field} />
      {!list ? <p className="flex items-center gap-2 text-sm" style={{ color: C.t3 }}><Loader2 size={14} className="animate-spin" /> Загрузка…</p>
        : byUser.size === 0 ? <p className="text-xs" style={{ color: C.t3 }}>Личных блокировок нет.</p>
        : [...byUser.entries()].map(([pid, items]) => (
          <div key={pid} className="rounded-xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
            <div className="flex items-center gap-2">
              <p className="flex-1 text-sm font-semibold" style={{ color: C.t1 }} translate="no">@{items[0].username}</p>
              <button type="button" onClick={() => void unblock({ profileId: pid })} className="rounded-lg px-2.5 py-1 text-xs font-bold" style={{ background: C.l2, color: C.t1, border: `1px solid ${C.brd}` }}>Снять все</button>
            </div>
            {items.map((b) => (
              <div key={b.module} className="mt-1.5 flex items-start gap-2 text-[11px]" style={{ color: C.t2 }}>
                <span className="flex-1"><b>{b.moduleLabel}</b> · {fmt(b.at)} · {b.reason}{b.showReason ? ' (видна человеку)' : ''}</span>
                <button type="button" onClick={() => void unblock(b)} aria-label={`Снять блокировку ${b.moduleLabel}`} className="rounded-lg px-2 py-0.5 font-bold" style={{ background: C.l2, border: `1px solid ${C.brd}`, color: C.t1 }}>Снять</button>
              </div>
            ))}
          </div>
        ))}
      <Withdrawals />
    </div>
  );
};
