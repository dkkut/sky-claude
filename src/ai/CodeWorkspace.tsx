/**
 * Sky AI → «Код»: рабочее место в духе терминального помощника.
 *
 *  — команды через «/» (разобрать, исправить, ревью, тесты, рефакторинг, документация, оптимизация, перевод на другой язык);
 *  — файлы с кода как контекст: выбираются кнопкой, перетаскиваются или вставляются; читаются ТОЛЬКО на устройстве и уходят в запрос текстом;
 *  — ответы с подсветкой кода, номерами строк, «Копировать», «Скачать как файл», сворачиванием длинных блоков;
 *  — Esc прерывает ответ, ↑ возвращает прошлый запрос, экспорт диалога в .md.
 *
 * Честно: код здесь НЕ запускается — ни на сервере Sky, ни в браузере. Помощник пишет и разбирает код, но не утверждает, что он проверен выполнением.
 */
import { CloudBuddy } from './CloudBuddy';
import { useEffect, useMemo, useRef, useState } from 'react';
import { GitBranch, Search, Archive, Terminal, Paperclip, X, Copy, Check, Download, FileCode2, Send, Square, ChevronDown, ChevronUp, RotateCcw, FileDown, Plus } from 'lucide-react';
import { apiAiSend, type AiMessage } from './aiApi';
import { apiRepoTree, apiRepoFiles, REPO_ERR, type RepoTree } from './repoApi';
import { buildZip, downloadBlob, safeEntryName } from './zip';
import { refreshAiState } from './aiState';

/* ── Команды ─────────────────────────────────────────────────── */
interface Cmd { name: string; hint: string; build?: (arg: string) => string; local?: 'clear' | 'help' | 'new' | 'export' }
const CMDS: Cmd[] = [
  { name: 'explain', hint: 'Объяснить, как работает код', build: (a) => `Объясни, как работает этот код: по шагам, коротко и по делу.${a ? ` Особое внимание: ${a}.` : ''}` },
  { name: 'fix', hint: 'Найти и исправить ошибку', build: (a) => `Найди причину ошибки и дай исправленный код с кратким объяснением, что было не так.${a ? ` Симптом: ${a}.` : ''}` },
  { name: 'review', hint: 'Ревью: баги, безопасность, стиль', build: (a) => `Сделай ревью кода: баги, уязвимости, граничные случаи, читаемость. Список по важности, с конкретными правками.${a ? ` Фокус: ${a}.` : ''}` },
  { name: 'test', hint: 'Написать тесты', build: (a) => `Напиши тесты для этого кода, включая граничные случаи.${a ? ` Фреймворк/язык: ${a}.` : ' Если фреймворк не очевиден — выбери самый распространённый и назови его.'}` },
  { name: 'refactor', hint: 'Упростить и почистить', build: (a) => `Предложи рефакторинг: упрости, убери дублирование, сохрани поведение. Покажи итоговый код и перечисли изменения.${a ? ` Цель: ${a}.` : ''}` },
  { name: 'docs', hint: 'Комментарии и документация', build: (a) => `Добавь документацию: докстринги/комментарии к публичным частям и короткое описание использования.${a ? ` Формат: ${a}.` : ''}` },
  { name: 'optimize', hint: 'Ускорить и сократить расходы', build: (a) => `Найди узкие места по скорости и памяти и предложи оптимизации с оценкой выигрыша. Не меняй поведение.${a ? ` Что важнее: ${a}.` : ''}` },
  { name: 'convert', hint: '/convert <язык> — перевести код', build: (a) => `Переведи этот код на ${a || 'указанный язык'}, сохранив поведение. Отметь отличия в идиомах и библиотеках.` },
  { name: 'new', hint: 'Новый диалог', local: 'new' },
  { name: 'clear', hint: 'Очистить экран (диалог останется на сервере)', local: 'clear' },
  { name: 'export', hint: 'Скачать диалог как .md', local: 'export' },
  { name: 'help', hint: 'Список команд и подсказки', local: 'help' },
];

import { readTextFiles, filesPrompt, type CtxFile as Ctx } from './attachFiles';

