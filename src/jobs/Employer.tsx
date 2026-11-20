/** Sky Работа → «Работодателю»: компания и проверка, вакансии (черновик → проверка → публикация), отклики и этапы найма, поиск резюме и приглашения. */
import { useCallback, useEffect, useState } from 'react';
import { Loader2, BadgeCheck } from 'lucide-react';
import { flash } from '@/shared/flash';
import { Btn, In, card, field, dt } from '@/kassabiz/ui';
import { jobs, jobErr, salaryText, type App, type Company, type JobsConfig, type Resume, type Vac } from './jobsApi';
import { Head, Thread } from './Thread';
import { Sel } from './JobsModule';

const Box = ({ title, children }: { title: string; children: React.ReactNode }) => <div className="space-y-2 rounded-2xl p-4" style={card}><p className="text-sm font-black" style={{ color: 'var(--t1)' }}>{title}</p>{children}</div>;
const ST: Record<string, string> = { draft: 'Черновик', pending: 'На проверке', published: 'Опубликована', rejected: 'Отклонена', closed: 'Закрыта', blocked: 'Заблокирована' };

const CompanyBox = ({ co, reload }: { co: Company | null; reload: () => void }) => {
  const [f, setF] = useState({ name: co?.name ?? '', about: co?.about ?? '', city: co?.city ?? '', site: co?.site ?? '' }); const [inn, setInn] = useState(''); const [claim, setClaim] = useState(''); const [ver, setVer] = useState(false);
  const save = () => void jobs.saveCompany(f).then((r) => { flash(r.ok ? 'Сохранено' : jobErr(r)); if (r.ok) reload(); });
  return (
    <Box title={co ? 'Компания' : 'Создайте компанию работодателя'}>
      <In label="Название" value={f.name} onChange={(v) => setF({ ...f, name: v })} max={80} /><In label="Город" value={f.city} onChange={(v) => setF({ ...f, city: v })} max={80} /><In label="Сайт (https)" value={f.site} onChange={(v) => setF({ ...f, site: v })} max={300} />
      <label className="block text-[11px]" style={{ color: 'var(--t3)' }}>О компании<textarea value={f.about} maxLength={1500} rows={3} onChange={(e) => setF({ ...f, about: e.target.value })} className="mt-0.5 block w-full rounded-lg px-3 py-2 text-sm" style={field} /></label>
      <Btn tone="accent" onClick={save}>{co ? 'Сохранить' : 'Создать компанию'}</Btn>
      {co && <div className="rounded-xl p-3 text-sm" style={{ background: 'var(--bg-l2)', color: 'var(--t1)' }}>
        <p className="flex items-center gap-1 font-bold">{co.verified && <BadgeCheck size={15} style={{ color: 'var(--accent)' }} />} {co.verifyLabel}</p>
        {co.verifyReason && <p className="text-xs" style={{ color: 'var(--red)' }}>{co.verifyReason}</p>}{co.status === 'blocked' && <p className="text-xs" style={{ color: 'var(--red)' }}>Компания заблокирована: {co.blockReason}</p>}
        {(co.verifyStatus === 'none' || co.verifyStatus === 'rejected') && (ver ? <div className="mt-2 space-y-2"><In label="ИНН (10 или 12 цифр)" value={inn} onChange={(v) => setInn(v.replace(/\D/g, ''))} max={12} /><In label="Чем подтвердить (сайт, договор, ссылка на реестр)" value={claim} onChange={setClaim} max={600} />
          <Btn tone="accent" onClick={() => void jobs.verify(inn, claim).then((r) => { flash(r.ok ? 'Заявка отправлена' : jobErr(r)); if (r.ok) { setVer(false); reload(); } })}>Отправить на проверку</Btn></div> : <div className="mt-2"><Btn small onClick={() => setVer(true)}>Пройти проверку</Btn></div>)}
        <p className="mt-2 text-[11px]" style={{ color: 'var(--t3)' }}>Проверка ручная: сотрудник Sky смотрит ваши данные. Автоматической сверки с реестром ФНС нет. Проверенные работодатели могут искать резюме.</p></div>}
    </Box>
  );
};

