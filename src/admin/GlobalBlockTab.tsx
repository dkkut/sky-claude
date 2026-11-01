/**
 * Вкладка «Блокировки» — глобальная блокировка по Sky ID, устройству, почте, номеру и (по выбору) адресу, с блокировкой
 * всех связанных аккаунтов, плюс очередь апелляций. Сервер — server/globalblock.mjs, право `global_block`.
 * Создание, снятие и решение по апелляции требуют код подтверждения личности (одноразовый, приходит после «Запросить код»).
 */
import { useCallback, useEffect, useState } from 'react';
import { ShieldBan, Loader2, RefreshCw, Check, X } from 'lucide-react';
import { apiCall } from '@/core/auth/api';
import { flash } from '@/shared/flash';

interface Block { groupId: string; createdAt: string; reason: string; publicReason: string; createdBy: string | null; origin: string; expiresAt: string | null; revoked: boolean; accounts: number; pendingAppeals: number }
interface Detail { identifiers: { kind: string; label: string }[]; accounts: { skyId: string; profiles: { id: string; username: string }[] }[]; revokedAt: string | null; revokeReason: string }
interface Appeal { id: string; groupId: string; account: string; message: string; contact: string; status: string; decision: string; createdAt: string; blockedBy: string | null }

const C = { l1: 'var(--bg-l1)', l2: 'var(--bg-l2)', brd: 'var(--border)', t1: 'var(--t1)', t2: 'var(--t2)', t3: 'var(--t3)', acc: 'var(--accent)', red: 'var(--red)' };
const field = { background: C.l2, border: `1px solid ${C.brd}`, color: C.t1 };
const ERR: Record<string, string> = {
  not_allowed: 'Недостаточно прав.', owner_protected: 'Владельца блокировать нельзя.', not_found: 'Не найдено.', reason_required: 'Укажите причину (не короче 5 знаков).',
  step_up_required: 'Запросите код и введите его.', bad_code: 'Код не подошёл.', self_review: 'Апелляцию по этой блокировке решает другой сотрудник.', bad_days: 'Срок — от 1 до 3650 дней.',
  confirm_required: 'Подтвердите действие.', failed: 'Не удалось выполнить. Попробуйте ещё раз.', bad_decision: 'Выберите решение.',
};
const errText = (e?: string, fallback?: string) => (e && ERR[e]) || fallback || (e ? `Не получилось (${e})` : 'Ошибка');
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : 'бессрочно');

const CodeBox = ({ code, setCode }: { code: string; setCode: (v: string) => void }) => {
  const [sent, setSent] = useState(false);
  const ask = async () => { const r = await apiCall('/api/admin/global-blocks/step-up', { method: 'POST', body: '{}' }); if (!r.ok) { flash(errText(r.error, r.reason)); return; } setSent(true); flash('Введите код из приложения-аутентификатора'); };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" onClick={() => void ask()} className="rounded-full px-3 py-2 text-xs font-bold" style={{ background: C.l2, color: C.t1 }}>{sent ? 'Запросить код ещё раз' : 'Запросить код'}</button>
      <input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" maxLength={8} placeholder="Код подтверждения" className="min-w-0 flex-1 rounded-full px-4 py-2 text-sm outline-none" style={field} />
    </div>
  );
};

