import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePeopleSearch } from '@/messenger/usePeopleSearch';
import { sp, errText, RARITY, CATEGORY, ROOM, type Overview, type Pet, type Egg, type Item, type Art } from './api';
import { PetPic, EggSvg, ArtOnly, PetSvg } from './PetArt';
import { Btn, Card, Chip, Empty, Modal, Bar, INK, rid, itemIcon, Coin, useReload } from './ui';

type T = (m: string, bad?: boolean) => void;
type Props = { ov: Overview; reload: () => void; toast: T; openPet: (id: string) => void; myId: string };

const fmt = (s: number | null) => { if (s == null) return ''; const m = Math.floor(s / 60), r = s % 60; return m >= 60 ? `${Math.floor(m / 60)} ч ${m % 60} мин` : m > 0 ? `${m} мин ${r} с` : `${r} с`; };

// ───────────── Люди (поиск) ─────────────
export function PersonPick({ onPick, label = 'Кому' }: { onPick: (p: { id: string; name: string }) => void; label?: string }) {
  const [q, setQ] = useState(''); const { people, loading } = usePeopleSearch(q);
  return <div><input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`${label}: имя или @ник`} className="w-full rounded-2xl px-3 py-2.5 text-[13px] outline-none" style={{ background: '#fff', color: INK }} />
    <div className="mt-1 flex flex-wrap gap-1">{loading && <span className="text-[11px] opacity-60">Ищем…</span>}{people.slice(0, 6).map((p) => <Btn key={p.id} kind="soft" small onClick={() => onPick({ id: p.id, name: p.name })}>{p.name}</Btn>)}</div></div>;
}

