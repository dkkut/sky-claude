/**
 * Техническая поддержка в профиле.
 *
 * До этого «обратная связь» складывалась в localStorage того, кто писал,
 * и её не видел никто. Теперь это обращение на сервере: у него есть
 * состояние, ответственный и переписка.
 *
 * Путь до этого экрана назван в документах дословно — «Настройки →
 * Тех. поддержка», — поэтому он должен называться так и лежать там.
 */
import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronLeft, Plus, LifeBuoy, Mail, Loader2, MessageSquareText,
} from 'lucide-react';
import {
  apiSupportTickets, apiReadTicket, apiCreateTicket, apiReplyTicket,
  type SupportTicket, type TicketKind,
} from '@/moderation/supportApi';
import {
  Composer, MessageBubble, SafetyNotice, StatusChip,
  STATUS_LABEL, KIND_LABEL, fmtWhen,
} from './parts';

const KINDS: TicketKind[] = ['question', 'bug', 'idea', 'report'];

/** Пока обращение открыто, ответ поддержки должен появляться сам. */
const REFRESH_MS = 20_000;

export const SupportScreen = ({ initialTicketId }: { initialTicketId?: string | null } = {}) => {
  const [view, setView] = useState<'list' | 'new' | 'ticket'>('list');
  const [tickets, setTickets] = useState<SupportTicket[] | null>(null);
  const [open, setOpen] = useState<SupportTicket | null>(null);

  const [kind, setKind] = useState<TicketKind>('question');
  const [subject, setSubject] = useState('');
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const bottom = useRef<HTMLDivElement>(null);

  const refreshList = async () => {
    const list = await apiSupportTickets();
    setTickets(list ?? []);
  };
  useEffect(() => { void refreshList(); }, []);

  // Открытое обращение подтягиваем само: иначе человек сидел бы на
  // экране и не знал, что ему уже ответили.
  useEffect(() => {
    if (view !== 'ticket' || !open) return;
    const id = open.id;
    let alive = true;
    const t = setInterval(() => {
      void apiReadTicket(id).then(fresh => { if (alive && fresh) setOpen(fresh); });
    }, REFRESH_MS);
    return () => { alive = false; clearInterval(t); };
  }, [view, open?.id]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth' });
  }, [open?.messages?.length]);

  const openTicket = async (id: string) => {
    const t = await apiReadTicket(id);
    if (t) { setOpen(t); setView('ticket'); setError(null); }
  };

  // Пришли сюда извне (например, из заявки на награду мероприятия) —
  // открываем именно тот тикет, а не список.
  useEffect(() => { if (initialTicketId) void openTicket(initialTicketId); }, [initialTicketId]);

  const create = async () => {
    const text = draft.trim();
    if (!text || busy) return;
    setBusy(true); setError(null);
    const res = await apiCreateTicket({ subject: subject.trim() || undefined, body: text, kind });
    setBusy(false);
    if (!res.ok) { setError(res.reason ?? 'Не получилось отправить'); return; }
    setDraft(''); setSubject('');
    if (res.ticket) { setOpen(res.ticket); setView('ticket'); }
    void refreshList();
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
    void refreshList();
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Шапка */}
      <div className="flex items-center gap-3 px-4 py-3 shrink-0"
        style={{ borderBottom: '1px solid var(--border)' }}>
        {view === 'list' ? (
          <div className="grid h-9 w-9 place-items-center rounded-xl" style={{ background: 'var(--accent-bg)' }}>
            <LifeBuoy size={17} style={{ color: 'var(--accent)' }} />
          </div>
        ) : (
          <button type="button"
            onClick={() => { setView('list'); setOpen(null); setError(null); setDraft(''); }}
            aria-label="Назад"
            className="grid h-9 w-9 place-items-center rounded-xl" style={{ background: 'var(--bg-l2)' }}>
            <ChevronLeft size={17} style={{ color: 'var(--t2)' }} />
          </button>
        )}
        <div className="flex-1 min-w-0">
          <p className="truncate text-sm font-semibold" style={{ color: 'var(--t1)' }}>
            {view === 'list' ? 'Тех. поддержка'
              : view === 'new' ? 'Новое обращение'
              : open?.subject ?? 'Обращение'}
          </p>
          {view === 'ticket' && open && (
            <p className="text-[11px]" style={{ color: 'var(--t3)' }}>
              {KIND_LABEL[open.kind]} · {STATUS_LABEL[open.status]}
            </p>
          )}
        </div>
        {view === 'list' && (
          <button type="button" onClick={() => { setView('new'); setError(null); }}
            className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold text-white"
            style={{ background: 'var(--accent)' }}>
            <Plus size={13} /> Написать
          </button>
        )}
      </div>

      <AnimatePresence mode="wait">
        {/* ── Список обращений ─────────────────────────────────── */}
        {view === 'list' && (
          <motion.div key="list" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="flex-1 overflow-y-auto px-4 py-3 space-y-2" style={{ scrollbarWidth: 'none' }}>

            <SafetyNotice />

            {tickets === null && (
              <div className="grid place-items-center py-10">
                <Loader2 size={20} className="sky-spin" style={{ color: 'var(--t3)' }} />
              </div>
            )}

            {tickets?.length === 0 && (
              <div className="py-10 text-center">
                <MessageSquareText size={28} className="mx-auto mb-3" style={{ color: 'var(--t3)' }} />
                <p className="text-sm" style={{ color: 'var(--t2)' }}>Обращений пока нет</p>
                <p className="mt-1 text-xs" style={{ color: 'var(--t3)' }}>
                  Напишите, если что-то не работает или непонятно
                </p>
              </div>
            )}

            {tickets?.map(t => (
              <button key={t.id} type="button" onClick={() => void openTicket(t.id)}
                className="w-full rounded-2xl px-4 py-3 text-left transition-colors hover:bg-white/[0.03]"
                style={{ background: 'var(--bg-l1)', border: '1px solid var(--border)' }}>
                <div className="flex items-center gap-2">
                  <p className="flex-1 truncate text-sm font-semibold" style={{ color: 'var(--t1)' }}>
                    {t.subject}
                  </p>
                  <StatusChip status={t.status} />
                </div>
                <p className="mt-0.5 text-[11px]" style={{ color: 'var(--t3)' }}>
                  {KIND_LABEL[t.kind]} · {fmtWhen(t.updatedAt)}
                </p>
              </button>
            ))}

            <div className="pt-2">
              <p className="px-1 text-[11px] leading-relaxed" style={{ color: 'var(--t3)' }}>
                <Mail size={11} className="mr-1 inline" />
                Если доступ к аккаунту потерян — пишите на skymessenger.tp@gmail.com
              </p>
            </div>
          </motion.div>
        )}

        {/* ── Новое обращение ──────────────────────────────────── */}
        {view === 'new' && (
          <motion.div key="new" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="flex flex-1 flex-col overflow-hidden">
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3" style={{ scrollbarWidth: 'none' }}>
              <div>
                <p className="mb-2 text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--t3)' }}>
                  О чём обращение
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {KINDS.map(k => (
                    <button key={k} type="button" onClick={() => setKind(k)}
                      className="rounded-2xl py-2.5 text-sm font-semibold transition-all"
                      style={{
                        background: kind === k ? 'var(--accent)' : 'var(--bg-l2)',
                        color: kind === k ? '#fff' : 'var(--t2)',
                        border: `1px solid ${kind === k ? 'var(--accent)' : 'var(--border)'}`,
                      }}>
                      {KIND_LABEL[k]}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--t3)' }}>
                  Тема <span className="font-normal normal-case">(необязательно)</span>
                </p>
                <input value={subject} onChange={e => setSubject(e.target.value)} maxLength={200}
                  placeholder="Коротко, о чём речь"
                  className="w-full rounded-2xl px-3.5 py-2.5 text-sm outline-none"
                  style={{ background: 'var(--bg-l2)', color: 'var(--t1)', border: '1px solid var(--border)' }} />
              </div>

              <SafetyNotice />
            </div>
            <Composer draft={draft} setDraft={setDraft} onSend={create} busy={busy} error={error}
              placeholder="Опишите, что случилось" />
          </motion.div>
        )}

        {/* ── Переписка ────────────────────────────────────────── */}
        {view === 'ticket' && open && (
          <motion.div key="ticket" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="flex flex-1 flex-col overflow-hidden">
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2" style={{ scrollbarWidth: 'none' }}>
              {(open.messages ?? []).map(m => <MessageBubble key={m.id} message={m} />)}
              <div ref={bottom} />
            </div>
            {open.status !== 'closed' ? (
              <Composer draft={draft} setDraft={setDraft} onSend={reply} busy={busy} error={error}
                placeholder="Ответить" />
            ) : (
              <p className="px-4 py-4 text-center text-xs" style={{ color: 'var(--t3)' }}>
                Обращение закрыто. Если вопрос остался — создайте новое.
              </p>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
