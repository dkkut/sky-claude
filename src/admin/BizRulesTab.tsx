/** Админка → «Правила Business» (право `business_rules`): разделы правил, черновик → публикация новой редакции, история, кто ознакомился. Организациям при публикации уходит уведомление. */
import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { flash } from '@/shared/flash';
import { Box, Btn, Note, K, fieldSty, inp, call, useLoad, type D } from './kit';

export const BizRulesTab = () => {
  const [d, load] = useLoad<D>('/api/admin/business-rules');
  const [sec, setSec] = useState('general'); const [form, setForm] = useState<D | null>(null); const [hist, setHist] = useState<D | null>(null); const [acks, setAcks] = useState<D | null>(null); const [notify, setNotify] = useState(true);
  if (!d) return <Loader2 size={16} className="animate-spin" style={{ color: K.t3 }} />;
  const s = (d.sections as D[]).find((x) => x.section === sec)!;
  const f = form ?? { title: s.draft?.title ?? s.published?.title ?? s.label, body: s.draft?.body ?? s.published?.body ?? '', changeNote: s.draft?.changeNote ?? '' };
  const pick = (k: string) => { setSec(k); setForm(null); setHist(null); setAcks(null); };
  return (
    <div className="space-y-4">
      <Note>Организаций в системе: {d.organizations}. Опубликованная редакция одна, прежняя уходит в архив. Начальный текст — шаблон Sky (продуктовая политика, не юридическое заключение): он остаётся черновиком и людям не виден, пока вы его не опубликуете.</Note>
      <div className="flex flex-wrap gap-2">{(d.sections as D[]).map((x) => <Btn key={x.section} tone={sec === x.section ? 'acc' : 'plain'} onClick={() => pick(x.section)}>{x.label}{x.published ? ` · v${x.published.version}` : ' · не опубликовано'}</Btn>)}</div>
      <Box title={`${s.label}${s.published ? ` — действует v${s.published.version}, ознакомились: ${s.acknowledged}` : ' — не опубликовано'}`}>
        <input className={inp} style={fieldSty} value={f.title} placeholder="Заголовок" onChange={(e) => setForm({ ...f, title: e.target.value })} />
        <textarea className={inp} style={fieldSty} rows={14} value={f.body} onChange={(e) => setForm({ ...f, body: e.target.value })} />
        <input className={inp} style={fieldSty} value={f.changeNote} placeholder="Что изменилось (обязательно для новой редакции)" onChange={(e) => setForm({ ...f, changeNote: e.target.value })} />
        <label className="flex items-center gap-2 text-xs" style={{ color: K.t1 }}><input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />Уведомить организации при публикации</label>
        <div className="flex flex-wrap gap-2">
          <Btn tone="plain" onClick={async () => { if (await call(`/api/admin/business-rules/${sec}`, 'PUT', f)) { flash('Черновик сохранён'); setForm(null); void load(); } }}>Сохранить черновик</Btn>
          <Btn disabled={!s.draft && !form} onClick={async () => { if (form && !(await call(`/api/admin/business-rules/${sec}`, 'PUT', f))) return; const r = await call<D>(`/api/admin/business-rules/${sec}/publish`, 'POST', { notify }); if (r) { flash(`Опубликована v${r.version}, уведомлений: ${r.notified}`); setForm(null); void load(); } }}>Опубликовать редакцию</Btn>
          <Btn tone="plain" onClick={async () => setHist(await call(`/api/admin/business-rules/${sec}/history`))}>История</Btn>
          <Btn tone="plain" onClick={async () => setAcks(await call(`/api/admin/business-rules/${sec}/acks`))}>Кто ознакомился</Btn>
        </div>
      </Box>
      {hist && <Box title="История редакций">{(hist.items as D[]).map((h) => <p key={h.id} className="text-xs" style={{ color: K.t1 }}>v{h.version} · {({ draft: 'черновик', published: 'действует', archived: 'архив' } as D)[h.status]} · {h.publishedAt ? new Date(h.publishedAt).toLocaleString('ru') : new Date(h.createdAt).toLocaleString('ru')}{h.publishedBy ? ` · ${h.publishedBy}` : ''}{h.changeNote ? ` — ${h.changeNote}` : ''}{h.notified ? ` · уведомлено ${h.notified}` : ''}</p>)}</Box>}
      {acks && <Box title={acks.version ? `Ознакомление с v${acks.version}: ${(acks.acknowledged as D[]).length} из ${acks.organizations}, ждут ${acks.pending}` : 'Раздел не опубликован'}>{(acks.acknowledged as D[]).map((a) => <p key={a.profileId} className="text-xs" style={{ color: K.t1 }}><span translate="no">{a.name} {a.username}</span> · {new Date(a.at).toLocaleString('ru')}</p>)}</Box>}
    </div>
  );
};
