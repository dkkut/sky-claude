/**
 * Sky Вопросы — вопросы и ответы людей экосистемы: лента (новые / без ответа / популярные / мои), поиск и теги,
 * страница вопроса с ответами, голосами, «лучшим ответом» и жалобой. Репутация считается сервером из настоящих голосов.
 */
import { flash } from '@/shared/flash';
import { HELD_TEXT } from '@/shared/contentFilter';
import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowUp, ArrowDown, Check, ChevronLeft, Flag, MessageSquare, Plus, Search, Trash2, X } from 'lucide-react';
import { SkyLoader } from '@/shared/SkyLoader';
import { qaApi, type QaAnswer, type QaQuestion, type QaSort } from './api';

const ERR: Record<string, string> = {
  content_blocked: 'Текст не прошёл проверку — измените его.',
  bad_title: 'Название — от 10 знаков.', bad_body: 'Ответ — от 10 знаков.', daily_limit: 'На сегодня лимит исчерпан — попробуйте завтра.', duplicate: 'Такой вопрос вы уже задавали сегодня.',
  already_answered: 'Вы уже отвечали на этот вопрос.', own_question: 'На свой вопрос отвечать нельзя.', own_answer: 'За свой ответ голосовать нельзя.', has_answers: 'На вопрос уже ответили — удалить его нельзя.',
  already_reported: 'Вы уже жаловались на это.', not_found: 'Не найдено — возможно, уже удалено.', rate_limited: 'Слишком часто — подождите минуту.',
};
const errText = (e?: string) => ERR[e ?? ''] ?? (e ? `Не удалось выполнить (${e})` : 'Не удалось выполнить');
const REASONS: [string, string][] = [['spam', 'Спам или реклама'], ['abuse', 'Оскорбления'], ['illegal', 'Незаконное'], ['personal_data', 'Личные данные'], ['other', 'Другое']];
const card: React.CSSProperties = { background: 'var(--bg-l1)', border: '1px solid var(--border)', borderRadius: 20, padding: 14 };
const field = 'w-full rounded-xl px-3 py-2 text-sm outline-none';
const fieldSt: React.CSSProperties = { background: 'var(--bg-l2)', color: 'var(--t1)', border: '1px solid var(--border)' };
const when = (iso: string) => new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
const SORTS: { id: QaSort | 'mine'; label: string }[] = [{ id: 'new', label: 'Новые' }, { id: 'unanswered', label: 'Без ответа' }, { id: 'top', label: 'Популярные' }, { id: 'mine', label: 'Мои' }];

export const SkyQA = () => {
  const [open, setOpen] = useState<string | null>(null);
  return open ? <QuestionPage id={open} onBack={() => setOpen(null)} /> : <Feed onOpen={setOpen} />;
};

