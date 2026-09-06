/* ======================================================================
   SKY ПВЗ  —  Мои ПВЗ (мультиучёт) + Модерация
====================================================================== */
import { useState } from 'react';
import {
  Plus, MapPin, Star, ChevronRight, ShieldCheck,
  Video, FileText, MessageSquare, History as HistoryIcon,
  CheckCircle2, XCircle, AlertTriangle, Sparkles, Building2,
} from 'lucide-react';
import { C, fmt } from '@/marketplace/SkyMarket';
import { usePVZStore } from './store';
import { GlassCard, EmptyState, Pill, ScoreRing, PVZSlide, PVZConfirm } from './shared';
import type { PVZ, PVZStatus, ModerationAction } from './types';

export const STATUS_CFG: Record<PVZStatus, { label: string; color: string }> = {
  draft:      { label:'Черновик',        color: C.t3 },
  in_review:  { label:'На модерации',    color: C.amber },
  needs_fix:  { label:'Нужны доработки', color: C.red },
  approved:   { label:'Одобрен',         color: C.green },
  active:     { label:'Активен',         color: C.green },
  suspended:  { label:'Приостановлен',   color: C.red },
  rejected:   { label:'Отклонён',        color: C.red },
};

/* ── Карточка ПВЗ в списке ────────────────────────────────────────── */
const PVZCard = ({ pvz, onOpen, onContinue }: { pvz: PVZ; onOpen: () => void; onContinue: () => void }) => {
  const { snapshotsFor, balanceFor } = usePVZStore();
  const snaps = snapshotsFor(pvz.id).slice(-30);
  const revenue = snaps.reduce((a,s)=>a+s.revenue,0);
  const cfg = STATUS_CFG[pvz.status];
  const isDraft = ['draft','in_review','needs_fix'].includes(pvz.status);

  return (
    <GlassCard className="p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold truncate" style={{ color: C.t1 }}>{pvz.name || 'Новый ПВЗ (без названия)'}</p>
          <p className="text-[11px] flex items-center gap-1 mt-0.5 truncate" style={{ color: C.t3 }}><MapPin size={10}/> {pvz.city ? `${pvz.city}, ${pvz.address}` : 'Адрес не указан'}</p>
        </div>
        <Pill label={cfg.label} color={cfg.color}/>
      </div>
      {pvz.status === 'active' || pvz.status === 'approved' ? (
        <div className="grid grid-cols-3 gap-2 mt-3">
          <div><p className="text-[10px]" style={{ color: C.t3 }}>Выручка 30д</p><p className="text-xs font-bold" style={{ color: C.t1 }}>{fmt(revenue)}</p></div>
          <div><p className="text-[10px]" style={{ color: C.t3 }}>Рейтинг</p><p className="text-xs font-bold flex items-center gap-1" style={{ color: C.t1 }}><Star size={10} style={{ color: C.amber }}/>{pvz.rating.toFixed(1)}</p></div>
          <div><p className="text-[10px]" style={{ color: C.t3 }}>Баланс</p><p className="text-xs font-bold" style={{ color: C.green }}>{fmt(balanceFor(pvz.id))}</p></div>
        </div>
      ) : (
        <p className="text-xs mt-2.5" style={{ color: C.t3 }}>
          {pvz.status === 'needs_fix' ? 'Модератор запросил доработки — продолжите мастер регистрации' :
           pvz.status === 'in_review' ? 'Заявка на проверке у модератора' : 'Регистрация не завершена'}
        </p>
      )}
      <button type="button" onClick={isDraft && pvz.status!=='in_review' ? onContinue : onOpen}
        className="w-full mt-3 flex items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-bold"
        style={{ background: isDraft && pvz.status!=='in_review' ? C.acc : C.l2, color: isDraft && pvz.status!=='in_review' ? '#fff' : C.t1 }}>
        {isDraft && pvz.status!=='in_review' ? 'Продолжить регистрацию' : 'Открыть'} <ChevronRight size={13}/>
      </button>
    </GlassCard>
  );
};