/* ── Подсветка ───────────────────────────────────────────────── */
const KW = new Set(('abstract async await break case catch class const continue def default defer do elif else enum except export extends false final finally fn for from func function go if impl import in interface is lambda let loop match mod mut namespace new nil none not null of or package pass private public pub raise return self static struct super switch this throw true try type typeof use var void while with yield and as begin end then local echo fi done select where').split(' '));
const TOK = /(\/\/[^\n]*|#[^\n]*|--[^\n]*|\/\*[\s\S]*?\*\/)|("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`)|(\b\d[\d_.]*\b)|([A-Za-z_][A-Za-z0-9_]*)/g;
const Highlight = ({ line }: { line: string }) => {
  const out: React.ReactNode[] = []; let last = 0; let k = 0; let m: RegExpExecArray | null;
  TOK.lastIndex = 0;
  while ((m = TOK.exec(line))) {
    if (m.index > last) out.push(line.slice(last, m.index));
    const [t, com, str, num, id] = m;
    const color = com ? '#6e7b8b' : str ? '#a5d6a7' : num ? '#f2a96b' : id && KW.has(id) ? '#c792ea' : null;
    out.push(color ? <span key={k++} style={{ color }}>{t}</span> : t);
    last = m.index + t.length;
    if (m[0] === '') TOK.lastIndex++;
  }
  if (last < line.length) out.push(line.slice(last));
  return <>{out}</>;
};

const EXT: Record<string, string> = { javascript: 'js', js: 'js', typescript: 'ts', ts: 'ts', tsx: 'tsx', jsx: 'jsx', python: 'py', py: 'py', rust: 'rs', go: 'go', java: 'java', kotlin: 'kt', swift: 'swift', c: 'c', cpp: 'cpp', csharp: 'cs', cs: 'cs', php: 'php', ruby: 'rb', bash: 'sh', sh: 'sh', shell: 'sh', sql: 'sql', html: 'html', css: 'css', json: 'json', yaml: 'yml', yml: 'yml', md: 'md', markdown: 'md' };

const CodeBlock = ({ lang, code, path }: { lang: string; code: string; path?: string }) => {
  const [done, setDone] = useState(false);
  const lines = code.split('\n');
  const long = lines.length > 28;
  const [open, setOpen] = useState(!long);
  const shown = open ? lines : lines.slice(0, 12);
  const copy = () => { void navigator.clipboard?.writeText(code).then(() => { setDone(true); setTimeout(() => setDone(false), 1500); }).catch(() => { /* буфер недоступен */ }); };
  const save = () => {
    const ext = EXT[lang.toLowerCase()] ?? 'txt';
    downloadBlob(code, path ? (safeEntryName(path).split('/').pop() || `sky-code.${ext}`) : `sky-code.${ext}`, 'text/plain;charset=utf-8');
  };
  const btn = 'flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] hover:bg-white/10';
  return (
    <div className="my-2 overflow-hidden rounded-xl" data-keep-dark translate="no" style={{ background: '#0b0f14', border: '1px solid rgba(255,255,255,0.09)' }}>
      <div className="flex items-center justify-between px-3 py-1.5" style={{ background: 'rgba(255,255,255,0.05)', color: '#9aa4b2' }}>
        <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider"><FileCode2 size={11} />{path ? <span className="normal-case tracking-normal" style={{ color: '#d8b4fe' }}>{path}</span> : (lang || 'code')}<span style={{ opacity: .6 }}>· {lines.length} стр.</span></span>
        <span className="flex items-center gap-1">
          <button type="button" onClick={save} className={btn} aria-label="Скачать как файл"><Download size={11} />Файл</button>
          <button type="button" onClick={copy} className={btn} aria-label="Копировать">{done ? <Check size={11} /> : <Copy size={11} />}{done ? 'Скопировано' : 'Копировать'}</button>
        </span>
      </div>
      <pre className="overflow-x-auto py-2 text-[12px] leading-[1.55]" style={{ color: '#e6edf3', fontFamily: 'ui-monospace,SFMono-Regular,Menlo,monospace' }}>
        <code>{shown.map((l, i) => (
          <div key={i} className="flex">
            <span className="w-9 shrink-0 select-none pr-3 text-right" style={{ color: '#4b5663' }}>{i + 1}</span>
            <span className="whitespace-pre pr-3"><Highlight line={l} /></span>
          </div>))}</code>
      </pre>
      {long && (
        <button type="button" onClick={() => setOpen(o => !o)} className="flex w-full items-center justify-center gap-1 py-1.5 text-[11px]" style={{ background: 'rgba(255,255,255,0.04)', color: '#9aa4b2' }}>
          {open ? <><ChevronUp size={12} />Свернуть</> : <><ChevronDown size={12} />Показать всё ({lines.length} строк)</>}
        </button>)}
    </div>
  );
};

/* Минимальная разметка вне кода: заголовки, списки, `код`, **жирный**. Без внешних библиотек и без HTML из текста. */
const Inline = ({ text }: { text: string }) => {
  const parts = text.split(/(`[^`\n]+`|\*\*[^*\n]+\*\*)/g);
  return <>{parts.map((p, i) => p.startsWith('`') && p.endsWith('`') && p.length > 2
    ? <code key={i} className="rounded px-1 py-px text-[12px]" style={{ background: 'rgba(168,85,247,0.14)', color: '#d8b4fe', fontFamily: 'ui-monospace,Menlo,monospace' }}>{p.slice(1, -1)}</code>
    : p.startsWith('**') && p.endsWith('**') && p.length > 4 ? <strong key={i}>{p.slice(2, -2)}</strong> : <span key={i}>{p}</span>)}</>;
};
const Prose = ({ text }: { text: string }) => (
  <div className="space-y-1.5" translate="no">
    {text.split('\n').map((l, i) => {
      if (!l.trim()) return <div key={i} className="h-1" />;
      const h = /^(#{1,4})\s+(.*)/.exec(l);
      if (h) return <p key={i} className="pt-1 text-[13px] font-bold" style={{ color: 'var(--t1)' }}><Inline text={h[2]} /></p>;
      const li = /^\s*([-*]|\d+[.)])\s+(.*)/.exec(l);
      if (li) return <p key={i} className="flex gap-2 text-[13px] leading-relaxed" style={{ color: 'var(--t1)' }}><span style={{ color: '#a855f7' }}>{/\d/.test(li[1]) ? li[1] : '•'}</span><span><Inline text={li[2]} /></span></p>;
      return <p key={i} className="text-[13px] leading-relaxed" style={{ color: 'var(--t1)' }}><Inline text={l} /></p>;
    })}
  </div>
);
/** Строка после ``` : «язык путь/к/файлу.ext» или просто путь. Путь распознаётся только если похож на путь к файлу. */
const parseInfo = (info: string): { lang: string; path?: string } => {
  const t = info.trim().split(/\s+/).filter(Boolean);
  const isPath = (x: string) => /^[\w.@()+\-/]{1,200}$/.test(x) && /\.[A-Za-z0-9]{1,8}$/.test(x) && !x.includes('..');
  const path = t.find(isPath);
  const lang = t.find((x) => x !== path)?.replace(/^\{|\}$/g, '') ?? (path ? (path.split('.').pop() ?? '') : '');
  return { lang, ...(path ? { path: path.replace(/^\.?\//, '') } : {}) };
};

const UpdatedFiles = ({ files }: { files: { path: string; code: string }[] }) => {
  if (!files.length) return null;
  const zip = () => downloadBlob(buildZip(files.map((f) => ({ path: f.path, text: f.code }))), 'sky-code-files.zip', 'application/zip');
  return (
    <div className="my-2 rounded-xl p-3" data-keep-dark translate="no" style={{ background: 'rgba(168,85,247,0.08)', border: '1px solid rgba(168,85,247,0.25)' }}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-1.5 text-[11px] font-bold" style={{ color: '#d8b4fe' }}><Archive size={12} />{`Обновлённые файлы: ${files.length}`}</span>
        <button type="button" onClick={zip} className="ml-auto flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-bold" style={{ background: '#a855f7', color: '#fff' }}><Download size={11} />Скачать всё (.zip)</button>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {files.map((f) => (
          <button key={f.path} type="button" onClick={() => downloadBlob(f.code, safeEntryName(f.path).split('/').pop() || 'file.txt', 'text/plain;charset=utf-8')}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px]" style={{ background: 'rgba(255,255,255,0.06)', color: '#e6edf3', ...mono }} title="Скачать файл"><FileCode2 size={11} />{f.path}</button>))}
      </div>
    </div>
  );
};

const Answer = ({ text }: { text: string }) => {
  const parts = text.split(/```([^\n`]*)\n?([\s\S]*?)```/g);
  const out: React.ReactNode[] = []; const updated: { path: string; code: string }[] = [];
  for (let i = 0; i < parts.length; i += 3) {
    if (parts[i]?.trim()) out.push(<Prose key={i} text={parts[i].trim()} />);
    if (i + 2 < parts.length) {
      const info = parseInfo(parts[i + 1]); const code = parts[i + 2].replace(/\n$/, '');
      if (info.path) { const k = updated.findIndex((u) => u.path === info.path); if (k >= 0) updated[k] = { path: info.path, code }; else updated.push({ path: info.path, code }); }
      out.push(<CodeBlock key={`c${i}`} lang={info.lang} code={code} path={info.path} />);
    }
  }
  out.push(<UpdatedFiles key="upd" files={updated} />);
  return <>{out}</>;
};

const fmtSize = (n: number) => (n < 1024 ? `${n} Б` : `${(n / 1024).toFixed(1)} КБ`);
const mono = { fontFamily: 'ui-monospace,SFMono-Regular,Menlo,monospace' } as const;

export interface CodeWorkspaceProps {
  chatId: string | null;
  setChatId: (id: string | null) => void;
  messages: AiMessage[];
  setMessages: React.Dispatch<React.SetStateAction<AiMessage[]>>;
  maxChars: number;
  usage?: { used: number; limit: number };
  configured: boolean;
  onSent: () => void;
  onNew: () => void;
}

export const CodeWorkspace = ({ chatId, setChatId, messages, setMessages, maxChars, usage, configured, onSent, onNew }: CodeWorkspaceProps) => {
  const [input, setInput] = useState('');
  const [files, setFiles] = useState<Ctx[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [retry, setRetry] = useState('');
  const [secs, setSecs] = useState(0);
  const [help, setHelp] = useState(false);
  const [drag, setDrag] = useState(false);
  const [sel, setSel] = useState(0);
  const [phase, setPhase] = useState<'code' | 'wave'>('code');
  const [repoOpen, setRepoOpen] = useState(false);
  const [repoIn, setRepoIn] = useState({ repo: '', ref: '', token: '' });
  const [tree, setTree] = useState<RepoTree | null>(null);
  const [pick, setPick] = useState<Set<string>>(new Set());
  const [q, setQ] = useState('');
  const [rbusy, setRbusy] = useState(false);
  const [rerr, setRerr] = useState('');
  const abort = useRef<AbortController | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const history = useRef<string[]>([]);
  const histPos = useRef(-1);

  // Облачко на пустом экране: «пишет код» секунду, потом машет, и так по кругу.
  useEffect(() => {
    const t = window.setTimeout(() => setPhase((p) => (p === 'code' ? 'wave' : 'code')), phase === 'code' ? 1000 : 2200);
    return () => window.clearTimeout(t);
  }, [phase]);

  const openRepo = async () => {
    setRbusy(true); setRerr('');
    const r = await apiRepoTree({ repo: repoIn.repo.trim(), ref: repoIn.ref.trim() || undefined, token: repoIn.token.trim() || undefined });
    setRbusy(false);
    if (!r.ok || !r.data) { setRerr(REPO_ERR[r.error ?? ''] ?? 'Не удалось открыть репозиторий'); return; }
    setTree(r.data); setPick(new Set()); setQ('');
  };
  const togglePick = (path: string) => setPick((cur) => { const n = new Set(cur); if (n.has(path)) n.delete(path); else if (n.size < 12) n.add(path); return n; });
  const addPicked = async () => {
    if (!tree || !pick.size) return;
    setRbusy(true); setRerr('');
    const r = await apiRepoFiles({ repo: tree.repo, ref: tree.ref, paths: [...pick], token: repoIn.token.trim() || undefined });
    setRbusy(false);
    if (!r.ok || !r.data) { setRerr(REPO_ERR[r.error ?? ''] ?? 'Не удалось получить файлы'); return; }
    const add = r.data.files.map((f) => ({ name: f.path, text: f.text }));
    setFiles((cur) => { const m = new Map(cur.map((f) => [f.name, f])); add.forEach((f) => m.set(f.name, f)); return [...m.values()].slice(0, 12); });
    const skipped = r.data.skipped.length ? `Пропущено: ${r.data.skipped.map((x) => x.path).join(', ')}` : '';
    setErr(skipped); setRepoOpen(false); setPick(new Set());
  };
  const shown = useMemo(() => (tree ? tree.files.filter((f) => !q || f.path.toLowerCase().includes(q.toLowerCase())).slice(0, 200) : []), [tree, q]);

  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' }); }, [messages, busy, help]);
  useEffect(() => {
    if (!busy) return;
    const t0 = Date.now(); setSecs(0);
    const t = window.setInterval(() => setSecs(Math.floor((Date.now() - t0) / 1000)), 500);
    return () => window.clearInterval(t);
  }, [busy]);

  const ctxChars = files.reduce((s, f) => s + f.text.length + f.name.length + 12, 0);
  const slash = input.startsWith('/') && !input.includes(' ') ? input.slice(1).toLowerCase() : null;
  const matches = useMemo(() => (slash === null ? [] : CMDS.filter(c => c.name.startsWith(slash))), [slash]);
  useEffect(() => { setSel(0); }, [slash]);

  const addFiles = async (list: FileList | File[]) => {
    const r = await readTextFiles(list, files);
    setFiles(r.files);
    setErr(r.errors.join(' · '));
  };

  const buildPrompt = (userText: string) => {
    return filesPrompt(userText, files);
  };

  const run = async (userText: string, display: string) => {
    const full = buildPrompt(userText);
    if (full.length > maxChars) { setErr(`Слишком много текста: ${full.length.toLocaleString('ru-RU')} из ${maxChars.toLocaleString('ru-RU')} знаков. Уберите файл или сократите запрос.`); return; }
    setErr(''); setRetry(''); setBusy(true);
    setMessages(h => [...h, { id: `local-${Date.now()}`, role: 'user', text: files.length ? `${display}\n\n📎 ${files.map(f => f.name).join(', ')}` : display, tool: 'chat', createdAt: new Date().toISOString() }]);
    const ctl = new AbortController(); abort.current = ctl;
    const r = await apiAiSend(full, chatId ?? undefined, { mode: 'code', signal: ctl.signal });
    abort.current = null; setBusy(false);
    if (r.code === 'aborted') { setRetry(userText); return; }
    if (!r.ok || !r.answer) { setErr(r.reason ?? 'Не получилось'); setRetry(userText); return; }
    if (!chatId && r.chatId) setChatId(r.chatId);
    setMessages(h => [...h, r.answer as AiMessage]);
    onSent(); void refreshAiState();
  };

  const exportMd = () => {
    const md = messages.map(m => `### ${m.role === 'user' ? 'Вы' : 'Sky AI'}\n\n${m.text}`).join('\n\n---\n\n');
    const url = URL.createObjectURL(new Blob([md], { type: 'text/markdown;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = 'sky-code-session.md'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  const submit = () => {
    const raw = input.trim();
    if (!raw || busy) return;
    const m = /^\/(\w+)\s*([\s\S]*)$/.exec(raw);
    if (m) {
      const cmd = CMDS.find(c => c.name === m[1].toLowerCase());
      if (!cmd) { setErr(`Неизвестная команда /${m[1]}. Список — /help`); return; }
      setInput('');
      if (cmd.local === 'new') { onNew(); setFiles([]); setHelp(false); return; }
      if (cmd.local === 'clear') { setMessages([]); setHelp(false); return; }
      if (cmd.local === 'export') { exportMd(); return; }
      if (cmd.local === 'help') { setHelp(true); return; }
      if (!files.length && !m[2].trim() && cmd.name !== 'convert') { setErr('К команде нужен код: прикрепите файл или вставьте код после команды.'); setInput(raw); return; }
      const body = m[2].trim();
      // у команды с файлами текст после неё — уточнение; без файлов — это сам код
      const arg = files.length ? body : (cmd.name === 'convert' ? body.split(/\s+/)[0] ?? '' : '');
      const code = files.length ? '' : (cmd.name === 'convert' ? body.split(/\s+/).slice(1).join(' ') : body);
      const prompt = `${cmd.build!(arg)}${code ? `\n\n\`\`\`\n${code}\n\`\`\`` : ''}`;
      history.current.unshift(raw); histPos.current = -1;
      void run(prompt, `/${cmd.name}${body ? ` ${body.length > 160 ? `${body.slice(0, 160)}…` : body}` : ''}`);
      return;
    }
    history.current.unshift(raw); histPos.current = -1;
    setInput(''); setHelp(false);
    void run(raw, raw);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (matches.length && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); setSel(s => (s + (e.key === 'ArrowDown' ? 1 : matches.length - 1)) % matches.length); return; }
    if (matches.length && (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey && slash !== matches[sel].name))) { e.preventDefault(); setInput(`/${matches[sel].name} `); return; }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); return; }
    if (e.key === 'Escape' && busy) { abort.current?.abort(); return; }
    if (e.key === 'ArrowUp' && !input && history.current.length) { e.preventDefault(); histPos.current = Math.min(histPos.current + 1, history.current.length - 1); setInput(history.current[histPos.current]); }
  };

  const empty = messages.length === 0;
  return (
    <div className="relative flex h-full min-w-0 flex-1 flex-col overflow-hidden" data-keep-dark style={{ background: '#0a0d12' }}
      onDragOver={e => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
      onDrop={e => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files.length) void addFiles(e.dataTransfer.files); }}>
      {/* Шапка сессии */}
      <div className="flex shrink-0 items-center justify-between px-4 py-2 text-[11px]" style={{ background: '#10151c', borderBottom: '1px solid rgba(255,255,255,0.07)', color: '#9aa4b2', ...mono }}>
        <span className="flex items-center gap-2"><Terminal size={13} style={{ color: '#a855f7' }} /><span style={{ color: '#e6edf3' }}>sky-code</span><span style={{ opacity: .6 }}>{chatId ? `· диалог ${chatId.slice(0, 6)}` : '· новый диалог'}</span></span>
        <span className="flex items-center gap-1">
          {messages.length > 0 && <button type="button" onClick={exportMd} aria-label="Скачать диалог" className="grid h-6 w-6 place-items-center rounded-md hover:bg-white/10"><FileDown size={13} /></button>}
          <button type="button" onClick={() => setRepoOpen((o) => !o)} aria-label="Репозиторий GitHub" title="Репозиторий GitHub" className="grid h-6 w-6 place-items-center rounded-md hover:bg-white/10" style={{ color: repoOpen ? '#d8b4fe' : undefined }}><GitBranch size={14} /></button>
          <button type="button" onClick={() => { onNew(); setFiles([]); }} aria-label="Новый диалог" className="grid h-6 w-6 place-items-center rounded-md hover:bg-white/10"><Plus size={14} /></button>
        </span>
      </div>

      {repoOpen && (
        <div className="shrink-0 space-y-2 px-4 py-3" style={{ background: '#0f141a', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
          <p className="text-[11px] leading-relaxed" style={{ color: '#8b97a6' }}>Репозиторий GitHub, только чтение. Выберите файлы (до 12) — они попадут в запрос. Изменённые файлы помощник отдаёт целиком, их можно скачать и закоммитить самим: в репозиторий Sky ничего не записывает. Токен нужен только для закрытых репозиториев, он уходит в GitHub и нигде не сохраняется.</p>
          <div className="grid gap-2 sm:grid-cols-[1fr_140px_1fr_auto]">
            <input value={repoIn.repo} onChange={(e) => setRepoIn({ ...repoIn, repo: e.target.value })} placeholder="владелец/репозиторий или ссылка" aria-label="Репозиторий" className="rounded-lg px-2.5 py-1.5 text-[12px] outline-none" style={{ background: '#10151c', border: '1px solid rgba(255,255,255,0.1)', color: '#e6edf3', ...mono }} />
            <input value={repoIn.ref} onChange={(e) => setRepoIn({ ...repoIn, ref: e.target.value })} placeholder="ветка (по умолчанию)" aria-label="Ветка" className="rounded-lg px-2.5 py-1.5 text-[12px] outline-none" style={{ background: '#10151c', border: '1px solid rgba(255,255,255,0.1)', color: '#e6edf3', ...mono }} />
            <input value={repoIn.token} onChange={(e) => setRepoIn({ ...repoIn, token: e.target.value })} type="password" autoComplete="off" placeholder="токен GitHub (для закрытых)" aria-label="Токен GitHub" className="rounded-lg px-2.5 py-1.5 text-[12px] outline-none" style={{ background: '#10151c', border: '1px solid rgba(255,255,255,0.1)', color: '#e6edf3', ...mono }} />
            <button type="button" disabled={rbusy || !repoIn.repo.trim()} onClick={() => void openRepo()} className="rounded-lg px-3 py-1.5 text-[12px] font-bold disabled:opacity-50" style={{ background: '#a855f7', color: '#fff' }}>{rbusy && !tree ? 'Открываю…' : 'Открыть'}</button>
          </div>
          {rerr && <p className="text-[11px]" style={{ color: '#fb7185' }}>{rerr}</p>}
          {tree && (
            <div className="space-y-1.5">
              <p className="text-[11px]" style={{ color: '#9aa4b2', ...mono }} translate="no">{`${tree.repo} @ ${tree.ref}${tree.private ? ' · закрытый' : ''}${tree.truncated ? ' · список обрезан' : ''} · файлов: ${tree.files.length}`}</p>
              <div className="flex items-center gap-2"><Search size={12} style={{ color: '#8b97a6' }} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="поиск по пути" aria-label="Поиск файла" className="flex-1 rounded-lg px-2.5 py-1 text-[12px] outline-none" style={{ background: '#10151c', border: '1px solid rgba(255,255,255,0.1)', color: '#e6edf3', ...mono }} />
                <button type="button" disabled={!pick.size || rbusy} onClick={() => void addPicked()} className="rounded-lg px-3 py-1 text-[12px] font-bold disabled:opacity-50" style={{ background: '#a855f7', color: '#fff' }}>{rbusy ? 'Загружаю…' : `Добавить (${pick.size})`}</button></div>
              <div className="max-h-44 overflow-y-auto rounded-lg" style={{ background: '#0b0f14', border: '1px solid rgba(255,255,255,0.07)' }}>
                {shown.map((f) => (
                  <label key={f.path} className="flex cursor-pointer items-center gap-2 px-2.5 py-1 text-[12px] hover:bg-white/5" style={{ color: '#e6edf3', ...mono }} translate="no">
                    <input type="checkbox" checked={pick.has(f.path)} onChange={() => togglePick(f.path)} /><span className="min-w-0 flex-1 truncate">{f.path}</span><span style={{ color: '#6b7684' }}>{fmtSize(f.size)}</span>
                  </label>))}
                {!shown.length && <p className="px-3 py-3 text-[11px]" style={{ color: '#8b97a6' }}>Ничего не найдено</p>}
              </div>
            </div>)}
        </div>)}

      <div ref={listRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4" style={{ scrollbarWidth: 'none' }}>
        {!configured && <p className="rounded-xl px-3 py-2 text-xs" style={{ background: 'rgba(245,158,11,.1)', color: '#f5b84b' }}>Модель не подключена на этом сервере.</p>}
        {empty && !help && (
          <div className="mx-auto max-w-xl pt-4">
            <div className="mb-2"><CloudBuddy mood={phase} size={104} /></div>
            <pre className="text-[11px] leading-tight" style={{ color: '#a855f7', ...mono }}>{`  ┌─┐┬┌─┬ ┬  ┌─┐┌─┐┌┬┐┌─┐\n  └─┐├┴┐└┬┘  │  │ │ ││├┤ \n  └─┘┴ ┴ ┴   └─┘└─┘─┴┘└─┘`}</pre>
            <p className="mt-3 text-sm font-semibold" style={{ color: '#e6edf3' }}>Что будем делать с кодом?</p>
            <p className="mt-1 text-xs leading-relaxed" style={{ color: '#8b97a6' }}>Прикрепите файлы (кнопка со скрепкой или перетащите сюда) и напишите задачу, либо начните с «/». Код здесь не запускается — помощник пишет и разбирает его, но не проверяет выполнением.</p>
            <div className="mt-4 grid grid-cols-2 gap-2">
              {CMDS.filter(c => c.build).slice(0, 6).map(c => (
                <button key={c.name} type="button" onClick={() => { setInput(`/${c.name} `); }} className="rounded-xl px-3 py-2 text-left" style={{ background: '#10151c', border: '1px solid rgba(255,255,255,0.08)' }}>
                  <span className="text-xs font-bold" style={{ color: '#d8b4fe', ...mono }}>/{c.name}</span>
                  <span className="mt-0.5 block text-[11px]" style={{ color: '#8b97a6' }}>{c.hint}</span>
                </button>))}
            </div>
          </div>)}

        {help && (
          <div className="rounded-xl p-3" style={{ background: '#10151c', border: '1px solid rgba(255,255,255,0.08)' }}>
            <p className="mb-2 text-xs font-bold" style={{ color: '#e6edf3' }}>Команды</p>
            {CMDS.map(c => <p key={c.name} className="flex gap-3 py-0.5 text-[12px]"><span className="w-20 shrink-0" style={{ color: '#d8b4fe', ...mono }}>/{c.name}</span><span style={{ color: '#9aa4b2' }}>{c.hint}</span></p>)}
            <p className="mt-2 text-[11px] leading-relaxed" style={{ color: '#8b97a6' }}>Enter — отправить, Shift+Enter — новая строка, Esc — остановить ответ, ↑ — прошлый запрос, Tab — подставить команду.</p>
          </div>)}

        {messages.map(m => m.role === 'user' ? (
          <div key={m.id} className="flex gap-2 text-[13px]" translate="no" style={mono}>
            <span style={{ color: '#a855f7' }}>›</span>
            <span className="min-w-0 whitespace-pre-wrap break-words" style={{ color: '#e6edf3' }}>{m.text}</span>
          </div>
        ) : (
          <div key={m.id} className="flex gap-2">
            <span className="mt-0.5 shrink-0 text-[13px]" style={{ color: '#6366f1', ...mono }}>●</span>
            <div className="min-w-0 flex-1"><Answer text={m.text} /></div>
          </div>
        ))}

        {busy && (
          <div className="flex items-center gap-2 text-[12px]" style={{ color: '#9aa4b2', ...mono }} role="status">
            <CloudBuddy mood="code" size={56} />
            <span className="sky-think-dots" aria-hidden="true"><i /><i /><i /></span>
            <span>Пишу код… {secs} с</span>
            <button type="button" onClick={() => abort.current?.abort()} className="ml-1 flex items-center gap-1 rounded-md px-1.5 py-0.5 hover:bg-white/10"><Square size={10} />Esc</button>
          </div>)}
        {!busy && retry && <button type="button" onClick={() => void run(retry, retry)} className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold" style={{ background: 'rgba(168,85,247,.14)', color: '#d8b4fe' }}><RotateCcw size={12} />Повторить запрос</button>}
        {err && <p className="rounded-xl px-3 py-2 text-xs font-semibold" style={{ background: 'rgba(244,63,94,.1)', color: '#fb7185' }}>{err}</p>}
      </div>

      {drag && <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center text-sm font-bold" style={{ background: 'rgba(10,13,18,.85)', border: '2px dashed #a855f7', color: '#d8b4fe' }}>Отпустите, чтобы добавить файлы</div>}

      {/* Подсказки команд */}
      {matches.length > 0 && (
        <div className="mx-3 mb-1 overflow-hidden rounded-xl" style={{ background: '#10151c', border: '1px solid rgba(255,255,255,0.1)' }} role="listbox">
          {matches.map((c, i) => (
            <button key={c.name} type="button" role="option" aria-selected={i === sel} onClick={() => setInput(`/${c.name} `)} className="flex w-full items-center gap-3 px-3 py-1.5 text-left text-[12px]" style={{ background: i === sel ? 'rgba(168,85,247,.16)' : 'transparent' }}>
              <span className="w-20 shrink-0" style={{ color: '#d8b4fe', ...mono }}>/{c.name}</span><span style={{ color: '#9aa4b2' }}>{c.hint}</span>
            </button>))}
        </div>)}

      {/* Прикреплённые файлы */}
      {files.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-3 pb-1">
          {files.map(f => (
            <span key={f.name} className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px]" style={{ background: '#10151c', border: '1px solid rgba(255,255,255,0.1)', color: '#c9d1d9', ...mono }} translate="no">
              <FileCode2 size={11} style={{ color: '#a855f7' }} />{f.name}<span style={{ opacity: .55 }}>{fmtSize(f.text.length)}</span>
              <button type="button" onClick={() => setFiles(fs => fs.filter(x => x.name !== f.name))} aria-label="Убрать файл"><X size={11} /></button>
            </span>))}
        </div>)}

      {/* Ввод */}
      <div className="shrink-0 px-3 pb-3 pt-1">
        <div className="flex items-end gap-2 rounded-2xl px-3 py-2" style={{ background: '#10151c', border: '1px solid rgba(168,85,247,.35)' }}>
          <span className="pb-1.5 text-sm" style={{ color: '#a855f7', ...mono }}>›</span>
          <textarea value={input} onChange={e => setInput(e.target.value)} onKeyDown={onKey}
            onPaste={e => { const fl = e.clipboardData.files; if (fl.length) { e.preventDefault(); void addFiles(fl); } }}
            placeholder="Опишите задачу, вставьте код или начните с /" aria-label="Запрос к Sky AI" data-ai-input rows={1} maxLength={maxChars}
            className="max-h-40 min-h-[28px] flex-1 resize-none bg-transparent py-1 text-[13px] outline-none" style={{ color: '#e6edf3', ...mono }} />
          <input ref={fileRef} type="file" multiple className="hidden" onChange={e => { if (e.target.files) void addFiles(e.target.files); e.target.value = ''; }} />
          <button type="button" onClick={() => fileRef.current?.click()} aria-label="Прикрепить файлы" className="grid h-8 w-8 shrink-0 place-items-center rounded-lg hover:bg-white/10" style={{ color: '#9aa4b2' }}><Paperclip size={15} /></button>
          {busy
            ? <button type="button" onClick={() => abort.current?.abort()} aria-label="Остановить" className="grid h-8 w-8 shrink-0 place-items-center rounded-lg" style={{ background: 'rgba(244,63,94,.2)', color: '#fb7185' }}><Square size={13} /></button>
            : <button type="button" onClick={submit} disabled={!input.trim()} aria-label="Отправить" data-ai-send className="grid h-8 w-8 shrink-0 place-items-center rounded-lg disabled:opacity-35" style={{ background: 'linear-gradient(135deg,#a855f7,#6366f1)', color: '#fff' }}><Send size={14} /></button>}
        </div>
        <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-3 px-1 text-[10px]" style={{ color: '#6b7787', ...mono }}>
          <span>контекст {(input.length + ctxChars).toLocaleString('ru-RU')} / {maxChars.toLocaleString('ru-RU')}{files.length ? ` · файлов ${files.length}` : ''}</span>
          <span>{usage && usage.limit > 0 ? `сегодня ${usage.used} из ${usage.limit} · ` : ''}код не запускается</span>
        </div>
      </div>
    </div>
  );
};
