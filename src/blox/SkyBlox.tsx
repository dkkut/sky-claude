/**
 * Sky Blox — игровая платформа Sky: каталог игр, библиотека игрока,
 * кабинет разработчика. Видимость игр, цены и деньги решает сервер.
 */
import { useCallback, useEffect, useState } from 'react';
import { Gamepad2, Heart, History, Library, Loader2, Search, ShoppingBag, SlidersHorizontal, Sparkles, TrendingUp, Wrench, X } from 'lucide-react';
import { Alert, C, Empty, GameCard, Spinner, errText, fmtDt, glass, inputStyle } from './ui';
import {
  apiCatalog, apiEntitlements, apiFavorite, apiFavorites, apiHistory, apiHome, apiMe, apiPurchases, ensureBloxMedia,
  CATEGORY_LABEL, type Game, type Place, type Purchase,
} from './bloxApi';
import { GamePage } from './GamePage';
import { PlayerScreen } from './Player';
import { DevCabinet } from './DevCabinet';

type Tab = 'catalog' | 'library' | 'dev';
const SORTS: [string, string][] = [['new', 'Новые'], ['popular', 'Популярные'], ['rating', 'По рейтингу'], ['recommended', 'Рекомендуемые']];

const Row = ({ title, icon: Icon, items, onOpen, onFav }: { title: string; icon: typeof Sparkles; items: Game[]; onOpen: (id: string) => void; onFav: (g: Game) => void }) => {
  if (items.length === 0) return null;
  return (
    <section className="space-y-2">
      <p className="flex items-center gap-1.5 px-1 text-[13px] font-bold" style={{ color: C.t1 }}><Icon size={14} style={{ color: C.acc }} /> {title}</p>
      <div className="flex gap-3 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
        {items.map((g) => <div key={g.id} className="w-44 shrink-0"><GameCard game={g} onOpen={() => onOpen(g.id)} onFavorite={() => onFav(g)} /></div>)}
      </div>
    </section>
  );
};

const CatalogView = ({ onOpen }: { onOpen: (id: string) => void }) => {
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [sort, setSort] = useState('new');
  const [filters, setFilters] = useState(false);
  const [items, setItems] = useState<Game[] | null>(null);
  const [home, setHome] = useState<{ popular: Game[]; new: Game[]; recommended: Game[] } | null>(null);
  const [err, setErr] = useState('');
  const searching = q.trim() !== '' || category !== '' || sort !== 'new';

  const loadHome = useCallback(async () => { const r = await apiHome(); if (r.ok) setHome(r.data); else setErr(errText(r)); }, []);
  useEffect(() => { void loadHome(); }, [loadHome]);
  useEffect(() => {
    if (!searching) { setItems(null); return; }
    const t = setTimeout(async () => {
      const r = await apiCatalog({ q: q.trim() || undefined, category: category || undefined, sort });
      if (r.ok) { setItems(r.data.items); setErr(''); } else setErr(errText(r));
    }, 250);
    return () => clearTimeout(t);
  }, [q, category, sort, searching]);

  const fav = async (g: Game) => {
    const r = await apiFavorite(g.id, !g.favorite);
    if (!r.ok) return;
    const flip = (x: Game) => (x.id === g.id ? { ...x, favorite: !g.favorite } : x);
    setItems((v) => v?.map(flip) ?? v);
    setHome((h) => (h ? { popular: h.popular.map(flip), new: h.new.map(flip), recommended: h.recommended.map(flip) } : h));
  };

  const empty = home && home.popular.length === 0 && home.new.length === 0;
  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center gap-2">
        <div className="flex flex-1 items-center gap-2 rounded-2xl px-3 py-2.5" style={glass}>
          <Search size={15} style={{ color: C.t3 }} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Найти игру" aria-label="Поиск игр" className="flex-1 bg-transparent text-[13px] outline-none" style={{ color: C.t1 }} />
          {q && <button type="button" aria-label="Очистить" onClick={() => setQ('')}><X size={14} style={{ color: C.t3 }} /></button>}
        </div>
        <button type="button" aria-label="Фильтры" onClick={() => setFilters((v) => !v)} className="grid h-11 w-11 place-items-center rounded-2xl" style={{ ...glass, color: filters ? C.acc : C.t3 }}><SlidersHorizontal size={16} /></button>
      </div>
      {filters && (
        <div className="space-y-2">
          <div className="flex gap-1 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
            {SORTS.map(([k, l]) => <button key={k} type="button" onClick={() => setSort(k)} className="shrink-0 rounded-xl px-3 py-1.5 text-[11px] font-semibold" style={{ background: sort === k ? C.accBg : C.l2, color: sort === k ? C.acc : C.t3 }}>{l}</button>)}
          </div>
          <div className="flex gap-1 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
            {([['', 'Все']] as [string, string][]).concat(Object.entries(CATEGORY_LABEL)).map(([k, l]) => <button key={k || 'all'} type="button" onClick={() => setCategory(k)} className="shrink-0 rounded-xl px-3 py-1.5 text-[11px] font-semibold" style={{ background: category === k ? C.accBg : C.l2, color: category === k ? C.acc : C.t3 }}>{l}</button>)}
          </div>
        </div>
      )}
      {err && <Alert text={err} />}

      {searching ? (
        items === null ? <Spinner /> : items.length === 0 ? <Empty title="Ничего не нашлось" hint="Попробуйте другой запрос или категорию" Icon={Gamepad2} />
          : <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{items.map((g) => <GameCard key={g.id} game={g} onOpen={() => onOpen(g.id)} onFavorite={() => void fav(g)} />)}</div>
      ) : !home ? <Spinner /> : empty ? <Empty title="Игр пока нет" hint="Первые игры появятся после проверки модераторами" Icon={Gamepad2} /> : (
        <>
          <Row title="Популярные" icon={TrendingUp} items={home.popular} onOpen={onOpen} onFav={(g) => void fav(g)} />
          <Row title="Новые" icon={Sparkles} items={home.new} onOpen={onOpen} onFav={(g) => void fav(g)} />
          <Row title="Рекомендуем вам" icon={Heart} items={home.recommended} onOpen={onOpen} onFav={(g) => void fav(g)} />
        </>
      )}
    </div>
  );
};