const VacancyForm = ({ v, cfg, onDone }: { v: Vac | null; cfg: JobsConfig; onDone: () => void }) => {
  const [f, setF] = useState({ title: v?.title ?? '', categoryId: v?.categoryId ?? '', city: v?.city ?? '', remote: v?.remote ?? false, salaryFrom: v?.salaryFrom != null ? String(v.salaryFrom) : '', salaryTo: v?.salaryTo != null ? String(v.salaryTo) : '',
    schedule: v?.schedule ?? 'full_day', employment: v?.employment ?? 'full', experience: v?.experience ?? 'none', description: v?.description ?? '', requirements: v?.requirements ?? '', conditions: v?.conditions ?? '' });
  const s = (k: string) => (x: string) => setF((o) => ({ ...o, [k]: x }));
  const ta = (k: 'description' | 'requirements' | 'conditions', label: string, rows: number) => <label className="block text-[11px]" style={{ color: 'var(--t3)' }}>{label}<textarea value={f[k]} rows={rows} maxLength={5000} onChange={(e) => s(k)(e.target.value)} className="mt-0.5 block w-full rounded-lg px-3 py-2 text-sm" style={field} /></label>;
  const save = async () => {
    const r = await jobs.saveVacancy(v?.id ?? null, { ...f, salaryFrom: f.salaryFrom ? Number(f.salaryFrom) : '', salaryTo: f.salaryTo ? Number(f.salaryTo) : '' });
    if (!r.ok) return flash(jobErr(r)); flash(r.data?.returnedToDraft ? 'Сохранено. Вакансия вернулась в черновик — отправьте на проверку снова.' : 'Сохранено'); onDone();
  };
  return (
    <div className="space-y-2">
      <In label="Название вакансии" value={f.title} onChange={s('title')} max={100} /><Sel label="Направление" value={f.categoryId} onChange={s('categoryId')} opts={cfg.categories.map((c): [string, string] => [c.id, c.name])} all="Выберите" />
      <div className="grid grid-cols-2 gap-2"><In label="Город" value={f.city} onChange={s('city')} max={80} /><label className="flex items-end gap-2 pb-2 text-sm" style={{ color: 'var(--t1)' }}><input type="checkbox" checked={f.remote} onChange={(e) => setF({ ...f, remote: e.target.checked })} /> Удалённо</label>
        <In label="Зарплата от, ₽" value={f.salaryFrom} onChange={(x) => s('salaryFrom')(x.replace(/\D/g, ''))} max={9} /><In label="Зарплата до, ₽" value={f.salaryTo} onChange={(x) => s('salaryTo')(x.replace(/\D/g, ''))} max={9} />
        <Sel label="График" value={f.schedule} onChange={s('schedule')} opts={Object.entries(cfg.schedule)} all="—" /><Sel label="Занятость" value={f.employment} onChange={s('employment')} opts={Object.entries(cfg.employment)} all="—" /><Sel label="Опыт" value={f.experience} onChange={s('experience')} opts={Object.entries(cfg.experience)} all="—" /></div>
      {ta('description', 'Описание (не короче 50 знаков)', 5)}{ta('requirements', 'Требования', 3)}{ta('conditions', 'Условия', 3)}
      <p className="text-[11px]" style={{ color: 'var(--t3)' }}>Нельзя: просить деньги у соискателя, указывать телефоны, ссылки и мессенджеры (общение идёт внутри Sky). Вакансия публикуется после проверки модератором.</p>
      <div className="flex gap-2"><Btn tone="accent" onClick={() => void save()}>Сохранить</Btn><Btn onClick={onDone}>Отмена</Btn></div>
    </div>
  );
};

const Applicants = ({ v, onBack }: { v: Vac; onBack: () => void }) => {
  const [list, setList] = useState<App[] | null>(null); const [open, setOpen] = useState<string | null>(null);
  const load = useCallback(() => { void jobs.vacancyApps(v.id).then((r) => r.ok && setList(r.data!.applications)); }, [v.id]); useEffect(load, [load]);
  if (open) return <Thread id={open} onBack={() => { setOpen(null); load(); }} />;
  return (
    <div className="space-y-2"><Head title={`Отклики: ${v.title}`} onBack={onBack} />
      {!list ? <Loader2 className="animate-spin" size={16} /> : list.length === 0 ? <p className="text-sm" style={{ color: 'var(--t3)' }}>Откликов пока нет.</p> : list.map((a) => (
        <button key={a.id} type="button" onClick={() => setOpen(a.id)} className="block w-full rounded-2xl p-3 text-left" style={card}>
          <div className="flex justify-between"><b style={{ color: 'var(--t1)' }} translate="no">{a.name}{a.position ? ` · ${a.position}` : ''}</b><span className="text-sm font-bold" style={{ color: 'var(--accent)' }}>{a.statusLabel}</span></div>
          <p className="text-xs" style={{ color: 'var(--t3)' }}>{dt(a.updatedAt)}{a.initiator === 'employer' ? ' · вы пригласили' : ''}{(a.unread ?? 0) > 0 ? ` · новых сообщений: ${a.unread}` : ''}</p></button>))}</div>
  );
};

