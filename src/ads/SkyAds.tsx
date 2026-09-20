/* ===============================================================
   SKY ADS  -  Рекламный кабинет
=============================================================== */
import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus, ChevronLeft, TrendingUp, Eye, MousePointer, Calendar,
  Play, Pause, Trash2, Check, AlertCircle, Upload, Image, FileText,
  BarChart2, Megaphone, Clock, X, ChevronRight, Shield, Rocket,
} from 'lucide-react';
import {
  useAdsStore, AD_PLACEMENTS, AD_FORMAT_LABEL, AD_STATUS_LABEL, AD_STATUS_COLOR,
  fmtBudget, campaignMediaUrl, type AdCampaign, type AdPlacement, type AdFormat,
} from './store';
import { apiUploadAdMedia } from './adsApi';
import { useMoney } from '@/wallet/store';
import { useAuthStore } from '@/core/auth/store';

const C = {
  bg:'var(--bg)', l1:'var(--bg-l1)', l2:'var(--bg-l2)', l3:'var(--bg-l3)',
  border:'var(--border)', b2:'var(--border-m)',
  t1:'var(--t1)', t2:'var(--t2)', t3:'var(--t3)',
  accent:'var(--accent)', green:'var(--green)', amber:'var(--amber)', red:'var(--red)',
};

/* -- Stat card ------------------------------------------------ */
const Stat = ({ icon: Icon, label, value, color }: { icon: any; label: string; value: string|number; color: string }) => (
  <div className="flex-1 rounded-2xl p-3.5" style={{ background:C.l2, border:`1px solid ${C.border}` }}>
    <div className="flex items-center gap-1.5 mb-1.5">
      <Icon size={13} style={{ color }}/>
      <span className="text-[10px] uppercase tracking-wider font-semibold" style={{ color:C.t3 }}>{label}</span>
    </div>
    <p className="text-xl font-black" style={{ color }}>{value}</p>
  </div>
);

/* -- Campaign Card ------------------------------------------ */
const CANCELLABLE: AdCampaign['status'][] = ['draft', 'moderation', 'approved', 'scheduled'];