export const GlobalBlockTab = () => {
  const [view, setView] = useState<'blocks' | 'appeals' | 'create'>('blocks');
  const [status, setStatus] = useState<'active' | 'revoked' | 'all'>('active');
  const [q, setQ] = useState('');
  const [blocks, setBlocks] = useState<Block[] | null>(null);
  const [appeals, setAppeals] = useState<Appeal[] | null>(null);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState<{ id: string; d: Detail } | null>(null);
  const [code, setCode] = useState(''); const [reason, setReason] = useState(''); const [busy, setBusy] = useState(false);
  // создание
  const [target, setTarget] = useState(''); const [pub, setPub] = useState(''); const [days, setDays] = useState('');
  const [devices, setDevices] = useState(true); const [contacts, setContacts] = useState(true); const [ips, setIps] = useState(false);

  const load = useCallback(async () => {
    setErr('');
    const b = await apiCall<{ blocks: Block[] }>(`/api/admin/global-blocks?status=${status}&q=${encodeURIComponent(q)}`);
    if (!b.ok || !b.data) { setErr(errText(b.error, b.reason)); return; }
    setBlocks(b.data.blocks);
    const a = await apiCall<{ appeals: Appeal[] }>('/api/admin/global-blocks/appeals?status=pending');
    if (a.ok && a.data) setAppeals(a.data.appeals);
  }, [status, q]);
  useEffect(() => { void load(); }, [load]);

  const show = async (id: string) => {
    if (open?.id === id) { setOpen(null); return; }
    const r = await apiCall<Detail>(`/api/admin/global-blocks/${id}`);
    if (r.ok && r.data) setOpen({ id, d: r.data }); else flash(errText(r.error, r.reason));
  };
  const act = async (path: string, body: Record<string, unknown>, okText: string) => {
    setBusy(true);
    const r = await apiCall<Record<string, unknown>>(path, { method: 'POST', body: JSON.stringify({ ...body, code }) });
    setBusy(false);
    if (!r.ok) { flash(errText(r.error, r.reason)); return false; }
    flash(okText); setCode(''); setReason(''); void load(); return true;
  };
  const create = async () => {
    if (!window.confirm('Заблокировать этот Sky ID и все связанные с ним аккаунты? Их сессии будут завершены.')) return;
    const done = await act('/api/admin/global-blocks', { target, reason, publicReason: pub, days: days.trim() ? Number(days) : null, scope: { devices, contacts, ips }, confirm: true }, 'Блокировка создана');
    if (done) { setTarget(''); setPub(''); setDays(''); setView('blocks'); }
  };

  return (
    <div className="space-y-3 p-1">
      <div className="flex items-center gap-2">
        <ShieldBan size={18} style={{ color: C.t1 }} /><p className="flex-1 text-sm font-bold" style={{ color: C.t1 }}>Глобальная блокировка</p>
        <button type="button" aria-label="Обновить" onClick={() => void load()} className="grid h-9 w-9 place-items-center rounded-full" style={{ background: C.l2, color: C.t1 }}><RefreshCw size={14} /></button>
      </div>
      <div className="flex gap-1.5 text-xs font-semibold">
        {([['blocks', 'Блокировки'], ['appeals', `Апелляции${appeals?.length ? ` · ${appeals.length}` : ''}`], ['create', 'Заблокировать']] as const).map(([k, l]) => (
          <button key={k} type="button" onClick={() => setView(k)} className="rounded-full px-3 py-2" style={{ background: view === k ? C.t1 : C.l2, color: view === k ? 'var(--bg-l1)' : C.t1 }}>{l}</button>
        ))}
      </div>
      {err && <p role="alert" className="text-sm" style={{ color: C.red }}>{err}</p>}

      {view === 'blocks' && (
        <div className="space-y-2">
          <div className="flex gap-2">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск: @ник, причина, код группы" className="min-w-0 flex-1 rounded-full px-4 py-2 text-sm outline-none" style={field} />
            <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className="rounded-full px-3 py-2 text-sm" style={field}><option value="active">Действуют</option><option value="revoked">Сняты</option><option value="all">Все</option></select>
          </div>
          {!blocks && !err && <div className="grid place-items-center py-8"><Loader2 size={18} className="animate-spin" style={{ color: C.t3 }} /></div>}
          {blocks?.length === 0 && <p className="py-6 text-center text-sm" style={{ color: C.t3 }}>Блокировок нет.</p>}
          {blocks?.map((b) => (
            <div key={b.groupId} className="rounded-2xl p-3" style={{ background: C.l2 }}>
              <button type="button" className="w-full text-left" onClick={() => void show(b.groupId)}>
                <p className="text-sm font-bold" style={{ color: C.t1 }} translate="no">{b.origin || b.groupId}{b.revoked ? ' · снята' : ''}</p>
                <p className="text-xs" style={{ color: C.t3 }} translate="no">{b.reason}</p>
                <p className="text-[11px]" style={{ color: C.t3 }}>Аккаунтов: {b.accounts} · с {when(b.createdAt)} · до {when(b.expiresAt)}{b.pendingAppeals ? ` · апелляций: ${b.pendingAppeals}` : ''}</p>
              </button>
              {open?.id === b.groupId && (
                <div className="mt-2 space-y-2 border-t pt-2 text-xs" style={{ borderColor: C.brd, color: C.t2 }}>
                  <p>Признаки: {open.d.identifiers.map((i) => `${i.kind}: ${i.label}`).join(' · ') || '—'}</p>
                  <p translate="no">Аккаунты: {open.d.accounts.map((a) => a.profiles.map((p) => `@${p.username}`).join(', ') || a.skyId).join(' · ') || '—'}</p>
                  {!b.revoked && (
                    <div className="space-y-2">
                      <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Причина снятия" className="w-full min-w-0 rounded-full px-4 py-2 text-sm outline-none" style={field} />
                      <CodeBox code={code} setCode={setCode} />
                      <button type="button" disabled={busy} onClick={() => void act(`/api/admin/global-blocks/${b.groupId}/revoke`, { reason }, 'Блокировка снята')} className="rounded-full px-4 py-2 text-xs font-bold disabled:opacity-50" style={{ background: C.t1, color: 'var(--bg-l1)' }}>Снять блокировку</button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {view === 'appeals' && (
        <div className="space-y-2">
          {appeals?.length === 0 && <p className="py-6 text-center text-sm" style={{ color: C.t3 }}>Апелляций нет.</p>}
          {appeals?.map((a) => (
            <div key={a.id} className="space-y-2 rounded-2xl p-3" style={{ background: C.l2 }}>
              <p className="text-sm font-bold" style={{ color: C.t1 }} translate="no">{a.account}</p>
              <p className="text-xs" style={{ color: C.t2 }} translate="no">{a.message}</p>
              {a.contact && <p className="text-[11px]" style={{ color: C.t3 }} translate="no">Связь: {a.contact}</p>}
              <p className="text-[11px]" style={{ color: C.t3 }}>{when(a.createdAt)}</p>
              <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ответ человеку (виден ему)" className="w-full min-w-0 rounded-full px-4 py-2 text-sm outline-none" style={field} />
              <CodeBox code={code} setCode={setCode} />
              <div className="flex gap-2">
                <button type="button" disabled={busy} onClick={() => void act(`/api/admin/global-blocks/appeals/${a.id}/decide`, { decision: 'accept', reason }, 'Апелляция принята')} className="flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-bold disabled:opacity-50" style={{ background: C.t1, color: 'var(--bg-l1)' }}><Check size={13} />Принять</button>
                <button type="button" disabled={busy} onClick={() => void act(`/api/admin/global-blocks/appeals/${a.id}/decide`, { decision: 'reject', reason }, 'Апелляция отклонена')} className="flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-bold disabled:opacity-50" style={{ background: C.l1, color: C.t1, border: `1px solid ${C.brd}` }}><X size={13} />Отклонить</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {view === 'create' && (
        <div className="space-y-2 rounded-2xl p-3" style={{ background: C.l2 }}>
          <input value={target} onChange={(e) => setTarget(e.target.value)} placeholder="@ник, id профиля или Sky ID" className="w-full min-w-0 rounded-full px-4 py-2 text-sm outline-none" style={{ ...field, background: C.l1 }} />
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Причина (для администрации)" className="w-full min-w-0 rounded-full px-4 py-2 text-sm outline-none" style={{ ...field, background: C.l1 }} />
          <input value={pub} onChange={(e) => setPub(e.target.value)} maxLength={300} placeholder="Причина для человека (необязательно)" className="w-full min-w-0 rounded-full px-4 py-2 text-sm outline-none" style={{ ...field, background: C.l1 }} />
          <input value={days} onChange={(e) => setDays(e.target.value.replace(/\D/g, ''))} inputMode="numeric" placeholder="Срок в днях (пусто — бессрочно)" className="w-full min-w-0 rounded-full px-4 py-2 text-sm outline-none" style={{ ...field, background: C.l1 }} />
          <label className="flex items-center gap-2 text-sm" style={{ color: C.t1 }}><input type="checkbox" checked={devices} onChange={(e) => setDevices(e.target.checked)} />Блокировать устройства (и аккаунты на них)</label>
          <label className="flex items-center gap-2 text-sm" style={{ color: C.t1 }}><input type="checkbox" checked={contacts} onChange={(e) => setContacts(e.target.checked)} />Блокировать почту и номер (и аккаунты с ними)</label>
          <label className="flex items-center gap-2 text-sm" style={{ color: C.t1 }}><input type="checkbox" checked={ips} onChange={(e) => setIps(e.target.checked)} />Блокировать IP-адреса</label>
          {ips && <p className="text-[11px]" style={{ color: C.red }}>Адрес — грубый признак: блокировка заденет всех, кто выходит в сеть с него (общий Wi-Fi, оператор).</p>}
          <p className="text-[11px]" style={{ color: C.t3 }}>Владелец и администраторы по связи не блокируются. Проверка ручная; блокировка закрывает все сессии затронутых аккаунтов.</p>
          <CodeBox code={code} setCode={setCode} />
          <button type="button" disabled={busy || !target.trim() || reason.trim().length < 5} onClick={() => void create()} className="rounded-full px-4 py-2.5 text-sm font-bold disabled:opacity-50" style={{ background: C.red, color: '#fff' }}>Заблокировать</button>
        </div>
      )}
    </div>
  );
};
