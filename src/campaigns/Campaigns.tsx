/**
 * Мероприятия: награда за подтверждённую активность.
 *
 * Первое мероприятие — «Опубликуй видео и получи Sky Prime»: механика
 * общая для любых будущих мероприятий с наградой за уровень. Шкала
 * наград, условия, обложка — всё с сервера, здесь ничего не зашито.
 */
import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Gift, Trophy, Copy, Check, Clock, ChevronRight, ChevronLeft, Loader2,
  Link2, RefreshCw, AlertTriangle, Sparkles, LifeBuoy, Eye,
} from 'lucide-react';
import { useModuleStore } from '@/data/state/modules';
import {
  apiCampaigns, apiCampaignDetail, apiCampaignJoin, apiCampaignMine,
  apiParticipationLink, apiRegenerateLink, apiRequestReward,
  campaignLinkUrl, campaignCoverUrl,
  type Campaign, type CampaignDetail, type Participation, type RewardGrant,
} from './campaignsApi';

const C = {
  bg: '#0a0a10', l1: '#111118', l2: 'var(--bg-l2)',
  border: 'var(--border)', purple: 'var(--purple)', accent: 'var(--accent)',
  t1: 'var(--t1)', t2: 'var(--t2)', t3: 'var(--t3)',
  green: 'var(--green)', red: 'var(--red)', amber: 'var(--amber)',
};

const GRANT_STATUS_LABEL: Record<RewardGrant['status'], string> = {
  pending: 'На рассмотрении', approved: 'Одобрена', rejected: 'Отклонена',
  granted: 'Начислена', failed: 'Не выполнена',
};
const GRANT_STATUS_COLOR: Record<RewardGrant['status'], string> = {
  pending: C.amber, approved: C.accent, rejected: C.red, granted: C.green, failed: C.red,
};

const fmtNum = (n: number) => n.toLocaleString('ru-RU');

