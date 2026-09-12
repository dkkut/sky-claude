/* ===============================================================
   SKY AI — кнопки, встроенные в другие экраны.

   Что изменилось по сравнению с прежней версией этого файла.

   Раньше здесь была функция callAI, которая обращалась к
   https://api.anthropic.com/v1/messages прямо из браузера. Ключа в
   запросе не было — положить ключ в страницу значит раздать его всем,
   кто её открыл, — поэтому поставщик отвечал отказом, и КАЖДАЯ кнопка
   ниже показывала «Ошибка AI, попробуйте позже». Sky AI не работал ни
   у кого.

   Хуже того, две кнопки работали «успешно», ничего не делая:
   расшифровка голосового и описание кружочка возвращали заранее
   написанный текст после setTimeout. Человек видел ответ, которого
   никто не давал.

   Теперь всё идёт через сервер: ключ там, проверка подписки там,
   расшифровка — настоящая, у отдельного поставщика речи.

   И главное разделение:
     · перевод, правка текста, варианты ответа, краткий смысл —
       БЕСПЛАТНО. Это один короткий запрос, ровно то же, что человек
       набрал бы в чате сам;
     · пересказ документа, разбор файла и картинки, расшифровка
       записи — Prime. Это отдельная работа и другая цена.
=============================================================== */
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Sparkles, Loader, ChevronDown, ChevronUp, Lock, Languages, Crown,
} from 'lucide-react';
import {
  apiAiAsk, apiAiSummary, apiAiTranscribe, uploadFromUrl,
  type TranscriptCue,
} from './aiApi';
import { useAiState } from './aiState';

export { SkyAITab } from './SkyAITab';

const C = {
  accent: '#a855f7',   // AI purple
  bg:     '#1a0533',
  border: 'rgba(168,85,247,0.3)',
  t1:     'var(--t1)',
  t2:     'var(--t2)',
  t3:     'var(--t3)',
};

/* -- Предложение Prime -------------------------------------------
   Показывается там, где инструмент действительно требует подписки, и
   только там. Обычный чат за этой заглушкой не прячется. */
const PrimeGate = ({ what = 'Эта возможность' }: { what?: string }) => (
  <div className="flex items-center gap-2 px-3 py-2 rounded-xl"
    style={{ background: 'rgba(168,85,247,0.08)', border: `1px solid ${C.border}` }}>
    <Lock size={12} style={{ color: C.accent }}/>
    <span className="text-[10px] font-semibold" style={{ color: C.accent }}>
      {what} — в Sky Prime
    </span>
  </div>
);

/** Раскрывающийся блок с ответом — один вид на все кнопки. */
const Answer = ({ children, icon: Icon = Sparkles }: { children: React.ReactNode; icon?: typeof Sparkles }) => (
  <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}
    exit={{ opacity: 0, height: 0 }}
    className="overflow-hidden mt-1.5 rounded-xl px-3 py-2.5"
    style={{ background: `${C.accent}10`, border: `1px solid ${C.border}` }}>
    <div className="flex items-start gap-2">
      <Icon size={12} className="mt-0.5 shrink-0" style={{ color: C.accent }}/>
      <div className="text-xs leading-relaxed whitespace-pre-wrap" style={{ color: C.t1 }}>{children}</div>
    </div>
  </motion.div>
);

/* === AI SUMMARIZE TEXT BUTTON ==============================
   Пересказ длинного сообщения. Prime-инструмент: это та самая
   отдельная функция пересказа, а не разговор с моделью.
=========================================================== */
interface AiSummarizeProps {
  text: string;
  minLength?: number;
}

