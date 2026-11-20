/** Sky Работа: резюме соискателя — опыт, образование, навыки, желаемая зарплата, видимость, согласие на обработку данных, выгрузка и удаление. */
import { useEffect, useState } from 'react';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { flash } from '@/shared/flash';
import { Btn, In, card, field } from '@/kassabiz/ui';
import { jobs, jobErr, type JobsConfig, type Resume } from './jobsApi';
import { Sel } from './JobsModule';

type Exp = { company: string; role: string; from: string; to: string; text: string }; type Edu = { place: string; spec: string; year: string };
const VIS: [string, string][] = [['applied', 'Только работодателям, куда я откликнулся'], ['public', 'Видно проверенным работодателям (поиск резюме)'], ['hidden', 'Скрыто (не показывается и не ищется)']];

export const ResumeEditor = ({ cfg }: { cfg: JobsConfig }) => {
  const [loaded, setLoaded] = useState(false); const [exists, setExists] = useState(false); const [busy, setBusy] = useState(false); const [consent, setConsent] = useState(false);
  const [f, setF] = useState({ position: '', categoryId: '', city: '', desiredSalary: '', schedule: 'full_day', employment: 'full', experienceYears: '0', skills: '', about: '', phone: '', email: '', visibility: 'applied' });
  const [exp, setExp] = useState<Exp[]>([]); const [edu, setEdu] = useState<Edu[]>([]); const [views, setViews] = useState<{ company: string; verified: boolean; day: string }[]>([]);
  const fill = (r: Resume) => { setExists(true); setF({ position: r.position, categoryId: r.categoryId ?? '', city: r.city, desiredSalary: r.desiredSalary ? String(r.desiredSalary) : '', schedule: r.schedule, employment: r.employment, experienceYears: String(r.experienceYears), skills: r.skills.join(', '), about: r.about ?? '', phone: r.contact?.phone ?? '', email: r.contact?.email ?? '', visibility: r.visibility }); setExp(r.experience ?? []); setEdu(r.education ?? []); };
  useEffect(() => { void jobs.resume().then((r) => { if (r.ok && r.data!.resume) { fill(r.data!.resume); setViews(r.data!.views ?? []); } setLoaded(true); }); }, []);
  if (!loaded) return <div className="grid place-items-center py-10"><Loader2 className="animate-spin" size={18} /></div>;
  const set = (k: string) => (v: string) => setF((x) => ({ ...x, [k]: v }));
  const save = async () => {
    setBusy(true);
    try {
      const r = await jobs.saveResume({ ...f, consent, desiredSalary: f.desiredSalary ? Number(f.desiredSalary) : null, experienceYears: Number(f.experienceYears) || 0, skills: f.skills.split(',').map((s) => s.trim()).filter(Boolean), experience: exp, education: edu, contact: { phone: f.phone, email: f.email } });
      if (!r.ok) return flash(jobErr(r)); flash('Резюме сохранено'); const x = await jobs.resume(); if (x.ok && x.data!.resume) { fill(x.data!.resume); setViews(x.data!.views ?? []); }
    } finally { setBusy(false); }
  };
  const del = async () => { if (!window.confirm('Удалить резюме и отозвать согласие? Данные будут стёрты.')) return; const r = await jobs.deleteResume(); if (r.ok) { setExists(false); setConsent(false); setExp([]); setEdu([]); setViews([]); setF((x) => ({ ...x, position: '', about: '', skills: '' })); flash('Резюме удалено'); } };
  const download = async () => { const r = await jobs.exportData(); if (!r.ok) return flash(jobErr(r)); const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(r.data, null, 2)], { type: 'application/json' })); a.download = 'sky-job-data.json'; a.click(); };
  return (
    <div className="space-y-3">
      <div className="space-y-2 rounded-2xl p-4" style={card}>
        <In label="Желаемая должность" value={f.position} onChange={set('position')} max={100} />
        <div className="grid grid-cols-2 gap-2"><Sel label="Направление" value={f.categoryId} onChange={set('categoryId')} opts={cfg.categories.map((c): [string, string] => [c.id, c.name])} all="Не выбрано" /><In label="Город" value={f.city} onChange={set('city')} max={80} />
          <In label="Желаемая зарплата, ₽" value={f.desiredSalary} onChange={(v) => set('desiredSalary')(v.replace(/\D/g, ''))} max={9} /><In label="Опыт, лет" value={f.experienceYears} onChange={(v) => set('experienceYears')(v.replace(/\D/g, ''))} max={2} />
          <Sel label="График" value={f.schedule} onChange={set('schedule')} opts={Object.entries(cfg.schedule)} all="—" /><Sel label="Занятость" value={f.employment} onChange={set('employment')} opts={Object.entries(cfg.employment)} all="—" /></div>
        <In label="Навыки (через запятую)" value={f.skills} onChange={set('skills')} max={600} />
        <label className="block text-[11px]" style={{ color: 'var(--t3)' }}>О себе<textarea value={f.about} maxLength={3000} rows={4} onChange={(e) => set('about')(e.target.value)} className="mt-0.5 block w-full rounded-lg px-3 py-2 text-sm" style={field} /></label>
      </div>
      <div className="space-y-2 rounded-2xl p-4" style={card}><p className="text-sm font-black" style={{ color: 'var(--t1)' }}>Опыт работы</p>
        {exp.map((x, i) => <div key={i} className="grid grid-cols-2 gap-2 rounded-xl p-2" style={{ background: 'var(--bg-l2)' }}>
          <In label="Компания" value={x.company} onChange={(v) => setExp((l) => l.map((y, j) => (j === i ? { ...y, company: v } : y)))} max={100} /><In label="Должность" value={x.role} onChange={(v) => setExp((l) => l.map((y, j) => (j === i ? { ...y, role: v } : y)))} max={100} />
          <In label="С (ГГГГ-ММ)" value={x.from} onChange={(v) => setExp((l) => l.map((y, j) => (j === i ? { ...y, from: v } : y)))} max={7} /><In label="По (ГГГГ-ММ)" value={x.to} onChange={(v) => setExp((l) => l.map((y, j) => (j === i ? { ...y, to: v } : y)))} max={7} />
          <div className="col-span-2"><In label="Чем занимались" value={x.text} onChange={(v) => setExp((l) => l.map((y, j) => (j === i ? { ...y, text: v } : y)))} max={1000} /></div>
          <button type="button" aria-label="Удалить место работы" onClick={() => setExp((l) => l.filter((_, j) => j !== i))}><Trash2 size={15} /></button></div>)}
        <Btn small onClick={() => setExp((l) => [...l, { company: '', role: '', from: '', to: '', text: '' }])}><Plus size={13} className="inline" /> Добавить место работы</Btn>
        <p className="pt-2 text-sm font-black" style={{ color: 'var(--t1)' }}>Образование</p>
        {edu.map((x, i) => <div key={i} className="grid grid-cols-3 gap-2 rounded-xl p-2" style={{ background: 'var(--bg-l2)' }}>
          <In label="Учебное заведение" value={x.place} onChange={(v) => setEdu((l) => l.map((y, j) => (j === i ? { ...y, place: v } : y)))} max={120} /><In label="Специальность" value={x.spec} onChange={(v) => setEdu((l) => l.map((y, j) => (j === i ? { ...y, spec: v } : y)))} max={120} /><In label="Год" value={x.year} onChange={(v) => setEdu((l) => l.map((y, j) => (j === i ? { ...y, year: v.replace(/\D/g, '') } : y)))} max={4} />
          <button type="button" aria-label="Удалить" onClick={() => setEdu((l) => l.filter((_, j) => j !== i))}><Trash2 size={15} /></button></div>)}
        <Btn small onClick={() => setEdu((l) => [...l, { place: '', spec: '', year: '' }])}><Plus size={13} className="inline" /> Добавить образование</Btn>
      </div>
      <div className="space-y-2 rounded-2xl p-4" style={card}>
        <p className="text-sm font-black" style={{ color: 'var(--t1)' }}>Приватность и контакты</p>
        <Sel label="Кто видит резюме" value={f.visibility} onChange={set('visibility')} opts={VIS} all="—" />
        <div className="grid grid-cols-2 gap-2"><In label="Телефон" value={f.phone} onChange={set('phone')} max={30} /><In label="Почта" value={f.email} onChange={set('email')} max={120} /></div>
        <p className="text-[11px]" style={{ color: 'var(--t3)' }}>Контакты работодатель видит только в тех откликах, где вы сами их открыли. Не указывайте паспорт, номера карт и пароли. Текст резюме хранится в зашифрованном виде.</p>
        {!exists && <label className="flex items-start gap-2 text-sm" style={{ color: 'var(--t1)' }}><input type="checkbox" className="mt-1" checked={consent} onChange={(e) => setConsent(e.target.checked)} /> Согласен на обработку моих персональных данных для поиска работы в Sky. Согласие можно отозвать, удалив резюме.</label>}
        <div className="flex flex-wrap gap-2"><Btn tone="accent" disabled={busy || (!exists && !consent)} onClick={() => void save()}>Сохранить резюме</Btn>{exists && <><Btn onClick={() => void download()}>Скачать мои данные</Btn><Btn tone="danger" onClick={() => void del()}>Удалить резюме</Btn></>}</div>
      </div>
      {exists && <div className="rounded-2xl p-4" style={card}><p className="mb-1 text-sm font-black" style={{ color: 'var(--t1)' }}>Кто смотрел резюме (30 дней)</p>{views.length === 0 ? <p className="text-xs" style={{ color: 'var(--t3)' }}>Пока никто.</p> : views.map((v, i) => <p key={i} className="text-sm" style={{ color: 'var(--t2)' }} translate="no">{v.company}{v.verified ? ' ✓' : ''} · {v.day}</p>)}</div>}
    </div>
  );
};