/* ── Мультиучёт: сравнение и сводка по всем ПВЗ владельца ─────────── */
export const MultiHub = ({ pvzList, onSelect, onCreate, onContinueWizard }: {
  pvzList: PVZ[]; onSelect: (id: string) => void; onCreate: () => void; onContinueWizard: (id: string) => void;
}) => {
  const { snapshotsFor, balanceFor } = usePVZStore();
  const active = pvzList.filter(p => ['active','approved'].includes(p.status));

  const totalRevenue = active.reduce((a,p) => a + snapshotsFor(p.id).slice(-30).reduce((x,s)=>x+s.revenue,0), 0);
  const totalBalance = active.reduce((a,p) => a + balanceFor(p.id), 0);
  const avgRating = active.length ? active.reduce((a,p)=>a+p.rating,0)/active.length : 0;

  return (
    <div className="h-full overflow-y-auto pb-10" style={{ scrollbarWidth:'none' }}>
      <div className="px-5 pt-5 flex items-center justify-between">
        <p className="text-lg font-black" style={{ color: C.t1 }}>Мои ПВЗ</p>
        <button type="button" onClick={onCreate} className="flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-bold text-white" style={{ background: C.acc }}>
          <Plus size={14}/> Создать ПВЗ
        </button>
      </div>

      {active.length > 1 && (
        <div className="px-5 grid grid-cols-3 gap-2.5 mt-4">
          <GlassCard className="p-3"><p className="text-[10px]" style={{ color: C.t3 }}>Общая выручка (30д)</p><p className="text-sm font-black mt-0.5" style={{ color: C.t1 }}>{fmt(totalRevenue)}</p></GlassCard>
          <GlassCard className="p-3"><p className="text-[10px]" style={{ color: C.t3 }}>Общий баланс</p><p className="text-sm font-black mt-0.5" style={{ color: C.green }}>{fmt(totalBalance)}</p></GlassCard>
          <GlassCard className="p-3"><p className="text-[10px]" style={{ color: C.t3 }}>Средний рейтинг</p><p className="text-sm font-black mt-0.5 flex items-center gap-1" style={{ color: C.t1 }}><Star size={12} style={{ color: C.amber }}/>{avgRating.toFixed(1)}</p></GlassCard>
        </div>
      )}

      {active.length > 1 && (
        <div className="px-5 mt-4">
          <p className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: C.t3 }}>Сравнение эффективности</p>
          <GlassCard className="p-3 space-y-2">
            {active.map(p => {
              const rev = snapshotsFor(p.id).slice(-30).reduce((a,s)=>a+s.revenue,0);
              const pct = totalRevenue > 0 ? (rev/totalRevenue)*100 : 0;
              return (
                <div key={p.id}>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span style={{ color: C.t1 }}>{p.name}</span>
                    <span style={{ color: C.t3 }}>{fmt(rev)}</span>
                  </div>
                  <div className="h-1.5 rounded-full overflow-hidden" style={{ background: C.l2 }}>
                    <div className="h-full rounded-full" style={{ width:`${pct}%`, background: C.acc }}/>
                  </div>
                </div>
              );
            })}
          </GlassCard>
        </div>
      )}

      <div className="px-5 mt-4 space-y-3">
        {pvzList.length === 0 ? (
          <EmptyState icon={Building2} title="У вас пока нет ПВЗ" sub="Создайте свой первый пункт выдачи заказов Sky"/>
        ) : pvzList.map(p => (
          <PVZCard key={p.id} pvz={p} onOpen={() => onSelect(p.id)} onContinue={() => onContinueWizard(p.id)}/>
        ))}
      </div>
    </div>
  );
};

/* ══════════════════════════════════════════════════════════════════
   МОДЕРАЦИЯ (для админов)
══════════════════════════════════════════════════════════════════ */
const REASON_PRESETS = [
  'Плохое освещение', 'Несоответствие планировке', 'Отсутствует брендинг',
  'Видео низкого качества', 'Признаки монтажа видео', 'Не пройдены все точки маршрута',
  'Документы неполные', 'Помещение не готово',
];

const ModerationQueueItem = ({ pvz, onOpen }: { pvz: PVZ; onOpen: () => void }) => (
  <button type="button" onClick={onOpen} className="w-full text-left">
    <GlassCard className="p-4 flex items-center gap-3">
      <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl" style={{ background: C.accBg }}>
        <ShieldCheck size={18} style={{ color: C.acc }}/>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold truncate" style={{ color: C.t1 }}>{pvz.name}</p>
        <p className="text-[11px] truncate" style={{ color: C.t3 }}>{pvz.city}, {pvz.address}</p>
      </div>
      <div className="text-right shrink-0">
        <p className="text-[10px]" style={{ color: C.t3 }}>Отправлено</p>
        <p className="text-[11px] font-semibold" style={{ color: C.t1 }}>{pvz.submittedAt ? new Date(pvz.submittedAt).toLocaleDateString('ru-RU') : '—'}</p>
      </div>
      <ChevronRight size={15} style={{ color: C.t3 }}/>
    </GlassCard>
  </button>
);