// ───────────── Яйца ─────────────
function Odds({ eggId, onClose }: { eggId: string; onClose: () => void }) {
  const [d, setD] = useState<any>(null); useEffect(() => { void sp(`/eggs/${eggId}/odds`).then((r) => setD(r.data)); }, [eggId]);
  return <Modal onClose={onClose} title={d?.egg?.name ?? 'Шансы'}>
    {!d ? <div className="py-6 text-center text-[13px]">Загрузка…</div> : <div className="space-y-1.5"><div className="text-[12px] opacity-70" style={{ color: INK }}>Шансы считает сервер и не меняются от нажатий. Выпадают только опубликованные питомцы.</div>
      {d.drops.map((x: any) => <div key={x.speciesId} className="flex items-center gap-2 rounded-2xl p-2" style={{ background: 'rgba(255,255,255,.75)', color: INK }}><ArtOnly art={x.art} imageId={x.imageId} size={44} /><div className="min-w-0 flex-1"><div className="text-[13px] font-bold">{x.name}</div><Chip color={RARITY[x.rarity]?.color}>{RARITY[x.rarity]?.name}</Chip></div><div className="text-[14px] font-extrabold">{x.percent}%</div></div>)}</div>}
  </Modal>;
}
export function Eggs({ ov, reload, toast, openPet, preset, myId }: Props & { preset?: { id: string; name: string } | null }) {
  const [odds, setOdds] = useState<string | null>(null); const [inv, setInv] = useState<Egg | null>(null); const [partner, setPartner] = useState<{ id: string; name: string } | null>(preset ?? null);
  const [hatching, setHatching] = useState<Egg | null>(null); const [nm, setNm] = useState(''); const [, tick] = useState(0);
  useEffect(() => { const t = window.setInterval(() => tick((x) => x + 1), 1000); return () => window.clearInterval(t); }, []);
  useEffect(() => { if (preset) setPartner(preset); }, [preset]);
  const act = async (e: Egg, a: 'incubate' | 'touch') => { const r = await sp<any>(`/egg/${e.id}/${a}`, 'POST', {}); if (!r.ok) toast(errText(r.data.error), true); else toast(a === 'touch' ? 'Яйцо тёплое 💛' : 'Яйцо в инкубаторе'); reload(); };
  const hatch = async () => { if (!hatching) return; const r = await sp<any>(`/egg/${hatching.id}/hatch`, 'POST', { name: nm.trim() || undefined }); if (!r.ok) { toast(errText(r.data.error), true); return; } setHatching(null); setNm(''); reload(); toast(`Вылупился: ${r.data.pet.name}!`); openPet(r.data.pet.id); };
  const send = async (egg: Egg) => { if (!partner) return; const r = await sp<any>('/invite', 'POST', { toId: partner.id, eggId: egg.id }); if (!r.ok) toast(errText(r.data.error), true); else { toast('Приглашение отправлено'); setInv(null); setPartner(null); reload(); } };
  const answer = async (id: string, accept: boolean | 'cancel') => { const r = await sp<any>(`/invite/${id}/respond`, 'POST', accept === 'cancel' ? { cancel: true } : { accept }); if (!r.ok) toast(errText(r.data.error), true); else toast(accept === true ? 'Приняли! Яйцо теперь общее' : 'Готово'); reload(); };
  return (
    <div className="space-y-3">
      {ov.invites.length > 0 && <Card><div className="mb-1 text-[13px] font-extrabold">Приглашения растить вместе</div>{ov.invites.map((i) => <div key={i.id} className="flex items-center justify-between gap-2 py-1.5"><div className="text-[12px] font-semibold"><span translate="no">{i.direction === 'in' ? i.from.name : i.to.name}</span> · {i.egg.name}<div className="opacity-60">{i.direction === 'in' ? 'зовёт вас' : 'ждём ответа'}</div></div>{i.direction === 'in' ? <div className="flex gap-1"><Btn small onClick={() => answer(i.id, true)}>Принять</Btn><Btn small kind="soft" onClick={() => answer(i.id, false)}>Нет</Btn></div> : <Btn small kind="soft" onClick={() => answer(i.id, 'cancel')}>Отозвать</Btn>}</div>)}</Card>}
      {ov.eggs.length === 0 && <Empty text="Яиц пока нет" hint="Купите яйцо в магазине или получите за задания." />}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {ov.eggs.map((e) => { const incub = e.state === 'incubating'; const ready = incub && e.ready; return (
          <Card key={e.id} className="text-center">
            <div className="flex justify-center"><EggSvg art={e.art} size={76} wobble={ready} crack={ready ? 2 : incub ? 1 : 0} /></div>
            <div className="mt-1 text-[13px] font-extrabold">{e.name}</div>
            <div className="flex flex-wrap justify-center gap-1"><Chip color={RARITY[e.rarity]?.color}>{RARITY[e.rarity]?.name}</Chip>{e.partnerId && <Chip color="#2fa36b">Общее</Chip>}</div>
            {incub && <div className="mt-1 text-[11px] font-semibold">{ready ? 'Готово к вылуплению' : `До вылупления: ${fmt(Math.max(0, Math.ceil((new Date(e.readyAt ?? 0).getTime() - Date.now()) / 1000)))}`} · касаний {e.touches}/{e.needTouches}</div>}
            <div className="mt-2 flex flex-wrap justify-center gap-1.5">
              {e.state === 'unhatched' && <Btn small onClick={() => act(e, 'incubate')}>В инкубатор</Btn>}
              {incub && <Btn small kind="soft" onClick={() => act(e, 'touch')}>Погладить</Btn>}
              {incub && <Btn small kind="gold" disabled={!ready || e.touches < e.needTouches} onClick={() => setHatching(e)}>Вылупить</Btn>}
              <Btn small kind="ghost" onClick={() => setOdds(e.eggId)}>Шансы</Btn>
              {!e.partnerId && e.ownerId === myId && ['unhatched', 'incubating'].includes(e.state) && <Btn small kind="soft" onClick={() => setInv(e)}>Растить вместе</Btn>}
            </div>
          </Card>); })}
      </div>
      {odds && <Odds eggId={odds} onClose={() => setOdds(null)} />}
      {inv && <Modal onClose={() => setInv(null)} title="Завести питомца вместе"><div className="space-y-2 text-[13px]" style={{ color: INK }}><div>Выберите партнёра: после принятия яйцо станет общим, а питомец — с равными правами у обоих.</div>
        {partner ? <div className="flex items-center justify-between rounded-2xl p-2" style={{ background: '#fff' }}><b translate="no">{partner.name}</b><Btn small kind="ghost" onClick={() => setPartner(null)}>Другой</Btn></div> : <PersonPick label="Партнёр" onPick={setPartner} />}
        <div className="flex justify-end"><Btn disabled={!partner} onClick={() => send(inv)}>Отправить приглашение</Btn></div></div></Modal>}
      {hatching && <Modal onClose={() => setHatching(null)} title="Вылупление!"><div className="flex flex-col items-center gap-3"><EggSvg art={hatching.art} size={110} wobble crack={3} /><input value={nm} onChange={(e) => setNm(e.target.value)} maxLength={20} placeholder="Имя питомца (можно позже)" className="w-full rounded-2xl px-4 py-3 text-[14px] outline-none" style={{ background: '#fff', color: INK }} translate="no" /><Btn kind="gold" onClick={hatch}>Вылупить 🐣</Btn></div></Modal>}
    </div>
  );
}

