import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { useAuthStore } from '@/core/auth/store';
import { useModuleStore } from '@/data/state/modules';
import { sp, errText, ROOM, MOOD, type Overview, type House, type Pet, type InvRow } from './api';
import { PetPic } from './PetArt';
import { PetSheet } from './PetSheet';
import { Eggs, ShopScreen, InventoryScreen, TasksScreen, AchievementsScreen, Collection, CityScreen } from './Screens';
import { FurnArt } from './Furniture';
import { Btn, Card, Chip, Empty, Coin, GRAD, INK, itemIcon, ItemArt, useToast, useReload } from './ui';
import { usePetsNav } from './nav';

const CSS = `
@keyframes sp-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-4px)}}
@keyframes sp-wob{0%,100%{transform:rotate(-4deg)}50%{transform:rotate(4deg)}}
@keyframes sp-zz{0%{opacity:0;transform:translate(0,0) scale(.7)}30%{opacity:1}100%{opacity:0;transform:translate(10px,-22px) scale(1.15)}}
@keyframes sp-bub{0%{opacity:0;transform:translateY(6px) scale(.6)}40%{opacity:1}100%{opacity:0;transform:translateY(-22px) scale(1.1)}}
.sp-zz{animation:sp-zz 2.6s ease-out infinite}.sp-bub{animation:sp-bub 2.2s ease-out infinite}
@keyframes sp-z{0%{opacity:0;transform:translateY(0)}50%{opacity:1}100%{opacity:0;transform:translateY(-14px)}}
.sp-bob{animation:sp-bob 2.4s ease-in-out infinite}.sp-wobble{animation:sp-wob .8s ease-in-out infinite;transform-origin:50% 90%}
.sp-root *{-webkit-tap-highlight-color:transparent}
@media (prefers-reduced-motion:reduce){.sp-bob,.sp-wobble,.sp-zz,.sp-bub{animation:none}}
html[data-animations='off'] .sp-bob,html[data-animations='off'] .sp-wobble{animation:none}
`;
const TABS = [['home', 'Мой дом'], ['pets', 'Мои питомцы'], ['shared', 'Совместные'], ['collection', 'Коллекция'], ['eggs', 'Яйца'], ['shop', 'Магазин'], ['inventory', 'Инвентарь'], ['city', 'Город питомцев'], ['tasks', 'Задания'], ['ach', 'Достижения'], ['friends', 'Друзья']] as const;
type TabKey = (typeof TABS)[number][0];
const WALL: Record<string, string> = { living: '#f6dcee', kitchen: '#ffeccc', bath: '#d6eefc', bed: '#e3dcff', play: '#dcf6d8', garden: '#d4f1ff' };
const FLOOR: Record<string, string> = { living: '#e6c7a2', kitchen: '#e8d9c4', bath: '#bfd9e6', bed: '#cdb9e8', play: '#f0d98f', garden: '#9ed67a' };
/** Встроенная обстановка комнат: рисуется всегда, не убирается и не мешает нажатиям; свою мебель человек ставит поверх. */
/** [рисунок, x %, y %, ширина % сцены, 'w' — висит на стене/лежит (y — центр), иначе y — «ножки» на полу]. Пол — нижняя половина сцены. */
const FIXTURES: Record<string, [string, number, number, number, string?][]> = {
  living: [['carpet', 50, 84, 72, 'w'], ['picture', 28, 24, 30, 'w'], ['window', 72, 27, 32, 'w'], ['clock', 50, 11, 13, 'w'], ['lamp', 9, 70, 16], ['sofa', 46, 74, 66], ['plant', 91, 74, 22]],
  kitchen: [['clock', 50, 10, 13, 'w'], ['fridge', 14, 56, 30], ['stove', 45, 56, 30], ['sink', 76, 56, 30], ['table', 50, 88, 66], ['chair', 17, 86, 24], ['chair', 83, 86, 24]],
  bath: [['mirror', 50, 24, 22, 'w'], ['shower', 17, 58, 30], ['sink', 50, 56, 34], ['tub', 56, 90, 70], ['plant', 9, 80, 20]],
  bed: [['window', 30, 25, 32, 'w'], ['picture', 70, 23, 24, 'w'], ['carpet', 50, 90, 60, 'w'], ['wardrobe', 88, 56, 26], ['lamp', 10, 68, 16], ['bed', 40, 82, 66], ['nightstand', 82, 76, 26], ['teddy', 12, 92, 18]],
  play: [['balloon', 24, 22, 22, 'w'], ['balloon', 72, 18, 18, 'w'], ['tunnel', 52, 66, 36], ['slide', 22, 70, 40], ['easel', 80, 72, 34], ['blocks', 48, 90, 26], ['ball', 88, 92, 16]],
  garden: [['sun', 50, 14, 26, 'w'], ['fence', 52, 55, 40], ['tree', 17, 66, 46], ['house', 80, 62, 46], ['bush', 92, 90, 28], ['tulip', 30, 92, 18], ['tulip', 42, 93, 18]],
};
/** Узоры стен и пола: у каждой комнаты свой (полоски, шахматка, ромбы, дерево). */
const PATTERN = (room: string): { wall: string; wallSize?: string; floor: string; floorSize?: string } => {
  const w = 'rgba(255,255,255,.38)', d = 'rgba(0,0,0,.05)';
  if (room === 'living') return { wall: `repeating-linear-gradient(90deg,transparent 0 38px,${w} 38px 76px)`, floor: `repeating-linear-gradient(0deg,transparent 0 46px,${d} 46px 49px)` };
  if (room === 'kitchen') return { wall: `repeating-linear-gradient(90deg,transparent 0 38px,${w} 38px 76px)`, floor: `linear-gradient(45deg,${w} 25%,transparent 25% 75%,${w} 75%),linear-gradient(45deg,${w} 25%,transparent 25% 75%,${w} 75%)`, floorSize: '80px 80px', };
  if (room === 'bath') return { wall: `conic-gradient(${w} 25%,transparent 0 50%,${w} 0 75%,transparent 0)`, wallSize: '90px 90px', floor: `linear-gradient(${w} 2px,transparent 2px),linear-gradient(90deg,${w} 2px,transparent 2px)`, floorSize: '64px 64px' };
  if (room === 'bed') return { wall: `repeating-linear-gradient(0deg,transparent 0 56px,${w} 56px 66px)`, floor: `radial-gradient(${w} 3px,transparent 4px)`, floorSize: '48px 48px' };
  if (room === 'play') return { wall: `radial-gradient(${w} 6px,transparent 7px)`, wallSize: '52px 52px', floor: `repeating-linear-gradient(90deg,transparent 0 60px,${d} 60px 120px)` };
  return { wall: 'none', floor: `repeating-linear-gradient(90deg,transparent 0 40px,${d} 40px 80px)` };
};
const hash = (s: string) => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; };

