import { useEffect, useState } from 'react';
import { GAMES } from './store';
import { apiGameLeaderboard, apiGameEloHistory, type BoardRow, type EloHistoryItem, type GameRating } from './matchmakingApi';

/** Лиги ELO — те же границы, что в server/gameelo.mjs (TIERS). */
export const TIER_STYLE: Record<string, { name: string; color: string }> = {
  bronze:   { name: 'Бронза',  color: '#cd7f32' },
  silver:   { name: 'Серебро', color: '#9da3ae' },
  gold:     { name: 'Золото',  color: '#f5c518' },
  platinum: { name: 'Платина', color: '#4a9eff' },
  diamond:  { name: 'Алмаз',   color: '#a855f7' },
  master:   { name: 'Мастер',  color: '#f5771f' },
};

export const TierChip = ({ id }: { id?: string }) => {
  const t = TIER_STYLE[id ?? ''];
  if (!t) return null;
  return <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ background: `${t.color}22`, color: t.color }}>{t.name}</span>;
};

const C = { card: '#14161a', border: 'rgba(255,255,255,0.08)', t1: '#f2f3f5', t2: '#b6bac2', t3: '#7c818c', green: '#00dc5a', red: '#ff4d4d', orange: '#f5771f' };

/** Панель ELO: лига, прогресс до следующей, пик, место, история и таблица лидеров по выбранной игре. */
export const EloPanel = () => {
  const [gameId, setGameId] = useState(GAMES[0].id);
  const [mine, setMine] = useState<GameRating | null>(null);
  const [top, setTop] = useState<BoardRow[]>([]);
  const [hist, setHist] = useState<EloHistoryItem[]>([]);
  const [state, setState] = useState<'load' | 'ok' | 'err'>('load');

  const load = () => {
    setState('load');
    void Promise.all([apiGameLeaderboard(gameId, 10), apiGameEloHistory(gameId, 8)]).then(([b, h]) => {
      if (!b) { setState('err'); return; }
      setMine(b.mine); setTop(b.top); setHist(h); setState('ok');
    });
  };
  useEffect(load, [gameId]); // eslint-disable-line react-hooks/exhaustive-deps

  const tier = mine?.tier;
  const ts = TIER_STYLE[tier?.id ?? 'silver'];
  return (
    <div className="mt-3 rounded-xl overflow-hidden" style={{ background: C.card, border: `1px solid ${C.border}` }}>
      <div className="flex gap-1 overflow-x-auto px-3 pt-3" style={{ scrollbarWidth: 'none' }}>
        {GAMES.map(g => (
          <button key={g.id} type="button" onClick={() => setGameId(g.id)}
            className="shrink-0 rounded-full px-3 py-1 text-[11px] font-bold"
            style={{ background: g.id === gameId ? C.orange : 'rgba(255,255,255,0.06)', color: g.id === gameId ? '#000' : C.t2 }}>
            {g.title}
          </button>
        ))}
      </div>

      {state === 'err' && (
        <div className="p-4 text-center">
          <p className="text-xs" style={{ color: C.t3 }}>Не удалось загрузить рейтинг</p>
          <button type="button" onClick={load} className="mt-2 rounded-lg px-3 py-1.5 text-xs font-bold" style={{ background: C.orange, color: '#000' }}>Повторить</button>
        </div>
      )}
      {state !== 'err' && mine && (
        <div className="p-4">
          <div className="flex items-end justify-between">
            <div>
              <p className="text-3xl font-black tabular-nums" style={{ color: ts.color }}>{mine.elo}</p>
              <p className="text-xs font-bold" style={{ color: ts.color }}>{ts.name}</p>
            </div>
            <div className="text-right text-[11px]" style={{ color: C.t2 }}>
              <p>Место: <b style={{ color: C.t1 }}>{mine.position ? `#${mine.position}` : '—'}</b></p>
              <p>Пик: <b style={{ color: C.t1 }}>{mine.peak ?? mine.elo}</b></p>
              <p>Победы / поражения: <b style={{ color: C.t1 }}>{mine.wins} / {mine.losses}</b></p>
            </div>
          </div>
          {tier && (
            <div className="mt-3">
              <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.08)' }}>
                <div className="h-full rounded-full" style={{ width: `${Math.round(tier.progress * 100)}%`, background: ts.color }} />
              </div>
              <p className="mt-1 text-[10px]" style={{ color: C.t3 }}>
                {tier.next ? `До лиги «${TIER_STYLE[tier.next.id]?.name ?? tier.next.name}»: ${Math.max(0, tier.next.min - mine.elo)} ELO` : 'Высшая лига'}
              </p>
            </div>
          )}
          {mine.calibrating && (
            <p className="mt-2 rounded-lg px-3 py-2 text-[11px]" style={{ background: 'rgba(245,119,31,0.1)', color: C.orange }}>
              {`Калибровка: ещё ${mine.gamesToCalibrate ?? 0} матчей — рейтинг меняется быстрее`}
            </p>
          )}

          {hist.length > 0 && (
            <div className="mt-4">
              <p className="mb-1 text-[10px] font-bold tracking-widest" style={{ color: C.t3 }}>ПОСЛЕДНИЕ МАТЧИ</p>
              {hist.map((h, i) => (
                <div key={i} className="flex items-center justify-between py-1 text-xs" style={{ borderTop: i ? `1px solid ${C.border}` : undefined }}>
                  <span style={{ color: h.won ? C.green : C.red }}>{h.won ? 'Победа' : 'Поражение'}</span>
                  <span className="tabular-nums" style={{ color: C.t2 }}>{h.before} → {h.after}</span>
                  <span className="font-bold tabular-nums" style={{ color: !h.rated ? C.t3 : h.delta >= 0 ? C.green : C.red }}>
                    {h.rated ? (h.delta > 0 ? `+${h.delta}` : String(h.delta)) : 'не зачтён'}
                  </span>
                </div>
              ))}
            </div>
          )}

          <div className="mt-4">
            <p className="mb-1 text-[10px] font-bold tracking-widest" style={{ color: C.t3 }}>ТАБЛИЦА ЛИДЕРОВ</p>
            {top.length === 0 && <p className="text-xs" style={{ color: C.t3 }}>Пока никто не сыграл — станьте первым</p>}
            {top.map(r => (
              <div key={r.profileId} className="flex items-center gap-2 py-1 text-xs"
                style={{ background: r.me ? 'rgba(245,119,31,0.1)' : undefined, borderRadius: 6, padding: '4px 6px' }}>
                <span className="w-6 font-black tabular-nums" style={{ color: r.place <= 3 ? C.orange : C.t3 }}>{r.place}</span>
                <span className="flex-1 truncate" translate="no" style={{ color: C.t1 }}>{r.name}</span>
                <TierChip id={r.tier} />
                <span className="w-12 text-right font-bold tabular-nums" style={{ color: C.t1 }}>{r.elo}</span>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[10px]" style={{ color: C.t3 }}>
            Рейтинг меняется только после подтверждения результата соперником. Против одних и тех же соперников засчитываются не больше 3 матчей в сутки.
          </p>
        </div>
      )}
    </div>
  );
};
