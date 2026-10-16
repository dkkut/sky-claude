/**
 * Быстрые действия Sky AI. Каждая кнопка вызывает настоящее серверное задание (`/api/ai/ask`, закрытый список задач) —
 * кнопок, которые только выглядят рабочими, здесь нет.
 *
 * Над чем работает действие: 1) выделенный на экране текст, 2) иначе содержимое поля ввода, 3) иначе последнее сообщение диалога.
 * Берётся только текст этого экрана Sky AI — содержимое других чатов и аккаунтов сюда не попадает.
 * Большой объём (> 4000 знаков) отправляется только после подтверждения. Результат — в карточке, в диалог не пишется, пока человек сам этого не захочет;
 * повторный платный запрос при обновлении экрана не отправляется (результат живёт только в памяти).
 */
import { useRef, useState } from 'react';
import { Copy, Check, X, CornerDownLeft, RotateCcw } from 'lucide-react';
import { apiAiAsk, type AskTask } from './aiApi';
import { ThinkingIndicator } from './ThinkingIndicator';

interface Action { task: AskTask; label: string; code?: boolean }
const ACTIONS: Action[] = [
  { task: 'gist', label: 'Суммировать' },
  { task: 'simplify', label: 'Объяснить проще' },
  { task: 'translate', label: 'Перевести' },
  { task: 'fix', label: 'Исправить ошибки' },
  { task: 'rewrite', label: 'Переписать' },
  { task: 'continue', label: 'Продолжить' },
  { task: 'plan', label: 'Составить план' },
  { task: 'todo', label: 'Список задач' },
  { task: 'analyze', label: 'Проанализировать' },
  { task: 'shortreply', label: 'Краткий ответ' },
  { task: 'explaincode', label: 'Объяснить код', code: true },
  { task: 'findbug', label: 'Найти ошибку в коде', code: true },
];
const LANGS = ['русский', 'английский', 'немецкий', 'французский', 'испанский', 'китайский'];
const BIG = 4000;

export const QuickActions = ({ input, lastMessage, onInsert, mode, disabled }: {
  input: string; lastMessage: string; onInsert: (t: string) => void; mode: 'chat' | 'code'; disabled?: boolean;
}) => {
  const [busy, setBusy] = useState(false);
  const [lang, setLang] = useState('английский');
  const [note, setNote] = useState('');
  const [result, setResult] = useState<{ label: string; text: string } | null>(null);
  const [error, setError] = useState<{ reason: string; retry: () => void } | null>(null);
  const [copied, setCopied] = useState(false);
  const ticket = useRef(0);

  const pickSource = (): string => {
    const sel = (typeof window !== 'undefined' ? window.getSelection()?.toString() : '')?.trim();
    if (sel) return sel;
    if (input.trim()) return input.trim();
    return lastMessage.trim();
  };

  const run = async (a: Action) => {
    if (busy) return;
    const text = pickSource();
    setNote(''); setError(null);
    if (!text) { setNote('Выделите текст, напишите его в поле ввода или откройте диалог с сообщением.'); return; }
    if (text.length > BIG && !window.confirm(`Будет отправлено ${text.length} знаков в Sky AI. Продолжить?`)) return;
    const mine = ++ticket.current;
    setBusy(true); setResult(null);
    const r = await apiAiAsk(a.task, text, a.task === 'translate' ? lang : '');
    if (mine !== ticket.current) return;           // запрос отменён
    setBusy(false);
    if (!r.ok) { setError({ reason: r.reason || 'Не получилось', retry: () => void run(a) }); return; }
    setResult({ label: a.label, text: r.text });
  };
  const cancel = () => { ticket.current += 1; setBusy(false); };
  const list = [...ACTIONS].sort((x, y) => Number(Boolean(y.code) === (mode === 'code')) - Number(Boolean(x.code) === (mode === 'code')));

  return (
    <div className="space-y-2" data-ai-quick>
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1" role="toolbar" aria-label="Быстрые действия Sky AI">
        {list.map(a => (
          <button key={a.task} type="button" onClick={() => void run(a)} disabled={busy || disabled}
            className="shrink-0 rounded-full px-3 py-1.5 text-[11.5px] font-bold disabled:opacity-40"
            style={{ background: 'rgba(168,85,247,0.12)', color: '#a855f7', border: '1px solid rgba(168,85,247,0.25)', cursor: 'pointer' }}>
            {a.label}
          </button>
        ))}
        <select value={lang} onChange={(e) => setLang(e.target.value)} aria-label="Язык перевода"
          className="shrink-0 rounded-full px-2 py-1.5 text-[11px]" style={{ background: 'var(--bg-l2)', color: 'var(--t2)', border: '1px solid var(--border)' }}>
          {LANGS.map(l => <option key={l} value={l}>{`на: ${l}`}</option>)}
        </select>
      </div>
      {note && <p className="text-[11.5px]" style={{ color: 'var(--t3)' }}>{note}</p>}
      {busy && <ThinkingIndicator onCancel={cancel} />}
      {error && (
        <div className="flex items-center gap-2 rounded-xl px-3 py-2 text-[12px]" style={{ background: 'rgba(239,68,68,0.1)', color: 'var(--red)' }}>
          <span className="flex-1">{error.reason}</span>
          <button type="button" onClick={error.retry} className="flex items-center gap-1 font-bold"><RotateCcw size={12} />Повторить</button>
        </div>
      )}
      {result && (
        <div className="rounded-2xl p-3" style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)' }}>
          <div className="mb-1 flex items-center gap-2">
            <p className="flex-1 text-[11px] font-bold" style={{ color: 'var(--t3)' }}>{result.label}</p>
            <button type="button" onClick={() => setResult(null)} aria-label="Закрыть" style={{ color: 'var(--t3)' }}><X size={13} /></button>
          </div>
          <p translate="no" className="whitespace-pre-wrap text-[13px]" style={{ color: 'var(--t1)' }}>{result.text}</p>
          <div className="mt-2 flex gap-2">
            <button type="button" onClick={() => { void navigator.clipboard?.writeText(result.text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => {}); }}
              className="flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11.5px] font-bold" style={{ background: 'var(--bg)', color: 'var(--t2)', border: '1px solid var(--border)' }}>
              {copied ? <Check size={12} /> : <Copy size={12} />}{copied ? 'Скопировано' : 'Копировать'}
            </button>
            <button type="button" onClick={() => { onInsert(result.text); setResult(null); }}
              className="flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11.5px] font-bold" style={{ background: 'var(--accent)', color: '#fff' }}>
              <CornerDownLeft size={12} />В поле ввода
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