const ModerationDetail = ({ pvz, onClose }: { pvz: PVZ; onClose: () => void }) => {
  const { analysisFor, sessionFor, decide, addComment, commentsFor, decisionsFor, historyFor } = usePVZStore();
  const analysis = analysisFor(pvz.id);
  const session = sessionFor(pvz.id);
  const comments = commentsFor(pvz.id);
  const decisions = decisionsFor(pvz.id);
  const history = historyFor(pvz.id);
  const [tab, setTab] = useState<'overview'|'video'|'docs'|'history'>('overview');
  const [comment, setComment] = useState('');
  const [decisionModal, setDecisionModal] = useState<ModerationAction | null>(null);
  const [reasons, setReasons] = useState<string[]>([]);
  const [decisionComment, setDecisionComment] = useState('');

  const markers = session ? session.checkpoints.map(c => ({
    label: c.task, found: c.confirmedAt !== null,
  })) : [];

  const submitDecision = () => {
    if (!decisionModal) return;
    decide(pvz.id, decisionModal, decisionComment, reasons);
    setDecisionModal(null); setReasons([]); setDecisionComment('');
    onClose();
  };

  return (
    <PVZSlide open onClose={onClose} title={`Модерация · ${pvz.name}`}>
      <div className="px-5 pt-4 flex gap-1.5 overflow-x-auto" style={{ scrollbarWidth:'none' }}>
        {(['overview','video','docs','history'] as const).map(t => (
          <button key={t} type="button" onClick={() => setTab(t)}
            className="shrink-0 rounded-xl px-3 py-1.5 text-[11px] font-semibold" style={{ background: tab===t ? C.accBg : C.l2, color: tab===t ? C.acc : C.t3 }}>
            {t==='overview'?'Обзор':t==='video'?'Видео и ИИ':t==='docs'?'Документы':'История'}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="px-5 py-4 space-y-3">
          <GlassCard className="p-4">
            <p className="text-xs font-bold mb-2" style={{ color: C.t1 }}>Основная информация</p>
            <div className="space-y-1 text-xs">
              <p style={{ color: C.t2 }}>Формат: {pvz.format}</p>
              <p style={{ color: C.t2 }}>Телефон: {pvz.phone} · {pvz.email}</p>
              <p style={{ color: C.t2 }}>Адрес: {pvz.city}, {pvz.address} ({pvz.entrance})</p>
              <p style={{ color: C.t2 }}>Координаты: {pvz.location.lat.toFixed(5)}, {pvz.location.lng.toFixed(5)}</p>
            </div>
          </GlassCard>
          {pvz.layout && (
            <GlassCard className="p-4">
              <p className="text-xs font-bold mb-2" style={{ color: C.t1 }}>Планировка</p>
              <p className="text-xs" style={{ color: C.t2 }}>Площадь: {pvz.layout.areaSqm} м² · Потолки: {pvz.layout.ceilingHeightM} м · Склад: {pvz.layout.storageSqm} м²</p>
              <div className="flex gap-2 mt-2 flex-wrap">{pvz.layout.zones.map((z,i) => <Pill key={i} label={`${z.name} · ${z.sqm}м²`} color={C.acc}/>)}</div>
            </GlassCard>
          )}
          <GlassCard className="p-4">
            <p className="text-xs font-bold mb-2" style={{ color: C.t1 }}>Чек-лист помещения</p>
            <div className="grid grid-cols-2 gap-1.5">
              {pvz.checklist.map(c => (
                <div key={c.key} className="flex items-center gap-1.5 text-[11px]">
                  {c.status==='pass' ? <CheckCircle2 size={11} style={{ color: C.green }}/> : c.status==='fail' ? <XCircle size={11} style={{ color: C.red }}/> : <AlertTriangle size={11} style={{ color: C.t3 }}/>}
                  <span style={{ color: C.t2 }}>{c.key}</span>
                </div>
              ))}
            </div>
          </GlassCard>
          {pvz.branding && (
            <GlassCard className="p-4 flex items-center gap-3">
              <ScoreRing score={pvz.branding.score} size={56}/>
              <p className="text-xs flex-1" style={{ color: C.t2 }}>Балл брендинга по итогам самопроверки продавца</p>
            </GlassCard>
          )}
          <GlassCard className="p-4">
            <p className="text-xs font-bold mb-2 flex items-center gap-1.5" style={{ color: C.t1 }}><MessageSquare size={13}/> Комментарии модераторов</p>
            <div className="space-y-2 mb-2">
              {comments.length === 0 ? <p className="text-[11px]" style={{ color: C.t3 }}>Пока нет комментариев</p> :
                comments.map(c => <div key={c.id}><p className="text-[11px] font-semibold" style={{ color: C.t1 }}>{c.authorName}</p><p className="text-[11px]" style={{ color: C.t2 }}>{c.text}</p></div>)}
            </div>
            <div className="flex gap-2">
              <input value={comment} onChange={e => setComment(e.target.value)} placeholder="Добавить комментарий..."
                className="flex-1 rounded-lg px-2.5 py-1.5 text-xs outline-none" style={{ background: C.l2, border:`1px solid ${C.brd}`, color: C.t1 }}/>
              <button type="button" onClick={() => { if(comment.trim()){addComment(pvz.id, comment); setComment('');} }} className="rounded-lg px-3 py-1.5 text-xs font-bold text-white" style={{ background: C.acc }}>OK</button>
            </div>
          </GlassCard>
        </div>
      )}

      {tab === 'video' && (
        <div className="px-5 py-4 space-y-3">
          {!analysis ? <EmptyState icon={Video} title="Видео-проверка не пройдена"/> : (
            <>
              <GlassCard className="p-4 flex items-center gap-4">
                <ScoreRing score={analysis.overallScore} size={76}/>
                <div className="flex-1">
                  <p className="text-sm font-bold" style={{ color: C.t1 }}>Общий балл ИИ-анализа</p>
                  <p className="text-xs mt-1" style={{ color: C.t3 }}>{session?.videoName}</p>
                </div>
              </GlassCard>
              <GlassCard className="p-3">
                <p className="text-xs font-bold mb-2" style={{ color: C.t1 }}>Разметка по ключевым моментам</p>
                <div className="space-y-1">
                  {markers.map((m,i) => (
                    <div key={i} className="flex items-center gap-2 text-[11px]">
                      {m.found ? <CheckCircle2 size={11} style={{ color: C.green }}/> : <XCircle size={11} style={{ color: C.red }}/>}
                      <span style={{ color: C.t2 }}>{m.found ? 'Найдено: ' : 'Не найдено: '}{m.label}</span>
                    </div>
                  ))}
                  {(analysis.editingDetected || analysis.splicesDetected) && (
                    <div className="flex items-center gap-2 text-[11px]"><AlertTriangle size={11} style={{ color: C.red }}/><span style={{ color: C.red }}>Обнаружены нарушения: признаки монтажа/склеек</span></div>
                  )}
                  {analysis.lightingQuality < 75 && (
                    <div className="flex items-center gap-2 text-[11px]"><AlertTriangle size={11} style={{ color: C.amber }}/><span style={{ color: C.amber }}>Обнаружено плохое освещение</span></div>
                  )}
                </div>
              </GlassCard>
              <GlassCard className="p-3">
                <p className="text-xs font-bold mb-2 flex items-center gap-1.5" style={{ color: C.t1 }}><Sparkles size={13} style={{ color: C.acc }}/> Рекомендации ИИ</p>
                {analysis.recommendations.map((r,i) => <p key={i} className="text-xs mb-1" style={{ color: C.t2 }}>• {r}</p>)}
              </GlassCard>
            </>
          )}
        </div>
      )}

      {tab === 'docs' && (
        <div className="px-5 py-4 space-y-2">
          {pvz.documents.length === 0 ? <EmptyState icon={FileText} title="Документы не загружены"/> : pvz.documents.map(d => (
            <div key={d.id} className="flex items-center gap-3 rounded-xl p-3" style={{ background: C.l1, border:`1px solid ${C.brd}` }}>
              <FileText size={15} style={{ color: C.acc }}/>
              <div className="flex-1"><p className="text-xs font-semibold" style={{ color: C.t1 }}>{d.title}</p><p className="text-[10px]" style={{ color: C.t3 }}>{d.fileName}</p></div>
            </div>
          ))}
          {pvz.layout?.photos.map((p,i) => <img key={i} src={p} className="w-full rounded-xl"/>)}
        </div>
      )}

      {tab === 'history' && (
        <div className="px-5 py-4 space-y-2">
          {decisions.map(d => (
            <div key={d.id} className="rounded-xl p-3" style={{ background: C.l1, border:`1px solid ${C.brd}` }}>
              <p className="text-xs font-bold" style={{ color: d.action==='approved'?C.green:d.action==='rejected'?C.red:C.amber }}>{d.action} · {d.reviewerName}</p>
              <p className="text-[11px] mt-1" style={{ color: C.t2 }}>{d.comment}</p>
            </div>
          ))}
          {history.map(h => (
            <div key={h.id} className="flex items-start gap-2 text-[11px] px-1">
              <HistoryIcon size={11} className="mt-0.5 shrink-0" style={{ color: C.t3 }}/>
              <span style={{ color: C.t2 }}>{h.description} <span style={{ color: C.t3 }}>· {new Date(h.createdAt).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}</span></span>
            </div>
          ))}
        </div>
      )}

      {pvz.status === 'in_review' && (
        <div className="p-4 flex gap-2 sticky bottom-0" style={{ background: C.bg, borderTop:`1px solid ${C.brd}` }}>
          <button type="button" onClick={() => setDecisionModal('rejected')} className="flex-1 rounded-xl py-2.5 text-xs font-bold" style={{ background:'rgba(244,63,94,0.1)', color: C.red }}>Отклонить</button>
          <button type="button" onClick={() => setDecisionModal('needs_fix')} className="flex-1 rounded-xl py-2.5 text-xs font-bold" style={{ background:'rgba(245,158,11,0.1)', color: C.amber }}>Доработки</button>
          <button type="button" onClick={() => setDecisionModal('approved')} className="flex-1 rounded-xl py-2.5 text-xs font-bold text-white" style={{ background: C.green }}>Одобрить</button>
        </div>
      )}

      <PVZConfirm open={!!decisionModal} onClose={() => setDecisionModal(null)} title={decisionModal==='approved'?'Одобрить ПВЗ?':decisionModal==='rejected'?'Отклонить заявку':'Запросить доработки'}>
        {decisionModal !== 'approved' && (
          <div className="flex flex-wrap gap-1.5 mb-3">
            {REASON_PRESETS.map(r => (
              <button key={r} type="button" onClick={() => setReasons(arr => arr.includes(r) ? arr.filter(x=>x!==r) : [...arr, r])}
                className="text-[10px] font-semibold px-2 py-1 rounded-full" style={{ background: reasons.includes(r) ? C.accBg : C.l2, color: reasons.includes(r) ? C.acc : C.t3 }}>
                {r}
              </button>
            ))}
          </div>
        )}
        <textarea value={decisionComment} onChange={e => setDecisionComment(e.target.value)} rows={3} placeholder="Комментарий для продавца..."
          className="w-full resize-none rounded-xl px-3 py-2 text-xs outline-none mb-3" style={{ background: C.l2, border:`1px solid ${C.brd}`, color: C.t1 }}/>
        <div className="flex gap-2">
          <button type="button" onClick={() => setDecisionModal(null)} className="flex-1 rounded-xl py-2 text-xs font-bold" style={{ background: C.l2, color: C.t1 }}>Отмена</button>
          <button type="button" onClick={submitDecision} className="flex-1 rounded-xl py-2 text-xs font-bold text-white" style={{ background: C.acc }}>Подтвердить</button>
        </div>
      </PVZConfirm>
    </PVZSlide>
  );
};

export const ModerationPanel = () => {
  const { pendingModeration } = usePVZStore();
  const queue = pendingModeration();
  const [openId, setOpenId] = useState<string | null>(null);
  const open = queue.find(p => p.id === openId);

  return (
    <div className="h-full overflow-y-auto pb-10" style={{ scrollbarWidth:'none' }}>
      <div className="px-5 pt-5">
        <p className="text-lg font-black" style={{ color: C.t1 }}>Модерация ПВЗ</p>
        <p className="text-xs mt-1" style={{ color: C.t3 }}>{queue.length} заявок ожидают проверки</p>
      </div>
      <div className="px-5 mt-4 space-y-2.5">
        {queue.length === 0 ? <EmptyState icon={ShieldCheck} title="Очередь модерации пуста" sub="Все заявки на регистрацию ПВЗ обработаны"/> :
          queue.map(p => <ModerationQueueItem key={p.id} pvz={p} onOpen={() => setOpenId(p.id)}/>)}
      </div>
      {open && <ModerationDetail pvz={open} onClose={() => setOpenId(null)}/>}
    </div>
  );
};