const CampaignCard = ({ c, onOpen }: { c: AdCampaign; onOpen: () => void }) => {
  const { pause, resume, cancel } = useAdsStore();
  const [confirm, setConfirm] = useState(false);
  const p = AD_PLACEMENTS.find(x => x.placement === c.placement);
  const sc = AD_STATUS_COLOR[c.status];
  const budget_pct = c.budget > 0 ? Math.min(100, c.spent/c.budget*100) : 0;

  return (
    <motion.div whileTap={{ scale:.98 }}
      className="rounded-2xl overflow-hidden cursor-pointer"
      style={{ background:C.l1, border:`1px solid ${c.status==='active' ? C.accent+'30' : C.border}` }}
      onClick={onOpen}>
      {/* Status bar */}
      <div className="h-0.5 w-full" style={{ background:sc }}/>
      <div className="p-4">
        <div className="flex items-start justify-between gap-2 mb-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              {p && <p.Icon size={15} style={{ color:C.t2 }}/>}
              <p className="text-sm font-bold truncate" style={{ color:C.t1 }}>{c.title}</p>
            </div>
            <p className="text-xs truncate" style={{ color:C.t3 }}>{p?.label}</p>
          </div>
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0"
            style={{ background:`${sc}18`, color:sc }}>
            {AD_STATUS_LABEL[c.status]}
          </span>
        </div>

        {/* Stats row */}
        {c.status === 'active' && (
          <div className="flex gap-3 mb-3">
            <div className="flex items-center gap-1">
              <Eye size={11} style={{ color:C.t3 }}/>
              <span className="text-xs" style={{ color:C.t2 }}>{c.impressions.toLocaleString('ru')}</span>
            </div>
            <div className="flex items-center gap-1">
              <MousePointer size={11} style={{ color:C.t3 }}/>
              <span className="text-xs" style={{ color:C.t2 }}>{c.clicks.toLocaleString('ru')}</span>
            </div>
            <div className="flex items-center gap-1">
              <TrendingUp size={11} style={{ color:C.t3 }}/>
              <span className="text-xs" style={{ color:C.green }}>{c.ctr}% CTR</span>
            </div>
          </div>
        )}

        {/* Budget progress */}
        <div className="mb-3">
          <div className="flex justify-between text-[10px] mb-1" style={{ color:C.t3 }}>
            <span>Потрачено {fmtBudget(c.spent)}</span>
            <span>из {fmtBudget(c.budget)}</span>
          </div>
          <div className="h-1.5 rounded-full overflow-hidden" style={{ background:C.l3 }}>
            <div className="h-full rounded-full transition-all" style={{ width:`${budget_pct}%`, background:C.accent }}/>
          </div>
        </div>

        {/* Dates + actions */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1">
            <Calendar size={10} style={{ color:C.t3 }}/>
            <span className="text-[10px]" style={{ color:C.t3 }}>
              {c.startDate ? new Date(c.startDate).toLocaleDateString('ru',{day:'numeric',month:'short'}) : '—'} -{' '}
              {c.endDate ? new Date(c.endDate).toLocaleDateString('ru',{day:'numeric',month:'short'}) : '—'}
            </span>
          </div>
          <div className="flex gap-1" onClick={e => e.stopPropagation()}>
            {c.status === 'active' && (
              <button type="button" onClick={() => pause(c.id)}
                className="grid h-7 w-7 place-items-center rounded-xl hover:bg-white/5">
                <Pause size={13} style={{ color:C.t2 }}/>
              </button>
            )}
            {c.status === 'paused' && (
              <button type="button" onClick={() => resume(c.id)}
                className="grid h-7 w-7 place-items-center rounded-xl hover:bg-white/5">
                <Play size={13} style={{ color:C.green }}/>
              </button>
            )}
            {CANCELLABLE.includes(c.status) && (confirm ? (
              <div className="flex gap-1">
                <button type="button" onClick={() => cancel(c.id)}
                  className="grid h-7 w-7 place-items-center rounded-xl"
                  style={{ background:'rgba(248,113,113,0.15)' }}>
                  <Check size={13} style={{ color:C.red }}/>
                </button>
                <button type="button" onClick={() => setConfirm(false)}
                  className="grid h-7 w-7 place-items-center rounded-xl hover:bg-white/5">
                  <X size={13} style={{ color:C.t3 }}/>
                </button>
              </div>
            ) : (
              <button type="button" onClick={() => setConfirm(true)}
                className="grid h-7 w-7 place-items-center rounded-xl hover:bg-white/5">
                <Trash2 size={13} style={{ color:C.t3 }}/>
              </button>
            ))}
          </div>
        </div>
      </div>
    </motion.div>
  );
};

/* -- Create Campaign Flow ---------------------------------- */
const CreateCampaign = ({ onDone }: { onDone: () => void }) => {
  const { currentUserId } = useAuthStore();
  const { getBalance } = useMoney();
  const { create } = useAdsStore();

  const [step, setStep] = useState<'placement'|'format'|'content'|'budget'|'review'|'done'>('placement');
  const [placement, setPlacement]   = useState<AdPlacement|null>(null);
  const [format,    setFormat]      = useState<AdFormat|null>(null);
  const [title,     setTitle]       = useState('');
  const [desc,      setDesc]        = useState('');
  const [link,      setLink]        = useState('');
  const [image,     setImage]       = useState<string|undefined>(); // превью — data URL для показа до отправки
  const [imageFile, setImageFile]   = useState<File|undefined>();   // настоящие байты — грузятся на сервер при отправке
  const [days,      setDays]        = useState(7);
  const [daily,     setDaily]       = useState(500);
  const [err,       setErr]         = useState('');
  const [busy,      setBusy]        = useState(false);
  const imgRef = useRef<HTMLInputElement>(null);

  const pricing = AD_PLACEMENTS.find(p => p.placement === placement);
  const budget  = daily * days; // оценка для интерфейса — настоящую цену всегда считает сервер
  const balance = getBalance(currentUserId ?? '');

  const STEP_LABELS = ['Площадка','Формат','Контент','Бюджет','Итого'];
  const stepIdx = ['placement','format','content','budget','review'].indexOf(step);

  const submit = async () => {
    setErr('');
    if (!placement || !format || !title.trim()) { setErr('Заполните все поля'); return; }
    if (balance < budget) { setErr(`Недостаточно средств. Нужно ${fmtBudget(budget)}`); return; }

    setBusy(true);
    let mediaId: string | undefined;
    if (imageFile) {
      const uploaded = await apiUploadAdMedia(imageFile);
      if (!uploaded) { setBusy(false); setErr('Не удалось загрузить изображение'); return; }
      mediaId = uploaded.mediaId;
    }

    const r = await create({
      title:        title.trim(),
      description:  desc.trim(),
      mediaId,
      linkUrl:      link.trim() || undefined,
      placement,
      format,
      dailyLimit:   daily,
      durationDays: days,
      targetRegions: [],
    });
    setBusy(false);
    if (!r.ok) { setErr(r.reason ?? 'Не удалось создать кампанию'); return; }
    setStep('done');
  };

  if (step === 'done') return (
    <div className="flex flex-col items-center justify-center gap-5 py-12 px-6">
      <motion.div initial={{ scale:0 }} animate={{ scale:1 }}
        transition={{ type:'spring', stiffness:400, damping:18 }}
        className="grid h-20 w-20 place-items-center rounded-full"
        style={{ background:'rgba(79,110,247,0.12)', border:`2px solid ${C.accent}40` }}>
        <Rocket size={36} style={{ color:C.accent }}/>
      </motion.div>
      <div className="text-center">
        <p className="text-xl font-black" style={{ color:C.t1 }}>Кампания создана!</p>
        <p className="text-sm mt-1.5" style={{ color:C.t2 }}>
          Отправлена на модерацию. Обычно 2-24 часа.
        </p>
        <p className="text-xs mt-1" style={{ color:C.t3 }}>Списано: {fmtBudget(budget)}</p>
      </div>
      <button type="button" onClick={onDone}
        className="rounded-2xl px-8 py-3 text-sm font-bold text-white"
        style={{ background:C.accent }}>
        В кабинет
      </button>
    </div>
  );

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Step header */}
      <div className="flex items-center gap-3 px-4 py-3 shrink-0"
        style={{ borderBottom:`1px solid ${C.border}` }}>
        <button type="button" onClick={step==='placement' ? onDone : () => {
          const steps = ['placement','format','content','budget','review'] as const;
          setStep(steps[Math.max(0, steps.indexOf(step as any)-1)]);
        }} className="grid h-8 w-8 place-items-center rounded-full hover:bg-white/5">
          <ChevronLeft size={18} style={{ color:C.t2 }}/>
        </button>
        <div className="flex-1">
          <p className="text-sm font-bold" style={{ color:C.t1 }}>Новая кампания</p>
          <p className="text-xs" style={{ color:C.t3 }}>{STEP_LABELS[stepIdx] ?? ''}</p>
        </div>
        {/* Progress dots */}
        <div className="flex gap-1">
          {STEP_LABELS.map((_,i) => (
            <div key={i} className="rounded-full transition-all"
              style={{ width: i===stepIdx ? 16 : 6, height:6,
                background: i<=stepIdx ? C.accent : C.l3 }}/>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4" style={{ scrollbarWidth:'none' }}>

        {/* STEP 1: Placement */}
        {step === 'placement' && (
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wider mb-4" style={{ color:C.t3 }}>
              Где показать рекламу?
            </p>
            {AD_PLACEMENTS.map(p => (
              <motion.button key={p.placement} type="button" whileTap={{ scale:.97 }}
                onClick={() => { setPlacement(p.placement); setStep('format'); }}
                className="flex items-center gap-4 w-full rounded-2xl px-4 py-4 transition-all"
                style={{ background:C.l1, border:`1.5px solid ${placement===p.placement?C.accent:C.border}` }}>
                <div className="grid h-12 w-12 place-items-center rounded-2xl shrink-0"
                  style={{ background:C.l2 }}><p.Icon size={22} style={{ color:C.t2 }}/></div>
                <div className="flex-1 text-left">
                  <p className="text-sm font-bold" style={{ color:C.t1 }}>{p.label}</p>
                  <p className="text-xs mt-0.5 leading-snug" style={{ color:C.t3 }}>{p.description}</p>
                  <div className="flex items-center gap-3 mt-1.5">
                    <span className="text-[10px] font-bold" style={{ color:C.accent }}>
                      от {fmtBudget(p.pricePerDay)}/день
                    </span>
                    <span className="text-[10px]" style={{ color:C.t3 }}>
                      ~{p.maxImpressions.toLocaleString('ru')} показов/день
                    </span>
                  </div>
                </div>
                <ChevronRight size={16} style={{ color:C.t3 }}/>
              </motion.button>
            ))}
          </div>
        )}

        {/* STEP 2: Format */}
        {step === 'format' && pricing && (
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wider mb-4" style={{ color:C.t3 }}>
              Формат рекламы
            </p>
            {pricing.formats.map(f => (
              <motion.button key={f} type="button" whileTap={{ scale:.97 }}
                onClick={() => { setFormat(f); setStep('content'); }}
                className="flex items-center gap-3 w-full rounded-2xl px-4 py-3.5 transition-all"
                style={{ background:C.l1, border:`1.5px solid ${format===f?C.accent:C.border}` }}>
                <div className="grid h-10 w-10 place-items-center rounded-xl shrink-0"
                  style={{ background:`${C.accent}15` }}>
                  {f==='video'?<Play size={16} style={{ color:C.accent }}/>
                  :f==='image'?<Image size={16} style={{ color:C.accent }}/>
                  :<FileText size={16} style={{ color:C.accent }}/>}
                </div>
                <div className="flex-1 text-left">
                  <p className="text-sm font-semibold" style={{ color:C.t1 }}>{AD_FORMAT_LABEL[f]}</p>
                  <p className="text-xs" style={{ color:C.t3 }}>
                    {f==='video'?'MP4, WebM · до 30 секунд'
                    :f==='image'?'JPG, PNG · рекомендуется 1280×720'
                    :f==='text'?'Текст до 280 символов'
                    :'Текст + изображение'}
                  </p>
                </div>
                <ChevronRight size={16} style={{ color:C.t3 }}/>
              </motion.button>
            ))}
          </div>
        )}

        {/* STEP 3: Content */}
        {step === 'content' && (
          <div className="space-y-4">
            <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color:C.t3 }}>
              Контент рекламы
            </p>
            <div className="space-y-1">
              <label className="text-xs font-semibold" style={{ color:C.t3 }}>Заголовок *</label>
              <input value={title} onChange={e=>setTitle(e.target.value)} maxLength={60}
                placeholder="Краткий цепляющий заголовок"
                className="w-full rounded-2xl px-4 py-3 text-sm outline-none"
                style={{ background:C.l2, border:`1px solid ${C.border}`, color:C.t1 }}/>
              <p className="text-[10px] text-right" style={{ color:C.t3 }}>{title.length}/60</p>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold" style={{ color:C.t3 }}>Описание</label>
              <textarea value={desc} onChange={e=>setDesc(e.target.value)} rows={3} maxLength={280}
                placeholder="Расскажите о вашем предложении..."
                className="w-full rounded-2xl px-4 py-3 text-sm outline-none resize-none"
                style={{ background:C.l2, border:`1px solid ${C.border}`, color:C.t1 }}/>
            </div>
            {(format==='image'||format==='text_image') && (
              <div>
                <label className="text-xs font-semibold block mb-1.5" style={{ color:C.t3 }}>Изображение</label>
                <input ref={imgRef} type="file" accept="image/*" className="hidden"
                  onChange={e=>{
                    const f=e.target.files?.[0]; if(!f) return;
                    setImageFile(f);
                    const r=new FileReader(); r.onload=()=>setImage(r.result as string); r.readAsDataURL(f);
                  }}/>
                <div className="rounded-2xl cursor-pointer flex flex-col items-center justify-center gap-2 py-6 transition-colors"
                  style={{ border:`2px dashed ${image?C.accent:C.border}`, background:image?`${C.accent}06`:'transparent' }}
                  onClick={()=>imgRef.current?.click()}>
                  {image
                    ? <img src={image} alt="" className="h-20 object-cover rounded-xl"/>
                    : <><Upload size={22} style={{ color:C.t3 }}/><span className="text-xs" style={{ color:C.t3 }}>Загрузить</span></>
                  }
                </div>
              </div>
            )}
            <div className="space-y-1">
              <label className="text-xs font-semibold" style={{ color:C.t3 }}>Ссылка (необязательно)</label>
              <input value={link} onChange={e=>setLink(e.target.value)}
                placeholder="https://..." type="url"
                className="w-full rounded-2xl px-4 py-3 text-sm outline-none"
                style={{ background:C.l2, border:`1px solid ${C.border}`, color:C.t1 }}/>
            </div>
            <button type="button" onClick={() => { if(!title.trim()){setErr('Введите заголовок');return;} setErr(''); setStep('budget'); }}
              className="w-full rounded-2xl py-3.5 text-sm font-bold text-white"
              style={{ background:C.accent }}>
              Далее →
            </button>
            {err && <p className="text-xs text-center" style={{ color:C.red }}>{err}</p>}
          </div>
        )}

        {/* STEP 4: Budget */}
        {step === 'budget' && pricing && (
          <div className="space-y-5">
            <p className="text-xs font-semibold uppercase tracking-wider" style={{ color:C.t3 }}>
              Бюджет и сроки
            </p>
            {/* Days */}
            <div>
              <div className="flex justify-between mb-2">
                <label className="text-xs font-semibold" style={{ color:C.t3 }}>Длительность</label>
                <span className="text-xs font-bold" style={{ color:C.t1 }}>{days} дней</span>
              </div>
              <input type="range" min={pricing.minDays} max={30} value={days}
                onChange={e=>setDays(parseInt(e.target.value))}
                className="w-full accent-[#4f6ef7]"/>
              <div className="flex gap-2 mt-2">
                {[1,3,7,14,30].filter(d=>d>=pricing.minDays).map(d=>(
                  <button key={d} type="button" onClick={()=>setDays(d)}
                    className="flex-1 rounded-xl py-1.5 text-xs font-semibold"
                    style={{ background:days===d?C.accent:C.l2, color:days===d?'#fff':C.t3 }}>
                    {d}д
                  </button>
                ))}
              </div>
            </div>
            {/* Daily limit */}
            <div>
              <div className="flex justify-between mb-2">
                <label className="text-xs font-semibold" style={{ color:C.t3 }}>Дневной лимит</label>
                <span className="text-xs font-bold" style={{ color:C.t1 }}>{fmtBudget(daily)}/день</span>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[pricing.pricePerDay, pricing.pricePerDay*2, pricing.pricePerDay*5, pricing.pricePerDay*10].map(v=>(
                  <button key={v} type="button" onClick={()=>setDaily(v)}
                    className="rounded-xl py-2 text-xs font-semibold"
                    style={{ background:daily===v?C.accent:C.l2, color:daily===v?'#fff':C.t3 }}>
                    {fmtBudget(v)}
                  </button>
                ))}
              </div>
            </div>
            {/* Summary */}
            <div className="rounded-2xl p-4 space-y-2" style={{ background:C.l2, border:`1px solid ${C.border}` }}>
              {[
                { l:'Площадка', v:pricing.label },
                { l:'Длительность', v:`${days} дней` },
                { l:'Дневной лимит', v:fmtBudget(daily) },
                { l:'Охват/день', v:`~${pricing.maxImpressions.toLocaleString('ru')} показов` },
              ].map(({l,v})=>(
                <div key={l} className="flex justify-between text-sm">
                  <span style={{ color:C.t2 }}>{l}</span>
                  <span className="font-semibold" style={{ color:C.t1 }}>{v}</span>
                </div>
              ))}
              <div className="flex justify-between text-base font-black pt-1" style={{ borderTop:`1px solid ${C.border}` }}>
                <span style={{ color:C.t1 }}>Итого</span>
                <span style={{ color:C.accent }}>{fmtBudget(budget)}</span>
              </div>
              <p className="text-[10px] flex items-center gap-1" style={{ color:balance<budget?C.red:C.green }}>
                {balance<budget
                  ? `Не хватает ${fmtBudget(budget-balance)}`
                  : <><Check size={10}/> Баланс: {fmtBudget(balance)}</>}
              </p>
            </div>
            <button type="button" onClick={() => setStep('review')} disabled={balance<budget}
              className="w-full rounded-2xl py-3.5 text-sm font-bold text-white disabled:opacity-35"
              style={{ background:C.accent }}>
              Проверить и оплатить →
            </button>
          </div>
        )}

        {/* STEP 5: Review */}
        {step === 'review' && pricing && (
          <div className="space-y-4">
            <p className="text-xs font-semibold uppercase tracking-wider" style={{ color:C.t3 }}>
              Проверьте перед запуском
            </p>
            {/* Preview */}
            <div className="rounded-2xl overflow-hidden" style={{ background:C.l2, border:`1px solid ${C.border}` }}>
              <div className="px-4 py-3 flex items-center gap-2 border-b" style={{ borderColor:C.border }}>
                <pricing.Icon size={15} style={{ color:C.t2 }}/>
                <span className="text-xs font-semibold" style={{ color:C.t2 }}>{pricing.label}</span>
                <span className="ml-auto text-[10px] px-2 py-0.5 rounded-full"
                  style={{ background:'rgba(245,158,11,0.15)', color:C.amber }}>
                  Реклама
                </span>
              </div>
              {image && <img src={image} alt="" className="w-full max-h-36 object-cover"/>}
              <div className="px-4 py-3">
                <p className="text-sm font-bold" style={{ color:C.t1 }}>{title}</p>
                {desc && <p className="text-xs mt-1 leading-relaxed" style={{ color:C.t2 }}>{desc}</p>}
                {link && <p className="text-xs mt-1.5" style={{ color:C.accent }}>→ {link}</p>}
              </div>
            </div>
            {/* Moderation note */}
            <div className="rounded-2xl px-4 py-3 flex gap-3"
              style={{ background:'rgba(79,110,247,0.06)', border:`1px solid ${C.accent}25` }}>
              <Shield size={15} style={{ color:C.accent }} className="shrink-0 mt-0.5"/>
              <p className="text-xs leading-relaxed" style={{ color:C.t2 }}>
                Кампания пройдёт проверку модераторов. Обычно 2-24 часа. После одобрения начнёт показываться автоматически.
              </p>
            </div>
            {err && <p className="text-xs text-center" style={{ color:C.red }}>{err}</p>}
            <motion.button whileTap={{ scale:.97 }} type="button" onClick={submit} disabled={busy}
              className="flex items-center justify-center gap-2 w-full rounded-2xl py-4 text-sm font-bold text-white disabled:opacity-50"
              style={{ background:`linear-gradient(135deg,${C.accent},#818cf8)`, boxShadow:`0 6px 24px ${C.accent}40` }}>
              <Rocket size={16}/> {busy ? 'Отправка…' : `Запустить кампанию · ${fmtBudget(budget)}`}
            </motion.button>
          </div>
        )}
      </div>
    </div>
  );
};

