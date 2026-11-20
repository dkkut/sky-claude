/** Sky Работа — самостоятельная вкладка главной навигации: поиск вакансий, отклики, избранное, резюме, кабинет работодателя. */
import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Loader2, Search, Heart, MapPin, BadgeCheck, Flag } from 'lucide-react';
import { ModuleGate } from '@/core/moduleClosures';
import { flash } from '@/shared/flash';
import { Btn, In, card, field, dt } from '@/kassabiz/ui';
import { jobs, jobErr, salaryText, type App, type JobsConfig, type Resume, type Vac } from './jobsApi';
import { Head, Thread } from './Thread';
import { ResumeEditor } from './ResumeEditor';
import { Employer } from './Employer';

const TABS = [['search', 'Вакансии'], ['apps', 'Отклики'], ['fav', 'Избранное'], ['resume', 'Резюме'], ['emp', 'Работодателю']] as const;
type Tab = (typeof TABS)[number][0];
export const Sel = ({ label, value, onChange, opts, all = 'Любой' }: { label: string; value: string; onChange: (v: string) => void; opts: [string, string][]; all?: string }) => (
  <label className="block text-[11px]" style={{ color: 'var(--t3)' }}>{label}<select value={value} onChange={(e) => onChange(e.target.value)} className="mt-0.5 block w-full rounded-lg px-2 py-2 text-sm" style={field}><option value="">{all}</option>{opts.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select></label>
);
export const useConfig = () => { const [c, setC] = useState<JobsConfig | null>(null); useEffect(() => { void jobs.config().then((r) => r.ok && setC(r.data!)); }, []); return c; };
const toOpts = (o: Record<string, string>): [string, string][] => Object.entries(o);

const ReportBtn = ({ type, id, cfg }: { type: string; id: string; cfg: JobsConfig }) => {
  const [open, setOpen] = useState(false); const [reason, setReason] = useState(''); const [text, setText] = useState('');
  if (!open) return <button type="button" className="inline-flex items-center gap-1 text-xs" style={{ color: 'var(--t3)' }} onClick={() => setOpen(true)}><Flag size={13} /> Пожаловаться</button>;
  return (
    <div className="space-y-2 rounded-xl p-3" style={{ background: 'var(--bg-l2)' }}>
      <Sel label="Причина" value={reason} onChange={setReason} opts={toOpts(cfg.reportReasons)} all="Выберите" /><In label="Подробности (необязательно)" value={text} onChange={setText} max={500} />
      <div className="flex gap-2"><Btn small tone="accent" disabled={!reason} onClick={() => void jobs.report(type, id, reason, text).then((r) => { flash(r.ok ? 'Жалоба отправлена' : jobErr(r)); if (r.ok) setOpen(false); })}>Отправить</Btn><Btn small onClick={() => setOpen(false)}>Отмена</Btn></div>
    </div>
  );
};

const VacancyPage = ({ id, cfg, onBack }: { id: string; cfg: JobsConfig; onBack: () => void }) => {
  const [v, setV] = useState<Vac | null>(null); const [res, setRes] = useState<Resume | null>(null); const [cover, setCover] = useState(''); const [withResume, setWithResume] = useState(true); const [busy, setBusy] = useState(false); const [thread, setThread] = useState<string | null>(null);
  const load = useCallback(() => { void jobs.vacancy(id).then((r) => (r.ok ? setV(r.data!.vacancy) : flash('Вакансия недоступна'))); }, [id]);
  useEffect(() => { load(); void jobs.resume().then((r) => r.ok && setRes(r.data!.resume)); }, [load]);
  if (thread) return <Thread id={thread} onBack={() => { setThread(null); load(); }} />;
  if (!v) return <div className="grid place-items-center py-10"><Loader2 className="animate-spin" size={18} /></div>;
  const apply = async () => {
    setBusy(true); try { const r = await jobs.apply(id, { resumeId: withResume && res ? res.id : undefined, cover }); if (!r.ok) return flash(jobErr(r)); flash(r.data?.duplicate ? 'Вы уже откликались' : 'Отклик отправлен'); load(); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-3">
      <Head title="Вакансия" onBack={onBack} />
      <div className="space-y-2 rounded-2xl p-4" style={card}>
        <h3 className="text-lg font-black" style={{ color: 'var(--t1)' }} translate="no">{v.title}</h3>
        <p className="text-base font-bold" style={{ color: 'var(--accent)' }}>{salaryText(v)}</p>
        <p className="text-sm" style={{ color: 'var(--t2)' }}><span translate="no">{v.company?.name}</span>{v.company?.verified ? <BadgeCheck size={14} className="ml-1 inline" style={{ color: 'var(--accent)' }} aria-label="Компания проверена Sky" /> : <span className="ml-2 text-xs" style={{ color: 'var(--t3)' }}>не проверена Sky</span>}</p>
        <p className="flex items-center gap-1 text-sm" style={{ color: 'var(--t2)' }}><MapPin size={14} /> {v.remote ? 'Удалённо' : v.city}</p>
        <p className="text-xs" style={{ color: 'var(--t3)' }}>{v.employmentLabel} · {v.scheduleLabel} · {v.experienceLabel}</p>
      </div>
      {[['Описание', v.description], ['Требования', v.requirements], ['Условия', v.conditions]].filter(([, t]) => t).map(([h, t]) => <div key={h} className="rounded-2xl p-4" style={card}><p className="mb-1 text-xs font-bold" style={{ color: 'var(--t3)' }}>{h}</p><p className="whitespace-pre-wrap text-sm" style={{ color: 'var(--t1)' }} translate="no">{t}</p></div>)}
      {v.company?.about && <div className="rounded-2xl p-4" style={card}><p className="mb-1 text-xs font-bold" style={{ color: 'var(--t3)' }}>О компании</p><p className="whitespace-pre-wrap text-sm" style={{ color: 'var(--t1)' }} translate="no">{v.company.about}</p>{v.company.site && <a href={v.company.site} target="_blank" rel="noopener noreferrer nofollow" className="text-xs underline" style={{ color: 'var(--accent)' }}>{v.company.site}</a>}</div>}
      {!v.own && (v.myApplication ? (
        <div className="flex items-center justify-between rounded-2xl p-4" style={card}><span className="text-sm" style={{ color: 'var(--t1)' }}>Ваш отклик: <b>{cfg.appStatus[v.myStatus ?? 'sent']}</b></span><Btn tone="accent" onClick={() => setThread(v.myApplication!)}>Открыть</Btn></div>
      ) : (
        <div className="space-y-2 rounded-2xl p-4" style={card}>
          {res ? <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--t1)' }}><input type="checkbox" checked={withResume} onChange={(e) => setWithResume(e.target.checked)} /> Приложить моё резюме «{res.position}»</label> : <p className="text-xs" style={{ color: 'var(--t3)' }}>Резюме нет — можно откликнуться письмом или создать резюме во вкладке «Резюме».</p>}
          <label className="block text-[11px]" style={{ color: 'var(--t3)' }}>Сопроводительное письмо<textarea value={cover} maxLength={2000} rows={4} onChange={(e) => setCover(e.target.value)} className="mt-0.5 block w-full rounded-lg px-3 py-2 text-sm" style={field} /></label>
          <Btn tone="accent" disabled={busy} onClick={() => void apply()}>Откликнуться</Btn>
        </div>))}
      <div className="flex items-center justify-between">
        <button type="button" className="inline-flex items-center gap-1 text-sm" style={{ color: v.fav ? 'var(--red)' : 'var(--t2)' }} onClick={() => void jobs.fav(id, !v.fav).then(load)}><Heart size={16} fill={v.fav ? 'currentColor' : 'none'} /> {v.fav ? 'В избранном' : 'В избранное'}</button>
        {!v.own && <ReportBtn type="vacancy" id={id} cfg={cfg} />}
      </div>
    </div>
  );
};

const SearchTab = ({ cfg, favOnly }: { cfg: JobsConfig; favOnly?: boolean }) => {
  const [f, setF] = useState({ q: '', category: '', city: '', salary: '', schedule: '', employment: '', experience: '', remote: false }); const [list, setList] = useState<Vac[] | null>(null); const [more, setMore] = useState(false); const [open, setOpen] = useState<string | null>(null); const [showF, setShowF] = useState(false);
  const run = useCallback(async (offset = 0) => {
    const r = await jobs.search({ ...f, fav: favOnly, offset }); if (!r.ok) { flash('Не удалось загрузить вакансии'); return; }
    setList((l) => (offset ? [...(l ?? []), ...r.data!.vacancies] : r.data!.vacancies)); setMore(r.data!.more);
  }, [f, favOnly]);
  useEffect(() => { const t = setTimeout(() => void run(0), 300); return () => clearTimeout(t); }, [run]);
  if (open) return <VacancyPage id={open} cfg={cfg} onBack={() => { setOpen(null); void run(0); }} />;
  const set = (k: string) => (v: string) => setF((x) => ({ ...x, [k]: v }));
  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <div className="relative flex-1"><Search size={16} className="absolute left-3 top-3" style={{ color: 'var(--t3)' }} /><input aria-label="Поиск вакансий" value={f.q} onChange={(e) => set('q')(e.target.value)} placeholder="Профессия, компания, ключевое слово" className="w-full rounded-xl py-2.5 pl-9 pr-3 text-sm" style={field} /></div>
        <Btn onClick={() => setShowF(!showF)}>Фильтры</Btn>
      </div>
      {showF && <div className="grid grid-cols-2 gap-2 rounded-2xl p-3 sm:grid-cols-3" style={card}>
        <Sel label="Направление" value={f.category} onChange={set('category')} opts={cfg.categories.map((c): [string, string] => [c.id, c.name])} /><In label="Город" value={f.city} onChange={set('city')} max={60} /><In label="Зарплата от, ₽" value={f.salary} onChange={(v) => set('salary')(v.replace(/\D/g, ''))} max={9} />
        <Sel label="График" value={f.schedule} onChange={set('schedule')} opts={toOpts(cfg.schedule)} /><Sel label="Занятость" value={f.employment} onChange={set('employment')} opts={toOpts(cfg.employment)} /><Sel label="Опыт" value={f.experience} onChange={set('experience')} opts={toOpts(cfg.experience)} />
        <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--t1)' }}><input type="checkbox" checked={f.remote} onChange={(e) => setF({ ...f, remote: e.target.checked })} /> Только удалённо</label></div>}
      {!list ? <div className="grid place-items-center py-10"><Loader2 className="animate-spin" size={18} /></div> : list.length === 0 ? <p className="py-8 text-center text-sm" style={{ color: 'var(--t3)' }}>{favOnly ? 'В избранном пока ничего нет.' : 'Ничего не найдено. Измените запрос или фильтры.'}</p>
        : list.map((v) => (
          <button key={v.id} type="button" onClick={() => setOpen(v.id)} className="block w-full rounded-2xl p-4 text-left" style={card}>
            <div className="flex items-start justify-between gap-2"><p className="font-black" style={{ color: 'var(--t1)' }} translate="no">{v.title}</p>{v.promoted && <span className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ background: 'var(--accent-bg)', color: 'var(--accent)' }}>Продвигается</span>}</div>
            <p className="text-sm font-bold" style={{ color: 'var(--accent)' }}>{salaryText(v)}</p>
            <p className="text-xs" style={{ color: 'var(--t2)' }}><span translate="no">{v.company?.name}</span>{v.company?.verified ? ' ✓' : ''} · {v.remote ? 'Удалённо' : v.city} · {v.experienceLabel}</p>
            {v.myStatus && <p className="mt-1 text-xs font-semibold" style={{ color: 'var(--accent)' }}>Ваш отклик: {cfg.appStatus[v.myStatus]}</p>}
          </button>))}
      {more && <Btn onClick={() => void run(list?.length ?? 0)}>Показать ещё</Btn>}
    </div>
  );
};

