/**
 * Очередь поддержки для тех, кто её разбирает.
 *
 * Обращение берёт на себя один администратор — так видно, кто за него
 * отвечает, и двое не пишут одному человеку разное. Передать можно
 * только другому администратору: обычный человек не должен оказаться
 * исполнителем чужого обращения и увидеть переписку.
 *
 * Всё это проверяет сервер. Здесь только показ: кнопка, которой нет
 * права, ничего не даст, даже если её дорисовать в браузере.
 */
import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronLeft, Inbox, Loader2, UserCheck, CheckCircle2, RefreshCw, Clock,
} from 'lucide-react';
import {
  apiSupportQueue, apiReadTicketEx, apiReplyTicket, apiSupportAdmins,
  apiAssignTicket, apiTicketStatus,
  type SupportTicket, type TicketStatus,
} from '@/moderation/supportApi';
import { useAuthStore } from '@/core/auth/store';
import {
  Composer, MessageBubble, StatusChip, KIND_LABEL, STATUS_LABEL, fmtWhen,
} from './parts';

type Filter = 'queue' | 'reports' | 'mine' | 'closed';

const FILTERS: [Filter, string][] = [
  ['queue', 'Все открытые'],
  ['reports', 'Жалобы'],
  ['mine', 'Мои'],
  ['closed', 'Закрытые'],
];

/** Состояния, которые администратор ставит руками. */
const SET_STATUS: [TicketStatus, string][] = [
  ['in_progress', 'В работу'],
  ['waiting', 'Ждём ответа'],
  ['closed', 'Закрыть'],
];

