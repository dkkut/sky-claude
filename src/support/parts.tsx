/**
 * Общие части поддержки.
 *
 * Обращения показываются в трёх местах: в профиле, на экране блокировки
 * и в очереди у администратора. Раньше разметка жила бы в каждом из них
 * своя — и расходилась бы при первой же правке. Здесь ровно то, что
 * должно выглядеть одинаково везде.
 */
import { Loader2, Send, ShieldAlert } from 'lucide-react';
import type { SupportMessage, TicketKind, TicketStatus } from '@/moderation/supportApi';

export const STATUS_LABEL: Record<TicketStatus, string> = {
  open:        'Ждёт ответа поддержки',
  in_progress: 'В работе',
  waiting:     'Ждём вашего ответа',
  closed:      'Закрыто',
};

/** Короткая подпись для очереди, где важна плотность. */
export const STATUS_SHORT: Record<TicketStatus, string> = {
  open: 'Новое', in_progress: 'В работе', waiting: 'Ждём ответа', closed: 'Закрыто',
};

export const STATUS_TONE: Record<TicketStatus, string> = {
  open:        'var(--amber)',
  in_progress: 'var(--accent)',
  waiting:     'var(--t3)',
  closed:      'var(--green)',
};

export const KIND_LABEL: Record<TicketKind, string> = {
  question: 'Вопрос',
  bug:      'Ошибка',
  idea:     'Предложение',
  report:   'Жалоба',
  appeal:   'Обжалование',
};

export const fmtWhen = (iso?: string) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return d.toLocaleString('ru-RU', sameDay
    ? { hour: '2-digit', minute: '2-digit' }
    : { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
};

/**
 * Предупреждение из правил: сотрудник никогда не спросит пароль или код.
 * Стоит именно в поддержке, потому что мошенники приходят именно сюда —
 * представляются поддержкой и просят «код для проверки».
 */
export const SafetyNotice = () => (
  <div className="flex items-start gap-2.5 rounded-2xl px-3.5 py-3"
    style={{ background: 'rgba(245,158,11,0.07)', border: '1px solid rgba(245,158,11,0.18)' }}>
    <ShieldAlert size={15} className="mt-0.5 shrink-0" style={{ color: 'var(--amber)' }} />
    <p className="text-[11px] leading-relaxed" style={{ color: 'var(--t2)' }}>
      Sky <b>никогда</b> не спрашивает пароль или код подтверждения — ни здесь,
      ни в письме, ни по телефону. Кто спрашивает, тот не из Sky.
    </p>
  </div>
);

export const StatusChip = ({ status }: { status: TicketStatus }) => (
  <span className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold"
    style={{ background: 'var(--bg-l3)', color: STATUS_TONE[status] }}>
    {STATUS_SHORT[status]}
  </span>
);

export const MessageBubble = ({ message }: { message: SupportMessage }) => (
  <div className={`flex ${message.fromStaff ? 'justify-start' : 'justify-end'}`}>
    <div className="max-w-[82%] rounded-2xl px-3.5 py-2.5"
      style={{
        background: message.fromStaff ? 'var(--bg-l2)' : 'var(--accent)',
        color: message.fromStaff ? 'var(--t1)' : '#fff',
      }}>
      {message.fromStaff && (
        <p className="mb-0.5 text-[10px] font-bold" style={{ color: 'var(--accent)' }}>
          Поддержка
        </p>
      )}
      <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{message.body}</p>
      <p className="mt-1 text-[10px]"
        style={{ color: message.fromStaff ? 'var(--t3)' : 'rgba(255,255,255,0.6)' }}>
        {fmtWhen(message.createdAt)}
      </p>
    </div>
  </div>
);

export const Composer = ({
  draft, setDraft, onSend, busy, error, placeholder, disabled,
}: {
  draft: string;
  setDraft: (v: string) => void;
  onSend: () => void;
  busy: boolean;
  error?: string | null;
  placeholder: string;
  disabled?: boolean;
}) => (
  <div className="shrink-0 px-3 py-3" style={{ borderTop: '1px solid var(--border)' }}>
    {error && <p className="mb-1.5 px-1 text-xs" style={{ color: 'var(--red)' }}>{error}</p>}
    <div className="flex items-end gap-2">
      <textarea value={draft} onChange={e => setDraft(e.target.value)} rows={2}
        placeholder={placeholder} disabled={disabled}
        // Enter отправляет, Shift+Enter переносит строку — как в чате.
        onKeyDown={e => {
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSend(); }
        }}
        className="flex-1 resize-none rounded-2xl px-3.5 py-2.5 text-sm outline-none disabled:opacity-50"
        style={{ background: 'var(--bg-l2)', color: 'var(--t1)', border: '1px solid var(--border)' }} />
      <button type="button" onClick={onSend} disabled={busy || disabled || !draft.trim()}
        className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl text-white disabled:opacity-40"
        style={{ background: 'var(--accent)' }}>
        {busy ? <Loader2 size={17} className="sky-spin" /> : <Send size={17} />}
      </button>
    </div>
  </div>
);
