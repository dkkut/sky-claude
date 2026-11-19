/** Админка → «Фильтры контента» (право `content`): действие по каждой категории, свои слова, проверка текста, очередь удержаний. */
import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { flash } from '@/shared/flash';
import { Box, Btn, Note, K, fieldSty, inp, call, useLoad, type D } from './kit';

const CAT: Record<string, string> = {
  profanity: 'Мат и грубая брань', adult: 'Контент 18+', drugs: 'Наркотики', contraband: 'Запрещённые товары и услуги',
  terror: 'Терроризм и экстремизм', hate: 'Ненависть и оскорбления', selfharm: 'Самоповреждение', scam: 'Мошенничество', custom: 'Свои слова',
};
const ACT: Record<string, string> = { off: 'Выключено', mask: 'Закрыть звёздочками', moderate: 'Отправить на модерацию', block: 'Не пропускать' };
const KIND: Record<string, string> = { bloom_post: 'Пост Bloom', bloom_comment: 'Комментарий Bloom', qa_question: 'Вопрос', qa_answer: 'Ответ' };

export const ContentFilterTab = () => {
  const [d, load] = useLoad<D>('/api/admin/content-filter');
  const [holds, loadHolds] = useLoad<D>('/api/admin/content-filter/holds?status=pending');
  const [enabled, setEnabled] = useState(true);
  const [actions, setActions] = useState<Record<string, string>>({});
  const [custom, setCustom] = useState<{ word: string; category: string; weight: number }[]>([]);
  const [allow, setAllow] = useState('');
  const [nw, setNw] = useState(''); const [nc, setNc] = useState('custom');
  const [sample, setSample] = useState(''); const [res, setRes] = useState<D | null>(null);
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (!d) return;
    const st = d.settings as D;
    setEnabled(st.enabled !== false); setActions(st.actions as Record<string, string>);
    setCustom(st.customWords as { word: string; category: string; weight: number }[]); setAllow((st.allowWords as string[]).join(', '));
  }, [d]);
  if (!d) return <Loader2 size={16} className="animate-spin" style={{ color: K.t3 }} />;

  const save = async () => {
    const r = await call('/api/admin/content-filter', 'PUT', { enabled, actions, customWords: custom, allowWords: allow.split(',').map((x) => x.trim()).filter(Boolean) });
    if (r) { flash('Сохранено'); void load(); }
  };
  const test = async () => { const r = await call('/api/admin/content-filter/test', 'POST', { text: sample }); if (r) setRes(r); };
  const decide = async (id: string, ok: boolean) => {
    if (!ok && reason.trim().length < 5) return flash('Укажите причину отказа (не короче 5 знаков)');
    const r = await call(`/api/admin/content-filter/holds/${id}/${ok ? 'approve' : 'reject'}`, 'POST', { reason });
    if (r) { setReason(''); void loadHolds(); void load(); }
  };
  const stats = (d.stats ?? {}) as Record<string, number>;

  return (
    <div className="space-y-4">
      <Note>Фильтр читает текст по словарям и ловит типичные обходы: латинские двойники букв, цифры вместо букв, неверную раскладку, разделители между буквами, растянутые буквы, звёздочки. Это эвристика, а не понимание смысла: возможны и пропуски, и ложные срабатывания, поэтому спорное лучше отправлять на модерацию. Картинки и личные чаты не проверяются.</Note>
      <Box title="Настройки">
        <label className="flex items-center gap-2 text-xs" style={{ color: K.t1 }}><input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />Фильтры включены</label>
        {(d.categories as string[]).filter((c) => c !== 'custom').concat(['custom']).map((c) => (
          <div key={c} className="flex flex-wrap items-center gap-2">
            <span className="min-w-0 flex-1 text-xs" style={{ color: K.t1 }}>{CAT[c] ?? c} <span style={{ color: K.t3 }}>· за 7 дней: {stats[c] ?? 0}</span></span>
            <select className={inp} style={{ ...fieldSty, width: 220 }} value={actions[c] ?? (d.defaults as Record<string, string>)[c]} onChange={(e) => setActions({ ...actions, [c]: e.target.value })}>
              {(d.actions as string[]).map((a) => <option key={a} value={a}>{ACT[a]}</option>)}
            </select>
          </div>))}
        <Note>«Закрыть звёздочками» работает на отдельных словах; фразы и 18+ звёздочками не закрываются — для них нужна модерация или отказ. Удержанное скрыто от всех, пока модератор не решит.</Note>
      </Box>
      <Box title="Свои слова и исключения">
        <div className="flex flex-wrap gap-2">
          <input className={inp} style={{ ...fieldSty, flex: 1, minWidth: 160 }} value={nw} onChange={(e) => setNw(e.target.value)} placeholder="Слово или фраза (от 3 знаков)" />
          <select className={inp} style={{ ...fieldSty, width: 220 }} value={nc} onChange={(e) => setNc(e.target.value)}>{(d.categories as string[]).map((c) => <option key={c} value={c}>{CAT[c] ?? c}</option>)}</select>
          <Btn tone="plain" onClick={() => { if (nw.trim().length < 3) return; setCustom([...custom, { word: nw.trim(), category: nc, weight: 2 }]); setNw(''); }}>Добавить</Btn>
        </div>
        {custom.map((w, i) => (
          <div key={`${w.word}${i}`} className="flex items-center gap-2 rounded-xl p-2 text-xs" style={{ background: K.l2, color: K.t1 }}>
            <span className="min-w-0 flex-1" translate="no">{w.word}</span><span style={{ color: K.t3 }}>{CAT[w.category]}</span>
            <Btn tone="red" onClick={() => setCustom(custom.filter((_, j) => j !== i))}>Убрать</Btn>
          </div>))}
        <textarea className={inp} style={{ ...fieldSty, minHeight: 60 }} value={allow} onChange={(e) => setAllow(e.target.value)} placeholder="Слова, которые нельзя считать нарушением (через запятую)" />
        <Btn onClick={() => void save()}>Сохранить</Btn>
      </Box>
      <Box title="Проверить текст">
        <textarea className={inp} style={{ ...fieldSty, minHeight: 70 }} value={sample} onChange={(e) => setSample(e.target.value)} placeholder="Вставьте текст: покажем, как его прочитает фильтр" />
        <Btn tone="plain" onClick={() => void test()}>Проверить</Btn>
        {res && <div className="rounded-xl p-3 text-xs" style={{ background: K.l2, color: K.t1 }}>
          <p className="font-bold">{res.action === 'allow' ? 'Пропустит' : ACT[res.action as string] ?? res.action}</p>
          {(res.hits as D[]).map((h) => <p key={h.category} style={{ color: K.t3 }}>{CAT[h.category as string]} · вес {h.score} · {ACT[h.action as string]}</p>)}
          {res.action === 'mask' && <p translate="no">{res.masked as string}</p>}
        </div>}
      </Box>
      <Box title={`Очередь удержаний: ${(holds?.holds as D[] | undefined)?.length ?? 0}`}>
        <input className={inp} style={fieldSty} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Причина (обязательна при отказе, её увидит автор)" />
        {!(holds?.holds as D[] | undefined)?.length ? <Note>Пока ничего не удержано.</Note> : (holds!.holds as D[]).map((h) => (
          <div key={h.id as string} className="space-y-1 rounded-xl p-3" style={{ background: K.l2 }}>
            <p className="text-xs font-bold" style={{ color: K.t1 }}>{KIND[h.kind as string] ?? h.kind} · {(h.categories as string[]).map((c) => CAT[c] ?? c).join(', ')} · <span translate="no">{(h.author as D).name as string}</span></p>
            <p className="whitespace-pre-wrap text-xs" style={{ color: K.t2 }} translate="no">{h.excerpt as string}</p>
            <div className="flex gap-2"><Btn onClick={() => void decide(h.id as string, true)}>Одобрить</Btn><Btn tone="red" onClick={() => void decide(h.id as string, false)}>Отклонить</Btn></div>
          </div>))}
      </Box>
    </div>
  );
};