// ───────────── Магазин ─────────────
type Shop = { coins: number; season: string; eggs: any[]; items: any[]; skins: any[]; pets: any[] };
const SHOP_TABS = [['eggs', 'Яйца'], ['pets', 'Питомцы'], ['food', 'Корм'], ['toys', 'Игрушки'], ['wear', 'Одежда и аксессуары'], ['skins', 'Скины'], ['home', 'Мебель и интерьеры'], ['set', 'Расширения дома'], ['season', 'Сезонные']] as const;
export function ShopScreen({ ov, reload, toast }: Props) {
  const [s, setS] = useState<Shop | null>(null); const [tab, setTab] = useState<string>('eggs'); const [odds, setOdds] = useState<string | null>(null); const load = useCallback(async () => { const r = await sp<Shop>('/shop'); if (r.ok) setS(r.data); }, []); useEffect(() => { void load(); }, [load]);
  const buy = async (kind: string, id: string, currency: 'coins' | 'points', qty = 1) => { const r = await sp<any>('/shop/buy', 'POST', { kind, id, currency, qty, idemKey: rid() }); if (!r.ok) { toast(errText(r.data.error), true); return; } toast(r.data.spentPoints ? `Куплено за ${r.data.spentPoints} баллов` : `Куплено за ${r.data.spentCoins} монет`); await load(); reload(); };
  const list = useMemo(() => {
    if (!s) return [] as any[]; const it = (kinds: string[]) => s.items.filter((i) => kinds.includes(i.kind)).map((i) => ({ k: 'item', ...i }));
    switch (tab) {
      case 'eggs': return s.eggs.map((e) => ({ k: 'egg', ...e })); case 'pets': return s.pets.map((p) => ({ k: 'species', price_coins: p.cost_coins, price_points: 0, ...p }));
      case 'food': return it(['food']); case 'toys': return it(['toy']); case 'wear': return it(['accessory', 'clothes']); case 'skins': return s.skins.map((x) => ({ k: 'skin', ...x }));
      case 'home': return it(['furniture', 'interior', 'decor', 'bed', 'bowl']); case 'set': return it(['house']);
      default: return [...s.eggs.filter((e) => e.season).map((e) => ({ k: 'egg', ...e })), ...s.items.filter((i) => i.season).map((i) => ({ k: 'item', ...i })), ...s.pets.filter((p) => p.season).map((p) => ({ k: 'species', price_coins: p.cost_coins, price_points: 0, ...p }))];
    }
  }, [s, tab]);
  if (!s) return <Empty text="Загрузка магазина…" />;
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between"><div className="text-[12px] font-semibold opacity-70" style={{ color: INK }}>Монеты — игровые, баллы — Sky Prime Points</div><Coin n={s.coins} /></div>
      <div className="flex gap-1.5 overflow-x-auto pb-1">{SHOP_TABS.map(([k, l]) => <button key={k} type="button" onClick={() => setTab(k)} className="shrink-0 rounded-full px-3 py-1.5 text-[12px] font-bold" style={{ background: tab === k ? '#7b5cf0' : 'rgba(122,92,240,.12)', color: tab === k ? '#fff' : '#6b4fd8' }}>{l}</button>)}</div>
      {list.length === 0 ? <Empty text="Здесь пока пусто" /> : <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{list.map((x) => (
        <Card key={`${x.k}${x.id}`} className="flex flex-col items-center text-center">
          <div className="grid h-[88px] place-items-center">{x.k === 'egg' ? <EggSvg art={x.art} size={64} /> : x.k === 'item' ? <span className="text-[44px]" aria-hidden>{itemIcon(x)}</span> : <ArtOnly art={x.art} imageId={x.image_id} view={x.view} size={84} />}</div>
          <div className="mt-1 text-[13px] font-extrabold" translate="no">{x.name}</div><div className="mt-0.5 flex flex-wrap justify-center gap-1"><Chip color={RARITY[x.rarity]?.color}>{RARITY[x.rarity]?.name}</Chip>{x.season && <Chip color="#2fa36b">сезон</Chip>}{x.owned && <Chip color="#2fa36b">куплено</Chip>}</div>
          {x.description && <div className="mt-1 text-[11px] opacity-70">{x.description}</div>}
          <div className="mt-2 flex flex-wrap justify-center gap-1.5">
            {x.k === 'egg' && <Btn small kind="ghost" onClick={() => setOdds(x.id)}>Шансы</Btn>}
            {(x.price_coins ?? 0) > 0 && !x.owned && <Btn small onClick={() => buy(x.k, x.id, 'coins')}>● {x.price_coins}</Btn>}
            {(x.price_points ?? 0) > 0 && !x.owned && <Btn small kind="gold" onClick={() => buy(x.k, x.id, 'points')}>★ {x.price_points}</Btn>}
          </div>
        </Card>))}</div>}
      {odds && <Odds eggId={odds} onClose={() => setOdds(null)} />}
    </div>
  );
}