const AppsTab = ({ cfg }: { cfg: JobsConfig }) => {
  const [list, setList] = useState<App[] | null>(null); const [open, setOpen] = useState<string | null>(null); const [st, setSt] = useState('');
  const load = useCallback(() => { void jobs.myApps().then((r) => r.ok && setList(r.data!.applications)); }, []); useEffect(load, [load]);
  if (open) return <Thread id={open} onBack={() => { setOpen(null); load(); }} />;
  if (!list) return <div className="grid place-items-center py-10"><Loader2 className="animate-spin" size={18} /></div>;
  const shown = st ? list.filter((a) => a.status === st) : list;
  return (
    <div className="space-y-3">
      <Sel label="Статус" value={st} onChange={setSt} opts={toOpts(cfg.appStatus)} all="Все отклики" />
      {shown.length === 0 ? <p className="py-8 text-center text-sm" style={{ color: 'var(--t3)' }}>Откликов пока нет. Найдите вакансию и откликнитесь — история сохранится здесь.</p>
        : shown.map((a) => (
          <button key={a.id} type="button" onClick={() => setOpen(a.id)} className="block w-full rounded-2xl p-4 text-left" style={card}>
            <div className="flex justify-between gap-2"><p className="font-black" style={{ color: 'var(--t1)' }} translate="no">{a.vacancyTitle}</p>{(a.unread ?? 0) > 0 && <span className="rounded-full px-2 text-xs font-bold text-white" style={{ background: 'var(--red)' }}>{a.unread}</span>}</div>
            <p className="text-xs" style={{ color: 'var(--t2)' }}><span translate="no">{a.company}</span> · {dt(a.updatedAt)}{a.initiator === 'employer' ? ' · вас пригласили' : ''}</p>
            <p className="mt-1 text-sm font-bold" style={{ color: a.status === 'rejected' ? 'var(--red)' : 'var(--accent)' }}>{a.statusLabel}</p>
          </button>))}
      <p className="text-[11px]" style={{ color: 'var(--t3)' }}>Уведомления о смене статуса приходят в раздел «Уведомления» Sky.</p>
    </div>
  );
};