export const AdminQueue = () => {
  const meId = useAuthStore(s => s.currentUserId);
  const [filter, setFilter] = useState<Filter>('queue');
  const [tickets, setTickets] = useState<SupportTicket[] | null>(null);
  const [open, setOpen] = useState<SupportTicket | null>(null);
  const [admins, setAdmins] = useState<{ id: string; name: string; username: string }[]>([]);
  const [assigning, setAssigning] = useState(false);

  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);

  const bottom = useRef<HTMLDivElement>(null);

  const load = async (f: Filter = filter) => {
    const list = await apiSupportQueue(
      f === 'closed' ? { status: 'closed' } : f === 'mine' ? { mine: true } : f === 'reports' ? { kind: 'report' } : {},
    );
    setTickets(list ?? []);
  };

  useEffect(() => { void load(filter); }, [filter]);
  useEffect(() => { void apiSupportAdmins().then(a => setAdmins(a ?? [])); }, []);
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: 'smooth' }); }, [open?.messages?.length]);

  const [loadingId, setLoadingId] = useState<string | null>(null);
  const openTicket = async (id: string) => {
    if (loadingId) return;
    setLoadingId(id); setListError(null);
    const r = await apiReadTicketEx(id);
    setLoadingId(null);
    if (r.ticket) { setOpen(r.ticket); setError(null); setDraft(''); return; }
    setListError(r.error === 'not_found' ? 'Обращение не найдено или недоступно вам.' : r.error === 'rate_limited' ? 'Слишком часто. Подождите немного.' : `Не удалось открыть обращение (${r.error}). Повторите.`);
  };

  const reply = async () => {
    const text = draft.trim();
    if (!text || !open || busy) return;
    setBusy(true); setError(null);
    const res = await apiReplyTicket(open.id, text);
    setBusy(false);
    if (!res.ok) { setError(res.reason ?? 'Не получилось отправить'); return; }
    setDraft('');
    if (res.ticket) setOpen(res.ticket);
    void load();
  };

  const assign = async (assigneeId: string | null) => {
    if (!open) return;
    setAssigning(false); setError(null);
    const res = await apiAssignTicket(open.id, assigneeId);
    if (!res.ok) { setError(res.reason ?? 'Не получилось назначить'); return; }
    if (res.ticket) setOpen(res.ticket);
    void load();
  };

  const setStatus = async (status: TicketStatus) => {
    if (!open) return;
    setError(null);
    const res = await apiTicketStatus(open.id, status);
    if (!res.ok) { setError(res.reason ?? 'Не получилось изменить'); return; }
    if (res.ticket) setOpen(res.ticket);
    void load();
  };

  const nameOf = (id?: string) =>
    !id ? null : (admins.find(a => a.id === id)?.name ?? 'администратор');

  /* ── Одно обращение ─────────────────────────────────────────── */
  if (open) {
    const mine = open.assigneeId && open.assigneeId === meId;
    return (
      <div className="flex h-full flex-col overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-3 shrink-0"
          style={{ borderBottom: '1px solid var(--border)' }}>
          <button type="button" onClick={() => { setOpen(null); void load(); }} aria-label="Назад"
            className="grid h-9 w-9 place-items-center rounded-xl" style={{ background: 'var(--bg-l2)' }}>
            <ChevronLeft size={17} style={{ color: 'var(--t2)' }} />
          </button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold" style={{ color: 'var(--t1)' }}>{open.subject}</p>
            <p className="text-[11px]" style={{ color: 'var(--t3)' }}>
              {KIND_LABEL[open.kind]} · {STATUS_LABEL[open.status]}
              {open.source === 'site' && <> · С сайта{open.guestEmail ? <> · <span translate="no">{open.guestEmail}</span></> : null}{open.guestCode ? <> · <span translate="no">{open.guestCode}</span></> : null} · ответ уйдёт на почту</>}
              {open.assigneeId && ` · ${mine ? 'на мне' : nameOf(open.assigneeId)}`}
            </p>
          </div>
        </div>

        {/* Ответственный и состояние */}
        <div className="shrink-0 px-4 py-2.5 space-y-2" style={{ borderBottom: '1px solid var(--border)' }}>
          <div className="flex flex-wrap gap-1.5">
            {!mine && (
              <button type="button" onClick={() => void assign(meId ?? null)}
                className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[11px] font-bold text-white"
                style={{ background: 'var(--accent)' }}>
                <UserCheck size={12} /> Взять себе
              </button>
            )}
            <button type="button" onClick={() => setAssigning(v => !v)}
              className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[11px] font-bold"
              style={{ background: 'var(--bg-l2)', color: 'var(--t2)' }}>
              <RefreshCw size={12} /> Передать
            </button>
            {SET_STATUS.map(([s, label]) => (
              <button key={s} type="button" onClick={() => void setStatus(s)}
                disabled={open.status === s}
                className="rounded-xl px-3 py-1.5 text-[11px] font-bold disabled:opacity-35"
                style={{ background: 'var(--bg-l2)', color: 'var(--t2)' }}>
                {label}
              </button>
            ))}
          </div>

          <AnimatePresence>
            {assigning && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                <div className="rounded-2xl p-1.5 space-y-0.5"
                  style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)' }}>
                  {admins.length === 0 && (
                    <p className="px-2 py-2 text-[11px]" style={{ color: 'var(--t3)' }}>
                      Других администраторов нет
                    </p>
                  )}
                  {admins.map(a => (
                    <button key={a.id} type="button" onClick={() => void assign(a.id)}
                      className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left transition-colors hover:bg-white/[0.04]">
                      <span className="flex-1 truncate text-xs" style={{ color: 'var(--t1)' }}>{a.name}</span>
                      <span className="text-[10px]" style={{ color: 'var(--t3)' }}>@{a.username}</span>
                    </button>
                  ))}
                  {open.assigneeId && (
                    <button type="button" onClick={() => void assign(null)}
                      className="w-full rounded-xl px-2.5 py-2 text-left text-xs"
                      style={{ color: 'var(--red)' }}>
                      Снять ответственного
                    </button>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {error && <p className="text-xs" style={{ color: 'var(--red)' }}>{error}</p>}
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2" style={{ scrollbarWidth: 'none' }}>
          {(open.messages ?? []).map(m => <MessageBubble key={m.id} message={m} />)}

          {(open.events ?? []).length > 0 && (
            <div className="pt-3">
              <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--t3)' }}>
                История
              </p>
              {(open.events ?? []).map(e => (
                <p key={e.id} className="flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--t3)' }}>
                  <Clock size={10} /> {fmtWhen(e.createdAt)} — {e.detail}
                </p>
              ))}
            </div>
          )}
          <div ref={bottom} />
        </div>

        {open.status !== 'closed' ? (
          <Composer draft={draft} setDraft={setDraft} onSend={reply} busy={busy}
            placeholder="Ответ пользователю" />
        ) : (
          <div className="flex items-center justify-center gap-2 px-4 py-4">
            <CheckCircle2 size={14} style={{ color: 'var(--green)' }} />
            <p className="text-xs" style={{ color: 'var(--t3)' }}>Обращение закрыто</p>
          </div>
        )}
      </div>
    );
  }

  /* ── Очередь ────────────────────────────────────────────────── */
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3 shrink-0"
        style={{ borderBottom: '1px solid var(--border)' }}>
        <div className="grid h-9 w-9 place-items-center rounded-xl" style={{ background: 'var(--accent-bg)' }}>
          <Inbox size={17} style={{ color: 'var(--accent)' }} />
        </div>
        <p className="flex-1 text-sm font-semibold" style={{ color: 'var(--t1)' }}>Очередь поддержки</p>
        <button type="button" onClick={() => void load()}
          className="grid h-8 w-8 place-items-center rounded-xl" style={{ background: 'var(--bg-l2)' }}>
          <RefreshCw size={14} style={{ color: 'var(--t2)' }} />
        </button>
      </div>

      <div className="flex gap-1.5 px-4 py-2.5 shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
        {FILTERS.map(([f, label]) => (
          <button key={f} type="button" onClick={() => { setFilter(f); setTickets(null); }}
            className="rounded-xl px-3 py-1.5 text-[11px] font-bold transition-colors"
            style={{
              background: filter === f ? 'var(--accent)' : 'var(--bg-l2)',
              color: filter === f ? '#fff' : 'var(--t2)',
            }}>
            {label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2" style={{ scrollbarWidth: 'none' }}>
        {tickets === null && (
          <div className="grid place-items-center py-10">
            <Loader2 size={20} className="sky-spin" style={{ color: 'var(--t3)' }} />
          </div>
        )}
        {tickets?.length === 0 && (
          <p className="py-10 text-center text-sm" style={{ color: 'var(--t3)' }}>
            {filter === 'mine' ? 'На вас ничего не назначено' : 'Обращений нет'}
          </p>
        )}
        {listError && <p role="alert" className="rounded-xl px-3 py-2 text-xs" style={{ background: 'color-mix(in srgb, var(--red) 12%, transparent)', color: 'var(--red)' }}>{listError}</p>}
        {tickets?.map(t => (
          <button key={t.id} type="button" onClick={() => void openTicket(t.id)} disabled={loadingId === t.id} aria-busy={loadingId === t.id}
            className="w-full rounded-2xl px-4 py-3 text-left transition-colors hover:bg-white/[0.03] disabled:opacity-60"
            style={{ background: 'var(--bg-l1)', border: '1px solid var(--border)' }}>
            <div className="flex items-center gap-2">
              <p className="flex-1 truncate text-sm font-semibold" style={{ color: 'var(--t1)' }}>{t.subject}</p>
              <StatusChip status={t.status} />
            </div>
            <p className="mt-0.5 text-[11px]" style={{ color: 'var(--t3)' }}>
              {KIND_LABEL[t.kind]} · {fmtWhen(t.updatedAt)}{t.source === 'site' ? ' · С сайта' : ''}
              {t.assigneeId
                ? ` · ${t.assigneeId === meId ? 'на мне' : (nameOf(t.assigneeId) ?? 'назначено')}`
                : ' · без ответственного'}
            </p>
          </button>
        ))}
      </div>
    </div>
  );
};
