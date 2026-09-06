/* ===============================================================
   MUSICIAN ACCOUNTS  -  профили музыкантов и аналитика
=============================================================== */
import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  Music2, Play, Users, TrendingUp, BarChart2, Star, Plus,
  HeartIcon, Share2, CheckCircle, Disc, Upload,
} from 'lucide-react';
import { useAuthStore } from '@/core/auth/store';
import { usePlatformStore } from '@/platform/store';
import { ArtistSubmitTrack } from './ArtistSubmit';
import { create } from 'zustand';

/* -- Types ------------------------------------------------ */
export interface ArtistProfile {
  userId:      string;
  artistName:  string;
  bio:         string;
  genre:       string;
  coverUrl?:   string;
  gradientFrom:string;
  gradientTo:  string;
  verified:    boolean;
  monthlyListeners: number;
  followers:   number;
  followedBy:  string[];   // userIds following this artist
  totalPlays:  number;
  links: { spotify?:string; vk?:string; youtube?:string; telegram?:string };
  createdAt:   string;
}

interface MusicianState {
  artists:     ArtistProfile[];
  myArtistId:  string | null;   // current user's artist profile
  create:  (p: Omit<ArtistProfile,'createdAt'|'verified'|'followers'|'followedBy'|'totalPlays'>) => void;
  follow:  (artistUserId: string, myId: string) => void;
  unfollow:(artistUserId: string, myId: string) => void;
  getArtist:(userId: string) => ArtistProfile | null;
}

const SK_ART = 'sky:artists:v1';
const loadArt = () => { try { return JSON.parse(localStorage.getItem(SK_ART)||'[]'); } catch { return []; } };
const saveArt = (a: ArtistProfile[]) => { try { localStorage.setItem(SK_ART, JSON.stringify(a)); } catch {} };

// Seed artists
const SEED_ARTISTS: ArtistProfile[] = [
  { userId:'luna_nova', artistName:'Luna Nova', bio:'Электронная музыка и ambient. Каждый трек  -  путешествие.',
    genre:'Electronic', verified:true, gradientFrom:'#1a0040', gradientTo:'#4a0080',
    monthlyListeners:142000, followers:8400, followedBy:[], totalPlays:1840000,
    links:{ vk:'luna_nova_music', telegram:'lunanovalive' }, createdAt:new Date().toISOString() },
];

export const useMusicianStore = create<MusicianState>((set, get) => ({
  artists:    [...SEED_ARTISTS, ...loadArt().filter((a:any) => !SEED_ARTISTS.find(s=>s.userId===a.userId))],
  myArtistId: null,

  create: (params) => {
    const profile: ArtistProfile = {
      ...params, verified:false, followers:0, followedBy:[], totalPlays:0,
      createdAt: new Date().toISOString(),
    };
    const artists = [...get().artists.filter(a=>a.userId!==params.userId), profile];
    saveArt(artists.filter(a=>!SEED_ARTISTS.find(s=>s.userId===a.userId)));
    set({ artists, myArtistId:params.userId });
  },

  follow: (artistUserId, myId) => {
    const artists = get().artists.map(a =>
      a.userId === artistUserId
        ? { ...a, followedBy:[...a.followedBy.filter(x=>x!==myId), myId], followers:a.followers+1 }
        : a
    );
    saveArt(artists);
    set({ artists });
  },
  unfollow: (artistUserId, myId) => {
    const artists = get().artists.map(a =>
      a.userId === artistUserId
        ? { ...a, followedBy:a.followedBy.filter(x=>x!==myId), followers:Math.max(0,a.followers-1) }
        : a
    );
    saveArt(artists);
    set({ artists });
  },

  getArtist: (userId) => get().artists.find(a => a.userId === userId) ?? null,
}));

const fmtNum = (n:number) => n >= 1000000 ? `${(n/1000000).toFixed(1)}M` : n >= 1000 ? `${(n/1000).toFixed(0)}K` : String(n);
const C = {
  bg:'#0a0a10', l1:'#111118', l2:'#1c1c22',
  border:'var(--border)', accent:'var(--accent)',
  t1:'var(--t1)', t2:'var(--t2)', t3:'var(--t3)',
};

