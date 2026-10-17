import { useState, useRef, useEffect } from 'react';
import { Search, Bell, Sparkles, X, Check, MessageCircle, Phone, Heart, Shield,
         AtSign, Repeat2, UserPlus } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNotifStore, SkyNotif, NotifKind } from '@/notifications/store';
import { useModuleStore } from '@/data/state/modules';
import { useRegionStore, findCountry } from '@/region/store';
import { RegionPicker } from '@/region/RegionPicker';

interface HeaderProps {
  moduleLabel: string;
  searchValue: string;
  onSearchChange: (v: string) => void;
  searchPlaceholder?: string;
}

const fmtTime = (ts: number) => {
  const d = Date.now() - ts;
  if (d < 60000)    return 'только что';
  if (d < 3600000)  return `${Math.floor(d / 60000)} мин`;
  if (d < 86400000) return `${Math.floor(d / 3600000)} ч`;
  return `${Math.floor(d / 86400000)} д`;
};

const KindIcon = ({ kind, color }: { kind: NotifKind; color: string }) => {
  const p = { size: 13, color };
  if (kind === 'message')      return <MessageCircle {...p} />;
  if (kind === 'mention')      return <AtSign        {...p} />;
  if (kind === 'call_in')      return <Phone         {...p} />;
  if (kind === 'call_missed')  return <Phone         size={13} style={{ color:'var(--red)' }} />;
  if (kind === 'like')         return <Heart         {...p} />;
  if (kind === 'comment')      return <MessageCircle {...p} />;
  if (kind === 'repost')       return <Repeat2       {...p} />;
  if (kind === 'follow')       return <UserPlus      {...p} />;
  return                              <Shield        {...p} />;
};