const fmtExpires = (iso: string | null) => {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return 'завершается';
  const days = Math.ceil(ms / 86_400_000);
  if (days <= 1) return 'меньше суток';
  if (days < 30) return `${days} дн.`;
  return new Date(iso).toLocaleDateString('ru', { day: 'numeric', month: 'short' });
};

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('ru', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';

/** Максимальная награда шкалы — то, что кампания обещает на обложке карточки. */
const maxReward = (levels: { rewardDays: number; active: boolean }[]) =>
  levels.filter((l) => l.active).reduce((max, l) => Math.max(max, l.rewardDays), 0);

/* ─── Карточка мероприятия в списке ──────────────────────────────────── */

const CampaignCard = ({ campaign, detail, mine, onOpen }: {
  campaign: Campaign; detail: CampaignDetail | null; mine: Participation | null; onOpen: () => void;
}) => {
  const reward = detail ? maxReward(detail.levels) : 0;
  const expires = fmtExpires(campaign.endsAt);

  return (
    <motion.div whileTap={{ scale: 0.98 }} onClick={onOpen}
      className="overflow-hidden rounded-2xl cursor-pointer"
      style={{ background: `linear-gradient(160deg, ${C.purple}1c, ${C.l1})`, border: `1px solid ${C.purple}35` }}>
      {campaign.hasCover && (
        <div className="h-32 w-full overflow-hidden">
          <img src={campaignCoverUrl(campaign.id)} alt="" className="h-full w-full object-cover" />
        </div>
      )}
      <div className="p-4">
        <div className="flex items-start gap-3">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl"
            style={{ background: `linear-gradient(135deg, ${C.purple}, ${C.accent})` }}>
            <Gift size={18} style={{ color: '#fff' }} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold leading-snug" style={{ color: C.t1 }}>{campaign.title}</p>
            <p className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed" style={{ color: C.t3 }}>{campaign.description}</p>
          </div>
          <ChevronRight size={16} style={{ color: C.t3, flexShrink: 0, marginTop: 2 }} />
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {reward > 0 && (
            <span className="flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-black"
              style={{ background: `${C.purple}28`, color: C.purple }}>
              <Trophy size={10} /> до {reward} дн. Prime
            </span>
          )}
          {expires && (
            <span className="flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-semibold"
              style={{ background: C.l2, color: C.t3 }}>
              <Clock size={10} /> {expires}
            </span>
          )}
          {mine && (
            <span className="flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-semibold"
              style={{ background: 'rgba(52,211,153,0.12)', color: C.green }}>
              <Eye size={10} /> {fmtNum(mine.views)} просмотров
            </span>
          )}
        </div>
      </div>
    </motion.div>
  );
};

/* ─── Список мероприятий ──────────────────────────────────────────────── */

const CampaignsList = ({ onOpen }: { onOpen: (id: string) => void }) => {
  const [rows, setRows] = useState<{ campaign: Campaign; detail: CampaignDetail | null; mine: Participation | null }[] | null>(null);

  const load = useCallback(async () => {
    const list = await apiCampaigns();
    if (!list) { setRows([]); return; }
    const enriched = await Promise.all(list.map(async (campaign) => {
      const [detail, mine] = await Promise.all([apiCampaignDetail(campaign.id), apiCampaignMine(campaign.id)]);
      return { campaign, detail, mine };
    }));
    setRows(enriched);
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="flex h-full flex-col overflow-hidden" style={{ background: C.bg }}>
      <div className="shrink-0 px-4 pb-3 pt-4">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-2xl"
            style={{ background: `linear-gradient(135deg, ${C.purple}, ${C.accent})` }}>
            <Gift size={18} style={{ color: '#fff' }} />
          </div>
          <div>
            <p className="text-lg font-black" style={{ color: C.t1 }}>Мероприятия</p>
            <p className="text-xs" style={{ color: C.purple }}>Выполняй условия — получай Sky Prime</p>
          </div>
        </div>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto px-4 pb-4" style={{ scrollbarWidth: 'none' }}>
        {rows === null ? (
          <div className="flex justify-center py-10"><Loader2 size={20} className="animate-spin" style={{ color: C.t3 }} /></div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-16 text-center">
            <Gift size={28} style={{ color: C.t3 }} />
            <p className="text-sm" style={{ color: C.t3 }}>Сейчас нет активных мероприятий</p>
          </div>
        ) : (
          <AnimatePresence>
            {rows.map((r) => (
              <CampaignCard key={r.campaign.id} campaign={r.campaign} detail={r.detail} mine={r.mine}
                onOpen={() => onOpen(r.campaign.id)} />
            ))}
          </AnimatePresence>
        )}
      </div>
    </div>
  );
};

/* ─── Прогресс до следующего уровня ──────────────────────────────────── */

const ProgressBar = ({ mine }: { mine: Participation }) => {
  const { views, currentLevel, nextLevel } = mine;
  const from = currentLevel?.viewsThreshold ?? 0;
  const to = nextLevel?.viewsThreshold ?? currentLevel?.viewsThreshold ?? 1;
  const pct = nextLevel
    ? Math.min(100, Math.max(0, ((views - from) / Math.max(1, to - from)) * 100))
    : 100;

  return (
    <div className="rounded-2xl p-4" style={{ background: C.l1, border: `1px solid ${C.border}` }}>
      <div className="flex items-baseline justify-between">
        <p className="text-xs" style={{ color: C.t3 }}>Твои просмотры</p>
        <p className="text-lg font-black" style={{ color: C.t1 }}>{fmtNum(views)}</p>
      </div>

      <div className="mt-2 h-2 overflow-hidden rounded-full" style={{ background: C.l2 }}>
        <motion.div className="h-full rounded-full" initial={{ width: 0 }} animate={{ width: `${pct}%` }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
          style={{ background: `linear-gradient(90deg, ${C.purple}, ${C.accent})` }} />
      </div>

      <div className="mt-2.5 flex items-center justify-between text-[11px]">
        {currentLevel ? (
          <span style={{ color: C.green }}>Доступно: {currentLevel.rewardDays} дн. Prime</span>
        ) : (
          <span style={{ color: C.t3 }}>Пока ниже первого уровня</span>
        )}
        {nextLevel ? (
          <span style={{ color: C.t3 }}>
            До {nextLevel.rewardDays} дн. — ещё {fmtNum(Math.max(0, nextLevel.viewsThreshold - views))} просмотров
          </span>
        ) : currentLevel ? (
          <span style={{ color: C.purple }}>Максимальный уровень шкалы</span>
        ) : null}
      </div>
    </div>
  );
};

/* ─── Экран мероприятия ──────────────────────────────────────────────── */

const CampaignDetailScreen = ({ campaignId, onBack }: { campaignId: string; onBack: () => void }) => {
  const [detail, setDetail] = useState<CampaignDetail | null>(null);
  const [mine, setMine] = useState<Participation | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [link, setLink] = useState<string | null>(null);

  const [videoUrl, setVideoUrl] = useState('');
  const [busyJoin, setBusyJoin] = useState(false);
  const [busyReward, setBusyReward] = useState(false);
  const [busyRegen, setBusyRegen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ticketOpened, setTicketOpened] = useState<string | null>(null);

  const setPendingSupportTicketId = useModuleStore((s) => s.setPendingSupportTicketId);
  const setActiveModule = useModuleStore((s) => s.setActiveModule);

  const load = useCallback(async () => {
    const [d, m] = await Promise.all([apiCampaignDetail(campaignId), apiCampaignMine(campaignId)]);
    setDetail(d); setMine(m); setLoaded(true);
    if (m) {
      const l = await apiParticipationLink(m.id);
      if (l.ok) setLink(l.link);
    }
  }, [campaignId]);

  useEffect(() => { void load(); }, [load]);

  const join = async () => {
    setBusyJoin(true); setError(null);
    const r = await apiCampaignJoin(campaignId, videoUrl.trim() || undefined);
    setBusyJoin(false);
    if (!r.ok) { setError(r.reason); return; }
    setLink(r.link);
    void load();
  };

  const copyLink = async () => {
    if (!link) return;
    await navigator.clipboard.writeText(campaignLinkUrl(link)).catch(() => {});
    setCopied(true); setTimeout(() => setCopied(false), 2500);
  };

  const regenerate = async () => {
    if (!mine) return;
    setBusyRegen(true); setError(null);
    const r = await apiRegenerateLink(mine.id);
    setBusyRegen(false);
    if (!r.ok) { setError(r.reason); return; }
    setLink(r.link);
  };

  const requestReward = async () => {
    if (!mine) return;
    setBusyReward(true); setError(null); setTicketOpened(null);
    const r = await apiRequestReward(mine.id);
    setBusyReward(false);
    if (!r.ok) { setError(r.reason); return; }
    setTicketOpened(r.ticketId);
    void load();
  };

  const openSupportChat = () => {
    if (!ticketOpened) return;
    setPendingSupportTicketId(ticketOpened);
    setActiveModule('profile');
  };

  const canRequest = Boolean(mine?.currentLevel) && !mine?.grants.some((g) =>
    g.levelId === mine.currentLevel?.id && (g.status === 'pending' || g.status === 'approved' || g.status === 'granted'));

  if (!loaded) {
    return (
      <div className="flex h-full items-center justify-center" style={{ background: C.bg }}>
        <Loader2 size={20} className="animate-spin" style={{ color: C.t3 }} />
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3" style={{ background: C.bg }}>
        <p className="text-sm" style={{ color: C.t3 }}>Мероприятие не найдено</p>
        <button type="button" onClick={onBack} className="text-xs font-semibold" style={{ color: C.accent }}>← Назад</button>
      </div>
    );
  }

  const reward = maxReward(detail.levels);
  const expires = fmtExpires(detail.endsAt);

  return (
    <div className="flex h-full flex-col overflow-hidden" style={{ background: C.bg }}>
      <div className="flex shrink-0 items-center gap-2 px-3 pb-2 pt-4">
        <button type="button" onClick={onBack} className="grid h-8 w-8 place-items-center rounded-xl"
          style={{ background: C.l2 }}>
          <ChevronLeft size={16} style={{ color: C.t2 }} />
        </button>
        <p className="text-sm font-bold" style={{ color: C.t1 }}>Мероприятие</p>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto px-4 pb-6" style={{ scrollbarWidth: 'none' }}>
        {detail.hasCover && (
          <div className="h-36 w-full overflow-hidden rounded-2xl">
            <img src={campaignCoverUrl(detail.id)} alt="" className="h-full w-full object-cover" />
          </div>
        )}

        <div>
          <p className="text-xl font-black leading-snug" style={{ color: C.t1 }}>{detail.title}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {reward > 0 && (
              <span className="flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-black"
                style={{ background: `${C.purple}28`, color: C.purple }}>
                <Trophy size={10} /> до {reward} дн. Sky Prime
              </span>
            )}
            {expires && (
              <span className="flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-semibold"
                style={{ background: C.l2, color: C.t3 }}>
                <Clock size={10} /> {expires}
              </span>
            )}
          </div>
        </div>

        {detail.description && (
          <p className="text-[13px] leading-relaxed" style={{ color: C.t2 }}>{detail.description}</p>
        )}

        {detail.conditions && (
          <div className="rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.border}` }}>
            <p className="text-[10px] font-bold" style={{ color: C.t3 }}>УСЛОВИЯ</p>
            <p className="mt-1 whitespace-pre-line text-[12px] leading-relaxed" style={{ color: C.t2 }}>{detail.conditions}</p>
          </div>
        )}

        {detail.levels.length > 0 && (
          <div className="rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.border}` }}>
            <p className="text-[10px] font-bold" style={{ color: C.t3 }}>ШКАЛА НАГРАД</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {detail.levels.map((lv) => {
                const reached = (mine?.views ?? 0) >= lv.viewsThreshold;
                return (
                  <span key={lv.id} className="rounded-lg px-2 py-1 text-[10px] font-semibold"
                    style={{ background: reached ? `${C.purple}28` : C.l2, color: reached ? C.purple : C.t3 }}>
                    {fmtNum(lv.viewsThreshold)} → {lv.rewardDays} дн.
                  </span>
                );
              })}
            </div>
          </div>
        )}

        {error && (
          <p className="flex items-center gap-1.5 text-[12px]" style={{ color: C.red }}>
            <AlertTriangle size={12} /> {error}
          </p>
        )}

        {!mine ? (
          <div className="rounded-2xl p-4" style={{ background: C.l1, border: `1px solid ${C.border}` }}>
            <p className="text-xs font-bold" style={{ color: C.t1 }}>Участвовать</p>
            <p className="mt-1 text-[11px] leading-relaxed" style={{ color: C.t3 }}>
              Нажми «Участвовать» — получишь свою уникальную ссылку. Опубликуй видео и добавь
              ссылку в описание: переходы по ней и есть подтверждённые просмотры.
            </p>
            <input value={videoUrl} onChange={(e) => setVideoUrl(e.target.value)}
              placeholder="Ссылка на видео (можно добавить позже)"
              className="mt-2 w-full rounded-xl px-3 py-2 text-xs outline-none"
              style={{ background: C.l2, border: `1px solid ${C.border}`, color: C.t1 }} />
            <button type="button" disabled={busyJoin} onClick={() => void join()}
              className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-xl py-2.5 text-xs font-bold disabled:opacity-50"
              style={{ background: `linear-gradient(135deg, ${C.purple}, ${C.accent})`, color: '#fff' }}>
              {busyJoin ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />} Участвовать
            </button>
          </div>
        ) : (
          <>
            <ProgressBar mine={mine} />

            {mine.status === 'suspicious' && (
              <div className="flex items-start gap-2 rounded-2xl p-3"
                style={{ background: 'rgba(245,158,11,0.1)', border: `1px solid ${C.amber}40` }}>
                <AlertTriangle size={13} style={{ color: C.amber, flexShrink: 0, marginTop: 1 }} />
                <p className="text-[11px] leading-relaxed" style={{ color: C.t2 }}>
                  Активность на ссылке выглядит необычно — участие ушло на дополнительную
                  проверку. Заявку на награду это не отменяет.
                </p>
              </div>
            )}

            <div className="rounded-2xl p-4" style={{ background: C.l1, border: `1px solid ${C.border}` }}>
              <p className="flex items-center gap-1.5 text-xs font-bold" style={{ color: C.t1 }}>
                <Link2 size={13} style={{ color: C.purple }} /> Твоя уникальная ссылка
              </p>
              <div className="mt-2 flex items-center gap-2 rounded-xl px-3 py-2.5"
                style={{ background: 'rgba(0,0,0,0.3)', border: `1px solid ${C.border}` }}>
                <span className="flex-1 truncate font-mono text-[11px]" style={{ color: C.t2 }}>
                  {link ? campaignLinkUrl(link) : '…'}
                </span>
                <button type="button" onClick={() => void copyLink()}
                  className="grid h-7 w-7 shrink-0 place-items-center rounded-lg"
                  style={{ background: copied ? 'rgba(34,197,94,0.2)' : C.l2 }}>
                  {copied ? <Check size={13} style={{ color: C.green }} /> : <Copy size={13} style={{ color: C.t2 }} />}
                </button>
              </div>
              <button type="button" disabled={busyRegen} onClick={() => void regenerate()}
                className="mt-2 flex items-center gap-1 text-[10px] font-semibold disabled:opacity-50" style={{ color: C.t3 }}>
                {busyRegen ? <Loader2 size={10} className="animate-spin" /> : <RefreshCw size={10} />} Перевыпустить ссылку
              </button>
            </div>

            <div className="rounded-2xl p-4" style={{ background: C.l1, border: `1px solid ${C.border}` }}>
              <p className="text-xs font-bold" style={{ color: C.t1 }}>Запросить подарок</p>
              {!ticketOpened ? (
                <>
                  <p className="mt-1 text-[11px] leading-relaxed" style={{ color: C.t3 }}>
                    {canRequest
                      ? 'Уровень достигнут — оформим заявку и откроем обращение в поддержку со всеми данными.'
                      : 'Появится, как только наберётся достаточно просмотров на следующий уровень.'}
                  </p>
                  <button type="button" disabled={!canRequest || busyReward} onClick={() => void requestReward()}
                    className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-xl py-2.5 text-xs font-bold disabled:opacity-40"
                    style={{ background: canRequest ? C.green : C.l2, color: canRequest ? '#04150c' : C.t3 }}>
                    {busyReward ? <Loader2 size={13} className="animate-spin" /> : <Gift size={13} />} Запросить подарок
                  </button>
                </>
              ) : (
                <div className="mt-2 space-y-2">
                  <p className="flex items-center gap-1.5 text-[12px]" style={{ color: C.green }}>
                    <Check size={13} /> Заявка отправлена — тикет открыт в поддержке.
                  </p>
                  <button type="button" onClick={openSupportChat}
                    className="flex w-full items-center justify-center gap-1.5 rounded-xl py-2.5 text-xs font-bold"
                    style={{ background: C.accent, color: '#fff' }}>
                    <LifeBuoy size={13} /> Открыть чат поддержки
                  </button>
                </div>
              )}
            </div>

            {mine.grants.length > 0 && (
              <div className="rounded-2xl p-4" style={{ background: C.l1, border: `1px solid ${C.border}` }}>
                <p className="text-xs font-bold" style={{ color: C.t1 }}>История наград</p>
                <div className="mt-2 space-y-2">
                  {mine.grants.map((g) => (
                    <div key={g.id} className="flex items-center justify-between rounded-xl px-3 py-2"
                      style={{ background: C.l2 }}>
                      <div>
                        <p className="text-[11px] font-semibold" style={{ color: C.t1 }}>
                          {fmtNum(g.viewsAtRequest)} просмотров → {g.rewardDays} дн. Prime
                        </p>
                        <p className="text-[10px]" style={{ color: C.t3 }}>
                          {fmtDate(g.createdAt)}{g.grantedAt ? ` · начислено ${fmtDate(g.grantedAt)}` : ''}
                        </p>
                      </div>
                      <span className="shrink-0 text-[10px] font-bold" style={{ color: GRANT_STATUS_COLOR[g.status] }}>
                        {GRANT_STATUS_LABEL[g.status]}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

/* ─── Точка входа вкладки ────────────────────────────────────────────── */

export const Campaigns = () => {
  const [openId, setOpenId] = useState<string | null>(null);

  return openId
    ? <CampaignDetailScreen campaignId={openId} onBack={() => setOpenId(null)} />
    : <CampaignsList onOpen={setOpenId} />;
};