const Feed = ({ onOpen }: { onOpen: (id: string) => void }) => {
  const [sort, setSort] = useState<QaSort | 'mine'>('new');
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [tag, setTag] = useState('');
  const [items, setItems] = useState<QaQuestion[] | null>(null);
  const [more, setMore] = useState(false);
  const [tags, setTags] = useState<{ tag: string; n: number }[]>([]);
  const [rep, setRep] = useState<number | null>(null);
  const [failed, setFailed] = useState('');
  const [ask, setAsk] = useState(false);

  const load = useCallback(async (offset = 0) => {
    const r = await qaApi.list({ sort: sort === 'mine' ? 'new' : sort, mine: sort === 'mine', q: query, tag, offset });
    if (r.ok && r.data) { setItems((cur) => offset ? [...(cur ?? []), ...r.data!.items] : r.data!.items); setMore(r.data.hasMore); setFailed(''); } else setFailed(errText(r.error));
  }, [sort, query, tag]);
  useEffect(() => { setItems(null); void load(0); }, [load]);
  useEffect(() => {
    void qaApi.tags().then((r) => { if (r.ok && r.data) setTags(r.data.tags); });
    void qaApi.me().then((r) => { if (r.ok && r.data) setRep(r.data.reputation); });
  }, []);

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-3xl min-w-0 flex-col overflow-y-auto overflow-x-hidden px-4 pb-24 pt-4" style={{ color: 'var(--t1)' }}>
      <div className="flex items-center gap-2">
        <h2 className="min-w-0 flex-1 text-lg font-bold" style={{ color: 'var(--t1)' }}>Вопросы</h2>
        {rep !== null && <span className="rounded-full px-3 py-1 text-xs font-semibold" style={{ background: 'var(--bg-l2)' }} title="Репутация">{`★ ${rep}`}</span>}
        <button type="button" className="inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-sm font-semibold" style={{ background: 'var(--accent)', color: '#fff' }} onClick={() => setAsk(true)}><Plus size={15} />Задать вопрос</button>
      </div>
      <form className="mt-3 flex gap-2" role="search" onSubmit={(e) => { e.preventDefault(); setQuery(q.trim()); }}>
        <input aria-label="Поиск по вопросам" className={field} style={fieldSt} placeholder="Поиск по вопросам" value={q} maxLength={80} onChange={(e) => setQ(e.target.value)} translate="no" />
        <button type="submit" aria-label="Искать" className="glass-btn round shrink-0"><Search size={16} /></button>
      </form>
      <div className="glass-pill mt-3 flex items-center gap-1 p-1" role="tablist">
        {SORTS.map((s) => (
          <button key={s.id} type="button" role="tab" aria-selected={sort === s.id} onClick={() => setSort(s.id)} className="relative isolate min-h-[36px] flex-1 rounded-full px-2 text-[13px] font-semibold">
            {sort === s.id && <motion.span layoutId="qa-lens" className="glass-lens absolute inset-0 -z-10 rounded-full" transition={{ type: 'spring', stiffness: 420, damping: 34 }} />}
            {s.label}
          </button>
        ))}
      </div>
      {tags.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {tag && <button type="button" className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold" style={{ background: 'var(--accent)', color: '#fff' }} onClick={() => setTag('')} translate="no"><X size={12} />{tag}</button>}
          {tags.filter((t) => t.tag !== tag).slice(0, 12).map((t) => <button key={t.tag} type="button" className="rounded-full px-3 py-1 text-xs" style={{ background: 'var(--bg-l2)' }} onClick={() => setTag(t.tag)} translate="no">{`#${t.tag}`}</button>)}
        </div>
      )}
      <div className="mt-3 flex flex-col gap-2">
        {items === null ? (failed ? <p className="text-sm" role="alert">{failed} <button type="button" className="underline" onClick={() => void load(0)}>Повторить</button></p> : <SkyLoader />) :
          items.length === 0 ? <p className="text-sm" style={{ color: 'var(--t3)' }}>{query || tag ? 'Ничего не найдено.' : sort === 'mine' ? 'Вы ещё не задавали вопросов.' : 'Вопросов пока нет — задайте первый.'}</p> :
            items.map((it) => (
              <button key={it.id} type="button" className="text-left" style={card} onClick={() => onOpen(it.id)}>
                <div className="text-sm font-semibold" style={{ color: 'var(--t1)' }} translate="no">{it.title}</div>
                {it.body && <p className="mt-1 line-clamp-2 text-xs" style={{ color: 'var(--t2)' }} translate="no">{it.body}</p>}
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs" style={{ color: 'var(--t2)' }}>
                  <span className="inline-flex items-center gap-1" style={it.hasBest ? { color: '#22c55e' } : undefined}>{it.hasBest ? <Check size={13} /> : <MessageSquare size={13} />}{String(it.answers)}</span>
                  <span translate="no">{it.author.name}</span><span>{when(it.createdAt)}</span>
                  {it.tags.slice(0, 3).map((t) => <span key={t} translate="no">{`#${t}`}</span>)}
                </div>
              </button>
            ))}
        {more && <button type="button" className="mx-auto rounded-full px-4 py-2 text-sm font-semibold" style={{ background: 'var(--bg-l2)' }} onClick={() => void load(items?.length ?? 0)}>Показать ещё</button>}
      </div>
      {ask && <AskForm onClose={() => setAsk(false)} onDone={(id) => { setAsk(false); onOpen(id); }} />}
    </div>
  );
};

