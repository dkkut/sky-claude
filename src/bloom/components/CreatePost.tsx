import { useState, useRef, useEffect } from 'react';
import { apiCall } from '@/core/auth/api';
import { motion } from 'framer-motion';
import { X, ImageIcon, MapPin, BarChart2, Trash2 } from 'lucide-react';
import { useBloomStore } from '../store';
import { useAuthStore } from '@/core/auth/store';
import { Av } from './Primitives';

export const CreatePost = ({ onClose, communityId: fixedCommunity }: { onClose: () => void; communityId?: string }) => {
  const addPost = useBloomStore(s => s.addPost);
  const { currentUserId, accounts } = useAuthStore();
  const me = accounts.find(a => a.id === currentUserId);

  const [text,       setText]       = useState('');
  const [mediaUrl,   setMediaUrl]   = useState<string>();
  const [mediaFile,  setMediaFile]  = useState<File>();
  const [kind,       setKind]       = useState<'text' | 'photo' | 'video'>('text');
  const [location,   setLocation]   = useState('');
  const [publishing, setPublishing] = useState(false);
  const [error,      setError]      = useState<string | null>(null);
  const [pollOn,     setPollOn]     = useState(false);
  const [pollQ,      setPollQ]      = useState('');
  const [pollOpts,   setPollOpts]   = useState(['', '']);
  const [blog,       setBlog]       = useState(false);
  const [title,      setTitle]      = useState('');
  const [isAd,       setIsAd]       = useState(false);
  const [adNote,     setAdNote]     = useState('');
  const [communityId, setCommunityId] = useState<string>(fixedCommunity ?? '');
  const [myCommunities, setMyCommunities] = useState<{ id: string; name: string; emoji: string; postPolicy: string; mine: { role: string; status: string } | null }[]>([]);
  useEffect(() => { let on = true; void apiCall<{ communities: typeof myCommunities }>('/api/bloom/communities?sort=mine').then(r => { if (on && r.ok) setMyCommunities((r.data?.communities ?? []).filter(c => c.mine?.status === 'active' && (c.postPolicy === 'all' || ['owner', 'mod'].includes(c.mine.role)))); }); return () => { on = false; }; }, []);
  const maxLen = blog ? 20000 : 280;
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return;
    setMediaUrl(prev => { if (prev?.startsWith('blob:')) URL.revokeObjectURL(prev); return URL.createObjectURL(f); });
    setKind(f.type.startsWith('video') ? 'video' : 'photo');
    setMediaFile(f);
  };

  const validPollOpts = pollOpts.map(o => o.trim()).filter(Boolean);
  const pollValid = pollOn && pollQ.trim() && validPollOpts.length >= 2;

  const publish = async () => {
    if (!text.trim() && !mediaUrl && !pollValid) return;
    if (blog && title.trim().length < 3) { setError('Название блога — не короче 3 знаков.'); return; }
    setPublishing(true);
    setError(null);
    const tags = Array.from(text.matchAll(/#(\w+)/g)).map(m => m[1]);
    const ok = await addPost({
      text: text.trim(), tags, communityId: communityId || undefined,
      location: location.trim() || undefined,
      poll: pollValid ? { question: pollQ.trim(), options: validPollOpts } : undefined,
      isBlog: blog || undefined, title: blog ? title.trim() : undefined,
      isAd: isAd || undefined, adNote: isAd ? adNote.trim() : undefined,
    }, mediaFile);
    setPublishing(false);
    if (!ok) { setError('Не получилось опубликовать. Попробуй ещё раз.'); return; }
    onClose();
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.85)' }}>
      <motion.div initial={{ y: 40, scale: 0.97 }} animate={{ y: 0, scale: 1 }}
        className="w-full max-w-lg overflow-hidden rounded-3xl"
        style={{ background: 'var(--bg-l1)', border: '1px solid var(--border-m)' }}>

        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <p className="text-base font-bold" style={{ color: 'var(--t1)' }}>{blog ? 'Новый блог' : 'Новый пост'}</p>
          <button type="button" onClick={onClose} style={{ color: 'var(--t3)' }}><X size={18}/></button>
        </div>

        <div className="flex items-start gap-3 px-5 pb-3">
          {me && <Av name={me.name} size={10}/>}
          <div className="flex-1">
            {blog && (
              <input value={title} onChange={e => setTitle(e.target.value)} maxLength={120} placeholder="Название блога"
                className="mb-2 w-full bg-transparent text-base font-bold outline-none" style={{ color: 'var(--t1)' }}/>
            )}
            <textarea value={text} onChange={e => setText(e.target.value)} rows={blog ? 9 : 4}
              placeholder={blog ? 'Текст блога. Используй #теги' : 'Что у тебя нового? Используй #теги'}
              className="w-full resize-none bg-transparent text-sm leading-relaxed outline-none"
              style={{ color: 'var(--t1)' }}/>
            {location && (
              <div className="flex items-center gap-1 mt-1">
                <MapPin size={11} style={{ color: 'var(--accent)' }}/>
                <span className="text-xs" style={{ color: 'var(--accent)' }}>{location}</span>
                <button type="button" onClick={() => setLocation('')} style={{ color: 'var(--t3)' }}><X size={11}/></button>
              </div>
            )}
          </div>
        </div>

        {mediaUrl && !pollOn && (
          <div className="relative mx-5 mb-3 overflow-hidden rounded-2xl" style={{ maxHeight: 260 }}>
            {kind === 'video'
              ? <video src={mediaUrl} muted autoPlay loop className="w-full object-cover" style={{ maxHeight: 260 }}/>
              : <img src={mediaUrl} alt="" className="w-full object-cover" style={{ maxHeight: 260 }}/>}
            <button type="button" onClick={() => { setMediaUrl(undefined); setKind('text'); setMediaFile(undefined); }}
              className="absolute top-2 right-2 grid h-7 w-7 place-items-center rounded-full"
              style={{ background: 'rgba(0,0,0,0.7)' }}><X size={12} className="text-white"/></button>
          </div>
        )}

        {pollOn && (
          <div className="mx-5 mb-3 space-y-2 rounded-2xl p-3.5" style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)' }}>
            <div className="flex items-center justify-between">
              <input value={pollQ} onChange={e => setPollQ(e.target.value)} placeholder="Вопрос опроса"
                className="flex-1 bg-transparent text-sm font-semibold outline-none" style={{ color: 'var(--t1)' }}/>
              <button type="button" onClick={() => { setPollOn(false); setPollQ(''); setPollOpts(['','']); }} style={{ color: 'var(--t3)' }}><X size={14}/></button>
            </div>
            {pollOpts.map((opt, i) => (
              <div key={i} className="flex items-center gap-2">
                <input value={opt} onChange={e => setPollOpts(o => o.map((x,j) => j===i ? e.target.value : x))}
                  placeholder={`Вариант ${i+1}`} maxLength={40}
                  className="flex-1 rounded-xl px-3 py-1.5 text-[13px] outline-none"
                  style={{ background: 'var(--bg-l1)', border: '1px solid var(--border)', color: 'var(--t1)' }}/>
                {pollOpts.length > 2 && (
                  <button type="button" onClick={() => setPollOpts(o => o.filter((_,j) => j!==i))} style={{ color: 'var(--t3)' }}>
                    <Trash2 size={13}/>
                  </button>
                )}
              </div>
            ))}
            {pollOpts.length < 4 && (
              <button type="button" onClick={() => setPollOpts(o => [...o, ''])}
                className="text-[12px] font-semibold" style={{ color: 'var(--accent)' }}>+ Добавить вариант</button>
            )}
          </div>
        )}

        {isAd && (
          <div className="mx-5 mb-3 rounded-2xl p-3" style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)' }}>
            <p className="text-[12px] font-semibold" style={{ color: 'var(--t1)' }}>Запись будет с пометкой «Реклама»</p>
            <input value={adNote} onChange={e => setAdNote(e.target.value)} maxLength={80} placeholder="Рекламодатель (по желанию)"
              className="mt-2 w-full rounded-xl px-3 py-1.5 text-[13px] outline-none"
              style={{ background: 'var(--bg-l1)', border: '1px solid var(--border)', color: 'var(--t1)' }}/>
            <p className="mt-1.5 text-[11px]" style={{ color: 'var(--t3)' }}>Пометку нельзя снять после публикации. Если запись рекламная, её нужно отметить — Sky не определяет рекламу сам.</p>
          </div>
        )}

        <input ref={fileRef} type="file" accept="image/*,video/*" className="hidden" onChange={handleFile}/>

        {error && (
          <p className="mx-5 mb-2 text-xs" style={{ color: 'var(--red)' }}>{error}</p>
        )}

        <div className="flex flex-wrap items-center gap-x-1 gap-y-2 border-t px-4 py-3" style={{ borderColor: 'var(--border)' }}>
          <button type="button" onClick={() => { fileRef.current?.click(); setPollOn(false); }}
            className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs hover:bg-white/5"
            style={{ color: 'var(--t3)' }}>
            <ImageIcon size={14}/>Медиа
          </button>
          <button type="button"
            onClick={() => { const l = prompt('Локация:'); if (l) setLocation(l); }}
            className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs hover:bg-white/5"
            style={{ color: location ? 'var(--accent)' : 'var(--t3)' }}>
            <MapPin size={14}/>Место
          </button>
          <button type="button"
            onClick={() => { if (!pollOn) { setMediaUrl(undefined); setMediaFile(undefined); setKind('text'); } setPollOn(v => !v); }}
            className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs hover:bg-white/5"
            style={{ color: pollOn ? 'var(--accent)' : 'var(--t3)' }}>
            <BarChart2 size={14}/>Опрос
          </button>
          <button type="button" onClick={() => setBlog(v => !v)}
            className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs hover:bg-white/5"
            style={{ color: blog ? 'var(--accent)' : 'var(--t3)' }}>Блог</button>
          <button type="button" onClick={() => setIsAd(v => !v)}
            className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs hover:bg-white/5"
            style={{ color: isAd ? 'var(--accent)' : 'var(--t3)' }}>Реклама</button>
          {myCommunities.length > 0 && !fixedCommunity && (
            <select value={communityId} onChange={e => setCommunityId(e.target.value)} aria-label="Где опубликовать" className="max-w-[130px] rounded-xl px-2 py-1.5 text-xs outline-none" style={{ background: 'var(--bg-l2)', color: 'var(--t2)', border: '1px solid var(--border)' }}>
              <option value="">В мою ленту</option>
              {myCommunities.map(c => <option key={c.id} value={c.id}>{c.emoji} {c.name}</option>)}
            </select>
          )}
          <span className="ml-auto mr-2 shrink-0 text-xs" style={{ color: text.length > maxLen ? 'var(--red)' : 'var(--t3)' }}>
            {text.length}/{maxLen}
          </span>
          <motion.button type="button" whileTap={{ scale: 0.96 }} onClick={publish}
            disabled={(!text.trim() && !mediaUrl && !pollValid) || publishing || text.length > maxLen}
            className="shrink-0 rounded-xl px-4 py-2 text-sm font-bold text-white disabled:opacity-40"
            style={{ background: 'var(--accent)' }}>
            {publishing ? 'Публикую...' : 'Опубликовать'}
          </motion.button>
        </div>
      </motion.div>
    </motion.div>
  );
};