const Vacancies = ({ cfg }: { cfg: JobsConfig }) => {
  const [list, setList] = useState<Vac[] | null>(null); const [edit, setEdit] = useState<Vac | 'new' | null>(null); const [apps, setApps] = useState<Vac | null>(null);
  const load = useCallback(() => { void jobs.myVacancies().then((r) => r.ok && setList(r.data!.vacancies)); }, []); useEffect(load, [load]);
  const act = (v: Vac, a: 'submit' | 'close' | 'promote') => void jobs.vacancyAction(v.id, a).then((r) => {
    if (!r.ok) return flash(jobErr(r));
    flash(a === 'submit' ? (r.data?.paidRub ? `Отправлено на проверку. Списано ${r.data.paidRub} ₽` : 'Отправлено на проверку') : a === 'promote' ? 'Вакансия продвигается 7 дней' : 'Вакансия закрыта'); load();
  });
  if (apps) return <Applicants v={apps} onBack={() => { setApps(null); load(); }} />;
  if (edit) return <Box title={edit === 'new' ? 'Новая вакансия' : 'Редактирование'}><VacancyForm v={edit === 'new' ? null : edit} cfg={cfg} onDone={() => { setEdit(null); load(); }} /></Box>;
  const s = cfg.settings;
  return (
    <div className="space-y-2">
      <Btn tone="accent" onClick={() => setEdit('new')}>Новая вакансия</Btn>
      <p className="text-[11px]" style={{ color: 'var(--t3)' }}>Бесплатно открытых вакансий: {s.freeVacancies}{s.vacancyPriceRub > 0 ? `; каждая следующая — ${s.vacancyPriceRub} ₽ с кошелька Sky` : ''}. Срок публикации — {s.vacancyDays} дн.{s.promoPriceRub > 0 ? ` Продвижение на 7 дней — ${s.promoPriceRub} ₽.` : ''}</p>
      {!list ? <Loader2 className="animate-spin" size={16} /> : list.length === 0 ? <p className="text-sm" style={{ color: 'var(--t3)' }}>Вакансий пока нет.</p> : list.map((v) => (
        <div key={v.id} className="rounded-2xl p-3" style={card}>
          <div className="flex justify-between gap-2"><b style={{ color: 'var(--t1)' }} translate="no">{v.title}</b><span className="text-xs font-bold" style={{ color: v.status === 'published' ? 'var(--accent)' : v.status === 'rejected' || v.status === 'blocked' ? 'var(--red)' : 'var(--t3)' }}>{ST[v.status]}</span></div>
          <p className="text-xs" style={{ color: 'var(--t3)' }}>{salaryText(v)} · откликов {v.apps ?? 0}{(v.appsNew ?? 0) > 0 ? ` (новых ${v.appsNew})` : ''} · просмотров {v.views ?? 0}{v.promoted ? ' · продвигается' : ''}</p>
          {v.rejectReason && <p className="text-xs" style={{ color: 'var(--red)' }}>Причина: {v.rejectReason}</p>}
          {(v.flags ?? []).length > 0 && v.status !== 'published' && <p className="text-xs" style={{ color: 'var(--t3)' }}>Есть пометки автопроверки — модератор посмотрит внимательнее.</p>}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {['draft', 'rejected', 'published', 'pending'].includes(v.status) && <Btn small onClick={() => setEdit(v)}>Изменить</Btn>}
            {['draft', 'rejected'].includes(v.status) && <Btn small tone="accent" onClick={() => act(v, 'submit')}>На проверку</Btn>}
            {v.status === 'published' && s.promoPriceRub > 0 && <Btn small onClick={() => act(v, 'promote')}>Продвинуть</Btn>}
            {(v.apps ?? 0) > 0 && <Btn small onClick={() => setApps(v)}>Отклики</Btn>}
            {['draft', 'pending', 'published', 'rejected'].includes(v.status) && <Btn small tone="danger" onClick={() => window.confirm('Закрыть вакансию?') && act(v, 'close')}>Закрыть</Btn>}
          </div></div>))}
    </div>
  );
};