export const AiSummarizeButton = ({ text, minLength = 200 }: AiSummarizeProps) => {
  const state = useAiState();
  const [result, setResult] = useState('');
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState('');

  if (text.length < minLength) return null;
  if (state && !state.configured) return null;
  if (state && !state.prime) return <PrimeGate what="AI-пересказ"/>;

  const run = async () => {
    if (result) { setOpen(o => !o); return; }
    setLoading(true); setErr('');
    const r = await apiAiSummary(text, 'short');
    setLoading(false);
    if (!r.ok) { setErr(r.reason); return; }
    setResult(r.text);
    setOpen(true);
  };

  return (
    <div className="mt-1.5">
      <button type="button" onClick={() => void run()} disabled={loading}
        className="flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-[11px] font-semibold transition-all hover:brightness-110 disabled:opacity-60"
        style={{ background: `${C.accent}15`, border: `1px solid ${C.border}`, color: C.accent, cursor: 'pointer' }}>
        {loading
          ? <><Loader size={11} className="animate-spin"/> Анализирую...</>
          : <><Sparkles size={11}/> AI-пересказ {open ? <ChevronUp size={10}/> : <ChevronDown size={10}/>}</>}
      </button>
      <AnimatePresence>
        {open && result && <Answer>{result}</Answer>}
      </AnimatePresence>
      {err && <p className="text-[10px] mt-1" style={{ color: 'var(--red)' }}>{err}</p>}
    </div>
  );
};

/* === AI VOICE TRANSCRIBE BUTTON ============================
   Настоящая расшифровка. Запись, которую браузер и так проигрывает,
   уходит на сервер, а оттуда — поставщику речи.
=========================================================== */
interface AiTranscribeProps {
  duration: number;
  msgId: string;
  /** Адрес записи. Без него расшифровывать нечего, и мы так и скажем. */
  mediaUrl?: string;
}

export const AiTranscribeButton = ({ duration, mediaUrl }: AiTranscribeProps) => {
  const state = useAiState();
  const [cues, setCues] = useState<TranscriptCue[]>([]);
  const [plain, setPlain] = useState('');
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState('');

  if (state && !state.transcription) return null;
  if (state && !state.prime) return <PrimeGate what="Расшифровка"/>;

  const run = async () => {
    if (plain) { setOpen(o => !o); return; }
    if (!mediaUrl) { setErr('Запись недоступна'); return; }
    setLoading(true); setErr('');

    const up = await uploadFromUrl(mediaUrl, `voice-${Math.round(duration)}s`);
    if (!up.ok || !up.fileId) { setLoading(false); setErr(up.reason ?? 'Не получилось'); return; }

    const r = await apiAiTranscribe(up.fileId);
    setLoading(false);
    if (!r.ok) { setErr(r.reason); return; }
    setCues(r.cues);
    setPlain(r.text);
    setOpen(true);
  };

  return (
    <div className="mt-1">
      <button type="button" onClick={() => void run()} disabled={loading}
        className="flex items-center gap-1.5 rounded-xl px-2.5 py-1 text-[10px] font-semibold transition-all"
        style={{ background: `${C.accent}12`, border: `1px solid ${C.border}`, color: C.accent, cursor: 'pointer' }}>
        {loading
          ? <><Loader size={10} className="animate-spin"/> Расшифровываю...</>
          : <><Sparkles size={10}/> Расшифровать {plain && (open ? <ChevronUp size={10}/> : <ChevronDown size={10}/>)}</>}
      </button>
      <AnimatePresence>
        {open && plain && (
          <Answer>
            {cues.length > 0
              ? cues.map(c => (
                <span key={`${c.start}-${c.at}`} className="block">
                  <span style={{ color: C.accent }}>{c.at}</span> {c.text}
                </span>
              ))
              : plain}
          </Answer>
        )}
      </AnimatePresence>
      {err && <p className="text-[10px] mt-1" style={{ color: 'var(--red)' }}>{err}</p>}
    </div>
  );
};

/* === AI VIDEO NOTE DESCRIBE ================================
   Кружок — это видео со звуком. Описываем его по расшифровке звука:
   это единственное, что мы про него действительно знаем. Придумывать
   «что было в кадре» по длительности нельзя.
=========================================================== */
interface AiVideoNoteProps {
  duration: number;
  msgId: string;
  mediaUrl?: string;
}