// ───────────── Инвентарь и подарки ─────────────
export function InventoryScreen({ ov, reload, toast }: Props) {
  const [g, setG] = useState<{ gifts: any[] } | null>(null); const [send, setSend] = useState<{ kind: 'item' | 'egg'; id: string; name: string; max: number } | null>(null); const [to, setTo] = useState<{ id: string; name: string } | null>(null); const [qty, setQty] = useState(1); const [msg, setMsg] = useState('');
  const load = useCallback(async () => { const r = await sp<{ gifts: any[] }>('/gifts'); if (r.ok) setG(r.data); }, []); useEffect(() => { void load(); }, [load]);
  const answer = async (id: string, how: string) => { const r = await sp<any>(`/gifts/${id}/answer`, 'POST', { how }); if (!r.ok) toast(errText(r.data.error), true); else toast(how === 'accept' ? 'Подарок принят' : 'Готово'); await load(); reload(); };
  const doSend = async () => { if (!send || !to) return; const r = await sp<any>('/gifts', 'POST', { toId: to.id, kind: send.kind, refId: send.id, qty, message: msg }); if (!r.ok) toast(errText(r.data.error), true); else { toast('Подарок отправлен'); setSend(null); setTo(null); setMsg(''); setQty(1); await load(); reload(); } };
  const groups = useMemo(() => { const m: Record<string, typeof ov.inventory> = {}; for (const r of ov.inventory) (m[r.item?.kind ?? 'x'] ||= []).push(r); return m; }, [ov.inventory]);
  const KIND: Record<string, string> = { food: 'Корм и лекарства', toy: 'Игрушки', accessory: 'Аксессуары', clothes: 'Одежда', furniture: 'Мебель', interior: 'Интерьеры', decor: 'Декор', house: 'Расширения', bed: 'Кровати', bowl: 'Миски' };
  return (
    <div className="space-y-3">
      {(g?.gifts ?? []).filter((x) => x.direction === 'in').length > 0 && <Card><div className="mb-1 text-[13px] font-extrabold">Вам прислали подарки</div>{g!.gifts.filter((x) => x.direction === 'in').map((x) => <div key={x.id} className="flex items-center justify-between gap-2 py-1"><div className="text-[12px] font-semibold"><span translate="no">{x.from?.name}</span>: {x.name} ×{x.qty}{x.message && <div className="opacity-60" translate="no">«{x.message}»</div>}</div><div className="flex gap-1"><Btn small onClick={() => answer(x.id, 'accept')}>Принять</Btn><Btn small kind="soft" onClick={() => answer(x.id, 'decline')}>Нет</Btn></div></div>)}</Card>}
      {Object.keys(groups).length === 0 && <Empty text="Инвентарь пуст" hint="Предметы появятся после покупок, заданий и наград." />}
      {Object.entries(groups).map(([k, rows]) => <div key={k}><div className="mb-1 text-[12px] font-extrabold opacity-70" style={{ color: INK }}>{KIND[k] ?? k}</div><div className="grid grid-cols-3 gap-2 sm:grid-cols-5">{rows.map((r) => <Card key={r.itemId} className="text-center" onClick={() => setSend({ kind: 'item', id: r.itemId, name: r.item?.name ?? '', max: r.qty })}><div className="text-[30px]" aria-hidden>{itemIcon(r.item)}</div><div className="text-[11px] font-bold">{r.item?.name}</div><div className="text-[11px] opacity-70">×{r.qty}</div></Card>)}</div></div>)}
      <div className="text-[11px] opacity-60" style={{ color: INK }}>Нажмите на предмет, чтобы подарить его другу.</div>
      {send && <Modal onClose={() => setSend(null)} title={`Подарить: ${send.name}`}><div className="space-y-2" style={{ color: INK }}>
        {to ? <div className="flex items-center justify-between rounded-2xl p-2" style={{ background: '#fff' }}><b translate="no">{to.name}</b><Btn small kind="ghost" onClick={() => setTo(null)}>Другой</Btn></div> : <PersonPick onPick={setTo} />}
        <div className="flex items-center gap-2 text-[13px]">Количество <input type="number" min={1} max={send.max} value={qty} onChange={(e) => setQty(Math.max(1, Math.min(send.max, Number(e.target.value) || 1)))} className="w-20 rounded-xl px-2 py-1.5 outline-none" style={{ background: '#fff' }} /> из {send.max}</div>
        <input value={msg} onChange={(e) => setMsg(e.target.value)} maxLength={120} placeholder="Записка (необязательно)" className="w-full rounded-2xl px-3 py-2 text-[13px] outline-none" style={{ background: '#fff' }} translate="no" />
        <div className="flex justify-end"><Btn disabled={!to} onClick={doSend}>Подарить</Btn></div></div></Modal>}
      {ov.eggs.some((e) => e.state === 'unhatched' && !e.partnerId) && <Card><div className="mb-1 text-[13px] font-extrabold">Подарить яйцо</div><div className="flex flex-wrap gap-2">{ov.eggs.filter((e) => e.state === 'unhatched' && !e.partnerId).map((e) => <Btn key={e.id} small kind="soft" onClick={() => setSend({ kind: 'egg', id: e.id, name: e.name, max: 1 })}>🥚 {e.name}</Btn>)}</div></Card>}
    </div>
  );
}