const AskForm = ({ onClose, onDone }: { onClose: () => void; onDone: (id: string) => void }) => {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [tags, setTags] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const submit = async () => {
    setBusy(true); setErr('');
    const r = await qaApi.ask({ title, body, tags: tags.split(/[,\s]+/).map((t) => t.replace(/^#/, '')).filter(Boolean) });
    setBusy(false);
    if (r.ok && r.data?.id) { if (r.data.held) { flash(HELD_TEXT); onClose(); } else onDone(r.data.id); } else setErr(errText(r.error));
  };
  return (
    <div className="fixed inset-0 z-[300] flex items-end justify-center sm:items-center" style={{ background: 'rgba(0,0,0,.55)' }} onClick={onClose}>
      <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-3xl p-4 sm:rounded-3xl" style={{ background: 'var(--bg-l1)', color: 'var(--t1)' }} role="dialog" aria-label="Новый вопрос" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center"><h3 className="flex-1 text-base font-bold" style={{ color: 'var(--t1)' }}>Новый вопрос</h3><button type="button" aria-label="Закрыть" onClick={onClose}><X size={20} /></button></div>
        <div className="mt-3 flex flex-col gap-3">
          <input className={field} style={fieldSt} placeholder="Ваш вопрос (от 10 знаков)" maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} translate="no" />
          <textarea className={field} style={{ ...fieldSt, minHeight: 90 }} placeholder="Подробности (необязательно)" maxLength={5000} value={body} onChange={(e) => setBody(e.target.value)} translate="no" />
          <input className={field} style={fieldSt} placeholder="Теги через запятую (до 5)" value={tags} onChange={(e) => setTags(e.target.value)} translate="no" />
          <p className="text-xs" style={{ color: 'var(--t3)' }}>Вопрос увидят все пользователи Sky. Не публикуйте личные данные — свои и чужие.</p>
          {err && <p className="text-sm" role="alert" style={{ color: '#ef4444' }}>{err}</p>}
          <button type="button" disabled={busy || title.trim().length < 10} onClick={() => void submit()} className="rounded-full px-4 py-2.5 text-sm font-semibold disabled:opacity-50" style={{ background: 'var(--accent)', color: '#fff' }}>Опубликовать</button>
        </div>
      </div>
    </div>
  );
};

const QuestionPage = ({ id, onBack }: { id: string; onBack: () => void }) => {
  const [data, setData] = useState<{ question: QaQuestion; answers: QaAnswer[] } | null>(null);
  const [failed, setFailed] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const load = useCallback(async () => {
    const r = await qaApi.get(id);
    if (r.ok && r.data) { setData(r.data); setFailed(''); } else setFailed(errText(r.error));
  }, [id]);
  useEffect(() => { void load(); }, [load]);

  const send = async () => {
    setBusy(true); setMsg('');
    const r = await qaApi.answer(id, text);
    setBusy(false);
    if (r.ok) { setText(''); if (r.data?.held) flash(HELD_TEXT); void load(); } else setMsg(errText(r.error));
  };
  const vote = async (a: QaAnswer, v: number) => {
    const next = a.myVote === v ? 0 : v;
    const r = await qaApi.vote(a.id, next);
    if (r.ok) void load(); else setMsg(errText(r.error));
  };
  const [reporting, setReporting] = useState<{ kind: 'question' | 'answer'; id: string } | null>(null);
  const report = (kind: 'question' | 'answer', rid: string) => setReporting({ kind, id: rid });
  const sendReport = async (reason: string) => {
    if (!reporting) return;
    const r = await qaApi.report(reporting.kind, reporting.id, reason); setReporting(null);
    setMsg(r.ok ? 'Жалоба отправлена модераторам.' : errText(r.error));
  };

  if (!data) return (
    <div className="mx-auto w-full max-w-3xl px-4 pt-4" style={{ color: 'var(--t1)' }}>
      <button type="button" aria-label="Назад" className="glass-btn round mb-3" onClick={onBack}><ChevronLeft size={18} /></button>
      {failed ? <p className="text-sm" role="alert">{failed}</p> : <SkyLoader />}
    </div>
  );
  const { question: qn, answers } = data;
  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-3xl min-w-0 flex-col overflow-y-auto overflow-x-hidden px-4 pb-24 pt-4" style={{ color: 'var(--t1)' }}>
      <button type="button" aria-label="Назад" className="glass-btn round mb-3 self-start" onClick={onBack}><ChevronLeft size={18} /></button>
      <div style={card}>
        <h2 className="text-lg font-bold" style={{ color: 'var(--t1)' }} translate="no">{qn.title}</h2>
        {qn.body && <p className="mt-2 whitespace-pre-wrap break-words text-sm" translate="no">{qn.body}</p>}
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs" style={{ color: 'var(--t2)' }}>
          <span translate="no">{qn.author.name}</span><span>{when(qn.createdAt)}</span>
          {qn.tags.map((t) => <span key={t} translate="no">{`#${t}`}</span>)}
          <span className="ml-auto flex gap-3">
            {!qn.mine && <button type="button" className="inline-flex items-center gap-1" onClick={() => void report('question', qn.id)}><Flag size={13} />Пожаловаться</button>}
            {qn.mine && qn.answers === 0 && <button type="button" className="inline-flex items-center gap-1" onClick={async () => { if (window.confirm('Удалить вопрос?')) { const r = await qaApi.removeQuestion(qn.id); if (r.ok) onBack(); else setMsg(errText((r as { error?: string }).error)); } }}><Trash2 size={13} />Удалить</button>}
          </span>
        </div>
      </div>
      {msg && <p className="mt-2 text-sm" role="status" style={{ color: 'var(--t2)' }}>{msg}</p>}
      <h3 className="mt-4 text-sm font-semibold" style={{ color: 'var(--t2)' }}>{`Ответы: ${answers.length}`}</h3>
      <div className="mt-2 flex flex-col gap-2">
        {answers.length === 0 && <p className="text-sm" style={{ color: 'var(--t3)' }}>Ответов пока нет.</p>}
        {answers.map((a) => (
          <div key={a.id} className="flex gap-3" style={{ ...card, borderColor: a.best ? '#22c55e' : undefined }}>
            <div className="flex w-9 shrink-0 flex-col items-center gap-1">
              <button type="button" aria-label="Полезный ответ" aria-pressed={a.myVote === 1} disabled={a.mine} className="rounded-full p-1 disabled:opacity-40" style={{ background: a.myVote === 1 ? 'var(--accent)' : 'var(--bg-l2)', color: a.myVote === 1 ? '#fff' : undefined }} onClick={() => void vote(a, 1)}><ArrowUp size={16} /></button>
              <span className="text-sm font-bold">{a.score}</span>
              <button type="button" aria-label="Неполезный ответ" aria-pressed={a.myVote === -1} disabled={a.mine} className="rounded-full p-1 disabled:opacity-40" style={{ background: a.myVote === -1 ? '#ef4444' : 'var(--bg-l2)', color: a.myVote === -1 ? '#fff' : undefined }} onClick={() => void vote(a, -1)}><ArrowDown size={16} /></button>
            </div>
            <div className="min-w-0 flex-1">
              {a.best && <div className="mb-1 inline-flex items-center gap-1 text-xs font-semibold" style={{ color: '#22c55e' }}><Check size={13} />Лучший ответ</div>}
              <p className="whitespace-pre-wrap break-words text-sm" translate="no">{a.body}</p>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs" style={{ color: 'var(--t2)' }}>
                <span translate="no">{a.author.name}</span><span>{`★ ${a.author.rep ?? 0}`}</span><span>{when(a.createdAt)}</span>
                <span className="ml-auto flex gap-3">
                  {qn.mine && !a.mine && <button type="button" onClick={async () => { const r = a.best ? await qaApi.unaccept(qn.id) : await qaApi.accept(qn.id, a.id); if (r.ok) void load(); else setMsg(errText(r.error)); }}>{a.best ? 'Снять отметку' : 'Это лучший ответ'}</button>}
                  {a.mine ? <button type="button" aria-label="Удалить ответ" onClick={async () => { if (window.confirm('Удалить ваш ответ?')) { const r = await qaApi.removeAnswer(a.id); if (r.ok) void load(); } }}><Trash2 size={13} /></button>
                    : <button type="button" aria-label="Пожаловаться на ответ" onClick={() => void report('answer', a.id)}><Flag size={13} /></button>}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
      {reporting && (
        <div className="fixed inset-0 z-[300] flex items-end justify-center sm:items-center" style={{ background: 'rgba(0,0,0,.55)' }} onClick={() => setReporting(null)}>
          <div className="w-full max-w-sm rounded-t-3xl p-4 sm:rounded-3xl" style={{ background: 'var(--bg-l1)', color: 'var(--t1)' }} role="dialog" aria-label="Жалоба" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-3 text-base font-bold" style={{ color: 'var(--t1)' }}>Причина жалобы</h3>
            <div className="flex flex-col gap-2">{REASONS.map(([k, l]) => <button key={k} type="button" className="rounded-xl px-3 py-2.5 text-left text-sm font-semibold" style={{ background: 'var(--bg-l2)' }} onClick={() => void sendReport(k)}>{l}</button>)}</div>
          </div>
        </div>
      )}
      {!qn.mine && !answers.some((a) => a.mine) && (
        <div className="mt-4 flex flex-col gap-2" style={card}>
          <textarea className={field} style={{ ...fieldSt, minHeight: 100 }} placeholder="Ваш ответ (от 10 знаков)" maxLength={5000} value={text} onChange={(e) => setText(e.target.value)} translate="no" />
          <button type="button" disabled={busy || text.trim().length < 10} onClick={() => void send()} className="self-end rounded-full px-4 py-2 text-sm font-semibold disabled:opacity-50" style={{ background: 'var(--accent)', color: '#fff' }}>Ответить</button>
        </div>
      )}
    </div>
  );
};

export default SkyQA;