/* -- Campaign detail --------------------------------------- */
const CampaignDetail = ({ c, onBack }: { c: AdCampaign; onBack: () => void }) => {
  const p = AD_PLACEMENTS.find(x => x.placement === c.placement);
  const sc = AD_STATUS_COLOR[c.status];
  return (
    <motion.div initial={{ opacity:0, x:20 }} animate={{ opacity:1, x:0 }}
      className="flex flex-col h-full overflow-y-auto" style={{ scrollbarWidth:'none' }}>
      <div className="flex items-center gap-3 px-4 py-3 shrink-0" style={{ borderBottom:`1px solid ${C.border}` }}>
        <button type="button" onClick={onBack}
          className="grid h-8 w-8 place-items-center rounded-full hover:bg-white/5">
          <ChevronLeft size={18} style={{ color:C.t2 }}/>
        </button>
        <span className="text-sm font-bold flex-1 truncate" style={{ color:C.t1 }}>{c.title}</span>
        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
          style={{ background:`${sc}18`, color:sc }}>
          {AD_STATUS_LABEL[c.status]}
        </span>
      </div>
      <div className="px-4 py-4 space-y-4">
        {campaignMediaUrl(c) && (
          c.format === 'video'
            ? <video src={campaignMediaUrl(c)} controls className="w-full max-h-48 object-cover rounded-2xl"/>
            : <img src={campaignMediaUrl(c)} alt="" className="w-full max-h-48 object-cover rounded-2xl"/>
        )}
        {/* Stats */}
        <div className="flex gap-3">
          <Stat icon={Eye}            label="Показы"  value={c.impressions.toLocaleString('ru')} color={C.accent}/>
          <Stat icon={MousePointer}   label="Клики"   value={c.clicks.toLocaleString('ru')}      color={C.green}/>
          <Stat icon={TrendingUp}     label="CTR"     value={`${c.ctr}%`}                        color={C.amber}/>
        </div>
        {/* Budget */}
        <div className="rounded-2xl p-4" style={{ background:C.l2, border:`1px solid ${C.border}` }}>
          <p className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color:C.t3 }}>Бюджет</p>
          <div className="flex justify-between text-sm mb-2">
            <span style={{ color:C.t2 }}>Потрачено</span>
            <span className="font-bold" style={{ color:C.t1 }}>{fmtBudget(c.spent)}</span>
          </div>
          <div className="flex justify-between text-sm mb-3">
            <span style={{ color:C.t2 }}>Общий бюджет</span>
            <span className="font-bold" style={{ color:C.t1 }}>{fmtBudget(c.budget)}</span>
          </div>
          <div className="h-2 rounded-full overflow-hidden" style={{ background:C.l3 }}>
            <div className="h-full rounded-full" style={{ width:`${Math.min(100,c.spent/c.budget*100)}%`, background:C.accent }}/>
          </div>
        </div>
        {/* Info */}
        <div className="rounded-2xl p-4 space-y-3" style={{ background:C.l2, border:`1px solid ${C.border}` }}>
          <p className="text-xs font-semibold uppercase tracking-wider" style={{ color:C.t3 }}>Детали</p>
          {[
            { l:'Площадка',  v:p?.label ?? '' },
            { l:'Формат',    v:AD_FORMAT_LABEL[c.format] },
            { l:'Старт',     v:c.startDate ? new Date(c.startDate).toLocaleDateString('ru',{day:'numeric',month:'long'}) : '—' },
            { l:'Конец',     v:c.endDate ? new Date(c.endDate).toLocaleDateString('ru',{day:'numeric',month:'long'}) : '—' },
            { l:'Дн. лимит', v:fmtBudget(c.dailyLimit) },
          ].map(({l,v})=>(
            <div key={l} className="flex justify-between text-sm">
              <span style={{ color:C.t2 }}>{l}</span>
              <span className="font-semibold" style={{ color:C.t1 }}>{v}</span>
            </div>
          ))}
        </div>
        {c.rejectReason && (
          <div className="rounded-2xl px-4 py-3" style={{ background:'rgba(248,113,113,0.08)', border:'1px solid rgba(248,113,113,0.2)' }}>
            <p className="text-xs font-bold mb-1" style={{ color:C.red }}>Причина отказа</p>
            <p className="text-xs" style={{ color:C.t2 }}>{c.rejectReason}</p>
          </div>
        )}
      </div>
    </motion.div>
  );
};