const LibraryView = ({ onOpen }: { onOpen: (id: string) => void }) => {
  const [sub, setSub] = useState<'fav' | 'hist' | 'items' | 'buys'>('fav');
  const [fav, setFav] = useState<Game[] | null>(null);
  const [hist, setHist] = useState<Game[] | null>(null);
  const [ents, setEnts] = useState<Awaited<ReturnType<typeof apiEntitlements>> | null>(null);
  const [buys, setBuys] = useState<Purchase[] | null>(null);
  const [me, setMe] = useState<{ name: string; played: number; favorites: number; reviews: number; purchases: number } | null>(null);
  useEffect(() => {
    void apiMe().then((r) => r.ok && setMe(r.data));
    void apiFavorites().then((r) => setFav(r.ok ? r.data.items : []));
    void apiHistory().then((r) => setHist(r.ok ? r.data.items : []));
    void apiEntitlements().then(setEnts);
    void apiPurchases().then((r) => setBuys(r.ok ? r.data.items : []));
  }, []);
  const STATUS: Record<string, string> = { pending: 'Ждёт подтверждения', paid: 'Оплачено', fulfilled: 'Выдано', refunded: 'Возврат', expired: 'Истекло', failed: 'Отменено' };
  return (
    <div className="space-y-3 p-4">
      {me && (
        <div className="grid grid-cols-4 gap-2">
          {([['Игр', me.played], ['Избранное', me.favorites], ['Отзывов', me.reviews], ['Покупок', me.purchases]] as [string, number][]).map(([l, v]) => (
            <div key={l} className="rounded-2xl p-3 text-center" style={glass}><p className="text-lg font-black" style={{ color: C.t1 }}>{v}</p><p className="text-[10px]" style={{ color: C.t3 }}>{l}</p></div>
          ))}
        </div>
      )}
      <div className="flex gap-1 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
        {([['fav', 'Избранное', Heart], ['hist', 'История запусков', History], ['items', 'Мои предметы', ShoppingBag], ['buys', 'Покупки', ShoppingBag]] as const).map(([k, l, I]) => (
          <button key={k} type="button" onClick={() => setSub(k)} className="flex shrink-0 items-center gap-1 rounded-xl px-3 py-1.5 text-[11px] font-semibold" style={{ background: sub === k ? C.accBg : C.l2, color: sub === k ? C.acc : C.t3 }}><I size={12} /> {l}</button>
        ))}
      </div>
      {(sub === 'fav' || sub === 'hist') && ((sub === 'fav' ? fav : hist) === null ? <Spinner /> : (sub === 'fav' ? fav : hist)!.length === 0
        ? <Empty title={sub === 'fav' ? 'В избранном пусто' : 'Вы ещё не запускали игры'} hint="Загляните в каталог" Icon={Gamepad2} />
        : <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{(sub === 'fav' ? fav : hist)!.map((g) => <div key={g.id}><GameCard game={g} onOpen={() => onOpen(g.id)} />{g.lastPlayedAt && <p className="mt-1 text-center text-[10px]" style={{ color: C.t3 }}>{fmtDt(g.lastPlayedAt)}</p>}</div>)}</div>)}
      {sub === 'items' && (!ents ? <Spinner /> : !ents.ok || ents.data.items.length === 0 ? <Empty title="Предметов пока нет" hint="Покупки в играх появятся здесь" Icon={ShoppingBag} />
        : ents.data.items.map((e) => <div key={e.gameId + e.sku} className="flex items-center justify-between rounded-2xl p-3" style={glass}><div><p className="text-[13px] font-semibold" style={{ color: C.t1 }} translate="no">{e.title}</p><p className="text-[11px]" style={{ color: C.t3 }} translate="no">{e.gameTitle}</p></div><span className="text-[13px] font-bold" style={{ color: C.acc }}>×{e.quantity}</span></div>))}
      {sub === 'buys' && (buys === null ? <Spinner /> : buys.length === 0 ? <Empty title="Покупок пока нет" hint="Здесь будет история операций" Icon={ShoppingBag} />
        : buys.map((b) => <div key={b.id} className="flex items-center justify-between rounded-2xl p-3" style={glass}><div><p className="text-[13px] font-semibold" style={{ color: C.t1 }} translate="no">{b.title}</p><p className="text-[11px]" style={{ color: C.t3 }}><span translate="no">{b.gameTitle}</span> · {fmtDt(b.createdAt)}</p></div><div className="text-right"><p className="text-[13px] font-bold" style={{ color: C.amber }}>{b.price.toLocaleString('ru-RU')}</p><p className="text-[10px]" style={{ color: b.status === 'refunded' ? C.red : C.t3 }}>{STATUS[b.status] ?? b.status}</p></div></div>))}
    </div>
  );
};