export const AiVideoNoteButton = ({ duration, mediaUrl }: AiVideoNoteProps) => {
  const state = useAiState();
  const [result, setResult] = useState('');
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState('');

  if (state && !state.transcription) return null;
  if (state && !state.prime) return <PrimeGate what="Расшифровка кружка"/>;

  const run = async () => {
    if (result) { setOpen(o => !o); return; }
    if (!mediaUrl) { setErr('Запись недоступна'); return; }
    setLoading(true); setErr('');

    const up = await uploadFromUrl(mediaUrl, `note-${Math.round(duration)}s`);
    if (!up.ok || !up.fileId) { setLoading(false); setErr(up.reason ?? 'Не получилось'); return; }
    const r = await apiAiTranscribe(up.fileId);
    setLoading(false);
    if (!r.ok) { setErr(r.reason); return; }
    setResult(r.text);
    setOpen(true);
  };

  return (
    <div className="mt-1">
      <button type="button" onClick={() => void run()} disabled={loading}
        className="flex items-center gap-1.5 rounded-xl px-2.5 py-1 text-[10px] font-semibold"
        style={{ background: `${C.accent}12`, border: `1px solid ${C.border}`, color: C.accent, cursor: 'pointer' }}>
        {loading ? <><Loader size={10} className="animate-spin"/> Слушаю...</> : <><Sparkles size={10}/> Расшифровать</>}
      </button>
      <AnimatePresence>{open && result && <Answer>{result}</Answer>}</AnimatePresence>
      {err && <p className="text-[10px] mt-1" style={{ color: 'var(--red)' }}>{err}</p>}
    </div>
  );
};

/* === AI VIDEO SUMMARIZE (SkyVideo) ========================
   Пересказ по описанию видео. Prime.
=========================================================== */
interface AiVideoSummarizeProps {
  title:       string;
  description: string;
  duration:    string;
  tags?:       string[];
  category?:   string;
}

/** Что мы на самом деле знаем о видео: только его карточка. */
const videoContext = ({ title, description, duration, tags, category }: AiVideoSummarizeProps) => [
  `Название: ${title}`,
  `Длительность: ${duration}`,
  category && `Категория: ${category}`,
  tags?.length && `Теги: ${tags.join(', ')}`,
  description && `Описание: ${description}`,
].filter(Boolean).join('\n');

export const AiVideoSummarize = (props: AiVideoSummarizeProps) => {
  const state = useAiState();
  const [result, setResult] = useState('');
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState('');

  if (state && !state.configured) return null;

  if (state && !state.prime) return (
    <div className="flex items-center gap-2 rounded-2xl px-4 py-3 mt-3"
      style={{ background: 'rgba(168,85,247,0.06)', border: '1px solid rgba(168,85,247,0.2)' }}>
      <Lock size={14} style={{ color: C.accent }}/>
      <div>
        <p className="text-xs font-semibold" style={{ color: C.accent }}>AI-пересказ — в Sky Prime</p>
        <p className="text-[10px] mt-0.5" style={{ color: C.t3 }}>Краткое содержание видео за секунды</p>
      </div>
    </div>
  );

  const run = async () => {
    if (result) { setOpen(o => !o); return; }
    if (!props.description && !props.title) return;
    setLoading(true); setErr('');
    /* Пересказ карточки — Prime-инструмент, тот же, что и для текста. */
    const r = await apiAiSummary(
      `Это карточка видео на платформе Sky. Самого видеоряда и звука нет — только эти сведения.\n\n${videoContext(props)}`,
      'short',
    );
    setLoading(false);
    if (!r.ok) { setErr(r.reason); return; }
    setResult(r.text);
    setOpen(true);
  };

  return (
    <div className="mt-3">
      <button type="button" onClick={() => void run()} disabled={loading || (!props.description && !props.title)}
        className="flex items-center gap-2 rounded-2xl px-4 py-2.5 text-xs font-semibold transition-all hover:brightness-110 disabled:opacity-40"
        style={{ background: `${C.accent}15`, border: `1px solid ${C.border}`, color: C.accent, cursor: 'pointer' }}>
        {loading
          ? <><Loader size={13} className="animate-spin"/> Анализирую видео...</>
          : <><Sparkles size={13}/> AI-пересказ видео {open ? <ChevronUp size={13}/> : <ChevronDown size={13}/>}</>}
      </button>
      <AnimatePresence>
        {open && result && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden mt-2 rounded-2xl px-4 py-3"
            style={{ background: `${C.accent}10`, border: `1px solid ${C.border}` }}>
            <div className="flex items-start gap-2.5">
              <Sparkles size={14} className="mt-0.5 shrink-0" style={{ color: C.accent }}/>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider mb-1.5" style={{ color: C.accent }}>
                  Sky AI · Краткое содержание
                </p>
                <p className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: C.t1 }}>{result}</p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {err && <p className="text-[11px] mt-1.5" style={{ color: 'var(--red)' }}>{err}</p>}
    </div>
  );
};