/* === MAIN ADS CABINET ====================================== */
export const SkyAdsCabinet = () => {
  const { campaigns, load } = useAdsStore();
  const [view, setView] = useState<'list'|'create'|'detail'>('list');
  const [detail, setDetail] = useState<AdCampaign|null>(null);

  useEffect(() => { load(); }, [load]);

  const active  = campaigns.filter(c => c.status === 'active');
  const pending = campaigns.filter(c => c.status === 'moderation');

  const totalSpent = campaigns.reduce((s,c) => s+c.spent, 0);
  const totalImpr  = campaigns.reduce((s,c) => s+c.impressions, 0);
  const totalClicks= campaigns.reduce((s,c) => s+c.clicks, 0);

  if (view === 'create') return <CreateCampaign onDone={() => setView('list')}/>;
  if (view === 'detail' && detail) return <CampaignDetail c={detail} onBack={() => { setView('list'); setDetail(null); }}/>;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-4 pb-3 shrink-0">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-2xl"
            style={{ background:`${C.accent}20`, border:`1px solid ${C.accent}35` }}>
            <Megaphone size={18} style={{ color:C.accent }}/>
          </div>
          <div>
            <p className="text-sm font-bold" style={{ color:C.t1 }}>Sky Реклама</p>
            <p className="text-xs" style={{ color:C.t3 }}>Рекламный кабинет</p>
          </div>
        </div>
        <motion.button whileTap={{ scale:.94 }} type="button"
          onClick={() => setView('create')}
          className="flex items-center gap-1.5 rounded-2xl px-4 py-2.5 text-sm font-bold text-white"
          style={{ background:C.accent, boxShadow:`0 4px 16px ${C.accent}40` }}>
          <Plus size={15}/> Создать
        </motion.button>
      </div>

      {/* Overview stats */}
      {campaigns.length > 0 && (
        <div className="flex gap-3 px-4 mb-3">
          <Stat icon={BarChart2}    label="Потрачено"   value={fmtBudget(totalSpent)} color={C.accent}/>
          <Stat icon={Eye}          label="Показы"      value={totalImpr.toLocaleString('ru')} color={C.green}/>
          <Stat icon={MousePointer} label="Клики"       value={totalClicks.toLocaleString('ru')} color={C.amber}/>
        </div>
      )}

      {/* Status tabs */}
      {campaigns.length > 0 && (
        <div className="flex gap-2 px-4 mb-3">
          {[
            { label:`Активных (${active.length})`,  color:C.green  },
            { label:`На проверке (${pending.length})`, color:C.amber },
            { label:`Всего (${campaigns.length})`,  color:C.accent },
          ].map(({label,color}) => (
            <div key={label} className="rounded-full px-3 py-1 text-[10px] font-bold"
              style={{ background:`${color}12`, color }}>
              {label}
            </div>
          ))}
        </div>
      )}

      {/* Campaign list */}
      <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-3" style={{ scrollbarWidth:'none' }}>
        {campaigns.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-4 py-16">
            <div className="grid h-16 w-16 place-items-center rounded-3xl"
              style={{ background:C.l2, border:`1px solid ${C.border}` }}>
              <Megaphone size={30} style={{ color:C.t3 }}/>
            </div>
            <div className="text-center">
              <p className="text-base font-bold" style={{ color:C.t1 }}>Нет кампаний</p>
              <p className="text-sm mt-1 leading-relaxed" style={{ color:C.t2 }}>
                Запустите рекламу в видео, Bloom или каналах
              </p>
            </div>
            <div className="space-y-2 w-full max-w-xs">
              {AD_PLACEMENTS.slice(0,3).map(p => (
                <div key={p.placement} className="flex items-center gap-3 rounded-2xl px-4 py-3"
                  style={{ background:C.l2, border:`1px solid ${C.border}` }}>
                  <p.Icon size={19} style={{ color:C.t2 }}/>
                  <div className="flex-1">
                    <p className="text-xs font-semibold" style={{ color:C.t1 }}>{p.label}</p>
                    <p className="text-[10px]" style={{ color:C.accent }}>от {fmtBudget(p.pricePerDay)}/день</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          campaigns.map(c => (
            <CampaignCard key={c.id} c={c} onOpen={() => { setDetail(c); setView('detail'); }}/>
          ))
        )}
      </div>
    </div>
  );
};