// ───────────── Задания, события, достижения ─────────────
export function TasksScreen({ ov, reload, toast }: Props) {
  const [t, setT] = useState<any[]>([]); const [ev, setEv] = useState<any[]>([]);
  const load = useCallback(async () => { const [a, b] = await Promise.all([sp<any>('/tasks'), sp<any>('/events')]); if (a.ok) setT(a.data.tasks); if (b.ok) setEv(b.data.events); }, []); useReload(load, 20000);
  const claim = async (path: string) => { const r = await sp<any>(path, 'POST', {}); if (!r.ok) toast(errText(r.data.error), true); else toast('Награда получена'); await load(); reload(); };
  const daily = async () => { const r = await sp<any>('/daily', 'POST', {}); if (!r.ok) toast(errText(r.data.error), true); else toast('+30 монет'); reload(); };
  const rw = (r: any) => [r?.coins ? `${r.coins} монет` : '', ...Object.keys(r?.items ?? {}).map(() => 'предмет'), ...Object.keys(r?.eggs ?? {}).map(() => 'яйцо')].filter(Boolean).join(' · ');
  const KIND: Record<string, string> = { daily: 'Ежедневные', weekly: 'Недельные', joint: 'Совместные', seasonal: 'Сезонные', holiday: 'Праздничные', event: 'События' };
  return (
    <div className="space-y-3">
      <Card className="flex items-center justify-between"><div><div className="text-[14px] font-extrabold">Ежедневный подарок</div><div className="text-[12px] opacity-70">30 монет раз в сутки</div></div><Btn kind="gold" disabled={!ov.player.dailyAvailable} onClick={daily}>{ov.player.dailyAvailable ? 'Забрать' : 'Уже получено'}</Btn></Card>
      {ev.map((e) => <Card key={e.id}><div className="flex items-start justify-between gap-2"><div><div className="text-[14px] font-extrabold" translate="no">🏆 {e.title}</div><div className="text-[12px] opacity-70" translate="no">{e.description}</div><div className="mt-0.5 text-[11px] opacity-60">{e.ended ? 'Завершено' : e.started ? `до ${new Date(e.endsAt).toLocaleDateString('ru-RU')}` : `старт ${new Date(e.startsAt).toLocaleDateString('ru-RU')}`} · ваши очки: {e.myScore}</div></div>
        {e.ended && e.myScore > 0 && !e.claimed && <Btn small kind="gold" onClick={() => claim(`/events/${e.id}/claim`)}>Награда</Btn>}{e.claimed && <Chip color="#2fa36b">Получено</Chip>}</div>
        {e.board.length > 0 && <div className="mt-1 space-y-0.5">{e.board.slice(0, 5).map((b: any) => <div key={b.rank} className="flex justify-between text-[12px]" style={{ fontWeight: b.me ? 800 : 500 }}><span translate="no">{b.rank}. {b.name}</span><span>{b.score}</span></div>)}</div>}</Card>)}
      {Object.entries(KIND).map(([k, label]) => { const list = t.filter((x) => x.kind === k); if (!list.length) return null; return <div key={k}><div className="mb-1 text-[12px] font-extrabold opacity-70" style={{ color: INK }}>{label}</div><div className="space-y-2">{list.map((x) => <Card key={x.id}><div className="flex items-center justify-between gap-2"><div className="min-w-0"><div className="text-[13px] font-bold" translate="no">{x.title}</div><div className="text-[11px] opacity-70">Награда: {rw(x.reward) || '—'}</div></div>{x.claimed ? <Chip color="#2fa36b">Получено</Chip> : <Btn small kind={x.ready ? 'gold' : 'soft'} disabled={!x.ready} onClick={() => claim(`/tasks/${x.id}/claim`)}>Забрать</Btn>}</div><div className="mt-1.5"><Bar v={x.progress} max={x.target} color="#9a7bff" label={`${x.progress}/${x.target}`} /></div></Card>)}</div></div>; })}
    </div>
  );
}
export function AchievementsScreen({ reload, toast }: Props) {
  const [a, setA] = useState<any[]>([]); const load = useCallback(async () => { const r = await sp<any>('/achievements'); if (r.ok) setA(r.data.achievements); }, []); useReload(load, 30000);
  const claim = async (x: any) => { const r = await sp<any>('/achievements/claim', 'POST', { key: x.key, petId: x.petId }); if (!r.ok) toast(errText(r.data.error), true); else toast('Награда получена'); await load(); reload(); };
  if (!a.length) return <Empty text="Достижений пока нет" hint="Растите питомцев — первые награды совсем рядом." />;
  return <div className="space-y-2">{a.map((x) => <Card key={`${x.key}${x.petId ?? ''}`}><div className="flex items-center justify-between gap-2"><div className="min-w-0"><div className="text-[13px] font-extrabold">{x.shared && '🤝 '}{x.title}</div>{x.petName && <div className="text-[11px] opacity-70" translate="no">{x.petName}</div>}</div>{x.claimed ? <Chip color="#2fa36b">Получено</Chip> : <Btn small kind={x.ready ? 'gold' : 'soft'} disabled={!x.ready} onClick={() => claim(x)}>Забрать</Btn>}</div><div className="mt-1.5"><Bar v={x.progress} max={x.target} color="#ffb02e" label={`${x.progress}/${x.target}`} /></div></Card>)}</div>;
}

