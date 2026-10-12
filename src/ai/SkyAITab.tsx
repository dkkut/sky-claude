/**
 * Экран Sky AI.
 *
 * Устроен вокруг одного решения: обычный чат бесплатен, и экран это
 * показывает собой. Человек без Prime попадает не на витрину подписки,
 * а в рабочий чат — поле ввода активно, история своя, диалогов
 * сколько нужно. Подписка добавляет отдельные инструменты, и только
 * они выглядят закрытыми.
 *
 * Prime здесь берётся с сервера и используется ТОЛЬКО для показа.
 * Поправить его в браузере можно; кнопки станут активными, а сервер
 * всё равно откажет — он спрашивает базу на каждом запросе.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Sparkles, Loader2, Crown, MessageCircle, FileText, Image as ImageIcon,
  Mic, Plus, Trash2, Pencil, PanelLeft, X, AlertTriangle, Paperclip, Send,
  Code2, Copy, Check,
} from 'lucide-react';
import {
  apiAiChats, apiAiReadChat, apiAiRenameChat, apiAiDeleteChat,
  apiAiSend, apiAiSummary, apiAiUpload, apiAiAnalyzeFile, apiAiAnalyzeImage, apiAiTranscribe,
  type AiChat, type AiMessage, type TranscriptCue, type VoiceTurnResult,
} from './aiApi';
import { useAiState, refreshAiState } from './aiState';
import { VoiceMode } from './VoiceMode';
import { PrimeGate } from '@/prime/PrimeGate';
import { browserVoiceAvailable } from './speech';

const C = {
  accent: '#a855f7',
  border: 'rgba(168,85,247,0.3)',
};

type Mode = 'chat' | 'code' | 'summary' | 'file' | 'image' | 'transcribe';

const MODES: { key: Mode; label: string; Icon: typeof MessageCircle; desc: string; prime: boolean }[] = [
  { key: 'chat',       label: 'Чат',        Icon: MessageCircle, desc: 'Свободный диалог с Sky AI',            prime: false },
  { key: 'code',       label: 'Код',        Icon: Code2,         desc: 'Написать, объяснить и исправить код',  prime: true },
  { key: 'summary',    label: 'Пересказ',   Icon: FileText,      desc: 'Кратко, подробно, тезисы или вывод',   prime: true },
  { key: 'file',       label: 'Документ',   Icon: Paperclip,     desc: 'PDF, DOCX, XLSX, PPTX и текст',        prime: true },
  { key: 'image',      label: 'Изображение', Icon: ImageIcon,    desc: 'Описание и распознавание текста',      prime: true },
  { key: 'transcribe', label: 'Расшифровка', Icon: Mic,          desc: 'Речь из записи в текст',               prime: true },
];

/* ─── Мелочи оформления ─────────────────────────────────────────── */

/* Блоки ```код``` — моноширинно, с кнопкой «Копировать». Остальное —
   обычный текст. Текст ответа — пользовательский, не словарный. */
const CodeBlock = ({ lang, code }: { lang: string; code: string }) => {
  const [done, setDone] = useState(false);
  const copy = () => {
    void navigator.clipboard?.writeText(code).then(() => { setDone(true); setTimeout(() => setDone(false), 1500); }).catch(() => {});
  };
  return (
    <div className="my-2 rounded-xl overflow-hidden" data-keep-dark translate="no"
      style={{ background: '#0d1117', border: '1px solid rgba(255,255,255,0.1)' }}>
      <div className="flex items-center justify-between px-3 py-1.5" style={{ background: 'rgba(255,255,255,0.06)' }}>
        <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#9aa4b2' }}>{lang || 'code'}</span>
        <button onClick={copy} className="flex items-center gap-1 text-[11px]" style={{ color: '#c9d1d9' }}>
          {done ? <Check size={12}/> : <Copy size={12}/>}{done ? 'Скопировано' : 'Копировать'}
        </button>
      </div>
      <pre className="px-3 py-2.5 overflow-x-auto text-[12px] leading-relaxed" style={{ color: '#e6edf3', fontFamily: 'ui-monospace,SFMono-Regular,Menlo,monospace' }}>
        <code>{code}</code>
      </pre>
    </div>
  );
};