const NEED_TEXT: Record<string, string> = { feed: 'Хочу кушать! 🍖', bathe: 'Хочу помыться 🛁', play: 'Давай поиграем! 🎾', sleep: 'Хочу спать… 😴', heal: 'Мне нездоровится 💊' };
const REACT = ['Мур-р! 💛', 'Ура, это ты!', 'Ещё погладь!', '😊', 'Я скучал(а)!'];

export function Scene({ house, pets, room, decor, selected, onPet, onTap, onRemove, inv, locked }: { house: House; pets: Pet[]; room: string; decor: boolean; selected: InvRow | null; onPet: (p: Pet, el: HTMLElement) => void; onTap: (x: number, y: number) => void; onRemove: (uid: string) => void; inv: InvRow[]; locked?: boolean }) {
  const ref = useRef<HTMLDivElement>(null); const [W, setW] = useState(360); useEffect(() => { const el = ref.current; if (!el) return; const ro = new ResizeObserver(() => setW(el.clientWidth || 360)); ro.observe(el); setW(el.clientWidth || 360); return () => ro.disconnect(); }, []); const pat = PATTERN(room); const st = house.style?.[room] ?? {}; const wall = st.wall ?? WALL[room] ?? '#eee', floor = st.floor ?? FLOOR[room] ?? '#ddd';
  const placed = house.placed.filter((x) => x.room === room); const bed = placed.find((x) => x.itemId.startsWith('bed'));
  const items = useMemo(() => new Map(inv.map((r) => [r.itemId, r.item])), [inv]);
  const icon = (id: string) => { const it = items.get(id); const k = id.startsWith('bed') ? 'bed' : id.startsWith('bowl') ? 'bowl' : id.startsWith('furn') ? 'sofa' : id.startsWith('decor') ? 'plant' : id.startsWith('toy') ? 'teddy' : ''; return it ? <ItemArt item={it} size={Math.round(W * 0.2)} /> : k ? <FurnArt name={k} size={Math.round(W * 0.2)} /> : <span className="text-[40px]">🎁</span>; };
  return (
    <div ref={ref} className="relative mx-auto w-full select-none overflow-hidden rounded-[30px]" style={{ aspectRatio: '4 / 5', maxWidth: 600, backgroundColor: wall, backgroundImage: pat.wall, backgroundSize: pat.wallSize, boxShadow: 'inset 0 -8px 24px rgba(0,0,0,.06), 0 12px 30px rgba(90,60,190,.18)', cursor: decor && selected ? 'crosshair' : 'default' }}
      onClick={(e) => { if (!decor || !selected || !ref.current) return; const r = ref.current.getBoundingClientRect(); onTap(((e.clientX - r.left) / r.width) * 100, ((e.clientY - r.top) / r.height) * 100); }}>
      <div className="absolute inset-x-0 bottom-0" style={{ height: '50%', backgroundColor: floor, backgroundImage: pat.floor, backgroundSize: pat.floorSize, borderTop: '4px solid rgba(255,255,255,.6)', boxShadow: 'inset 0 10px 16px rgba(0,0,0,.07)' }} />
      {(FIXTURES[room] ?? []).map(([e, x, y, wp, k], i) => <span key={`fx${i}`} aria-hidden className="pointer-events-none absolute leading-none" style={{ left: `${x}%`, top: `${y}%`, width: `${wp}%`, transform: k === 'w' ? 'translate(-50%,-50%)' : 'translate(-50%,-94%)', zIndex: e === 'carpet' ? 0 : Math.round(y) }}><FurnArt name={e} size="100%" /></span>)}
      {placed.map((x) => <button key={x.uid} type="button" aria-label="Предмет" onClick={(e) => { e.stopPropagation(); if (decor && !locked) onRemove(x.uid); }} className="absolute -translate-x-1/2 -translate-y-1/2 leading-none" style={{ left: `${x.x}%`, top: `${x.y}%`, filter: decor ? 'drop-shadow(0 0 4px #7b5cf0)' : 'drop-shadow(0 3px 3px rgba(0,0,0,.2))', cursor: decor ? 'pointer' : 'default' }}>{icon(x.itemId)}</button>)}
      {pets.map((p, i) => <PetActor key={p.id} p={p} i={i} room={room} W={W} decor={decor} bed={bed} onPet={onPet} />)}
      <div className="absolute left-3 top-3 rounded-full px-3 py-1 text-[12px] font-extrabold" style={{ background: 'rgba(255,255,255,.85)', color: INK }}>{ROOM[room] ?? room}</div>
      {decor && <div className="absolute inset-x-0 bottom-2 text-center text-[11px] font-bold" style={{ color: INK }}>{selected ? `Нажмите на сцену, чтобы поставить: ${selected.item?.name}` : 'Выберите предмет ниже. Нажмите на предмет в доме, чтобы убрать'}</div>}
    </div>
  );
}