// ───────────── Коллекция и списки питомцев ─────────────
export function PetCard({ p, onClick }: { p: Pet; onClick: () => void }) {
  const rar = RARITY[p.species?.rarity ?? 'common'];
  return <Card onClick={onClick} className="text-center"><div className="relative flex justify-center"><div className={p.sleeping ? '' : 'sp-bob'}><PetPic pet={p} size={92} /></div><span className="absolute left-0 top-0 rounded-full px-2 py-0.5 text-[11px] font-extrabold" style={{ background: '#7b5cf0', color: '#fff' }}>{p.level}</span>{p.favorite && <span className="absolute right-0 top-0 text-[14px]">★</span>}</div>
    <div className="mt-1 truncate text-[13px] font-extrabold" translate="no">{p.name}</div><div className="flex flex-wrap justify-center gap-1"><Chip color={rar.color}>{rar.name}</Chip>{p.shared && <Chip color="#2fa36b">общий</Chip>}</div></Card>;
}
export function Collection({ ov, openPet, shared }: Props & { shared?: boolean }) {
  const [q, setQ] = useState(''); const [rar, setRar] = useState('all'); const [sort, setSort] = useState('level'); const [fav, setFav] = useState(false);
  const base = shared === undefined ? ov.pets : ov.pets.filter((p) => p.shared === shared);
  const list = useMemo(() => base.filter((p) => (rar === 'all' || p.species?.rarity === rar) && (!fav || p.favorite) && (!q || p.name.toLowerCase().includes(q.toLowerCase()) || (p.species?.name ?? '').toLowerCase().includes(q.toLowerCase()))).sort((a, b) => (sort === 'level' ? b.level - a.level : sort === 'name' ? a.name.localeCompare(b.name) : +new Date(b.bornAt) - +new Date(a.bornAt))), [base, q, rar, sort, fav]);
  const cats = useMemo(() => { const m: Record<string, number> = {}; for (const p of ov.pets) { const c = p.species?.category ?? 'x'; m[c] = (m[c] ?? 0) + 1; } return m; }, [ov.pets]);
  const unopened = ov.eggs.filter((e) => e.state === 'unhatched').length;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4"><Card className="text-center"><div className="text-[20px] font-extrabold">{ov.pets.length}</div><div className="text-[11px] opacity-70">питомцев</div></Card><Card className="text-center"><div className="text-[20px] font-extrabold">{new Set(ov.pets.map((p) => p.speciesId)).size}</div><div className="text-[11px] opacity-70">видов</div></Card><Card className="text-center"><div className="text-[20px] font-extrabold">{ov.pets.filter((p) => p.shared).length}</div><div className="text-[11px] opacity-70">совместных</div></Card><Card className="text-center"><div className="text-[20px] font-extrabold">{unopened}</div><div className="text-[11px] opacity-70">нераспечатанных яиц</div></Card></div>
      {shared === undefined && Object.keys(cats).length > 0 && <div className="flex flex-wrap gap-1">{Object.entries(cats).map(([c, n]) => <Chip key={c}>{CATEGORY[c] ?? c}: {n}</Chip>)}</div>}
      <div className="flex flex-wrap items-center gap-2"><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск по имени" className="min-w-0 flex-1 rounded-2xl px-3 py-2 text-[13px] outline-none" style={{ background: '#fff', color: INK }} />
        <select value={rar} onChange={(e) => setRar(e.target.value)} className="rounded-2xl px-2 py-2 text-[12px]" style={{ background: '#fff', color: INK }}><option value="all">Любая редкость</option>{Object.entries(RARITY).map(([k, v]) => <option key={k} value={k}>{v.name}</option>)}</select>
        <select value={sort} onChange={(e) => setSort(e.target.value)} className="rounded-2xl px-2 py-2 text-[12px]" style={{ background: '#fff', color: INK }}><option value="level">По уровню</option><option value="name">По имени</option><option value="new">Сначала новые</option></select>
        <Btn small kind={fav ? 'main' : 'soft'} onClick={() => setFav(!fav)}>★ Избранные</Btn></div>
      {list.length === 0 ? <Empty text={shared ? 'Совместных питомцев пока нет' : 'Здесь пока никого'} hint={shared ? 'Откройте «Яйца» → «Растить вместе» и позовите друга.' : 'Вылупите яйцо — и питомец появится.'} /> : <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{list.map((p) => <PetCard key={p.id} p={p} onClick={() => openPet(p.id)} />)}</div>}
    </div>
  );
}

