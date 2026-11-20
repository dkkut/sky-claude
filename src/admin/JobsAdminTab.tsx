/** Админка → «Работа» (право `jobs`; тарифы — `jobs_tariffs`): модерация вакансий, проверка работодателей, жалобы, блокировки, статистика, тарифы и продвижение. */
import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { flash } from '@/shared/flash';
import { Box, Btn, Note, K, fieldSty, inp, call, useLoad, type D } from './kit';

const TABS = [['stats', 'Статистика'], ['vac', 'Вакансии'], ['co', 'Работодатели'], ['rep', 'Жалобы'], ['block', 'Блокировки'], ['tariff', 'Тарифы']] as const;
const FLAG: Record<string, string> = { too_good_to_be_true: 'Слишком хорошо, чтобы быть правдой', salary_extreme: 'Огромная зарплата', salary_wide: 'Слишком широкая вилка', unverified_employer: 'Работодатель не проверен', content_filter: 'Фильтр контента' };
const Reason = ({ v, set }: { v: string; set: (s: string) => void }) => <input className={inp} style={fieldSty} value={v} onChange={(e) => set(e.target.value)} placeholder="Причина или заметка (для отказа и блокировки — от 5 знаков)" />;

const Stats = () => {
  const [d] = useLoad<D>('/api/admin/jobs/overview'); if (!d) return <Loader2 size={16} className="animate-spin" />;
  const row = (o: D) => Object.entries(o).map(([k, n]) => `${k}: ${n}`).join(' · ') || '—';
  return (
    <div className="space-y-3">
      <Box title="Вакансии (по статусам)"><p className="text-sm" style={{ color: K.t1 }}>{row(d.vacancies)}</p></Box>
      <Box title="Отклики за 30 дней"><p className="text-sm" style={{ color: K.t1 }}>{row(d.applications30d)}</p></Box>
      <Box title="Работодатели"><p className="text-sm" style={{ color: K.t1 }}>Всего {d.companies.total} · проверено {d.companies.verified} · ждут проверки {d.companies.pending} · заблокировано {d.companies.blocked}</p></Box>
      <Box title="Резюме"><p className="text-sm" style={{ color: K.t1 }}>Всего {d.resumes.total} · видны в поиске {d.resumes.public} · заблокировано {d.resumes.blocked}</p><Note>Содержимое резюме здесь не показывается: модератор открывает его только по жалобе.</Note></Box>
      <Box title="Прочее"><p className="text-sm" style={{ color: K.t1 }}>Открытых жалоб: {d.openReports} · получено за платные вакансии: {d.paidVacanciesRub} ₽</p></Box>
    </div>
  );
};