/* -- Artist Card ------------------------------------------- */
const ArtistCard = ({ artist, myId, onOpen }: { artist:ArtistProfile; myId:string; onOpen:()=>void }) => {
  const { follow, unfollow } = useMusicianStore();
  const following = artist.followedBy.includes(myId);

  return (
    <motion.div whileTap={{ scale:.97 }} onClick={onOpen}
      className="rounded-2xl overflow-hidden cursor-pointer"
      style={{ background:`linear-gradient(155deg,${artist.gradientFrom},${artist.gradientTo})` }}>
      <div className="px-4 pt-5 pb-4">
        {/* Avatar */}
        <div className="flex items-center gap-3 mb-4">
          {artist.coverUrl
            ? <img src={artist.coverUrl} alt="" className="h-14 w-14 rounded-2xl object-cover"/>
            : <div className="grid h-14 w-14 place-items-center rounded-2xl text-2xl font-black text-white"
                style={{ background:'rgba(0,0,0,0.3)' }}>{artist.artistName[0]}</div>
          }
          <div>
            <div className="flex items-center gap-1.5">
              <p className="text-base font-black text-white">{artist.artistName}</p>
              {artist.verified && <CheckCircle size={14} style={{ color:'#60a5fa' }} fill="#60a5fa"/>}
            </div>
            <p className="text-xs" style={{ color:'rgba(255,255,255,0.6)' }}>{artist.genre}</p>
          </div>
        </div>
        {/* Stats */}
        <div className="flex gap-3 mb-3">
          {[
            { icon:TrendingUp, val:fmtNum(artist.monthlyListeners), label:'прослушиваний/мес' },
            { icon:Users,      val:fmtNum(artist.followers),        label:'подписчиков' },
          ].map(({icon:Icon,val,label}) => (
            <div key={label} className="flex-1 rounded-xl p-2.5" style={{ background:'rgba(0,0,0,0.25)' }}>
              <Icon size={12} style={{ color:'rgba(255,255,255,0.5)' }}/>
              <p className="text-base font-black text-white mt-1">{val}</p>
              <p className="text-[9px]" style={{ color:'rgba(255,255,255,0.4)' }}>{label}</p>
            </div>
          ))}
        </div>
        {/* Follow button */}
        <motion.button whileTap={{ scale:.94 }} type="button"
          onClick={e => { e.stopPropagation(); following ? unfollow(artist.userId,myId) : follow(artist.userId,myId); }}
          className="w-full rounded-xl py-2 text-xs font-bold transition-all"
          style={{
            background: following ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.9)',
            color: following ? '#fff' : '#000',
          }}>
          {following ? '✓ Вы подписаны' : '+ Подписаться'}
        </motion.button>
      </div>
    </motion.div>
  );
};