// ───────────── Город питомцев и друзья ─────────────
export function CityScreen({ ov, reload, toast, openPet, friendsOnly }: Props & { friendsOnly?: boolean }) {
  const [q, setQ] = useState(''); const [list, setList] = useState<any[] | null>(null); const [visit, setVisit] = useState<string | null>(null);
  useEffect(() => { let on = true; const t = setTimeout(async () => { const r = await sp<any>(`/city?q=${encodeURIComponent(q.trim())}`); if (on) setList(r.ok ? r.data.players : []); }, 250); return () => { on = false; clearTimeout(t); }; }, [q]);
  const shown = (list ?? []).filter((p) => !friendsOnly || p.friend);
  const setPol = async (visitPolicy: string) => { const r = await sp<any>('/settings', 'POST', { visitPolicy }); if (!r.ok) toast(errText(r.data.error), true); else toast('Сохранено'); reload(); };
  const setNotif = async (notify: string) => { const r = await sp<any>('/settings', 'POST', { notify }); if (!r.ok) toast(errText(r.data.error), true); else toast('Сохранено'); reload(); };
  return (
    <div className="space-y-3">
      <Card><div className="grid gap-2 sm:grid-cols-2"><label className="text-[12px] font-bold">Кто может заходить в мой дом<select value={ov.player.visitPolicy} onChange={(e) => setPol(e.target.value)} className="mt-1 w-full rounded-xl px-2 py-2 text-[13px]" style={{ background: '#fff' }}><option value="all">Все</option><option value="friends">Только друзья</option><option value="none">Никто</option></select></label>
        <label className="text-[12px] font-bold">Уведомления Sky Pets<select value={ov.player.notify} onChange={(e) => setNotif(e.target.value)} className="mt-1 w-full rounded-xl px-2 py-2 text-[13px]" style={{ background: '#fff' }}><option value="all">Все</option><option value="important">Только важные</option><option value="off">Выключены</option></select></label></div></Card>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Найти дом по имени или @нику" className="w-full rounded-2xl px-4 py-3 text-[13px] outline-none" style={{ background: '#fff', color: INK }} />
      {list === null ? <Empty text="Загрузка…" /> : shown.length === 0 ? <Empty text={friendsOnly ? 'У друзей пока нет открытых домов' : 'Открытых домов пока нет'} hint="Хозяин сам решает, кто может зайти." /> : <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{shown.map((p) => <Card key={p.id} onClick={() => setVisit(p.id)} className="text-center"><div className="flex justify-center">{p.top ? <ArtOnly art={p.top.art} imageId={p.top.image_id} size={72} /> : <PetSvg art={{ shape: 'blob' }} size={72} />}</div><div className="mt-1 truncate text-[13px] font-extrabold" translate="no">{p.name}</div><div className="text-[11px] opacity-70">питомцев: {p.pets}{p.friend ? ' · друг' : ''}</div></Card>)}</div>}
      {visit && <Visit id={visit} ov={ov} onClose={() => setVisit(null)} toast={toast} reload={reload} openPet={openPet} />}
    </div>
  );
}
function Visit({ id, ov, onClose, toast, reload }: { id: string; ov: Overview; onClose: () => void; toast: T; reload: () => void; openPet: (id: string) => void }) {
  const [d, setD] = useState<any>(null); const [mine, setMine] = useState<string>(''); const load = useCallback(async () => { const r = await sp<any>(`/city/${id}`); if (!r.ok) { toast(errText(r.data.error), true); onClose(); } else setD(r.data); }, [id, toast, onClose]); useEffect(() => { void load(); }, [load]);
  const personal = ov.pets.filter((p) => !p.shared);
  const react = async (kind: string) => { const r = await sp<any>(`/city/${id}/react`, 'POST', { kind }); if (!r.ok) toast(errText(r.data.error), true); else toast('Хозяин увидит вашу реакцию'); await load(); };
  const play = async (their: string) => { const my = mine || personal[0]?.id; if (!my) { toast('Нужен свой питомец (не совместный)', true); return; } const r = await sp<any>(`/city/${id}/play`, 'POST', { myPetId: my, theirPetId: their }); if (!r.ok) toast(errText(r.data.error), true); else { toast('Питомцы подружились! +5 опыта обоим'); reload(); await load(); } };
  return <Modal onClose={onClose} title={d ? `Дом: ${d.owner?.name ?? ''}` : 'Дом'} wide>{!d ? <Empty text="Загрузка…" /> : <div className="space-y-3">
    <div className="text-[12px] opacity-70" style={{ color: INK }}>Коллекция: {d.collection.pets} питомцев, {d.collection.species} видов</div>
    <div className="flex flex-wrap gap-1.5">{[['heart', '❤️'], ['wave', '👋'], ['clap', '👏'], ['star', '⭐'], ['cake', '🍰']].map(([k, e]) => <Btn key={k} kind="soft" small onClick={() => react(k)}>{e} {d.reactions[k] ?? 0}</Btn>)}</div>
    {personal.length > 1 && <label className="block text-[12px] font-bold" style={{ color: INK }}>Мой питомец для игры<select value={mine || personal[0].id} onChange={(e) => setMine(e.target.value)} className="ml-2 rounded-xl px-2 py-1" style={{ background: '#fff' }}>{personal.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>}
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{d.pets.map((p: Pet) => <Card key={p.id} className="text-center"><div className="flex justify-center"><PetPic pet={p} size={84} /></div><div className="text-[13px] font-extrabold" translate="no">{p.name}</div><div className="text-[11px] opacity-70">{p.species?.name} · ур. {p.level}</div>{!d.self && !p.shared && <div className="mt-1"><Btn small kind="soft" onClick={() => play(p.id)}>Поиграть вместе</Btn></div>}</Card>)}</div></div>}</Modal>;
}