export const SkyBlox = () => {
  const [tab, setTab] = useState<Tab>('catalog');
  const [gameId, setGameId] = useState<string | null>(null);
  const [playing, setPlaying] = useState<{ place: Place; game: Game } | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => { void ensureBloxMedia().finally(() => setReady(true)); }, []);

  if (playing) return <PlayerScreen place={playing.place} game={playing.game} onClose={() => setPlaying(null)} />;
  if (gameId) return <GamePage gameId={gameId} onBack={() => setGameId(null)} onPlay={(place, game) => setPlaying({ place, game })} onOpenGame={setGameId} />;

  return (
    <div className="flex h-full flex-col" style={{ background: C.bg }}>
      <div className="shrink-0 px-4 pt-3" style={{ borderBottom: `1px solid ${C.brd}` }}>
        <div className="flex items-center gap-2 pb-2">
          <div className="grid h-9 w-9 place-items-center rounded-xl" style={{ background: 'linear-gradient(135deg, var(--accent), var(--purple))' }}><Gamepad2 size={18} color="#fff" /></div>
          <div><p className="text-base font-black leading-tight" style={{ color: C.t1 }}>Sky Blox</p><p className="text-[10px]" style={{ color: C.t3 }}>Игры сообщества · плейсы · Prime Points</p></div>
        </div>
        <div className="flex gap-1">
          {([['catalog', 'Каталог', Gamepad2], ['library', 'Библиотека', Library], ['dev', 'Разработчикам', Wrench]] as const).map(([k, l, I]) => (
            <button key={k} type="button" onClick={() => setTab(k)} className="flex items-center gap-1.5 px-3 py-2 text-[12px] font-semibold" style={{ color: tab === k ? C.t1 : C.t3, borderBottom: `2px solid ${tab === k ? C.acc : 'transparent'}` }}><I size={13} /> {l}</button>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {!ready ? <div className="grid place-items-center p-10"><Loader2 className="animate-spin" style={{ color: C.t3 }} /></div> : (
          <>
            {tab === 'catalog' && <CatalogView onOpen={setGameId} />}
            {tab === 'library' && <LibraryView onOpen={setGameId} />}
            {tab === 'dev' && <DevCabinet onOpenGame={setGameId} />}
          </>
        )}
      </div>
    </div>
  );
};
