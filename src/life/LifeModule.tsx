/** Sky Life — персональное пространство внутри профиля Sky: главная, моя жизнь, цели, проекты, бизнес-связи, финансовые цели, важное, воспоминания, Sky AI, приватность. Своей авторизации нет — всё под текущим Sky ID. */
import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Home, BookHeart, Target, FolderKanban, Handshake, Wallet, ShieldCheck, History, Sparkles, SlidersHorizontal, CalendarDays } from 'lucide-react';
import { useAuthStore } from '@/core/auth/store';
import { J } from './api';
import { Sheet, Note, Spinner } from './ui';
import { HomeScreen } from './Home';
import { ItemsScreen } from './Items';
import { GoalsScreen, FinanceScreen } from './Goals';
import { ProjectsScreen } from './Projects';
import { BusinessScreen } from './Business';
import { SkyCalendar } from '@/calendar/SkyCalendar';
import { AiScreen, SettingsScreen } from './AiSettings';

export type Section = 'home' | 'life' | 'calendar' | 'goals' | 'projects' | 'business' | 'finance' | 'important' | 'memory' | 'ai' | 'settings';
const NAV: { k: Section; l: string; i: typeof Home }[] = [
  { k: 'home', l: 'Главная', i: Home }, { k: 'life', l: 'Моя жизнь', i: BookHeart }, { k: 'calendar', l: 'Календарь', i: CalendarDays }, { k: 'goals', l: 'Мои цели', i: Target }, { k: 'projects', l: 'Мои проекты', i: FolderKanban },
  { k: 'business', l: 'Бизнес-связи', i: Handshake }, { k: 'finance', l: 'Финансовые цели', i: Wallet }, { k: 'important', l: 'Важные вещи', i: ShieldCheck }, { k: 'memory', l: 'Воспоминания', i: History },
  { k: 'ai', l: 'Sky AI', i: Sparkles }, { k: 'settings', l: 'Приватность', i: SlidersHorizontal },
];

const LinkedProject = ({ token, onClose }: { token: string; onClose: () => void }) => {
  const [p, setP] = useState<{ title: string; summary: string } | null | false>(null);
  useEffect(() => { void J<{ project: { title: string; summary: string } }>(`/api/life/projects/by-link/${encodeURIComponent(token)}`).then((r) => setP(r.ok && r.data ? r.data.project : false)); }, [token]);
  return <Sheet title="Проект по ссылке" onClose={onClose}>{p === null ? <Spinner /> : p === false ? <Note>Ссылка недействительна или доступ закрыт автором.</Note> : <><p className="text-base font-bold" style={{ color: 'var(--t1)' }} translate="no">{p.title}</p><p className="whitespace-pre-wrap text-sm" style={{ color: 'var(--t2)' }} translate="no">{p.summary}</p><Note>Это публичная часть проекта. Участие — по приглашению автора.</Note></>}</Sheet>;
};

export const LifeModule = () => {
  const me = useAuthStore((s) => s.currentUserId) ?? '';
  const [sec, setSec] = useState<Section>(() => (sessionStorage.getItem('sky:life:sec') as Section) || 'home');
  const [link] = useState(() => new URLSearchParams(location.search).get('life_project'));
  const [showLink, setShowLink] = useState(Boolean(link));
  useEffect(() => { sessionStorage.setItem('sky:life:sec', sec); }, [sec]);
  const body = () => {
    switch (sec) {
      case 'home': return <HomeScreen go={setSec} />;
      case 'life': return <ItemsScreen kind="entry" heading="Моя жизнь" intro="Планы, мечты, важные даты, поездки, покупки, контакты, заметки и списки желаний. Всё зашифровано и видно только вам." />;
      case 'calendar': return <SkyCalendar />;
      case 'goals': return <GoalsScreen />;
      case 'projects': return <ProjectsScreen me={me} />;
      case 'business': return <BusinessScreen />;
      case 'finance': return <FinanceScreen />;
      case 'important': return <ItemsScreen kind="important" heading="Важные вещи" intro="Документы, гарантии, договоры, сроки действия, инструкции и экстренные контакты. Файлы шифруются. Пароли, коды подтверждения, номера карт и секретные ключи здесь хранить нельзя." />;
      case 'memory': return <ItemsScreen kind="memory" heading="Воспоминания" intro="Временная линия важных событий вашей жизни: добавляйте события, фотографии и достижения, ищите по годам." />;
      case 'ai': return <AiScreen />;
      default: return <SettingsScreen />;
    }
  };
  return (
    <div className="flex h-full min-h-0 flex-col lg:flex-row" style={{ background: 'radial-gradient(1200px 500px at 90% -10%, rgba(139,92,246,.14), transparent 60%)' }}>
      <nav aria-label="Разделы Sky Life" className="hidden w-60 shrink-0 space-y-1 overflow-y-auto p-4 lg:block">
        <p className="px-3 pb-2 text-lg font-black" style={{ color: 'var(--t1)' }}>Sky Life</p>
        {NAV.map((n) => { const I = n.i; const on = sec === n.k; return (
          <button key={n.k} type="button" onClick={() => setSec(n.k)} aria-current={on ? 'page' : undefined} className="relative isolate flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left text-sm font-semibold" style={{ color: on ? 'var(--t1)' : 'var(--t3)' }}>
            {on && <motion.span layoutId="life-side" className="glass-lens absolute inset-0 -z-10 rounded-2xl" transition={{ type: 'spring', stiffness: 420, damping: 34 }} />}<I size={17} />{n.l}</button>); })}
      </nav>
      <div className="glass-pill mx-3 mt-3 flex shrink-0 gap-1 overflow-x-auto p-1 lg:hidden" role="tablist" style={{ scrollbarWidth: 'none' }}>
        {NAV.map((n) => { const I = n.i; const on = sec === n.k; return (
          <button key={n.k} type="button" role="tab" aria-selected={on} onClick={() => setSec(n.k)} className="relative isolate flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-[13px] font-semibold" style={{ color: on ? 'var(--t1)' : 'var(--t3)' }}>
            {on && <motion.span layoutId="life-top" className="glass-lens absolute inset-0 -z-10 rounded-full" transition={{ type: 'spring', stiffness: 420, damping: 34 }} />}<I size={14} />{n.l}</button>); })}
      </div>
      <main className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-3 pb-24 sm:p-5 lg:pb-8"><div className="mx-auto w-full max-w-3xl min-w-0">{body()}</div></main>
      {showLink && link && <LinkedProject token={link} onClose={() => { setShowLink(false); const u = new URL(location.href); u.searchParams.delete('life_project'); history.replaceState(null, '', u.toString()); }} />}
    </div>
  );
};
export default LifeModule;