/* -- Artist Detail ----------------------------------------- */
const ArtistDetail = ({ artist, myId, onBack }: { artist:ArtistProfile; myId:string; onBack:()=>void }) => {
  const { follow, unfollow } = useMusicianStore();
  const { tracks } = usePlatformStore();
  const following = artist.followedBy.includes(myId);
  const myTracks  = tracks.filter(t => t.uploadedBy === artist.userId && t.status==='published');

  return (
    <motion.div initial={{ opacity:0, y:20 }} animate={{ opacity:1, y:0 }}
      className="flex flex-col h-full overflow-y-auto" style={{ background:C.bg, scrollbarWidth:'none' }}>
      {/* Hero */}
      <div className="relative overflow-hidden pb-6"
        style={{ background:`linear-gradient(160deg,${artist.gradientFrom},${artist.gradientTo},${C.bg})` }}>
        <button type="button" onClick={onBack}
          className="absolute top-4 left-4 text-white/60 text-sm font-semibold">← Назад</button>
        <div className="flex flex-col items-center gap-3 pt-14 px-6">
          {artist.coverUrl
            ? <img src={artist.coverUrl} alt="" className="h-24 w-24 rounded-3xl object-cover shadow-2xl"/>
            : <div className="grid h-24 w-24 place-items-center rounded-3xl text-4xl font-black text-white shadow-2xl"
                style={{ background:'rgba(0,0,0,0.4)' }}>{artist.artistName[0]}</div>
          }
          <div className="text-center">
            <div className="flex items-center justify-center gap-2">
              <h1 className="text-2xl font-black text-white">{artist.artistName}</h1>
              {artist.verified && <CheckCircle size={18} style={{ color:'#60a5fa' }} fill="#60a5fa"/>}
            </div>
            <p className="text-sm mt-1" style={{ color:'rgba(255,255,255,0.6)' }}>{artist.genre}</p>
          </div>
          {/* Follow + Share */}
          <div className="flex gap-3">
            <motion.button whileTap={{ scale:.94 }} type="button"
              onClick={() => following ? unfollow(artist.userId,myId) : follow(artist.userId,myId)}
              className="rounded-full px-6 py-2.5 text-sm font-bold"
              style={{ background:following?'rgba(255,255,255,0.15)':'rgba(255,255,255,0.9)',
                color:following?'#fff':'#000' }}>
              {following ? '✓ Подписан' : '+ Подписаться'}
            </motion.button>
            <button type="button"
              className="grid h-10 w-10 place-items-center rounded-full"
              style={{ background:'rgba(255,255,255,0.15)' }}>
              <Share2 size={16} className="text-white"/>
            </button>
          </div>
        </div>
      </div>

      <div className="px-4 space-y-4 pb-6">
        {/* Stats */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { val:fmtNum(artist.monthlyListeners), label:'Прослушиваний/мес', icon:'📈' },
            { val:fmtNum(artist.followers),        label:'Подписчиков',       icon:'👥' },
            { val:fmtNum(artist.totalPlays),       label:'Всего проигрываний',icon:'▶️' },
          ].map(({val,label,icon}) => (
            <div key={label} className="rounded-2xl p-3 text-center"
              style={{ background:C.l1, border:`1px solid ${C.border}` }}>
              <span className="text-xl">{icon}</span>
              <p className="text-base font-black text-white mt-1">{val}</p>
              <p className="text-[9px] leading-tight mt-0.5" style={{ color:C.t3 }}>{label}</p>
            </div>
          ))}
        </div>

        {/* Bio */}
        {artist.bio && (
          <div className="rounded-2xl p-4" style={{ background:C.l1, border:`1px solid ${C.border}` }}>
            <p className="text-xs font-bold mb-1.5" style={{ color:C.t3 }}>О художнике</p>
            <p className="text-sm leading-relaxed" style={{ color:C.t2 }}>{artist.bio}</p>
          </div>
        )}

        {/* Tracks */}
        <div>
          <p className="text-xs font-bold mb-3" style={{ color:C.t3 }}>🎵 Треки ({myTracks.length})</p>
          {myTracks.length === 0 ? (
            <div className="rounded-2xl p-4 text-center" style={{ background:C.l1 }}>
              <p className="text-sm" style={{ color:C.t3 }}>Нет опубликованных треков</p>
            </div>
          ) : (
            <div className="space-y-2">
              {myTracks.map((t,i) => (
                <div key={t.id} className="flex items-center gap-3 rounded-2xl px-3 py-2.5"
                  style={{ background:C.l1, border:`1px solid ${C.border}` }}>
                  <span className="text-xs w-4 text-center" style={{ color:C.t3 }}>{i+1}</span>
                  <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl overflow-hidden"
                    style={{ background:'linear-gradient(135deg,#1a0533,#2d1b69)' }}>
                    {t.coverUrl ? <img src={t.coverUrl} alt="" className="h-full w-full object-cover"/> : <Music2 size={16} style={{ color:C.t3 }}/>}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate text-white">{t.title}</p>
                    <p className="text-xs" style={{ color:C.t3 }}>{t.duration}</p>
                  </div>
                  <button type="button" className="grid h-8 w-8 place-items-center rounded-full hover:bg-white/5">
                    <Play size={14} style={{ color:C.t2 }}/>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Social links */}
        {Object.entries(artist.links).some(([,v])=>!!v) && (
          <div>
            <p className="text-xs font-bold mb-2" style={{ color:C.t3 }}>Соцсети</p>
            <div className="flex flex-wrap gap-2">
              {artist.links.vk && (
                <a href={`https://vk.com/${artist.links.vk}`} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold"
                  style={{ background:'rgba(0,119,255,0.15)', color:'#0077ff', border:'1px solid rgba(0,119,255,0.3)' }}>
                  🔷 VK
                </a>
              )}
              {artist.links.telegram && (
                <a href={`https://t.me/${artist.links.telegram}`} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold"
                  style={{ background:'rgba(0,136,204,0.15)', color:'#0088cc', border:'1px solid rgba(0,136,204,0.3)' }}>
                  ✈️ Telegram
                </a>
              )}
            </div>
          </div>
        )}
      </div>
    </motion.div>
  );
};

/* === MAIN MusicianHub ====================================== */
export const MusicianHub = () => {
  const { currentUserId, accounts } = useAuthStore();
  const { artists, create, getArtist } = useMusicianStore();
  const [detail,    setDetail]    = useState<ArtistProfile|null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name,    setName]    = useState('');
  const [bio,     setBio]     = useState('');
  const [genre,   setGenre]   = useState('');

  const myId = currentUserId ?? '';
  const myArtist = getArtist(myId);

  if (submitting) return <ArtistSubmitTrack onDone={()=>setSubmitting(false)}/>;
  if (detail) return <ArtistDetail artist={detail} myId={myId} onBack={()=>setDetail(null)}/>;

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ background:C.bg }}>
      <div className="px-4 pt-4 pb-3 shrink-0">
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-lg font-black" style={{ color:C.t1 }}>🎵 Музыканты</p>
            <p className="text-xs" style={{ color:C.t3 }}>{artists.length} исполнителей</p>
          </div>
          {!myArtist && (
            <button type="button" onClick={() => setCreating(c=>!c)}
              className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold"
              style={{ background:`${C.accent}20`, color:C.accent, border:`1px solid ${C.accent}30` }}>
              <Plus size={13}/> Стать артистом
            </button>
          )}
        </div>

        {/* My artist card */}
        {myArtist && !creating && (
          <div className="rounded-2xl p-3 mb-3"
            style={{ background:'rgba(79,110,247,0.08)', border:'1px solid rgba(79,110,247,0.22)' }}>
            <div className="flex items-center gap-3 mb-2.5 cursor-pointer" onClick={()=>setDetail(myArtist)}>
              <div className="grid h-10 w-10 place-items-center rounded-xl text-xl shrink-0"
                style={{ background:`linear-gradient(135deg,${myArtist.gradientFrom},${myArtist.gradientTo})` }}>
                {myArtist.artistName[0]}
              </div>
              <div>
                <p className="text-sm font-bold text-white">{myArtist.artistName}</p>
                <p className="text-[10px]" style={{ color:C.accent }}>Мой профиль → Аналитика</p>
              </div>
            </div>
            <button type="button" onClick={()=>setSubmitting(true)}
              className="flex items-center justify-center gap-2 w-full rounded-xl py-2.5 text-xs font-bold text-white"
              style={{ background:`linear-gradient(135deg,${C.accent},#818cf8)`, boxShadow:`0 4px 16px ${C.accent}35` }}>
              🎵 Подать трек на публикацию
            </button>
          </div>
        )}

        {/* Create form */}
        {creating && (
          <div className="rounded-2xl p-4 mb-3 space-y-3"
            style={{ background:C.l1, border:`1px solid ${C.border}` }}>
            <p className="text-sm font-bold" style={{ color:C.t1 }}>Создать профиль артиста</p>
            {[
              { val:name, set:setName, ph:'Псевдоним / название группы' },
              { val:genre, set:setGenre, ph:'Жанр (например: Electronic, Hip-Hop)' },
              { val:bio, set:setBio, ph:'О себе...' },
            ].map(({val,set,ph}) => (
              <input key={ph} value={val} onChange={e=>set(e.target.value)} placeholder={ph}
                className="w-full rounded-xl px-3 py-2.5 text-sm outline-none"
                style={{ background:C.l2, border:`1px solid ${C.border}`, color:C.t1 }}/>
            ))}
            <div className="flex gap-2">
              <motion.button whileTap={{scale:.96}} type="button" onClick={()=>{
                if(!name.trim())return;
                create({ userId:myId, artistName:name.trim(), bio:bio.trim(), genre:genre.trim()||'Другое',
                  gradientFrom:'#1a0040', gradientTo:'#4a0080', monthlyListeners:0, links:{} });
                setCreating(false);
              }} className="flex-1 rounded-xl py-2.5 text-sm font-bold text-white" style={{ background:C.accent }}>
                Создать
              </motion.button>
              <button type="button" onClick={()=>setCreating(false)}
                className="rounded-xl px-4 py-2.5 text-sm" style={{ color:C.t3, background:C.l2 }}>
                Отмена
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-3" style={{ scrollbarWidth:'none' }}>
        {artists.map(a => (
          <ArtistCard key={a.userId} artist={a} myId={myId} onOpen={()=>setDetail(a)}/>
        ))}
      </div>
    </div>
  );
};
