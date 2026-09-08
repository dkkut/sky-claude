/**
 * Экран заблокированного.
 *
 * Показывается вместо всего приложения и выхода в экосистему из него
 * нет — иначе блокировка была бы предупреждением, а не блокировкой.
 *
 * Но обращение в поддержку отсюда доступно: человек должен иметь
 * возможность оспорить решение. Поэтому обращения ходят по своему
 * маршруту, а не через хаб мессенджера, куда заблокированного не
 * пускают вовсе.
 */
import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Ban, LifeBuoy, LogOut, ChevronLeft } from 'lucide-react';
import { useAuthStore } from '@/core/auth/store';
import {
  apiSupportTickets, apiCreateTicket, apiReadTicket, apiReplyTicket,
  type SupportTicket,
} from './supportApi';
// Разметка обращения общая с поддержкой в профиле: два экземпляра
// одного и того же разошлись бы при первой правке.
import { Composer, MessageBubble, SafetyNotice, STATUS_LABEL } from '@/support/parts';

/** «до 14 марта, 18:20» — срок понятными словами. */
const untilText = (iso?: string) => {
  if (!iso) return 'бессрочно';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'бессрочно';
  return `до ${d.toLocaleString('ru-RU', {
    day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
  })}`;
};

export const BlockedScreen = ({ bannedUntil }: { bannedUntil?: string }) => {
  const logout = useAuthStore(s => s.logout);
  const [view, setView] = useState<'notice' | 'list' | 'ticket'>('notice');
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [open, setOpen] = useState<SupportTicket | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    const list = await apiSupportTickets();
    if (list) setTickets(list);
  };
  useEffect(() => { void refresh(); }, []);

  const submit = async () => {
    const text = draft.trim();
    if (!text || busy) return;
    setBusy(true); setError(null);
    const res = open
      ? await apiReplyTicket(open.id, text)
      : await apiCreateTicket({ subject: 'Обжалование блокировки', body: text, kind: 'appeal' });
    setBusy(false);
    if (!res.ok) { setError(res.reason ?? 'Не получилось отправить'); return; }
    setDraft('');
    if (res.ticket) { setOpen(res.ticket); setView('ticket'); }
    void refresh();
  };

  const openTicket = async (id: string) => {
    const t = await apiReadTicket(id);
    if (t) { setOpen(t); setView('ticket'); }
  };

  return (
    <div className="fixed inset-0 z-[1000] flex flex-col"
      style={{ background: 'var(--bg)', color: 'var(--t1)' }}>

      {/* Шапка. Возврат есть только внутрь поддержки — наружу выхода нет. */}
      <div className="flex items-center gap-3 px-4 py-3 shrink-0"
        style={{ borderBottom: '1px solid var(--border)' }}>
        {view !== 'notice' ? (
          <button type="button"
            onClick={() => { setView(view === 'ticket' ? 'list' : 'notice'); setOpen(null); }}
            aria-label="Назад"
            className="grid h-9 w-9 place-items-center rounded-xl"
            style={{ background: 'var(--bg-l2)' }}>
            <ChevronLeft size={17} />
          </button>
        ) : (
          <div className="grid h-9 w-9 place-items-center rounded-xl"
            style={{ background: 'rgba(239,68,68,0.12)' }}>
            <Ban size={17} style={{ color: 'var(--red)' }} />
          </div>
        )}
        <p className="flex-1 text-sm font-semibold">
          {view === 'notice' ? 'Доступ ограничен'
            : view === 'list' ? 'Обращения в поддержку'
            : 'Обращение'}
        </p>
        <button type="button" onClick={() => void logout()}
          className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold"
          style={{ background: 'var(--bg-l2)', color: 'var(--t2)' }}>
          <LogOut size={13} /> Выйти
        </button>
      </div>

      <AnimatePresence mode="wait">
        {view === 'notice' && (
          <motion.div key="notice" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="flex flex-1 flex-col items-center justify-center gap-5 px-6 text-center">
            <div className="grid h-20 w-20 place-items-center rounded-3xl"
              style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)' }}>
              <Ban size={34} style={{ color: 'var(--red)' }} />
            </div>
            <div>
              <p className="text-lg font-bold">Аккаунт заблокирован</p>
              <p className="mt-2 max-w-sm text-sm leading-relaxed" style={{ color: 'var(--t2)' }}>
                Доступ к Sky ограничен {untilText(bannedUntil)}. Если считаете
                решение ошибочным — напишите в поддержку, её ответ придёт сюда же.
              </p>
            </div>
            <button type="button" onClick={() => setView('list')}
              className="flex items-center gap-2 rounded-2xl px-5 py-3 text-sm font-bold text-white"
              style={{ background: 'var(--accent)' }}>
              <LifeBuoy size={16} /> Обратиться в поддержку
            </button>
            {tickets.length > 0 && (
              <p className="text-xs" style={{ color: 'var(--t3)' }}>
                У вас {tickets.length} обращени{tickets.length === 1 ? 'е' : 'я'}
              </p>
            )}
          </motion.div>
        )}

        {view === 'list' && (
          <motion.div key="list" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="flex flex-1 flex-col overflow-hidden">
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
              <SafetyNotice />
              {tickets.length === 0 && (
                <p className="py-10 text-center text-sm" style={{ color: 'var(--t3)' }}>
                  Обращений пока нет
                </p>
              )}
              {tickets.map(t => (
                <button key={t.id} type="button" onClick={() => void openTicket(t.id)}
                  className="w-full rounded-2xl px-4 py-3 text-left"
                  style={{ background: 'var(--bg-l1)', border: '1px solid var(--border)' }}>
                  <p className="truncate text-sm font-semibold">{t.subject}</p>
                  <p className="mt-0.5 text-xs" style={{ color: 'var(--t3)' }}>
                    {STATUS_LABEL[t.status] ?? t.status}
                  </p>
                </button>
              ))}
            </div>
            <Composer draft={draft} setDraft={setDraft} onSend={submit} busy={busy}
              error={error} placeholder="Опишите, что случилось" />
          </motion.div>
        )}

        {view === 'ticket' && open && (
          <motion.div key="ticket" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="flex flex-1 flex-col overflow-hidden">
            <div className="px-4 py-2 shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
              <p className="truncate text-sm font-semibold">{open.subject}</p>
              <p className="text-xs" style={{ color: 'var(--t3)' }}>
                {STATUS_LABEL[open.status] ?? open.status}
              </p>
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
              {(open.messages ?? []).map(m => <MessageBubble key={m.id} message={m} />)}
            </div>
            {open.status !== 'closed' ? (
              <Composer draft={draft} setDraft={setDraft} onSend={submit} busy={busy}
                error={error} placeholder="Ответить" />
            ) : (
              <p className="px-4 py-4 text-center text-xs" style={{ color: 'var(--t3)' }}>
                Обращение закрыто
              </p>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
