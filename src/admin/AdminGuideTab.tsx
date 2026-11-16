/** Вкладка «Обучение»: руководство администратора (12 разделов, уровни полномочий). Текст — src/admin/guide/content.ts; права и роли названы по server/roles.mjs. Доступна каждому сотруднику. */
import { useMemo, useState } from 'react';
import { PRINCIPLES, SECTIONS, TIERS, guideToMarkdown, type TierId } from './guide/content';

const C = { l1: 'var(--bg-l1)', l2: 'var(--bg-l2)', brd: 'var(--border)', t1: 'var(--t1)', t2: 'var(--t2)', t3: 'var(--t3)', acc: 'var(--accent)', red: 'var(--red)', green: 'var(--green)' };
const List = ({ title, items, tone }: { title: string; items: string[]; tone?: string }) => (
  <div><p className="text-[11px] font-bold uppercase" style={{ color: tone ?? C.t3 }}>{title}</p><ul className="ml-4 list-disc space-y-0.5 text-[13px]" style={{ color: C.t2 }}>{items.map((x, i) => <li key={i}>{x}</li>)}</ul></div>
);

export const AdminGuideTab = () => {
  const [open, setOpen] = useState<string>('principles'); const [tier, setTier] = useState<TierId>('moderator'); const [q, setQ] = useState('');
  const list = useMemo(() => { const k = q.trim().toLowerCase(); return k ? SECTIONS.filter((s) => JSON.stringify(s).toLowerCase().includes(k)) : SECTIONS; }, [q]);
  const download = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([guideToMarkdown()], { type: 'text/markdown' })); a.download = 'sky-admin-guide.md'; a.click(); URL.revokeObjectURL(a.href); };
  const tiers = TIERS;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск по руководству" className="min-w-0 flex-1 rounded-xl px-3 py-2 text-sm" style={{ background: C.l2, border: `1px solid ${C.brd}`, color: C.t1 }} />
        <button type="button" onClick={download} className="rounded-xl px-3 py-2 text-xs font-bold" style={{ background: C.l2, color: C.t1, border: `1px solid ${C.brd}` }}>Скачать (Markdown)</button>
      </div>
      <p className="text-xs" style={{ color: C.t3 }}>Руководство описывает то, что действительно умеет панель. Права и роли названы так же, как на сервере; «уровни» ниже — это наборы ролей, а не отдельная настройка.</p>

      <div className="rounded-2xl" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
        <button type="button" onClick={() => setOpen(open === 'principles' ? '' : 'principles')} className="w-full px-4 py-3 text-left text-sm font-bold" style={{ color: C.t1 }}>Принципы и уровни полномочий</button>
        {open === 'principles' && (
          <div className="space-y-3 px-4 pb-4">
            <List title="Принципы" items={PRINCIPLES} />
            <div className="flex flex-wrap gap-2" role="tablist">{tiers.map((t) => <button key={t.id} type="button" role="tab" aria-selected={tier === t.id} onClick={() => setTier(t.id)} className="rounded-full px-3 py-1 text-xs font-bold" style={{ background: tier === t.id ? C.acc : C.l2, color: tier === t.id ? '#fff' : C.t1 }}>{t.title}</button>)}</div>
            {tiers.filter((t) => t.id === tier).map((t) => (
              <div key={t.id} className="space-y-2"><p className="text-[13px]" style={{ color: C.t2 }}>{t.who}</p>
                {t.roles.length > 0 && <p className="text-[11px]" style={{ color: C.t3 }} translate="no">{`Роли: ${t.roles.join(', ')}`}</p>}
                <List title="Может" items={t.can} tone={C.green} /><List title="Не может" items={t.cannot} tone={C.red} /></div>))}
          </div>)}
      </div>

      {list.map((s) => (
        <div key={s.id} className="rounded-2xl" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
          <button type="button" onClick={() => setOpen(open === s.id ? '' : s.id)} aria-expanded={open === s.id} className="w-full px-4 py-3 text-left text-sm font-bold" style={{ color: C.t1 }}>{s.title}</button>
          {open === s.id && (
            <div className="space-y-3 px-4 pb-4">
              <p className="text-[13px]" style={{ color: C.t2 }}>{s.purpose}</p>
              <p className="text-[11px]" style={{ color: C.t3 }} translate="no">{`Права: ${s.rights.join(', ')} · Вкладки: ${s.tabs.join('; ')}`}</p>
              <div><p className="text-[11px] font-bold uppercase" style={{ color: C.t3 }}>Пошагово</p><ol className="ml-4 list-decimal space-y-0.5 text-[13px]" style={{ color: C.t2 }}>{s.steps.map((x, i) => <li key={i}>{x}</li>)}</ol></div>
              <div><p className="text-[11px] font-bold uppercase" style={{ color: C.t3 }}>Примеры</p>{s.examples.map((e, i) => <div key={i} className="mt-1 rounded-xl p-2 text-[13px]" style={{ background: C.l2, color: C.t2 }}><p><b>Ситуация.</b> {e.situation}</p><p><b>Что делать.</b> {e.action}</p></div>)}</div>
              <List title="Правильные действия" items={s.doThis} tone={C.green} /><List title="Запрещено" items={s.dontThis} tone={C.red} /><List title="Передайте старшему администратору или владельцу, если" items={s.escalate} />
              <div><p className="text-[11px] font-bold uppercase" style={{ color: C.t3 }}>Кто что делает в этом разделе</p>{tiers.map((t) => <p key={t.id} className="text-[13px]" style={{ color: C.t2 }}><b>{t.title}.</b> {s.tiers[t.id]}</p>)}</div>
            </div>)}
        </div>))}
      {list.length === 0 && <p className="text-sm" style={{ color: C.t3 }}>Ничего не найдено.</p>}
    </div>
  );
};
