/**
 * Sky Market: игровой маркет.
 *
 * Написан заново. От прежнего игрового маркета не осталось ничего: тот
 * жил в браузере, держал выдуманные игры и лоты в памяти вкладки и
 * считал деньги продавца — здесь нет ни одного из трёх.
 *
 * Что важно знать про эту витрину:
 *
 *   · Игры ведёт администрация Sky. Это список на сервере, а не набор
 *     строк во фронтенде: иначе каждый клиент показывал бы свой.
 *   · Доставки и трек-номера нет. Товар передаётся в игре, и путь у
 *     сделки короткий: купил → отправил деньги → продавец получил →
 *     продавец выдал → покупатель подтвердил выдачу → закрыто.
 *   · Деньги идут мимо Sky, как и в обычном маркете.
 *
 * Карточки и фильтры — общие с обычной витриной: две витрины одного
 * маркета не должны расходиться по мелочам.
 */
import { useEffect, useMemo, useState } from 'react';
import { Search, X, Gamepad2, ArrowLeft, Tag } from 'lucide-react';
import { C, Empty, Alert, ProductCard } from './ui';
import { useMarketStore } from './store';
import { gameCoverUrl } from './marketApi';
import type { Game, GameCategoryKey } from './types';
import { GAME_CATEGORY_LABEL } from './types';

/* ── Обложка игры ─────────────────────────────────────────────────── */

const GameCover = ({ game, className }: { game: Game; className?: string }) => {
  const [broken, setBroken] = useState(false);
  if (!game.hasCover || broken) {
    return (
      <div className={className} style={{ background: C.l3, display: 'grid', placeItems: 'center' }}>
        <Gamepad2 size={18} style={{ color: C.t3 }} />
      </div>
    );
  }
  return (
    <img src={gameCoverUrl(game.id)} alt={game.title} className={className}
      loading="lazy" onError={() => setBroken(true)} />
  );
};

/* ── Витрина одной игры ───────────────────────────────────────────── */

const GameShelf = ({ game, onBack, onOpen }:
{ game: Game; onBack: () => void; onOpen: (productId: string) => void }) => {
  const { catalog, catalogLoading, catalogError, loadCatalog, toggleFavorite } = useMarketStore();
  const [kind, setKind] = useState<GameCategoryKey | ''>('');
  const [q, setQ] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => {
      void loadCatalog({
        type: 'game',
        gameId: game.id,
        gameCategory: kind || undefined,
        q: q.trim() || undefined,
      });
    }, 250);
    return () => clearTimeout(timer);
  }, [game.id, kind, q]);

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0" style={{ borderBottom: `1px solid ${C.brd}` }}>
        <div className="flex items-center gap-3 px-4 py-3">
          <button type="button" onClick={onBack}
            className="grid h-9 w-9 place-items-center rounded-xl hover:bg-white/5" style={{ color: C.acc }}>
            <ArrowLeft size={18} />
          </button>
          <GameCover game={game} className="h-9 w-9 rounded-lg object-cover" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold" style={{ color: C.t1 }}>{game.title}</p>
            {game.description && (
              <p className="truncate text-[10px]" style={{ color: C.t3 }}>{game.description}</p>
            )}
          </div>
        </div>

        <div className="px-3 pb-2">
          <div className="flex items-center gap-2 rounded-xl px-3 py-2" style={{ background: C.l2 }}>
            <Search size={14} style={{ color: C.t3 }} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Что ищем в этой игре"
              className="flex-1 bg-transparent text-[12px] outline-none" style={{ color: C.t1 }} />
            {q && <button type="button" onClick={() => setQ('')}><X size={13} style={{ color: C.t3 }} /></button>}
          </div>
        </div>

        <div className="flex gap-1 overflow-x-auto px-3 pb-2" style={{ scrollbarWidth: 'none' }}>
          <button type="button" onClick={() => setKind('')}
            className="shrink-0 rounded-lg px-2.5 py-1 text-[10px] font-semibold"
            style={{ background: kind === '' ? C.accBg : C.l2, color: kind === '' ? C.acc : C.t3 }}>
            Всё
          </button>
          {(Object.keys(GAME_CATEGORY_LABEL) as GameCategoryKey[]).map((k) => (
            <button key={k} type="button" onClick={() => setKind(k)}
              className="shrink-0 rounded-lg px-2.5 py-1 text-[10px] font-semibold"
              style={{ background: kind === k ? C.accBg : C.l2, color: kind === k ? C.acc : C.t3 }}>
              {GAME_CATEGORY_LABEL[k]}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {catalogError && <Alert text={catalogError} />}
        {catalogLoading && catalog.length === 0 && (
          <p className="py-8 text-center text-[12px]" style={{ color: C.t3 }}>Загружаем…</p>
        )}
        {!catalogLoading && catalog.length === 0 && !catalogError && (
          <Empty title="Пока ничего не продают" hint="Загляните позже или выложите свой лот" Icon={Tag} />
        )}
        <div className="grid grid-cols-2 gap-2">
          {catalog.map((p) => (
            <ProductCard key={p.id} product={p} onOpen={() => onOpen(p.id)}
              onFavorite={() => toggleFavorite(p)} />
          ))}
        </div>
      </div>
    </div>
  );
};

/* ── Список игр ───────────────────────────────────────────────────── */

export const GamingMarket = ({ onOpen }: { onOpen: (productId: string) => void }) => {
  const { games, loadGames } = useMarketStore();
  const [picked, setPicked] = useState<Game | null>(null);
  const [q, setQ] = useState('');

  useEffect(() => { void loadGames(); }, []);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const live = games.filter((g) => !g.hidden);
    return needle ? live.filter((g) => g.title.toLowerCase().includes(needle)) : live;
  }, [games, q]);

  if (picked) {
    return <GameShelf game={picked} onBack={() => setPicked(null)} onOpen={onOpen} />;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 p-3" style={{ borderBottom: `1px solid ${C.brd}` }}>
        <div className="flex items-center gap-2 rounded-xl px-3 py-2" style={{ background: C.l2 }}>
          <Search size={14} style={{ color: C.t3 }} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Найти игру"
            className="flex-1 bg-transparent text-[12px] outline-none" style={{ color: C.t1 }} />
          {q && <button type="button" onClick={() => setQ('')}><X size={13} style={{ color: C.t3 }} /></button>}
        </div>
        <p className="mt-2 text-[10px]" style={{ color: C.t3 }}>
          В игровом маркете нет доставки и трек-номеров: товар передаётся внутри игры,
          а покупатель подтверждает выдачу.
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {shown.length === 0 && (
          <Empty title="Игр пока нет" hint="Список игр ведёт администрация Sky" Icon={Gamepad2} />
        )}
        <div className="grid grid-cols-2 gap-2">
          {shown.map((g) => (
            <button key={g.id} type="button" onClick={() => setPicked(g)}
              className="overflow-hidden rounded-2xl text-left"
              style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
              <GameCover game={g} className="h-28 w-full object-cover" />
              <div className="p-2.5">
                <p className="line-clamp-1 text-[12px] font-semibold" style={{ color: C.t1 }}>{g.title}</p>
                {g.description && (
                  <p className="line-clamp-2 text-[10px]" style={{ color: C.t3 }}>{g.description}</p>
                )}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