const Resumes = ({ cfg }: { cfg: JobsConfig }) => {
  const [q, setQ] = useState({ q: '', category: '', city: '' }); const [list, setList] = useState<Resume[] | null>(null); const [err, setErr] = useState(''); const [open, setOpen] = useState<Resume | null>(null); const [vacs, setVacs] = useState<Vac[]>([]); const [vid, setVid] = useState(''); const [txt, setTxt] = useState('');
  useEffect(() => { void jobs.myVacancies().then((r) => r.ok && setVacs(r.data!.vacancies.filter((v) => v.status === 'published'))); }, []);
  const run = useCallback(async () => { const r = await jobs.searchResumes(q); if (!r.ok) { setErr(jobErr(r)); setList([]); return; } setErr(''); setList(r.data!.resumes); }, [q]);
  useEffect(() => { const t = setTimeout(() => void run(), 300); return () => clearTimeout(t); }, [run]);
  if (open) return (
    <div className="space-y-2"><Head title={open.position} onBack={() => setOpen(null)} />
      <Box title={open.name ?? 'Кандидат'}><p className="text-sm" style={{ color: 'var(--t2)' }} translate="no">{open.city} · опыт {open.experienceYears} л.{open.desiredSalary ? ` · ${open.desiredSalary.toLocaleString('ru-RU')} ₽` : ''}</p>
        {open.skills.length > 0 && <p className="text-sm" style={{ color: 'var(--t1)' }} translate="no">{open.skills.join(', ')}</p>}{open.about && <p className="whitespace-pre-wrap text-sm" style={{ color: 'var(--t1)' }} translate="no">{open.about}</p>}
        {(open.experience ?? []).map((x, i) => <p key={i} className="text-sm" style={{ color: 'var(--t1)' }} translate="no"><b>{x.role}</b>, {x.company} ({x.from}–{x.to})</p>)}
        <p className="text-[11px]" style={{ color: 'var(--t3)' }}>Контакты скрыты. Кандидат видит, что вы открыли его резюме.</p></Box>
      <Box title="Пригласить на вакансию">{vacs.length === 0 ? <p className="text-xs" style={{ color: 'var(--t3)' }}>Нужна опубликованная вакансия.</p> : <><Sel label="Вакансия" value={vid} onChange={setVid} opts={vacs.map((v): [string, string] => [v.id, v.title])} all="Выберите" /><In label="Сообщение (без контактов)" value={txt} onChange={setTxt} max={500} />
        <Btn tone="accent" disabled={!vid} onClick={() => void jobs.invite(open.id, vid, txt).then((r) => flash(r.ok ? 'Приглашение отправлено' : jobErr(r)))}>Пригласить</Btn></>}</Box></div>);
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 gap-2"><In label="Должность или навык" value={q.q} onChange={(v) => setQ({ ...q, q: v })} max={60} /><Sel label="Направление" value={q.category} onChange={(v) => setQ({ ...q, category: v })} opts={cfg.categories.map((c): [string, string] => [c.id, c.name])} /><In label="Город" value={q.city} onChange={(v) => setQ({ ...q, city: v })} max={60} /></div>
      {err && <p className="rounded-xl p-3 text-sm" style={{ background: 'var(--bg-l2)', color: 'var(--t1)' }}>{err}</p>}
      {list?.map((r) => <button key={r.id} type="button" onClick={() => void jobs.openResume(r.id).then((x) => (x.ok ? setOpen(x.data!.resume) : flash(jobErr(x))))} className="block w-full rounded-2xl p-3 text-left" style={card}>
        <b style={{ color: 'var(--t1)' }} translate="no">{r.position}</b><p className="text-xs" style={{ color: 'var(--t3)' }} translate="no">{r.name} · {r.city} · опыт {r.experienceYears} л.{r.desiredSalary ? ` · ${r.desiredSalary.toLocaleString('ru-RU')} ₽` : ''}</p></button>)}
      {list && list.length === 0 && !err && <p className="text-sm" style={{ color: 'var(--t3)' }}>Подходящих открытых резюме нет. Кандидаты сами решают, показывать ли резюме в поиске.</p>}
    </div>
  );
};

export const Employer = ({ cfg }: { cfg: JobsConfig }) => {
  const [co, setCo] = useState<Company | null | undefined>(undefined); const [sub, setSub] = useState<'vac' | 'res' | 'co'>('vac');
  const load = useCallback(() => { void jobs.company().then((r) => r.ok && setCo(r.data!.company)); }, []); useEffect(load, [load]);
  if (co === undefined) return <div className="grid place-items-center py-10"><Loader2 className="animate-spin" size={18} /></div>;
  if (!co) return <CompanyBox co={null} reload={load} />;
  return (
    <div className="space-y-3">
      <div className="flex gap-1.5">{([['vac', 'Вакансии'], ['res', 'Поиск резюме'], ['co', 'Компания']] as const).map(([k, n]) => <button key={k} type="button" aria-pressed={sub === k} onClick={() => setSub(k)} className="rounded-full px-3 py-1.5 text-xs font-semibold" style={sub === k ? { background: 'var(--accent)', color: '#fff' } : { background: 'var(--bg-l2)', color: 'var(--t2)' }}>{n}</button>)}</div>
      {sub === 'vac' ? <Vacancies cfg={cfg} /> : sub === 'res' ? <Resumes cfg={cfg} /> : <CompanyBox co={co} reload={load} />}
    </div>
  );
};