const Vacancies = () => {
  const [st, setSt] = useState('pending'); const [why, setWhy] = useState(''); const [d, load] = useLoad<D>(`/api/admin/jobs/vacancies?status=${st}`);
  const act = async (id: string, a: string) => { if (['reject', 'block', 'close'].includes(a) && why.trim().length < 5) return flash('Укажите причину (не короче 5 знаков)'); if (await call(`/api/admin/jobs/vacancies/${id}/${a}`, 'POST', { reason: why })) { setWhy(''); void load(); } };
  return (
    <div className="space-y-3">
      <select className={inp} style={fieldSty} value={st} onChange={(e) => setSt(e.target.value)}>{[['pending', 'На проверке'], ['published', 'Опубликованные'], ['rejected', 'Отклонённые'], ['blocked', 'Заблокированные'], ['closed', 'Закрытые']].map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select>
      <Reason v={why} set={setWhy} />
      {!d ? <Loader2 size={16} className="animate-spin" /> : !(d.vacancies as D[]).length ? <Note>Пусто.</Note> : (d.vacancies as D[]).map((v) => (
        <Box key={v.id} title={`${v.title} — ${v.company}${v.verified ? ' ✓' : ' (не проверена)'}`}>
          <p className="text-xs" style={{ color: K.t3 }} translate="no">{v.city}{v.remote ? ' · удалённо' : ''} · {v.salaryFrom ?? '—'}–{v.salaryTo ?? '—'} ₽{v.paidRub ? ` · оплачено ${v.paidRub} ₽` : ''}</p>
          {v.flags.length > 0 && <p className="text-xs font-bold" style={{ color: K.red }}>Пометки: {v.flags.map((f: string) => FLAG[f] ?? f).join('; ')}</p>}
          <p className="whitespace-pre-wrap text-sm" style={{ color: K.t1 }} translate="no">{v.description}</p>{v.requirements && <p className="whitespace-pre-wrap text-xs" style={{ color: K.t2 }} translate="no">{v.requirements}</p>}{v.conditions && <p className="whitespace-pre-wrap text-xs" style={{ color: K.t2 }} translate="no">{v.conditions}</p>}
          {v.rejectReason && <p className="text-xs" style={{ color: K.red }}>Причина: {v.rejectReason}</p>}
          <div className="flex flex-wrap gap-2">
            {v.status === 'pending' && <><Btn onClick={() => void act(v.id, 'approve')}>Одобрить</Btn><Btn tone="red" onClick={() => void act(v.id, 'reject')}>Отклонить</Btn></>}
            {['pending', 'published', 'rejected'].includes(v.status) && <Btn tone="red" onClick={() => void act(v.id, 'block')}>Заблокировать</Btn>}
            {v.status === 'published' && <Btn tone="plain" onClick={() => void act(v.id, 'close')}>Снять с публикации</Btn>}
            {v.status === 'blocked' && <Btn tone="plain" onClick={() => void act(v.id, 'unblock')}>Разблокировать</Btn>}
          </div></Box>))}
    </div>
  );
};

const Companies = () => {
  const [st, setSt] = useState('pending'); const [why, setWhy] = useState(''); const [d, load] = useLoad<D>(`/api/admin/jobs/companies?verify=${st}`);
  const act = async (id: string, a: string) => { if (['reject', 'block'].includes(a) && why.trim().length < 5) return flash('Укажите причину'); if (await call(`/api/admin/jobs/companies/${id}/${a}`, 'POST', { reason: why })) { setWhy(''); void load(); } };
  return (
    <div className="space-y-3">
      <Note>Проверка ручная: сверка с реестрами ФНС не подключена. ИНН и пояснение видны только сотрудникам с правом «Работа».</Note>
      <select className={inp} style={fieldSty} value={st} onChange={(e) => setSt(e.target.value)}>{[['pending', 'Ждут проверки'], ['verified', 'Проверенные'], ['rejected', 'Отклонённые'], ['none', 'Без проверки']].map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select>
      <Reason v={why} set={setWhy} />
      {!d ? <Loader2 size={16} className="animate-spin" /> : !(d.companies as D[]).length ? <Note>Пусто.</Note> : (d.companies as D[]).map((c) => (
        <Box key={c.id} title={`${c.name}${c.status === 'blocked' ? ' — заблокирована' : ''}`}>
          <p className="text-xs" style={{ color: K.t3 }} translate="no">{c.city} · {c.site || 'сайта нет'} · живых вакансий {c.live}</p>
          {c.inn && <p className="text-sm" style={{ color: K.t1 }} translate="no">ИНН {c.inn}: {c.claim}</p>}
          <div className="flex flex-wrap gap-2">
            {c.verifyStatus !== 'verified' && <Btn onClick={() => void act(c.id, 'approve')}>Подтвердить</Btn>}{c.verifyStatus === 'pending' && <Btn tone="red" onClick={() => void act(c.id, 'reject')}>Отклонить проверку</Btn>}
            {c.status === 'active' ? <Btn tone="red" onClick={() => void act(c.id, 'block')}>Заблокировать (снимет вакансии)</Btn> : <Btn tone="plain" onClick={() => void act(c.id, 'unblock')}>Разблокировать</Btn>}
          </div></Box>))}
    </div>
  );
};

const Reports = () => {
  const [why, setWhy] = useState(''); const [d, load] = useLoad<D>('/api/admin/jobs/reports'); const [t, setT] = useState<D | null>(null);
  const done = async (id: string, a: string, block: boolean) => { if (a === 'resolve' && why.trim().length < 5) return flash('Опишите решение (не короче 5 знаков)'); if (await call(`/api/admin/jobs/reports/${id}/${a}`, 'POST', { note: why, block })) { setWhy(''); setT(null); void load(); } };
  return (
    <div className="space-y-3"><Reason v={why} set={setWhy} />
      {!d ? <Loader2 size={16} className="animate-spin" /> : !(d.reports as D[]).length ? <Note>Открытых жалоб нет.</Note> : (d.reports as D[]).map((r) => (
        <Box key={r.id} title={`${r.type === 'vacancy' ? 'Вакансия' : r.type === 'company' ? 'Компания' : 'Резюме'}: ${r.reasonLabel}`}>
          {r.text && <p className="text-sm" style={{ color: K.t1 }} translate="no">{r.text}</p>}
          <div className="flex flex-wrap gap-2"><Btn tone="plain" onClick={async () => { const x = await call(`/api/admin/jobs/reports/${r.id}`); if (x) setT(x.target ? { ...x, id: r.id } : { id: r.id }); }}>Посмотреть объект</Btn>
            <Btn onClick={() => void done(r.id, 'resolve', false)}>Нарушение подтверждено</Btn><Btn tone="red" onClick={() => void done(r.id, 'resolve', true)}>Подтверждено + заблокировать</Btn><Btn tone="plain" onClick={() => void done(r.id, 'dismiss', false)}>Нарушений нет</Btn></div>
          {t?.id === r.id && t!.target && <pre className="max-h-60 overflow-auto whitespace-pre-wrap rounded-xl p-2 text-xs" style={{ background: K.l2, color: K.t1 }} translate="no">{JSON.stringify(t!.target, null, 1)}</pre>}
        </Box>))}
      <Note>Резюме открывается только по жалобе, каждое открытие записывается в журнал.</Note>
    </div>
  );
};

const Blocks = () => {
  const [d, load] = useLoad<D>('/api/admin/jobs/blocks'); const [pid, setPid] = useState(''); const [why, setWhy] = useState('');
  return (
    <div className="space-y-3">
      <Box title="Ограничить доступ к «Работе»"><input className={inp} style={fieldSty} value={pid} onChange={(e) => setPid(e.target.value)} placeholder="ID профиля (acc-…)" /><Reason v={why} set={setWhy} />
        <Btn tone="red" disabled={!pid} onClick={async () => { if (why.trim().length < 5) return flash('Укажите причину'); if (await call('/api/admin/jobs/blocks', 'POST', { profileId: pid.trim(), on: true, reason: why })) { setPid(''); setWhy(''); void load(); } }}>Заблокировать</Btn>
        <Note>Блокировка закрывает отклики, резюме и вакансии человека; открытые вакансии его компании снимаются.</Note></Box>
      {(d?.blocks as D[] | undefined)?.map((b) => <Box key={b.profileId} title={`${b.name} (@${b.username})`}><p className="text-xs" style={{ color: K.t2 }}>{b.reason}</p><Btn tone="plain" onClick={async () => { if (await call('/api/admin/jobs/blocks', 'POST', { profileId: b.profileId, on: false })) void load(); }}>Снять блокировку</Btn></Box>)}
    </div>
  );
};

const Tariffs = () => {
  const [d, load] = useLoad<D>('/api/admin/jobs/overview'); const [f, setF] = useState<D | null>(null);
  if (!d) return <Loader2 size={16} className="animate-spin" />;
  const s = f ?? d.settings; const set = (k: string, v: unknown) => setF({ ...s, [k]: v });
  const num = (k: string, label: string) => <label className="block text-[11px]" style={{ color: K.t3 }}>{label}<input className={inp} style={fieldSty} inputMode="numeric" value={String(s[k])} onChange={(e) => set(k, e.target.value.replace(/\D/g, ''))} /></label>;
  return (
    <Box title="Тарифы и продвижение">
      {!d.canTariffs && <Note>Менять тарифы может сотрудник с правом «Работа: тарифы». Ниже — текущие значения.</Note>}
      {num('freeVacancies', 'Бесплатно открытых вакансий у компании')}{num('vacancyPriceRub', 'Цена каждой следующей вакансии, ₽ (0 — платных нет, лимит жёсткий)')}{num('promoPriceRub', 'Продвижение на 7 дней, ₽ (0 — продвижение выключено)')}{num('vacancyDays', 'Срок публикации, дней (7–90)')}
      <label className="flex items-center gap-2 text-sm" style={{ color: K.t1 }}><input type="checkbox" checked={s.resumesNeedVerified} onChange={(e) => set('resumesNeedVerified', e.target.checked)} /> Искать резюме могут только проверенные работодатели</label>
      <Btn disabled={!d.canTariffs} onClick={async () => { if (await call('/api/admin/jobs/settings', 'PUT', s)) { flash('Сохранено'); setF(null); void load(); } }}>Сохранить</Btn>
      <Note>Платит работодатель с кошелька Sky; отклонённая модерацией платная вакансия возвращает деньги. Продвижение не возвращается.</Note>
    </Box>
  );
};

export const JobsAdminTab = () => {
  const [tab, setTab] = useState<(typeof TABS)[number][0]>('vac');
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">{TABS.map(([k, n]) => <button key={k} type="button" aria-pressed={tab === k} onClick={() => setTab(k)} className="rounded-full px-3 py-1.5 text-xs font-semibold" style={tab === k ? { background: K.acc, color: '#fff' } : { background: K.l2, color: K.t2 }}>{n}</button>)}</div>
      {tab === 'stats' ? <Stats /> : tab === 'vac' ? <Vacancies /> : tab === 'co' ? <Companies /> : tab === 'rep' ? <Reports /> : tab === 'block' ? <Blocks /> : <Tariffs />}
    </div>
  );
};