const RichText = ({ text, user }: { text: string; user: boolean }) => {
  const parts = text.split(/```([^\n`]*)\n?([\s\S]*?)```/g);
  const out: React.ReactNode[] = [];
  for (let i = 0; i < parts.length; i += 3) {
    if (parts[i]?.trim()) out.push(
      <p key={i} translate="no" className="text-sm leading-relaxed whitespace-pre-wrap"
        style={{ color: user ? '#fff' : 'var(--t1)' }}>{parts[i].trim()}</p>);
    if (i + 2 < parts.length) out.push(<CodeBlock key={`c${i}`} lang={parts[i + 1].trim()} code={parts[i + 2].replace(/\n$/, '')}/>);
  }
  return <>{out}</>;
};

const Bubble = ({ m }: { m: AiMessage }) => (
  <div className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
    {m.role === 'assistant' && (
      <div className="grid h-7 w-7 place-items-center rounded-xl shrink-0 mr-2 mt-0.5"
        style={{ background: 'linear-gradient(135deg,#a855f7,#6366f1)' }}>
        <Sparkles size={12} className="text-white"/>
      </div>
    )}
    <div className="max-w-[78%] rounded-2xl px-4 py-2.5"
      style={{
        background: m.role === 'user' ? 'var(--accent)' : 'var(--bg-l2)',
        border: m.role === 'assistant' ? '1px solid var(--border)' : 'none',
      }}>
      {m.tool !== 'chat' && (
        <p className="text-[9px] font-bold uppercase tracking-wider mb-1" style={{ color: C.accent }}>
          {m.tool === 'summary' ? 'Пересказ' : m.tool === 'file' ? 'Документ' : m.tool === 'image' ? 'Изображение' : 'Расшифровка'}
        </p>
      )}
      <RichText text={m.text} user={m.role === 'user'}/>
    </div>
  </div>
);

const Thinking = () => (
  <div className="flex items-end gap-2">
    <div className="grid h-7 w-7 place-items-center rounded-xl shrink-0"
      style={{ background: 'linear-gradient(135deg,#a855f7,#6366f1)' }}>
      <Sparkles size={12} className="text-white"/>
    </div>
    <div className="rounded-2xl px-4 py-3 flex gap-1 items-center"
      style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)' }}>
      {[0, 1, 2].map(i => (
        <div key={i} className="h-1.5 w-1.5 rounded-full animate-bounce"
          style={{ background: C.accent, animationDelay: `${i * 0.15}s` }}/>
      ))}
    </div>
  </div>
);

/** Предложение подписки — на месте инструмента, но не на месте чата. */
const PrimeOffer = ({ what }: { what: string }) => (
  <div className="rounded-2xl px-4 py-4 text-center"
    style={{ background: 'rgba(168,85,247,0.06)', border: '1px solid rgba(168,85,247,0.2)' }}>
    <Crown size={22} className="mx-auto mb-2" style={{ color: C.accent }}/>
    <p className="text-sm font-bold" style={{ color: C.accent }}>{what} — в Sky Prime</p>
    <p className="text-xs mt-1.5" style={{ color: 'var(--t3)' }}>
      Обычный чат с Sky AI работает и без подписки — он слева, во вкладке «Чат».
    </p>
  </div>
);

/* ══════════════════════════════════════════════════════════════════ */

export const SkyAITab = () => {
  const state = useAiState();
  const prime = state?.prime === true;

  const [mode, setMode] = useState<Mode>('chat');
  const [chats, setChats] = useState<AiChat[]>([]);
  const [chatId, setChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AiMessage[]>([]);
  const [drawer, setDrawer] = useState(false);

  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [voiceOpen, setVoiceOpen] = useState(false);

  /* Инструменты */
  const [style, setStyle] = useState('short');
  const [question, setQuestion] = useState('');
  const [toolResult, setToolResult] = useState('');
  const [toolCues, setToolCues] = useState<TranscriptCue[]>([]);
  const [percent, setPercent] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, busy]);

  const loadChats = useCallback(async () => { setChats(await apiAiChats()); }, []);
  useEffect(() => { void loadChats(); }, [loadChats]);

  const openChat = async (id: string) => {
    setDrawer(false);
    const found = await apiAiReadChat(id);
    if (!found) { void loadChats(); return; }
    setChatId(id);
    setMessages(found.messages);
    setErr('');
  };

  const newChat = () => { setChatId(null); setMessages([]); setErr(''); setDrawer(false); };

  const removeChat = async (id: string) => {
    if (!(await apiAiDeleteChat(id))) return;
    if (id === chatId) newChat();
    void loadChats();
  };

  const rename = async (chat: AiChat) => {
    const next = window.prompt('Название диалога', chat.title);
    if (next === null) return;
    const updated = await apiAiRenameChat(chat.id, next.trim());
    if (updated) void loadChats();
  };

  /* ── Обычный чат: без единой проверки Prime ── */
  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    setErr('');
    setBusy(true);

    const mine: AiMessage = {
      id: `local-${Date.now()}`, role: 'user', text, tool: 'chat', createdAt: new Date().toISOString(),
    };
    setMessages(h => [...h, mine]);

    const r = await apiAiSend(text, chatId ?? undefined, mode === 'code' ? { mode: 'code' } : {});
    setBusy(false);
    if (!r.ok || !r.answer) {
      setErr(r.reason ?? 'Не получилось');
      return;
    }
    if (!chatId && r.chatId) setChatId(r.chatId);
    setMessages(h => [...h, r.answer as AiMessage]);
    void loadChats();
    void refreshAiState();
  };

  /* ── Пересказ: Prime ── */
  const runSummary = async () => {
    const text = input.trim();
    if (!text || busy) return;
    setBusy(true); setErr(''); setToolResult('');
    const r = await apiAiSummary(text, style, chatId ?? undefined);
    setBusy(false);
    if (!r.ok) { setErr(r.reason); return; }
    setToolResult(r.text);
    void refreshAiState();
    if (chatId) void openChat(chatId);
  };

  /* ── Файл, картинка, расшифровка: Prime ── */
  const runFile = async (file: File) => {
    setBusy(true); setErr(''); setToolResult(''); setToolCues([]); setPercent(0);
    const up = await apiAiUpload(file, file.name, chatId ?? undefined, setPercent).promise;
    setPercent(null);
    if (!up.ok || !up.fileId) { setBusy(false); setErr(up.reason ?? 'Не получилось'); return; }

    const r = mode === 'image'
      ? await apiAiAnalyzeImage(up.fileId, question.trim(), chatId ?? undefined)
      : mode === 'transcribe'
        ? await apiAiTranscribe(up.fileId, chatId ?? undefined)
        : await apiAiAnalyzeFile(up.fileId, question.trim(), chatId ?? undefined);

    setBusy(false);
    if (!r.ok) { setErr(r.reason); return; }
    setToolResult(r.text);
    if ('cues' in r) setToolCues(r.cues);
    void refreshAiState();
    if (chatId) void openChat(chatId);
  };

  /* ── Голосовой режим: тот же диалог, что и обычный чат ── */
  const onVoiceTurn = (r: VoiceTurnResult) => {
    if (!chatId && r.chatId) setChatId(r.chatId);
    setMessages(h => [
      ...h,
      { id: `local-voice-${Date.now()}`, role: 'user', text: r.recognizedText, tool: 'chat', createdAt: new Date().toISOString() },
      r.answer,
    ]);
    void loadChats();
  };

  const current = MODES.find(m => m.key === mode)!;
  /* «Код» входит в Prime (сервер отвечает 402 без подписки). Пока состояние не пришло, экран не закрываем. */
  const codeLocked = mode === 'code' && !!state && !state.prime;
  const chatLike = mode === 'chat' || (mode === 'code' && !codeLocked);
  const usage = state?.usage?.[chatLike ? 'chat' : mode as 'summary'];

  const accept = mode === 'image'
    ? 'image/jpeg,image/png,image/webp,image/gif'
    : mode === 'transcribe'
      ? 'audio/*,video/mp4,video/webm,.mp3,.m4a,.ogg,.oga,.wav,.flac,.mp4,.webm'
      : '.pdf,.txt,.md,.csv,.docx,.xlsx,.pptx,application/pdf,text/plain';

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Заголовок */}
      <div className="flex items-center justify-between px-5 py-3.5 shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
        <div className="flex items-center gap-2.5 min-w-0">
          <button type="button" onClick={() => setDrawer(d => !d)} aria-label="Диалоги"
            className="grid h-8 w-8 place-items-center rounded-xl shrink-0"
            style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)', cursor: 'pointer', color: 'var(--t2)' }}>
            <PanelLeft size={15}/>
          </button>
          <div className="grid h-8 w-8 place-items-center rounded-xl shrink-0"
            style={{ background: 'linear-gradient(135deg,#a855f7,#6366f1)' }}>
            <Sparkles size={16} className="text-white"/>
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-black truncate" style={{ color: 'var(--t1)' }}>Sky AI</h2>
            <p className="text-[10px] truncate" style={{ color: 'var(--t3)' }}>
              {state?.configured === false
                ? 'не настроен на этом сервере'
                : prime ? 'Prime · все инструменты' : 'чат бесплатно'}
            </p>
          </div>
        </div>
        <button type="button" onClick={newChat}
          className="rounded-xl px-3 py-1.5 text-xs font-bold shrink-0"
          style={{ background: 'var(--bg-l2)', color: 'var(--t2)', border: '1px solid var(--border)', cursor: 'pointer' }}>
          <Plus size={12} className="inline mr-1"/>Новый
        </button>
      </div>

      {/* Режимы. Инструменты подписаны короной, но вкладка «Чат» — нет. */}
      <div className="flex gap-1.5 px-5 py-2.5 shrink-0 overflow-x-auto" style={{ borderBottom: '1px solid var(--border)', scrollbarWidth: 'none' }}>
        {MODES.map(m => (
          <button key={m.key} type="button"
            onClick={() => { setMode(m.key); setToolResult(''); setToolCues([]); setErr(''); }}
            data-ai-mode={m.key}
            className="shrink-0 rounded-xl px-3 py-1.5 text-xs font-bold"
            style={{
              background: mode === m.key ? 'rgba(168,85,247,0.15)' : 'var(--bg-l2)',
              color: mode === m.key ? C.accent : 'var(--t3)',
              border: `1px solid ${mode === m.key ? C.border : 'var(--border)'}`,
              cursor: 'pointer',
            }}>
            <span className="inline-flex items-center gap-1.5">
              <m.Icon size={12}/> {m.label}
              {m.prime && !prime && <Crown size={10} style={{ opacity: 0.7 }}/>}
            </span>
          </button>
        ))}
      </div>

      <div className="flex flex-1 overflow-hidden relative">
        {/* Список диалогов */}
        <AnimatePresence>
          {drawer && (
            <motion.div initial={{ x: -280 }} animate={{ x: 0 }} exit={{ x: -280 }}
              transition={{ type: 'spring', stiffness: 320, damping: 32 }}
              className="absolute inset-y-0 left-0 z-20 w-[260px] overflow-y-auto"
              style={{ background: 'var(--bg-l1)', borderRight: '1px solid var(--border)', scrollbarWidth: 'none' }}>
              <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid var(--border)' }}>
                <p className="text-xs font-bold" style={{ color: 'var(--t2)' }}>Мои диалоги</p>
                <button type="button" onClick={() => setDrawer(false)} aria-label="Закрыть"
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--t3)' }}>
                  <X size={14}/>
                </button>
              </div>
              {chats.length === 0 && (
                <p className="px-4 py-6 text-xs text-center" style={{ color: 'var(--t3)' }}>Пока пусто</p>
              )}
              {chats.map(c => (
                <div key={c.id} data-ai-chat={c.id}
                  className="flex items-center gap-1 px-3 py-2"
                  style={{ borderBottom: '1px solid var(--border)', background: c.id === chatId ? 'rgba(168,85,247,0.08)' : 'transparent' }}>
                  <button type="button" onClick={() => void openChat(c.id)}
                    className="flex-1 min-w-0 text-left"
                    style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
                    <p className="text-xs font-semibold truncate" style={{ color: 'var(--t1)' }}>{c.title}</p>
                    <p className="text-[10px]" style={{ color: 'var(--t3)' }}>{c.messages} сообщ.</p>
                  </button>
                  <button type="button" onClick={() => void rename(c)} aria-label="Переименовать"
                    className="grid h-6 w-6 place-items-center rounded-lg shrink-0"
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--t3)' }}>
                    <Pencil size={11}/>
                  </button>
                  <button type="button" onClick={() => void removeChat(c.id)} aria-label="Удалить"
                    data-ai-chat-delete={c.id}
                    className="grid h-6 w-6 place-items-center rounded-lg shrink-0"
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--red)' }}>
                    <Trash2 size={11}/>
                  </button>
                </div>
              ))}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Содержимое */}
        {codeLocked && <div className="flex-1 overflow-y-auto"><PrimeGate service="code"/></div>}
        <div ref={listRef} className="flex-1 overflow-y-auto px-5 py-4 space-y-4" style={{ scrollbarWidth: 'none', display: codeLocked ? 'none' : undefined }}>
          {state?.configured === false && (
            <div className="rounded-2xl px-4 py-3 flex items-start gap-2"
              style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)' }}>
              <AlertTriangle size={14} className="mt-0.5 shrink-0" style={{ color: 'var(--amber)' }}/>
              <p className="text-xs" style={{ color: 'var(--t2)' }}>
                Модель не подключена на этом сервере. Sky AI заработает, как только владелец
                укажет ключ поставщика — в браузере его нет и быть не должно.
              </p>
            </div>
          )}

          {chatLike && (
            <>
              {messages.length === 0 && (
                <div className="grid place-items-center h-full py-12 text-center">
                  <div>
                    <Sparkles size={46} className="mx-auto mb-4" style={{ color: C.accent }}/>
                    <p className="text-sm font-bold mb-1" style={{ color: 'var(--t1)' }}>{current.label}</p>
                    <p className="text-xs" style={{ color: 'var(--t3)' }}>{current.desc}</p>
                    {usage && usage.limit > 0 && (
                      <p className="text-[10px] mt-3" style={{ color: 'var(--t3)' }}>
                        сегодня {usage.used} из {usage.limit}
                      </p>
                    )}
                  </div>
                </div>
              )}
              {messages.map(m => <Bubble key={m.id} m={m}/>)}
              {busy && <Thinking/>}
            </>
          )}

          {!chatLike && !prime && <PrimeOffer what={current.label}/>}

          {!chatLike && prime && (
            <div className="space-y-3">
              <p className="text-xs" style={{ color: 'var(--t3)' }}>{current.desc}</p>

              {mode === 'summary' && (
                <div className="flex gap-1.5 flex-wrap">
                  {(state?.summaryStyles ?? []).map(s => (
                    <button key={s.key} type="button" onClick={() => setStyle(s.key)}
                      className="rounded-xl px-3 py-1.5 text-xs font-bold"
                      style={{
                        background: style === s.key ? 'rgba(168,85,247,0.15)' : 'var(--bg-l2)',
                        color: style === s.key ? C.accent : 'var(--t3)',
                        border: `1px solid ${style === s.key ? C.border : 'var(--border)'}`,
                        cursor: 'pointer',
                      }}>
                      {s.label}
                    </button>
                  ))}
                </div>
              )}

              {(mode === 'file' || mode === 'image') && (
                <input value={question} onChange={e => setQuestion(e.target.value)}
                  placeholder={mode === 'image' ? 'Что спросить об изображении? (необязательно)' : 'Что найти в документе? (необязательно)'}
                  aria-label="Вопрос"
                  className="w-full rounded-xl px-3.5 py-2.5 text-sm outline-none"
                  style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)', color: 'var(--t1)' }}/>
              )}

              {mode !== 'summary' && (
                <>
                  <input ref={fileRef} type="file" accept={accept} className="hidden"
                    onChange={e => { const f = e.target.files?.[0]; if (f) void runFile(f); e.target.value = ''; }}/>
                  <button type="button" onClick={() => fileRef.current?.click()} disabled={busy}
                    data-ai-pick-file
                    className="w-full rounded-xl py-3 text-sm font-bold"
                    style={{ background: 'var(--bg-l2)', color: 'var(--t2)', border: '1px dashed var(--border)', cursor: 'pointer' }}>
                    {percent !== null
                      ? `Загрузка ${percent}%`
                      : busy ? 'Разбираю...' : mode === 'image' ? 'Выбрать изображение' : mode === 'transcribe' ? 'Выбрать запись' : 'Выбрать документ'}
                  </button>
                  {mode === 'transcribe' && state?.transcription === false && (
                    <p className="text-xs" style={{ color: 'var(--amber)' }}>
                      Поставщик расшифровки на этом сервере не подключён. Выдумывать текст
                      вместо расшифровки Sky AI не станет.
                    </p>
                  )}
                </>
              )}

              {busy && <Thinking/>}

              {toolResult && (
                <div className="rounded-2xl px-4 py-3" style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)' }}>
                  <p className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: C.accent }}>
                    Sky AI · {current.label}
                  </p>
                  {toolCues.length > 0
                    ? toolCues.map(c => (
                      <p key={`${c.start}-${c.at}`} className="text-sm leading-relaxed" style={{ color: 'var(--t1)' }}>
                        <span style={{ color: C.accent }}>{c.at}</span> {c.text}
                      </p>
                    ))
                    : <p className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: 'var(--t1)' }}>{toolResult}</p>}
                </div>
              )}

              {usage && (
                <p className="text-[10px]" style={{ color: 'var(--t3)' }}>сегодня {usage.used} из {usage.limit}</p>
              )}
            </div>
          )}

          {err && (
            <p className="text-xs font-semibold rounded-xl px-3 py-2"
              style={{ background: 'rgba(244,63,94,0.08)', color: 'var(--red)' }}>{err}</p>
          )}
        </div>
      </div>

      {/* Ввод. В режиме чата активен всегда — подписка на это не влияет. */}
      {(chatLike || (mode === 'summary' && prime)) && (
        <div className="flex gap-2 items-end px-5 py-3 shrink-0 rounded-t-[28px]" style={{ borderTop: '1px solid var(--border)', background: 'var(--bg-l1)' }}>
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void (chatLike ? send() : runSummary());
              }
            }}
            placeholder={mode === 'summary' ? 'Вставьте текст для пересказа...' : mode === 'code' ? 'Опишите задачу или вставьте код и ошибку...' : 'Спросите что-нибудь...'}
            aria-label="Сообщение для Sky AI"
            data-ai-input
            rows={1}
            maxLength={mode === 'summary' ? (state?.maxSummaryChars ?? 100000) : (state?.maxMessageChars ?? 16000)}
            className="flex-1 resize-none rounded-[24px] px-5 py-2.5 text-sm outline-none"
            style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)', color: 'var(--t1)', maxHeight: 120 }}
          />
          {chatLike && (state?.transcription || browserVoiceAvailable()) && (
            <motion.button whileTap={{ scale: 0.9 }} type="button" onClick={() => setVoiceOpen(true)}
              disabled={!prime && !!state?.transcription} title={prime ? 'Голосовой режим' : 'Голосовой режим — в Sky Prime'}
              aria-label="Голосовой режим"
              data-ai-voice
              className="grid h-10 w-10 place-items-center rounded-full shrink-0 disabled:opacity-40"
              style={{ background: 'linear-gradient(135deg,#a855f7,#6366f1)', border: '1px solid var(--border)', cursor: 'pointer' }}>
              <Mic size={15} color="#fff"/>
            </motion.button>
          )}
          <motion.button whileTap={{ scale: 0.9 }} type="button"
            onClick={() => void (chatLike ? send() : runSummary())}
            disabled={!input.trim() || busy}
            aria-label="Отправить"
            data-ai-send
            className="grid h-10 w-10 place-items-center rounded-xl shrink-0 disabled:opacity-40"
            style={{
              background: input.trim() ? 'linear-gradient(135deg,#a855f7,#6366f1)' : 'var(--bg-l2)',
              border: '1px solid var(--border)', cursor: 'pointer',
            }}>
            {busy ? <Loader2 size={15} className="animate-spin" color="#fff"/> : <Send size={15} color="#fff"/>}
          </motion.button>
        </div>
      )}

      <AnimatePresence>
        {voiceOpen && (
          <VoiceMode chatId={chatId} onClose={() => setVoiceOpen(false)} onTurn={onVoiceTurn} serverStt={!!state?.transcription}/>
        )}
      </AnimatePresence>
    </div>
  );
};