export const Header = ({ moduleLabel, searchValue, onSearchChange, searchPlaceholder = 'Поиск...' }: HeaderProps) => {
  const [showNotifs, setShowNotifs] = useState(false);
  const [showRegion, setShowRegion] = useState(false);
  const code = useRegionStore((s) => s.code);
  const [showAI,     setShowAI]     = useState(false);
  const [aiQuery,    setAiQuery]    = useState('');
  const [aiAnswer,   setAiAnswer]   = useState('');
  const [aiLoading,  setAiLoading]  = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);
  const aiRef    = useRef<HTMLDivElement>(null);
  const setActiveModule = useModuleStore((s) => s.setActiveModule);

  // -- Real notification store --------------------------------------
  const notifs = useNotifStore((s) => s.notifs);
  const markRead = useNotifStore((s) => s.markRead);
  const markAllRead = useNotifStore((s) => s.markAllRead);
  const dismiss = useNotifStore((s) => s.dismiss);
  const unread = notifs.filter(n => !n.read).length;

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) setShowNotifs(false);
      if (aiRef.current    && !aiRef.current.contains(e.target as Node))    setShowAI(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  // Mark all read when dropdown opens
  const openNotifs = () => {
    setShowNotifs(v => !v);
    if (!showNotifs) setTimeout(() => markAllRead(), 2000);
  };

  const askAI = async () => {
    if (!aiQuery.trim()) return;
    setAiLoading(true);
    await new Promise(r => setTimeout(r, 500));
    const q = aiQuery.toLowerCase();
    let answer = '';
    if      (q.includes('чат') || q.includes('сообщен'))   answer = 'Раздел «Чаты»  -  личные переписки, группы и каналы.';
    else if (q.includes('музык') || q.includes('трек'))    answer = 'Медиа → Музыка  -  каталог треков, плейлисты, AI-волна.';
    else if (q.includes('фильм') || q.includes('кино'))    answer = 'Медиа → Кино  -  фильмы, трейлеры, онлайн-просмотр.';
    else if (q.includes('истор'))                          answer = 'Истории  -  фото, видео, текстовые истории и стримы.';
    else if (q.includes('профил') || q.includes('аккаун')) answer = 'Профиль  -  редактирование, приватность, настройки.';
    else if (q.includes('bloom') || q.includes('пост'))    answer = 'Bloom  -  лента. Публикуй посты, лайкай, комментируй.';
    else if (q.includes('игр') || q.includes('gaming'))    answer = 'Gaming  -  Sky Arena, Neon Drift и другие игры + турниры.';
    else if (q.includes('market') || q.includes('магаз'))  answer = 'Медиа → Маркет  -  покупай и продавай товары.';
    else answer = 'Попробуй поискать в нужном разделе: Чаты, Истории, Bloom, Медиа, Gaming, Профиль.';
    setAiAnswer(answer);
    setAiLoading(false);
  };

  const dropdownStyle: React.CSSProperties = {
    position: 'absolute', top: 'calc(100% + 8px)', right: 0, zIndex: 9999,
    width: 300, background: 'var(--bg-l1)',
    border: '1px solid var(--border-m)', borderRadius: 16,
    boxShadow: 'var(--shadow-xl)', backdropFilter: 'blur(24px)',
  };

  return (
    <>
    <header className="mb-3 flex items-center justify-between gap-3 rounded-3xl px-5 py-3"
      style={{ background:'var(--bg-l1)', backdropFilter:'blur(20px) saturate(180%)',
        border:'1px solid var(--border)', boxShadow:'var(--shadow-sm)' }}>

      <h1 className="shrink-0 text-xl font-semibold leading-tight tracking-tight truncate max-w-[160px]"
        style={{ color:'var(--t1)' }}>{moduleLabel}</h1>

      {/* Поиск */}
      <label className="flex flex-1 max-w-sm items-center gap-2.5 rounded-2xl px-3.5 py-2 cursor-text"
        style={{ background:'var(--bg-l2)', border:'1px solid var(--border)' }}>
        <Search size={14} style={{ color:'var(--t3)', flexShrink:0 }}/>
        <input value={searchValue} onChange={e => onSearchChange(e.target.value)}
          className="w-full bg-transparent text-sm outline-none" style={{ color:'var(--t1)' }}
          placeholder={searchPlaceholder}/>
      </label>

      <div className="flex items-center gap-2">

        {/* Регион */}
        <motion.button type="button" whileTap={{ scale: 0.93 }} onClick={() => setShowRegion(true)}
          className="grid h-9 w-9 place-items-center rounded-2xl text-base"
          style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)' }}
          title="Регион">
          {findCountry(code).flag}
        </motion.button>

        {/* Sky AI */}
        <div className="relative" ref={aiRef}>
          <motion.button type="button" whileTap={{ scale:0.93 }}
            onClick={() => { setShowAI(v => !v); setAiAnswer(''); setAiQuery(''); }}
            className="grid h-9 w-9 place-items-center rounded-2xl"
            style={{ background:'linear-gradient(135deg,rgba(79,110,247,0.15),rgba(79,110,247,0.15))',
              border:'1px solid rgba(79,110,247,0.25)' }}>
            <Sparkles size={15} style={{ color:'var(--accent)' }}/>
          </motion.button>

          <AnimatePresence>
            {showAI && (
              <motion.div key="ai-drop" initial={{ opacity:0, scale:0.92, y:-6 }}
                animate={{ opacity:1, scale:1, y:0 }} exit={{ opacity:0, scale:0.92, y:-6 }}
                transition={{ duration:0.15 }} style={dropdownStyle}>
                <div className="p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <Sparkles size={13} style={{ color:'var(--accent)' }}/>
                    <p className="flex-1 text-xs font-semibold" style={{ color:'var(--accent)' }}>Sky AI</p>
                    <button type="button" onClick={() => setShowAI(false)} style={{ color:'var(--t3)' }}><X size={13}/></button>
                  </div>
                  <div className="flex gap-2">
                    <input value={aiQuery} onChange={e => setAiQuery(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && askAI()} autoFocus
                      placeholder="Спроси что-нибудь..."
                      className="flex-1 rounded-xl px-3 py-2 text-xs outline-none"
                      style={{ background:'var(--bg-l2)', border:'1px solid var(--border-m)', color:'var(--t1)' }}/>
                    <motion.button whileTap={{ scale:0.9 }} type="button" onClick={askAI}
                      disabled={aiLoading || !aiQuery.trim()}
                      className="rounded-xl px-3 py-2 text-xs font-bold text-white disabled:opacity-40"
                      style={{ background:'var(--accent)' }}>
                      {aiLoading ? '...' : '→'}
                    </motion.button>
                  </div>
                  {aiAnswer && (
                    <motion.div initial={{ opacity:0, y:4 }} animate={{ opacity:1, y:0 }}
                      className="rounded-xl p-3 text-xs leading-relaxed"
                      style={{ background:'rgba(79,110,247,0.07)', border:'1px solid rgba(79,110,247,0.15)', color:'var(--t1)' }}>
                      {aiAnswer}
                    </motion.div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Уведомления */}
        <div className="relative" ref={notifRef}>
          <motion.button type="button" whileTap={{ scale:0.93 }} onClick={openNotifs}
            className="relative grid h-9 w-9 place-items-center rounded-2xl"
            style={{ background:'var(--bg-l2)', border:'1px solid var(--border)' }}>
            <Bell size={15} style={{ color:'var(--t2)' }}/>
            {unread > 0 && (
              <motion.span initial={{ scale:0 }} animate={{ scale:1 }}
                className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full px-0.5 text-[9px] font-bold text-white"
                style={{ background:'var(--accent)' }}>{unread > 99 ? '99+' : unread}</motion.span>
            )}
          </motion.button>

          <AnimatePresence>
            {showNotifs && (
              <motion.div key="notif-drop" initial={{ opacity:0, scale:0.92, y:-6 }}
                animate={{ opacity:1, scale:1, y:0 }} exit={{ opacity:0, scale:0.92, y:-6 }}
                transition={{ duration:0.15 }} style={dropdownStyle}>

                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3 border-b"
                  style={{ borderColor:'var(--border)' }}>
                  <p className="text-sm font-semibold" style={{ color:'var(--t1)' }}>Уведомления</p>
                  <div className="flex items-center gap-2">
                    {unread > 0 && (
                      <button type="button" onClick={markAllRead}
                        className="flex items-center gap-1 text-xs" style={{ color:'var(--accent)' }}>
                        <Check size={11}/> Все прочитать
                      </button>
                    )}
                    <button type="button"
                      onClick={() => { setShowNotifs(false); setActiveModule('notifications'); }}
                      className="text-xs" style={{ color:'var(--t3)' }}>Все →</button>
                  </div>
                </div>

                {/* List */}
                <div className="max-h-80 overflow-y-auto">
                  {notifs.length === 0 ? (
                    <div className="flex flex-col items-center gap-2 py-10">
                      <Bell size={28} style={{ color:'var(--t3)', opacity:0.4 }}/>
                      <p className="text-xs" style={{ color:'var(--t3)' }}>Нет уведомлений</p>
                    </div>
                  ) : notifs.slice(0, 12).map((n: SkyNotif) => (
                    <motion.div key={n.id} layout
                      className="flex items-start gap-3 px-4 py-2.5 transition-colors hover:bg-white/[0.03] cursor-pointer"
                      style={{ background: n.read ? 'transparent' : 'rgba(79,110,247,0.05)' }}
                      onClick={() => markRead(n.id)}>
                      {/* Avatar */}
                      <div className="relative mt-0.5 shrink-0">
                        <div className="grid h-8 w-8 place-items-center rounded-full text-sm font-bold"
                          style={{ background: n.color || 'var(--bg-l3)', color: n.color ? '#fff' : 'var(--t1)' }}>
                          {n.avatarLetter}
                        </div>
                        <div className="absolute -bottom-0.5 -right-0.5 grid h-4 w-4 place-items-center rounded-full"
                          style={{ background:'var(--bg)' }}>
                          <KindIcon kind={n.kind} color={n.color || 'var(--accent)'} />
                        </div>
                      </div>
                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold" style={{ color:'var(--t1)' }}>{n.title}</p>
                        <p className="text-xs leading-snug mt-0.5 line-clamp-2" style={{ color:'var(--t2)' }}>{n.body}</p>
                        <p className="text-[10px] mt-1" style={{ color:'var(--t3)' }}>{fmtTime(n.timestamp)}</p>
                      </div>
                      {/* Dismiss */}
                      <button type="button"
                        onClick={e => { e.stopPropagation(); dismiss(n.id); }}
                        className="mt-0.5 shrink-0 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity hover:opacity-100"
                        style={{ color:'var(--t3)' }}>
                        <X size={11}/>
                      </button>
                      {/* Unread dot */}
                      {!n.read && (
                        <div className="mt-2 h-1.5 w-1.5 rounded-full shrink-0"
                          style={{ background:'var(--accent)' }}/>
                      )}
                    </motion.div>
                  ))}
                </div>

                {notifs.length > 12 && (
                  <button type="button"
                    onClick={() => { setShowNotifs(false); setActiveModule('notifications'); }}
                    className="w-full py-2.5 text-xs text-center border-t transition-colors hover:bg-white/5"
                    style={{ color:'var(--accent)', borderColor:'var(--border)' }}>
                    Показать все {notifs.length}
                  </button>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

      </div>
    </header>

    <AnimatePresence>
      {showRegion && <RegionPicker onClose={() => setShowRegion(false)}/>}
    </AnimatePresence>
    </>
  );
};
