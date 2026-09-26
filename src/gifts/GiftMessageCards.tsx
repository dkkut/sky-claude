/**
 * Карточки подарков прямо в сообщении мессенджера — обёртки над уже
 * существующими компонентами (GiftBubble) и один новый компонент,
 * которого раньше не было (PrimeGiftMessageCard).
 *
 * Сообщение несёт только идентификатор доставки (giftInstanceId /
 * primeGiftInstanceId) — сам текст сообщения клиент не читает и не
 * доверяет ему: имя, цену, картинку и состояние карточка получает
 * отдельным запросом, который сервер отдаёт только участнику этой
 * самой доставки (см. server/gifts.mjs::getInstance,
 * server/primegifts.mjs::getPrimeGiftInstance). Поэтому подделать
 * сообщение с чужим или выдуманным id бессмысленно: карточка не
 * дорисуется, а не покажет фальшивую цену или чужое имя.
 */
import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Crown, Check, Clock, Ban } from 'lucide-react';
import { GiftBubble } from './SkyGifts';
import type { SentGift } from './store';
import {
  apiGiftInstance, apiPrimeGiftInstance, apiActivatePrimeGift, apiCancelPrimeGift,
  giftMediaUrl, toSentGift,
} from './giftsApi';
import { PRIME_GIFT_THEMES } from './GiftPrime';

/** «2ч 14м» до конца окна отмены. */
const cancelCountdown = (deadline: string) => {
  const ms = new Date(deadline).getTime() - Date.now();
  if (ms <= 0) return null;
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return h > 0 ? `${h}ч ${m}м` : `${m}м`;
};

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

/* ── Обычный подарок в чате: та же карточка (GiftBubble), но данные — с сервера ── */
export const GiftMessageCard = ({ instanceId, fromMe }: { instanceId: string; fromMe: boolean }) => {
  const [gift, setGift] = useState<SentGift | 'error' | null>(null);

  useEffect(() => {
    let alive = true;
    apiGiftInstance(instanceId).then((inst) => {
      if (!alive) return;
      if (!inst) { setGift('error'); return; }
      setGift(toSentGift(inst));
    });
    return () => { alive = false; };
  }, [instanceId]);

  if (gift === 'error') {
    return (
      <div className={`flex ${fromMe ? 'justify-end' : 'justify-start'}`}>
        <div className="rounded-2xl px-4 py-3 text-xs" style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.4)' }}>
          Подарок недоступен
        </div>
      </div>
    );
  }
  if (!gift) {
    return (
      <div className={`flex ${fromMe ? 'justify-end' : 'justify-start'}`}>
        <div className="rounded-[28px] animate-pulse" style={{ width: 180, height: 160, background: 'rgba(255,255,255,0.06)' }} />
      </div>
    );
  }
  return <GiftBubble gift={gift} fromMe={fromMe} onCancelled={setGift} />;
};

