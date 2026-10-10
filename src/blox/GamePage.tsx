import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Flag, Heart, Loader2, Play, ShoppingBag, Star, Users } from 'lucide-react';
import { Alert, BloxImage, C, ERRORS, Field, GameCard, StatusBadge, errText, fmtDt, fmtN, glass, inputStyle } from './ui';
import { Stars } from '@/marketplace/ui';
import {
  apiAppeal, apiBuy, apiFavorite, apiGame, apiReport, apiReview, apiReviews, apiShop, CATEGORY_LABEL, REPORT_LABEL,
  type Game, type Place, type Product, type Review,
} from './bloxApi';

const newKey = () => `ui-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

const ReportBox = ({ targetType, targetId }: { targetType: 'game' | 'place' | 'developer' | 'review'; targetId: string }) => {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('scam');
  const [details, setDetails] = useState('');
  const [msg, setMsg] = useState('');
  const send = async () => {
    const r = await apiReport({ targetType, targetId, reason, details });
    setMsg(r.ok ? 'Жалоба отправлена модераторам. Спасибо.' : errText(r));
    if (r.ok) setOpen(false);
  };
  return (
    <div className="space-y-2">
      {!open && <button type="button" onClick={() => { setOpen(true); setMsg(''); }} className="flex items-center gap-1.5 text-[11px] font-semibold" style={{ color: C.t3 }}><Flag size={12} /> Пожаловаться</button>}
      {open && (
        <div className="space-y-2 rounded-2xl p-3" style={glass}>
          <select value={reason} onChange={(e) => setReason(e.target.value)} className="w-full rounded-xl px-3 py-2 text-[12px]" style={inputStyle}>
            {Object.entries(REPORT_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          <textarea value={details} onChange={(e) => setDetails(e.target.value)} rows={3} maxLength={1500} placeholder="Что случилось (необязательно)" className="w-full rounded-xl px-3 py-2 text-[12px]" style={inputStyle} />
          <div className="flex gap-2">
            <button type="button" onClick={() => setOpen(false)} className="flex-1 rounded-xl py-2 text-[12px] font-bold" style={{ background: C.l2, color: C.t1 }}>Отмена</button>
            <button type="button" onClick={() => void send()} className="flex-1 rounded-xl py-2 text-[12px] font-bold text-white" style={{ background: C.red }}>Отправить</button>
          </div>
        </div>
      )}
      {msg && <Alert kind="info" text={msg} />}
    </div>
  );
};

export const GamePage = ({ gameId, onBack, onPlay, onOpenGame }: { gameId: string; onBack: () => void; onPlay: (place: Place, game: Game) => void; onOpenGame: (id: string) => void }) => {
  const [game, setGame] = useState<Game | null>(null);
  const [err, setErr] = useState('');
  const [reviews, setReviews] = useState<Review[]>([]);
  const [shop, setShop] = useState<{ sellable: boolean; items: Product[] } | null>(null);
  const [rating, setRating] = useState(5);
  const [body, setBody] = useState('');
  const [msg, setMsg] = useState('');
  const [buying, setBuying] = useState('');
  const [appeal, setAppeal] = useState('');

  const load = useCallback(async () => {
    const [g, r, s] = await Promise.all([apiGame(gameId), apiReviews(gameId), apiShop(gameId)]);
    if (g.ok) { setGame(g.data.game); setErr(''); } else setErr(errText(g));
    if (r.ok) setReviews(r.data.items);
    if (s.ok) setShop(s.data);
  }, [gameId]);
  useEffect(() => { void load(); }, [load]);

  if (err) return <div className="p-4"><button type="button" onClick={onBack} style={{ color: C.acc }}><ArrowLeft size={18} /></button><div className="mt-3"><Alert text={err} /></div></div>;
  if (!game) return <div className="grid place-items-center p-10"><Loader2 className="animate-spin" style={{ color: C.t3 }} /></div>;

  const places = (game.places ?? []).filter((p) => p.moderationStatus === undefined || p.moderationStatus === 'published' || game.own);
  const playable = places.filter((p) => p.moderationStatus === undefined || p.moderationStatus === 'published');
  const main = playable.find((p) => p.isMain) ?? playable[0];

  const toggleFav = async () => { const r = await apiFavorite(game.id, !game.favorite); if (r.ok) setGame({ ...game, favorite: !game.favorite, favorites: game.favorites + (game.favorite ? -1 : 1) }); };
  const sendReview = async () => { setMsg(''); const r = await apiReview(game.id, { rating, body }); if (!r.ok) { setMsg(errText(r)); return; } setBody(''); setMsg('Спасибо за отзыв!'); void load(); };
  const buy = async (p: Product) => {
    setBuying(p.sku); setMsg('');
    const r = await apiBuy(game.id, p.sku, newKey());
    setBuying('');
    setMsg(r.ok ? `Запрос на покупку «${p.title}» создан. Подтвердите оплату в окне «Покупка» — оно появится на этом экране.` : errText(r));
    if (r.ok) window.dispatchEvent(new CustomEvent('blox:purchase-created'));
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="relative">
        <BloxImage id={game.coverId} alt={game.title} className="h-48 w-full object-cover md:h-64" />
        <div className="absolute inset-x-0 bottom-0 h-24" style={{ background: 'linear-gradient(transparent, var(--bg))' }} />
        <button type="button" onClick={onBack} aria-label="Назад" className="absolute left-3 top-3 grid h-9 w-9 place-items-center rounded-xl text-white" style={{ background: 'rgba(0,0,0,.5)' }}><ArrowLeft size={18} /></button>
      </div>

      <div className="mx-auto w-full max-w-3xl space-y-4 p-4">
        <div>
          <div className="flex items-start gap-2">
            <h1 className="flex-1 text-xl font-black" style={{ color: C.t1 }} translate="no">{game.title}</h1>
            <StatusBadge status={game.moderationStatus} />
          </div>
          <p className="text-[12px]" style={{ color: C.t3 }}>
            {CATEGORY_LABEL[game.category] ?? game.category} · <span translate="no">{game.developerName}</span> · версия <span translate="no">{game.version}</span>
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-[12px]" style={{ color: C.t2 }}>
            <span className="flex items-center gap-1"><Stars rating={game.rating} size={12} /> {game.rating ?? '—'} ({game.ratingCount})</span>
            <span className="flex items-center gap-1"><Users size={12} /> {fmtN(game.visitors)} игроков</span>
            <span className="flex items-center gap-1"><Play size={12} /> {fmtN(game.launches)} запусков</span>
            <span className="flex items-center gap-1"><Heart size={12} /> {fmtN(game.favorites)}</span>
          </div>
        </div>

        <div className="flex gap-2">
          <button type="button" disabled={!main} onClick={() => main && onPlay(main, game)}
            className="flex flex-1 items-center justify-center gap-2 rounded-2xl py-3 text-[14px] font-black text-white disabled:opacity-40"
            style={{ background: 'linear-gradient(135deg, var(--accent), var(--purple))' }}>
            <Play size={16} fill="#fff" /> {main ? 'Играть' : 'Пока недоступно'}
          </button>
          <button type="button" onClick={() => void toggleFav()} aria-label="Избранное" className="grid w-12 place-items-center rounded-2xl" style={glass}>
            <Heart size={18} style={{ color: game.favorite ? C.red : C.t2 }} fill={game.favorite ? C.red : 'none'} />
          </button>
        </div>

        {game.shotIds.length > 0 && (
          <div className="flex gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
            {game.shotIds.map((s) => <BloxImage key={s} id={s} className="h-28 shrink-0 rounded-xl object-cover" style={{ aspectRatio: '16/9' }} />)}
          </div>
        )}

        {game.description && <p className="whitespace-pre-wrap text-[13px]" style={{ color: C.t2 }} translate="no">{game.description}</p>}

        {places.length > 0 && (
          <div className="space-y-2">
            <p className="text-[13px] font-bold" style={{ color: C.t1 }}>Плейсы</p>
            {places.map((p) => (
              <div key={p.id} className="flex items-center gap-3 rounded-2xl p-2.5" style={glass}>
                <BloxImage id={p.coverId} className="h-14 w-20 shrink-0 rounded-lg object-cover" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-semibold" style={{ color: C.t1 }} translate="no">{p.title}</p>
                  <p className="truncate text-[11px]" style={{ color: C.t3 }} translate="no">{p.description}</p>
                  <p className="text-[10px]" style={{ color: C.t3 }}>до {p.maxPlayers} игроков{p.minAge > 0 ? ` · ${p.minAge}+` : ''}</p>
                </div>
                {(p.moderationStatus === undefined || p.moderationStatus === 'published') && (
                  <button type="button" onClick={() => onPlay(p, game)} className="rounded-xl px-3 py-1.5 text-[12px] font-bold text-white" style={{ background: C.acc }}>Играть</button>
                )}
              </div>
            ))}
          </div>
        )}

        {shop && shop.items.length > 0 && (
          <div className="space-y-2">
            <p className="flex items-center gap-1.5 text-[13px] font-bold" style={{ color: C.t1 }}><ShoppingBag size={14} /> Магазин игры · Prime Points</p>
            {!shop.sellable && <p className="text-[11px]" style={{ color: C.amber }}>Покупки в этой игре сейчас недоступны: сервер игры не подтверждён или игра не опубликована.</p>}
            {shop.items.map((p) => (
              <div key={p.id} className="flex items-center gap-3 rounded-2xl p-3" style={glass}>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-semibold" style={{ color: C.t1 }} translate="no">{p.title}</p>
                  {p.description && <p className="text-[11px]" style={{ color: C.t3 }} translate="no">{p.description}</p>}
                  <p className="text-[11px]" style={{ color: C.t2 }}>{p.kind === 'durable' ? 'Постоянный предмет' : 'Расходуемый'}{p.owned ? ` · у вас: ${p.owned}` : ''}</p>
                </div>
                <button type="button" disabled={!shop.sellable || buying === p.sku || (p.kind === 'durable' && (p.owned ?? 0) > 0) || game.own}
                  onClick={() => void buy(p)} className="rounded-xl px-3 py-2 text-[12px] font-bold text-white disabled:opacity-40" style={{ background: C.acc }}>
                  {p.kind === 'durable' && (p.owned ?? 0) > 0 ? 'Куплено' : `${p.price.toLocaleString('ru-RU')} баллов`}
                </button>
              </div>
            ))}
            <p className="text-[10px]" style={{ color: C.t3 }}>Баллы спишутся только после вашего подтверждения. Цену определяет сервер Sky, игра баланс не меняет.</p>
          </div>
        )}

        <div className="space-y-2">
          <p className="text-[13px] font-bold" style={{ color: C.t1 }}>Отзывы</p>
          {!game.own && (
            <div className="space-y-2 rounded-2xl p-3" style={glass}>
              <div className="flex gap-1">{[1, 2, 3, 4, 5].map((n) => <button key={n} type="button" aria-label={`Оценка ${n}`} onClick={() => setRating(n)}><Star size={20} style={{ color: n <= rating ? C.amber : C.t3 }} fill={n <= rating ? C.amber : 'none'} /></button>)}</div>
              <Field label="Ваш отзыв"><textarea value={body} onChange={(e) => setBody(e.target.value)} rows={2} maxLength={1000} className="w-full rounded-xl px-3 py-2 text-[12px]" style={inputStyle} /></Field>
              <button type="button" onClick={() => void sendReview()} className="rounded-xl px-4 py-2 text-[12px] font-bold text-white" style={{ background: C.acc }}>Оставить отзыв</button>
              <p className="text-[10px]" style={{ color: C.t3 }}>Отзыв можно оставить после запуска игры; один отзыв на игрока.</p>
            </div>
          )}
          {msg && <Alert kind="info" text={msg} />}
          {reviews.length === 0 && <p className="text-[12px]" style={{ color: C.t3 }}>Отзывов пока нет.</p>}
          {reviews.map((r) => (
            <div key={r.id} className="rounded-2xl p-3" style={glass}>
              <div className="flex items-center justify-between"><p className="text-[12px] font-semibold" style={{ color: C.t1 }} translate="no">{r.author}</p><Stars rating={r.rating} size={10} /></div>
              {r.body && <p className="mt-1 text-[12px]" style={{ color: C.t2 }} translate="no">{r.body}</p>}
              <div className="mt-1 flex items-center gap-3"><span className="text-[10px]" style={{ color: C.t3 }}>{fmtDt(r.at)}</span><ReportBox targetType="review" targetId={r.id} /></div>
            </div>
          ))}
        </div>

        {game.own && ['blocked', 'hidden', 'needs_changes'].includes(game.moderationStatus ?? '') && (
          <div className="space-y-2 rounded-2xl p-3" style={glass}>
            <p className="text-[12px] font-bold" style={{ color: C.t1 }}>Не согласны с решением?</p>
            {game.moderationReason && <p className="text-[12px]" style={{ color: C.t2 }} translate="no">Причина: {game.moderationReason}</p>}
            <textarea value={appeal} onChange={(e) => setAppeal(e.target.value)} rows={3} maxLength={2000} className="w-full rounded-xl px-3 py-2 text-[12px]" style={inputStyle} />
            <button type="button" disabled={appeal.trim().length < 10} onClick={async () => { const r = await apiAppeal({ subjectType: 'game', subjectId: game.id, text: appeal }); setMsg(r.ok ? 'Апелляция отправлена.' : (ERRORS[r.error ?? ''] ?? errText(r))); }}
              className="rounded-xl px-4 py-2 text-[12px] font-bold text-white disabled:opacity-40" style={{ background: C.acc }}>Подать апелляцию</button>
          </div>
        )}

        {!game.own && <ReportBox targetType="game" targetId={game.id} />}
        {!game.own && <ReportBox targetType="developer" targetId={game.developerId} />}
        <div className="h-6" />
      </div>
    </div>
  );
};