type Spot = { x: number; y: number; kind: 'sofa' | 'bed' | 'tub' | 'chair' | 'slide' | 'rug' | 'tree'; clip: number; rot: number; x2?: number; y2?: number };
/** Места, куда питомцы сами залезают: на диван, в кровать, в ванну, на стул, на горку. Координаты — под встроенную обстановку FIXTURES. */
const SPOTS: Record<string, Spot[]> = {
  living: [{ x: 46, y: 70, kind: 'sofa', clip: 0.26, rot: 0 }, { x: 52, y: 88, kind: 'rug', clip: 0, rot: -78 }],
  kitchen: [{ x: 17, y: 84, kind: 'chair', clip: 0.3, rot: 0 }, { x: 83, y: 84, kind: 'chair', clip: 0.3, rot: 0 }],
  bath: [{ x: 56, y: 86, kind: 'tub', clip: 0.42, rot: 0 }],
  bed: [{ x: 40, y: 77, kind: 'bed', clip: 0.4, rot: -6 }, { x: 52, y: 90, kind: 'rug', clip: 0, rot: -78 }],
  play: [{ x: 14, y: 52, kind: 'slide', clip: 0, rot: 0, x2: 33, y2: 70 }, { x: 52, y: 66, kind: 'rug', clip: 0.25, rot: 0 }],
  garden: [{ x: 17, y: 70, kind: 'tree', clip: 0, rot: 0 }],
};
const ZZ = ['z', 'Z', 'z'];
function PetActor({ p, i, room, W, decor, bed, onPet }: { p: Pet; i: number; room: string; W: number; decor: boolean; bed?: { x: number; y: number }; onPet: (p: Pet, el: HTMLElement) => void }) {
  const reduce = useReducedMotion(); const h = hash(p.id); const need = p.needs[0]; const size = Math.round(W * 0.27);
  const spots = SPOTS[room] ?? [];
  // куда тянет: усталому — кровать/диван, грязному — ванна, остальным — по настроению питомца
  const want = (kinds: Spot['kind'][]) => spots.find((s) => kinds.includes(s.kind));
  let spot: Spot | undefined;
  if (p.sleeping) spot = bed ? { x: bed.x, y: bed.y + 4, kind: 'bed', clip: 0.4, rot: -6 } : want(['bed', 'sofa', 'rug']);
  else if (need === 'bathe') spot = want(['tub']);
  else if (need === 'feed') spot = want(['chair']);
  else spot = spots.length ? spots[h % spots.length] : undefined;
  const dx = 18 + (h % 60), dy = 64 + ((h >> 3) % 20), bx = 22 + ((h >> 5) % 56), by = 80 - ((h >> 7) % 22);
  const sleepy = p.sleeping || spot?.rot === -78 || spot?.kind === 'bed';
  const still = p.sleeping || (need === 'bathe' && spot?.kind === 'tub');
  const inset = (c: number) => `inset(0 0 ${Math.round(c * 100)}% 0)`;
  let animate: any, transition: any, initial: any;
  if (!spot) {
    animate = { left: [dx, bx, dx + 8, dx].map((v) => `${v}%`), top: [dy, Math.min(90, dy + 6), dy - 3, dy].map((v) => `${v}%`) }; transition = { duration: 26 + (h % 14), repeat: Infinity, ease: 'easeInOut', delay: i * 0.7 };
  } else if (still || reduce) {
    animate = { left: `${spot.x}%`, top: `${spot.y}%`, rotate: spot.rot, clipPath: inset(spot.clip) }; transition = { duration: reduce ? 0 : 1.4, ease: 'easeInOut' };
  } else if (spot.kind === 'slide') {
    animate = { left: [dx, spot.x, spot.x2!, bx, dx].map((v) => `${v}%`), top: [dy, spot.y, spot.y2!, by, dy].map((v) => `${v}%`), rotate: [0, 0, 18, 0, 0] }; transition = { duration: 14 + (h % 6), repeat: Infinity, ease: 'easeInOut', times: [0, 0.22, 0.34, 0.6, 1], delay: i * 0.7 };
  } else {
    const dur = 24 + (h % 12); const c = spot.clip;
    animate = { left: [dx, spot.x, spot.x, bx, dx].map((v) => `${v}%`), top: [dy, spot.y, spot.y, by, dy].map((v) => `${v}%`), rotate: [0, spot.rot, spot.rot, 0, 0], clipPath: [inset(0), inset(c), inset(c), inset(0), inset(0)] };
    transition = { duration: dur, repeat: Infinity, ease: 'easeInOut', times: [0, 0.2, 0.62, 0.8, 1], delay: i * 0.7 };
  }
  const deco = spot && (sleepy || spot.kind === 'tub');
  const decoAnim = still ? { opacity: 1 } : spot ? { opacity: [0, 1, 1, 0, 0] } : undefined;
  const decoTr = still ? { duration: 0.8 } : spot ? { ...transition, ease: 'linear', delay: transition.delay } : undefined;
  return (
    <motion.button type="button" aria-label={p.name} onClick={(e) => { e.stopPropagation(); if (!decor) onPet(p, e.currentTarget); }} className="absolute outline-none"
      initial={false} animate={animate} transition={transition} style={{ x: '-50%', y: '-100%', transformOrigin: '50% 90%', left: `${spot?.x ?? dx}%`, top: `${spot?.y ?? dy}%`, zIndex: 100 + Math.round(spot?.y ?? dy) + (spot?.kind === 'tub' || spot?.kind === 'bed' ? 3 : 0) }}>
      {need && !p.sleeping && <div className="absolute left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ top: -22, background: '#fff', color: INK, boxShadow: '0 2px 8px rgba(0,0,0,.15)' }}>{NEED_TEXT[need]}</div>}
      <div className={still || reduce ? '' : 'sp-bob'}><PetPic pet={p} size={size} /></div>
      {deco && decoAnim && <motion.div aria-hidden className="pointer-events-none absolute inset-0" initial={false} animate={decoAnim} transition={decoTr}>
        {sleepy ? ZZ.map((z, k) => <span key={k} className="sp-zz absolute font-extrabold" style={{ left: `${62 + k * 12}%`, top: `${-4 - k * 10}%`, fontSize: size * (0.2 + k * 0.06), color: '#7b5cf0', animationDelay: `${k * 0.7}s`, textShadow: '0 1px 0 #fff' }}>{z}</span>)
          : [0, 1, 2, 3].map((k) => <span key={k} className="sp-bub absolute rounded-full" style={{ left: `${10 + k * 24}%`, top: `${40 + (k % 2) * 14}%`, width: size * (0.13 + (k % 3) * 0.04), height: size * (0.13 + (k % 3) * 0.04), background: 'rgba(255,255,255,.9)', border: '2px solid #bfe4ff', animationDelay: `${k * 0.5}s` }} />)}
      </motion.div>}
    </motion.button>);
}

export default function SkyPets() {
  const me = useAuthStore((s) => s.currentUserId) ?? ''; const nav = usePetsNav(); const { show, node } = useToast();
  const [ov, setOv] = useState<Overview | null>(null); const [err, setErr] = useState<string | null>(null); const [tab, setTab] = useState<TabKey>('home'); const [open, setOpen] = useState<string | null>(null);
  const [house, setHouse] = useState<House | null>(null); const [scope, setScope] = useState('me'); const [room, setRoom] = useState('living'); const [decor, setDecor] = useState(false); const [sel, setSel] = useState<InvRow | null>(null);
  const [bubble, setBubble] = useState<{ id: string; text: string } | null>(null); const [quick, setQuick] = useState<Pet | null>(null);
  const loadOv = useCallback(async () => { const r = await sp<Overview>('/overview'); if (r.ok) { setOv(r.data); setErr(null); } else setErr(errText(r.data.error)); }, []);
  const loadHouse = useCallback(async () => { const r = await sp<House>(`/house?scope=${encodeURIComponent(scope)}`); if (r.ok) { setHouse(r.data); setRoom((cur) => (r.data.rooms.includes(cur) ? cur : r.data.rooms[0])); } else if (scope !== 'me') setScope('me'); }, [scope]);
  useReload(loadOv, 12000); useEffect(() => { void loadHouse(); }, [loadHouse]); useEffect(() => { const h = () => void loadHouse(); window.addEventListener('sky:skypets', h); return () => window.removeEventListener('sky:skypets', h); }, [loadHouse]);
  useEffect(() => { if (nav.tab && ['eggs', 'shared', 'home'].includes(nav.tab)) { setTab(nav.tab as TabKey); } else if (nav.peerId) setTab('eggs'); }, [nav.tab, nav.peerId]);
  const reload = useCallback(() => { void loadOv(); void loadHouse(); }, [loadOv, loadHouse]);
  const sharedPets = ov?.pets.filter((p) => p.shared) ?? [];
  const scenePets = useMemo(() => (ov?.pets ?? []).filter((p) => (scope === 'me' ? !p.shared : p.id === scope) && p.room === room), [ov, scope, room]);
  const touch = async (p: Pet) => { setBubble({ id: p.id, text: p.needs[0] ? NEED_TEXT[p.needs[0]] : REACT[Math.floor(Math.random() * REACT.length)] }); window.setTimeout(() => setBubble(null), 2200); setQuick(p); void sp(`/pet/${p.id}/act`, 'POST', { action: 'touch' }); };
  const place = async (x: number, y: number) => { if (!sel) return; const r = await sp<any>('/house/place', 'POST', { scope, itemId: sel.itemId, room, x, y }); if (!r.ok) show(errText(r.data.error), true); else { show('Готово'); void loadOv(); void loadHouse(); } };
  const remove = async (uid: string) => { const r = await sp<any>('/house/remove', 'POST', { scope, uid }); if (!r.ok) show(errText(r.data.error), true); else { show('Предмет в инвентаре'); void loadOv(); void loadHouse(); } };
  const expand = async (it: InvRow) => { const r = await sp<any>('/house/expand', 'POST', { scope, itemId: it.itemId }); if (!r.ok) show(errText(r.data.error), true); else { show('Новая комната открыта'); void loadOv(); void loadHouse(); } };
  const moveTo = async (p: Pet, rm: string) => { const r = await sp<any>(`/pet/${p.id}/room`, 'POST', { room: rm }); if (!r.ok) show(errText(r.data.error), true); else { setQuick(null); setRoom(rm); void loadOv(); } };
  const quickAct = async (p: Pet, action: string, extra: Record<string, unknown> = {}) => { const r = await sp<any>(`/pet/${p.id}/act`, 'POST', { action, ...extra }); if (!r.ok) show(errText(r.data.error), true); else { show(r.data.xp ? `+${r.data.xp} опыта` : 'Готово'); setQuick(null); void loadOv(); } };
  if (!ov) return <div className="sp-root grid h-full place-items-center p-6" style={{ background: GRAD, color: INK }}><style>{CSS}</style>{err ? <div className="text-center"><div className="mb-2 text-[14px] font-bold">{err}</div><Btn onClick={loadOv}>Повторить</Btn></div> : <div className="text-[14px] font-bold">Загружаем питомцев…</div>}</div>;
  const placeable = ov.inventory.filter((r) => ['furniture', 'bed', 'bowl', 'decor', 'toy', 'interior', 'house'].includes(r.item?.kind ?? ''));
  const props = { ov, reload, toast: show, openPet: setOpen, myId: me };
  const foodFor = (p: Pet) => ov.inventory.find((r) => r.item?.kind === 'food' && r.item.effect?.satiety);
  return (
    <div className="sp-root h-full overflow-y-auto" style={{ background: GRAD, color: INK }}>
      <style>{CSS}</style>{node}
      <div className="mx-auto max-w-5xl px-3 pb-24 pt-3">
        <div className="mb-3 flex items-center justify-between gap-2"><div><div className="text-[20px] font-extrabold">Sky Pets</div><div className="text-[12px] opacity-70">Растите питомцев — вместе веселее</div></div><div className="flex items-center gap-2"><Coin n={ov.player.coins} />{ov.pending.gifts + ov.pending.transfers + ov.invites.filter((i) => i.direction === 'in').length > 0 && <Chip color="#e0709a">Ждут ответа: {ov.pending.gifts + ov.pending.transfers + ov.invites.filter((i) => i.direction === 'in').length}</Chip>}</div></div>
        <div className="glass-pill mb-3 flex gap-1 overflow-x-auto p-1" role="tablist" style={{ background: 'rgba(255,255,255,.6)', borderRadius: 999 }}>
          {TABS.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} type="button" onClick={() => { setTab(k); setDecor(false); }} className="relative shrink-0 rounded-full px-3 py-2 text-[12px] font-bold" style={{ color: tab === k ? '#fff' : '#6b4fd8' }}>{tab === k && <motion.span layoutId="sp-lens" className="absolute inset-0 -z-10 rounded-full" style={{ background: 'linear-gradient(180deg,#9a7bff,#7b5cf0)' }} />}{l}</button>)}
        </div>
        {tab === 'home' && (
          <div className="space-y-3">
            {ov.pets.length === 0 && ov.eggs.length > 0 && <Card className="text-center"><div className="text-[14px] font-extrabold">У вас есть яйцо 🥚</div><div className="mt-1 text-[12px] opacity-70">Положите его в инкубатор, погладьте — и дождитесь питомца.</div><div className="mt-2"><Btn onClick={() => setTab('eggs')}>К яйцам</Btn></div></Card>}
            {sharedPets.length > 0 && <div className="flex flex-wrap gap-1.5"><Btn small kind={scope === 'me' ? 'main' : 'soft'} onClick={() => setScope('me')}>Мой дом</Btn>{sharedPets.map((p) => <Btn key={p.id} small kind={scope === p.id ? 'main' : 'soft'} onClick={() => setScope(p.id)}>🤝 Дом «{p.name}»</Btn>)}</div>}
            <div className="grid gap-3 md:grid-cols-[1fr_64px]">
              <div className="relative">
                {house && <Scene house={house} pets={scenePets} room={room} decor={decor} selected={sel} inv={ov.inventory} onPet={(p) => void touch(p)} onTap={place} onRemove={remove} />}
                {bubble && <div className="pointer-events-none absolute inset-x-0 top-6 flex justify-center"><div className="rounded-2xl px-3 py-1.5 text-[13px] font-bold" style={{ background: '#fff', color: INK, boxShadow: '0 4px 16px rgba(0,0,0,.18)' }}>{bubble.text}</div></div>}
                {scenePets.length === 0 && house && <div className="pointer-events-none absolute inset-x-0 bottom-[42%] text-center text-[12px] font-bold opacity-60">В этой комнате никого — выберите питомца и «Привести сюда»</div>}
                {house && <div className="mt-2 flex flex-wrap justify-center gap-1.5">{house.rooms.map((rm) => <button key={rm} type="button" onClick={() => setRoom(rm)} className="rounded-full px-3 py-1.5 text-[12px] font-bold" style={{ background: room === rm ? '#7b5cf0' : 'rgba(255,255,255,.8)', color: room === rm ? '#fff' : '#6b4fd8' }}>{ROOM[rm] ?? rm}</button>)}<button type="button" onClick={() => setTab('city')} className="rounded-full px-3 py-1.5 text-[12px] font-bold" style={{ background: 'rgba(255,176,46,.25)', color: '#8a5a00' }}>Город питомцев →</button></div>}
              </div>
              <div className="flex gap-2 md:flex-col">
                {([['🏪', 'Магазин', () => setTab('shop')], ['🎒', 'Инвентарь', () => setTab('inventory')], ['🎨', decor ? 'Готово' : 'Декор', () => { setDecor(!decor); setSel(null); }], ['🥚', 'Яйца', () => setTab('eggs')], ['🚪', 'Выйти', () => useModuleStore.getState().setActiveModule('messages')]] as const).map(([i, l, f]) => <button key={l} type="button" onClick={f} aria-label={l} className="grid h-14 flex-1 place-items-center rounded-2xl text-[22px] md:flex-none" style={{ background: decor && l === 'Готово' ? '#7b5cf0' : 'rgba(255,255,255,.85)', boxShadow: '0 4px 14px rgba(90,60,190,.15)' }}><span aria-hidden>{i}</span><span className="text-[9px] font-bold" style={{ color: decor && l === 'Готово' ? '#fff' : INK }}>{l}</span></button>)}
              </div>
            </div>
            {decor && <Card><div className="mb-1 text-[12px] font-extrabold">Что поставить ({house?.placed.length ?? 0}/{house?.limit})</div>{placeable.length === 0 ? <div className="text-[12px] opacity-70">Купите мебель и декор в магазине.</div> : <div className="flex flex-wrap gap-2">{placeable.map((r) => <Btn key={r.itemId} small kind={sel?.itemId === r.itemId ? 'main' : 'soft'} onClick={() => (r.item?.kind === 'house' ? expand(r) : setSel(r))}><span className="inline-flex items-center gap-1"><ItemArt item={r.item} size={20} /> {r.item?.name} ×{r.qty}</span></Btn>)}</div>}</Card>}
            {scenePets.length > 0 && !decor && <div className="text-center text-[11px] opacity-60">Нажмите на питомца: он отреагирует, а внизу появятся быстрые действия.</div>}
            {ov.pets.filter((p) => p.needs.length > 0 && !p.sleeping).slice(0, 3).map((p) => <Card key={p.id} onClick={() => setOpen(p.id)} className="flex items-center gap-3"><PetPic pet={p} size={46} /><div className="min-w-0 flex-1"><div className="text-[13px] font-extrabold" translate="no">{p.name}</div><div className="text-[12px]" style={{ color: '#d0507a' }}>{NEED_TEXT[p.needs[0]]}</div></div><Chip color="#e0709a">{MOOD[p.mood]}</Chip></Card>)}
          </div>
        )}
        {tab === 'pets' && <Collection {...props} shared={false} />}
        {tab === 'shared' && (sharedPets.length === 0 && !nav.peerId ? <Empty text="Совместных питомцев пока нет" hint="Откройте «Яйца» → «Растить вместе» или чат с другом." /> : <div className="space-y-3">{nav.peerName && <Card><div className="text-[13px] font-bold">Растим с {nav.peerName}</div></Card>}<Collection {...props} shared /></div>)}
        {tab === 'collection' && <Collection {...props} />}
        {tab === 'eggs' && <Eggs {...props} preset={nav.peerId ? { id: nav.peerId, name: nav.peerName ?? 'Друг' } : null} />}
        {tab === 'shop' && <ShopScreen {...props} />}
        {tab === 'inventory' && <InventoryScreen {...props} />}
        {tab === 'city' && <CityScreen {...props} />}
        {tab === 'friends' && <CityScreen {...props} friendsOnly />}
        {tab === 'tasks' && <TasksScreen {...props} />}
        {tab === 'ach' && <AchievementsScreen {...props} />}
      </div>
      {quick && !open && <div className="fixed inset-x-0 bottom-4 z-[8000] flex justify-center px-3"><div className="flex max-w-full flex-wrap items-center justify-center gap-1.5 rounded-3xl p-2" style={{ background: 'rgba(255,255,255,.95)', boxShadow: '0 10px 30px rgba(60,30,140,.3)' }}>
        <span className="px-2 text-[12px] font-extrabold" translate="no">{quick.name}</span>
        {foodFor(quick) && !quick.sleeping && <Btn small kind="soft" onClick={() => quickAct(quick, 'feed', { itemId: foodFor(quick)!.itemId })}>🍖</Btn>}
        {!quick.sleeping && <><Btn small kind="soft" onClick={() => quickAct(quick, 'play')}>🎾</Btn><Btn small kind="soft" onClick={() => quickAct(quick, 'bathe')}>🛁</Btn><Btn small kind="soft" onClick={() => quickAct(quick, 'sleep')}>😴</Btn></>}
        {quick.sleeping && <Btn small kind="soft" onClick={() => quickAct(quick, 'wake')}>Разбудить</Btn>}
        {house && house.rooms.filter((rm) => rm !== quick.room).slice(0, 3).map((rm) => <Btn key={rm} small kind="ghost" onClick={() => moveTo(quick, rm)}>→ {ROOM[rm]}</Btn>)}
        <Btn small onClick={() => { setOpen(quick.id); setQuick(null); }}>Подробнее</Btn><Btn small kind="ghost" onClick={() => setQuick(null)}>×</Btn></div></div>}
      {open && <PetSheet id={open} inventory={ov.inventory} myId={me} onClose={() => setOpen(null)} onChanged={reload} toast={show} />}
    </div>
  );
}