/* ══════════════════════════════════════════════════════════════
   PRIME GIFT CARD — единственный полностью новый крупный компонент
   интерфейса в этой работе. Три состояния, все с сервера:
     · new         — можно нажать «Получить Prime»
     · activated   — получено, показан срок действия
     · unavailable — недоступно (например, заказ отменён/возвращён)
══════════════════════════════════════════════════════════════ */
export const PrimeGiftMessageCard = ({ instanceId, fromMe }: { instanceId: string; fromMe: boolean }) => {
  const [inst, setInst] = useState<Awaited<ReturnType<typeof apiPrimeGiftInstance>> | 'error'>(null);
  const [activating, setActivating] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [err, setErr] = useState('');
  const motionOn = !prefersReducedMotion();

  useEffect(() => {
    let alive = true;
    apiPrimeGiftInstance(instanceId).then((r) => { if (alive) setInst(r ?? 'error'); });
    return () => { alive = false; };
  }, [instanceId]);

  const handleActivate = async () => {
    setErr('');
    setActivating(true);
    const r = await apiActivatePrimeGift(instanceId);
    setActivating(false);
    if (!r.ok) { setErr(r.reason); return; }
    if (r.instance) setInst(r.instance);
  };

  const handleCancel = async () => {
    setErr('');
    setCancelling(true);
    const r = await apiCancelPrimeGift(instanceId);
    setCancelling(false);
    setConfirmingCancel(false);
    if (!r.ok) { setErr(r.reason); return; }
    if (r.instance) setInst(r.instance);
  };

  const cardShell = (children: React.ReactNode, bg: string) => (
    <div className={`flex ${fromMe ? 'justify-end' : 'justify-start'}`}>
      <motion.div
        initial={motionOn ? { scale: 0.55, opacity: 0, y: 26 } : false}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 230, damping: 20 }}
        whileTap={motionOn ? { scale: 0.97 } : undefined}
        className="relative overflow-hidden rounded-3xl w-full"
        style={{ background: bg, border: '1.5px solid rgba(255,255,255,0.18)', minWidth: 200, maxWidth: 260,
          boxShadow: '0 20px 60px rgba(0,0,0,0.55)' }}>
        {children}
      </motion.div>
    </div>
  );

  if (inst === 'error') {
    return cardShell(
      <div className="px-5 py-6 text-center">
        <p className="text-xs" style={{ color: 'rgba(255,255,255,0.45)' }}>Подарок Prime недоступен</p>
      </div>, 'rgba(255,255,255,0.05)',
    );
  }
  if (!inst) {
    return (
      <div className={`flex ${fromMe ? 'justify-end' : 'justify-start'}`}>
        <div className="rounded-3xl animate-pulse" style={{ width: 220, height: 180, background: 'rgba(255,255,255,0.06)' }} />
      </div>
    );
  }

  const theme = PRIME_GIFT_THEMES.find((t) => t.id === inst.theme) ?? PRIME_GIFT_THEMES[0];
  const isNew = inst.status === 'new';
  const isActivated = inst.status === 'activated';
  const isUnavailable = inst.status === 'unavailable';
  const canActivate = isNew && !fromMe;
  const mediaUrl = giftMediaUrl(inst.mediaId);
  const isVideo = inst.mediaKind === 'video' && Boolean(mediaUrl);
  const cancelLeft = isNew ? cancelCountdown(inst.cancelDeadline) : null;
  const canCancel = isNew && fromMe && Boolean(cancelLeft);
  const expiresLabel = inst.activatedAt
    ? new Date(new Date(inst.activatedAt).getTime() + inst.days * 86400_000)
      .toLocaleDateString('ru', { day: 'numeric', month: 'long', year: 'numeric' })
    : null;

  return cardShell(
    <>
      {mediaUrl && (isVideo
        ? <video src={mediaUrl} autoPlay loop muted playsInline className="absolute inset-0 h-full w-full object-cover opacity-75" />
        : <img src={mediaUrl} alt="" className="absolute inset-0 h-full w-full object-cover opacity-75" />)}
      <div className="absolute inset-0 pointer-events-none"
        style={{ background: 'linear-gradient(180deg, rgba(0,0,0,0.12), rgba(0,0,0,0.55))' }} />
      {isUnavailable && (
        <div className="absolute inset-0 pointer-events-none" style={{ background: 'rgba(10,10,14,0.55)', filter: 'saturate(0)' }} />
      )}
      {motionOn && isNew && (
        <motion.div className="absolute inset-0 pointer-events-none"
          style={{ background: 'linear-gradient(108deg, transparent 20%, rgba(255,255,255,0.15) 50%, transparent 80%)', backgroundSize: '250% 100%' }}
          animate={{ backgroundPosition: ['250% 0', '-250% 0'] }}
          transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut', repeatDelay: 1 }} />
      )}

      <div className="relative z-10 flex flex-col items-center px-5 py-6 text-center gap-1.5">
        <motion.div
          animate={motionOn && isNew ? { y: [0, -6, 0], rotate: [-3, 3, -3], scale: [1, 1.06, 1] } : undefined}
          transition={{ duration: 2.3, repeat: Infinity, ease: 'easeInOut' }}
          style={{ fontSize: 40, filter: isUnavailable ? 'grayscale(1)' : undefined }}>
          {isActivated ? '👑' : isUnavailable ? '🔒' : '🎁'}
        </motion.div>

        <div className="flex items-center gap-1.5">
          <Crown size={12} style={{ color: theme.textColor }} />
          <p className="text-sm font-black text-white">Sky Prime</p>
          <Crown size={12} style={{ color: theme.textColor }} />
        </div>
        <p className="text-[11px] font-bold" style={{ color: theme.textColor }}>{inst.days} дн. подписки</p>

        {inst.message && (
          <p className="mt-1.5 text-[11px] italic px-2" style={{ color: 'rgba(255,255,255,0.65)' }}>«{inst.message}»</p>
        )}

        {isActivated && (
          <div className="mt-2 w-full rounded-xl px-3 py-2" style={{ background: 'rgba(0,0,0,0.3)' }}>
            <p className="text-[9px] uppercase tracking-wide" style={{ color: 'rgba(255,255,255,0.4)' }}>Получено</p>
            {expiresLabel && <p className="text-[11px] font-bold text-white">эта подписка — до {expiresLabel}</p>}
          </div>
        )}
        {isUnavailable && (
          <p className="mt-2 text-[11px] font-semibold" style={{ color: 'rgba(255,255,255,0.5)' }}>
            {inst.unavailableReason ?? 'Подарок больше недоступен'}
          </p>
        )}

        {canActivate && (
          <motion.button type="button" whileTap={{ scale: 0.94 }} disabled={activating} onClick={handleActivate}
            className="mt-3 flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-black text-black"
            style={{ background: 'linear-gradient(135deg,#fbbf24,#f59e0b)', opacity: activating ? 0.6 : 1, cursor: activating ? 'default' : 'pointer' }}>
            {activating ? 'Получаем…' : <><Check size={13} /> Получить Prime</>}
          </motion.button>
        )}
        {isNew && fromMe && (
          <p className="mt-2 text-[10px] flex items-center gap-1" style={{ color: 'rgba(255,255,255,0.4)' }}>
            <Clock size={11} /> Ждём, когда получатель заберёт
          </p>
        )}
        {canCancel && (
          confirmingCancel ? (
            <div className="mt-2 flex items-center justify-center gap-1.5">
              <button type="button" disabled={cancelling} onClick={handleCancel}
                className="rounded-full px-3 py-1 text-[10px] font-bold"
                style={{ background: 'rgba(248,113,113,0.25)', color: '#fca5a5' }}>
                {cancelling ? 'Отменяем…' : 'Точно отменить?'}
              </button>
              <button type="button" onClick={() => setConfirmingCancel(false)}
                className="rounded-full px-3 py-1 text-[10px] font-semibold"
                style={{ background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.6)' }}>
                Нет
              </button>
            </div>
          ) : (
            <button type="button" onClick={() => setConfirmingCancel(true)}
              className="mt-2 flex items-center gap-1 rounded-full px-3 py-1 text-[10px] font-semibold"
              style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.55)' }}>
              <Ban size={10} /> Отменить · ещё {cancelLeft}
            </button>
          )
        )}
        {err && <p className="mt-1 text-[10px]" style={{ color: '#fca5a5' }}>{err}</p>}
      </div>
    </>,
    theme.bg,
  );
};