/* === AI VIDEO Q&A ============================================
   Вопрос по видео. Спросить о видео — это разговор, а не отдельный
   инструмент, поэтому бесплатно. Честно оговорено, что знаем мы
   только карточку.
=========================================================== */
export const AiVideoQA = (props: AiVideoSummarizeProps) => {
  const state = useAiState();
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  if (state && !state.configured) return null;

  const ask = async () => {
    const q = question.trim();
    if (!q) return;
    setLoading(true); setErr(''); setAnswer('');
    const r = await apiAiAsk(
      'gist',
      `Сведения о видео (самого видеоряда и звука нет, только это):\n${videoContext(props)}\n\nВопрос зрителя: ${q}\nЕсли по этим сведениям ответить нельзя — так и скажи.`,
    );
    setLoading(false);
    if (!r.ok) { setErr(r.reason); return; }
    setAnswer(r.text);
  };

  return (
    <div className="mt-2 rounded-2xl p-3" style={{ background: `${C.accent}08`, border: `1px solid ${C.border}` }}>
      <div className="flex items-center gap-2">
        <input value={question} onChange={e => setQuestion(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') void ask(); }}
          placeholder="Спросить об этом видео..." disabled={loading}
          aria-label="Вопрос о видео"
          className="flex-1 bg-transparent text-xs outline-none px-1" style={{ color: C.t1 }}/>
        <button type="button" onClick={() => void ask()} disabled={loading || !question.trim()}
          aria-label="Спросить"
          className="grid h-7 w-7 shrink-0 place-items-center rounded-lg disabled:opacity-40"
          style={{ background: C.accent, border: 'none', cursor: 'pointer' }}>
          {loading ? <Loader size={12} className="animate-spin" color="#fff"/> : <Sparkles size={12} color="#fff"/>}
        </button>
      </div>
      {answer && <p className="text-xs leading-relaxed mt-2.5 pt-2.5 border-t whitespace-pre-wrap" style={{ color: C.t1, borderColor: C.border }}>{answer}</p>}
      {err && <p className="text-[11px] mt-1.5" style={{ color: 'var(--red)' }}>{err}</p>}
    </div>
  );
};

/* === AI TRANSLATE MESSAGE BUTTON ============================
   Перевод сообщения. Бесплатно: это один короткий запрос, ровно то
   же, что человек набрал бы в чате сам. Закрывать подпиской «переведи
   это» значило бы закрывать подпиской обычный разговор.
=========================================================== */
const TRANSLATE_LANGS = [
  { code: 'ru', label: 'Русский' },
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Español' },
  { code: 'de', label: 'Deutsch' },
  { code: 'zh', label: '中文' },
  { code: 'tr', label: 'Türkçe' },
];

export const AiTranslateButton = ({ text }: { text: string }) => {
  const state = useAiState();
  const [result, setResult] = useState('');
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [picker, setPicker] = useState(false);
  const [err, setErr] = useState('');

  if (!text || text.trim().length < 3) return null;
  if (state && !state.configured) return null;

  const run = async (label: string) => {
    setPicker(false); setLoading(true); setErr(''); setResult('');
    const r = await apiAiAsk('translate', text, label);
    setLoading(false);
    if (!r.ok) { setErr(r.reason); return; }
    setResult(r.text);
    setOpen(true);
  };

  return (
    <div className="mt-1.5 relative">
      <button type="button" onClick={() => { if (result) { setOpen(o => !o); return; } setPicker(p => !p); }} disabled={loading}
        className="flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-[11px] font-semibold transition-all hover:brightness-110 disabled:opacity-60"
        style={{ background: `${C.accent}15`, border: `1px solid ${C.border}`, color: C.accent, cursor: 'pointer' }}>
        {loading
          ? <><Loader size={11} className="animate-spin"/> Перевожу...</>
          : <><Languages size={11}/> Перевести {result && (open ? <ChevronUp size={10}/> : <ChevronDown size={10}/>)}</>}
      </button>
      <AnimatePresence>
        {picker && (
          <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
            className="absolute z-20 mt-1 rounded-xl overflow-hidden" style={{ background: '#1e1e24', border: `1px solid ${C.border}` }}>
            {TRANSLATE_LANGS.map(l => (
              <button key={l.code} type="button" onClick={() => void run(l.label)}
                className="block w-full px-3 py-1.5 text-left text-[11px] whitespace-nowrap hover:brightness-125"
                style={{ color: C.t1, background: 'none', border: 'none', cursor: 'pointer' }}>
                {l.label}
              </button>
            ))}
          </motion.div>
        )}
        {open && result && <Answer icon={Languages}>{result}</Answer>}
      </AnimatePresence>
      {err && <p className="text-[10px] mt-1" style={{ color: 'var(--red)' }}>{err}</p>}
    </div>
  );
};

/* === AI SUGGEST REPLY ======================================
   Варианты ответа. Бесплатно.
=========================================================== */
export const AiSuggestReplies = ({ text, onPick }: { text: string; onPick: (t: string) => void }) => {
  const state = useAiState();
  const [replies, setReplies] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  if (text.length < 20) return null;
  if (state && !state.configured) return null;

  const run = async () => {
    if (replies.length) { setReplies([]); return; }
    setLoading(true);
    const r = await apiAiAsk('replies', text);
    setLoading(false);
    if (!r.ok) return;
    /* Модель просили вернуть массив строк. Если вернула что-то другое —
       показывать нечего: подставлять «Понял!» вместо ответа модели
       значит выдавать своё за её. */
    try {
      const parsed = JSON.parse(r.text.replace(/```json|```/g, '').trim());
      if (Array.isArray(parsed)) setReplies(parsed.map(String).slice(0, 3));
    } catch { /* не разобралось — молчим */ }
  };

  return (
    <div className="mt-1">
      <button type="button" onClick={() => void run()} disabled={loading}
        className="flex items-center gap-1 text-[10px] font-semibold transition-all"
        style={{ color: `${C.accent}99`, background: 'none', border: 'none', cursor: 'pointer' }}>
        {loading ? <><Loader size={9} className="animate-spin"/> Думаю...</> : <><Sparkles size={9}/> Варианты ответов</>}
      </button>
      <AnimatePresence>
        {replies.length > 0 && (
          <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 4 }}
            className="flex flex-wrap gap-1.5 mt-1.5">
            {replies.map((r, i) => (
              <button key={i} type="button" onClick={() => { onPick(r); setReplies([]); }}
                className="rounded-full px-3 py-1 text-[11px] font-medium transition-all hover:brightness-110"
                style={{ background: `${C.accent}15`, border: `1px solid ${C.border}`, color: C.accent, cursor: 'pointer' }}>
                {r}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

/** Значок Prime — для мест, где нужно коротко обозначить уровень. */
export const PrimeMark = () => (
  <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full"
    style={{ background: 'rgba(168,85,247,0.1)', color: C.accent, border: '1px solid rgba(168,85,247,0.2)' }}>
    <Crown size={10}/> Prime
  </span>
);