const JobsInner = () => {
  const cfg = useConfig(); const [tab, setTab] = useState<Tab>('search');
  return (
    <div className="mx-auto h-full w-full max-w-3xl overflow-y-auto overflow-x-hidden px-4 pb-24 pt-4">
      <h1 className="mb-3 text-2xl font-black" style={{ color: 'var(--t1)' }}>Работа</h1>
      <div className="glass-pill mb-4 flex gap-1 overflow-x-auto p-1" style={{ scrollbarWidth: 'none' }}>
        {TABS.map(([k, n]) => (
          <button key={k} type="button" aria-pressed={tab === k} onClick={() => setTab(k)} className="relative isolate shrink-0 rounded-full px-3.5 py-2 text-sm font-semibold" style={{ color: tab === k ? 'var(--t1)' : 'var(--t3)' }}>
            {tab === k && <motion.span layoutId="jobs-lens" className="glass-lens absolute inset-0 -z-10" />}{n}</button>))}
      </div>
      {!cfg ? <div className="grid place-items-center py-10"><Loader2 className="animate-spin" size={18} /></div>
        : tab === 'search' ? <SearchTab cfg={cfg} /> : tab === 'fav' ? <SearchTab cfg={cfg} favOnly /> : tab === 'apps' ? <AppsTab cfg={cfg} />
          : tab === 'resume' ? <ResumeEditor cfg={cfg} /> : <Employer cfg={cfg} />}
    </div>
  );
};
export const JobsModule = () => <ModuleGate id="jobs"><JobsInner /></ModuleGate>;
