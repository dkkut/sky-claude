/* ===============================================================
   ADMIN DISPUTES PANEL  -  Споры гаранта
   Администратор может вынести решение и подтвердить за участников
=============================================================== */
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, X, ChevronDown, ChevronUp, Scale, Gavel } from 'lucide-react';
import { useGarantStore, type GarantDeal } from '@/garant/SkyGarant';
import { useAuthStore } from '@/core/auth/store';

const fmtDate = (iso:string) =>
  new Date(iso).toLocaleString('ru',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});

const STATUS_COLORS: Record<string,string> = {
  pending_seller:'var(--amber)', pending_buyer:'var(--amber)',
  in_escrow:'var(--accent)', completed:'var(--green)', cancelled:'var(--t2)', disputed:'var(--red)',
};

const GarantDisputeCard = ({ deal }: { deal: GarantDeal }) => {
  const { resolveDispute, adminForceConfirm } = useGarantStore();
  const { accounts } = useAuthStore();
  const [expanded,  setExpanded]  = useState(false);
  const [resolving, setResolving] = useState(false);
  const [winner,    setWinner]    = useState<'seller_wins'|'buyer_wins'|'cancelled'>('seller_wins');
  const [note,      setNote]      = useState('');
  const [err,       setErr]       = useState('');

  const sellerAcc  = accounts.find(a => a.id === deal.sellerId);
  const buyerAcc   = accounts.find(a => a.id === deal.buyerId);
  const isResolved = deal.status === 'completed' && !!deal.disputeResult;

  const handleResolve = () => {
    if (!note.trim()) { setErr('Укажите обоснование'); return; }
    resolveDispute(deal.id, winner, note.trim());
    setResolving(false);
  };

  return (
    <div className="rounded-2xl overflow-hidden"
      style={{ background:'var(--bg-l1)',
        border:`1.5px solid ${isResolved?'rgba(52,211,153,0.25)':'rgba(248,113,113,0.3)'}` }}>

      <div className="flex items-start gap-3 px-4 py-3.5 cursor-pointer"
        onClick={() => setExpanded(e=>!e)}>
        <span className="text-2xl shrink-0">{deal.itemEmoji}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-bold text-white text-sm truncate">{deal.title}</p>
            <span className="text-[9px] font-bold px-2 py-0.5 rounded-full shrink-0"
              style={{ background:isResolved?'rgba(52,211,153,0.15)':'rgba(248,113,113,0.15)',
                color:isResolved?'var(--green)':'var(--red)' }}>
              {isResolved?'✓ Решён':'⚖️ Спор'}
            </span>
          </div>
          <p className="text-xs mt-0.5" style={{color:'var(--t2)'}}>
            {deal.sellerName} → {deal.buyerName}
          </p>
          <p className="text-sm font-black mt-0.5" style={{color:'var(--amber)'}}>
            {deal.payType==='rubles'?`${deal.price.toLocaleString('ru')} ₽`:`⭐ ${deal.price.toLocaleString('ru')}`}
          </p>
        </div>
        {expanded ? <ChevronUp size={16} style={{color:'var(--t3)'}}/> : <ChevronDown size={16} style={{color:'var(--t3)'}}/>}
      </div>

      <AnimatePresence>
        {expanded && (
          <motion.div initial={{height:0,opacity:0}} animate={{height:'auto',opacity:1}}
            exit={{height:0,opacity:0}} transition={{duration:0.2}}
            className="overflow-hidden border-t" style={{borderColor:'var(--border)'}}>
            <div className="px-4 py-4 space-y-4">

              {deal.disputeReason && (
                <div className="rounded-xl p-3"
                  style={{background:'rgba(248,113,113,0.06)',border:'1px solid rgba(248,113,113,0.15)'}}>
                  <p className="text-[10px] font-bold uppercase tracking-wider mb-1.5" style={{color:'var(--red)'}}>Причина спора</p>
                  <p className="text-xs leading-relaxed text-white">{deal.disputeReason}</p>
                  {deal.disputeAt && <p className="text-[10px] mt-1" style={{color:'var(--t3)'}}>{fmtDate(deal.disputeAt)}</p>}
                </div>
              )}

              <div className="grid grid-cols-2 gap-2">
                {([
                  {label:'Продавец',acc:sellerAcc,side:'seller' as const,confirmed:deal.sellerConfirmed},
                  {label:'Покупатель',acc:buyerAcc,side:'buyer' as const,confirmed:deal.buyerConfirmed},
                ]).map(({label,acc,side,confirmed}) => (
                  <div key={label} className="rounded-xl p-3 space-y-2"
                    style={{background:'rgba(255,255,255,0.03)'}}>
                    <div>
                      <p className="text-[9px] font-bold uppercase" style={{color:'var(--t3)'}}>{label}</p>
                      <p className="text-xs font-bold text-white">{acc?.name ?? label}</p>
                      <p className="text-[9px]" style={{color:'var(--t3)'}}>@{acc?.username ?? ' - '}</p>
                    </div>
                    <span className="text-[9px] font-semibold" style={{color:confirmed?'var(--green)':'var(--red)'}}>
                      {confirmed?'✓ Подтвердил':'✗ Не подтвердил'}
                    </span>
                    {!confirmed && !isResolved && (
                      <button type="button" onClick={() => adminForceConfirm(deal.id, side)}
                        className="w-full rounded-lg py-1.5 text-[10px] font-bold"
                        style={{background:'rgba(79,110,247,0.15)',color:'var(--accent)',border:'1px solid rgba(79,110,247,0.25)'}}>
                        👮 Подтвердить за {label==='Продавец'?'него':'неё'}
                      </button>
                    )}
                  </div>
                ))}
              </div>

              {!isResolved && !resolving && (
                <motion.button whileTap={{scale:.97}} type="button" onClick={() => setResolving(true)}
                  className="w-full flex items-center justify-center gap-2 rounded-2xl py-3.5 text-sm font-bold text-white"
                  style={{background:'linear-gradient(135deg,#7c3aed,#4f6ef7)'}}>
                  <Gavel size={16}/>Вынести решение
                </motion.button>
              )}

              {resolving && (
                <motion.div initial={{opacity:0,y:6}} animate={{opacity:1,y:0}}
                  className="rounded-2xl p-4 space-y-3"
                  style={{background:'rgba(124,58,237,0.07)',border:'1.5px solid rgba(124,58,237,0.25)'}}>
                  <p className="text-sm font-bold text-white">⚖️ Решение по спору</p>
                  <div className="space-y-2">
                    {([
                      {key:'seller_wins',label:'Победа продавца',icon:'🏆',c:'var(--green)'},
                      {key:'buyer_wins', label:'Победа покупателя',icon:'🛡️',c:'var(--accent)'},
                      {key:'cancelled',  label:'Отмена сделки',icon:'↩️',c:'var(--t2)'},
                    ] as const).map(opt => (
                      <button key={opt.key} type="button" onClick={() => setWinner(opt.key)}
                        className="flex items-center gap-3 w-full rounded-xl px-3 py-2.5 transition-all"
                        style={{background:winner===opt.key?`${opt.c}12`:'rgba(255,255,255,0.04)',
                          border:`1.5px solid ${winner===opt.key?opt.c:'var(--border)'}`}}>
                        <span className="text-xl">{opt.icon}</span>
                        <span className="text-xs font-bold" style={{color:winner===opt.key?opt.c:'var(--t1)'}}>{opt.label}</span>
                        {winner===opt.key && <Check size={13} style={{color:opt.c,marginLeft:'auto'}}/>}
                      </button>
                    ))}
                  </div>
                  <textarea value={note} onChange={e=>{setNote(e.target.value);setErr('');}} rows={3}
                    placeholder="Обоснование решения (будет видно участникам)..."
                    className="w-full rounded-xl px-3 py-2.5 text-xs outline-none resize-none"
                    style={{background:'rgba(0,0,0,0.3)',border:'1px solid rgba(255,255,255,0.1)',color:'var(--t1)'}}/>
                  {err && <p className="text-[10px]" style={{color:'var(--red)'}}>{err}</p>}
                  <div className="flex gap-2">
                    <motion.button whileTap={{scale:.96}} type="button" onClick={handleResolve}
                      className="flex-1 flex items-center justify-center gap-1.5 rounded-xl py-3 text-xs font-bold text-white"
                      style={{background:'linear-gradient(135deg,#7c3aed,#4f6ef7)'}}>
                      <Gavel size={13}/>Вынести решение
                    </motion.button>
                    <button type="button" onClick={() => {setResolving(false);setErr('');}}
                      className="rounded-xl px-4 py-3 text-xs"
                      style={{color:'var(--t3)',background:'rgba(255,255,255,0.05)'}}>Отмена</button>
                  </div>
                </motion.div>
              )}

              {isResolved && deal.disputeResult && (
                <div className="rounded-xl p-3"
                  style={{background:'rgba(52,211,153,0.08)',border:'1px solid rgba(52,211,153,0.2)'}}>
                  <p className="text-xs font-bold" style={{color:'var(--green)'}}>
                    ✅ {deal.disputeResult==='seller_wins'?'Победа продавца':
                        deal.disputeResult==='buyer_wins'?'Победа покупателя':'Сделка отменена'}
                  </p>
                  {deal.disputeNote && <p className="text-[11px] mt-1" style={{color:'var(--t2)'}}>{deal.disputeNote}</p>}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export const AdminDisputesPanel = () => {
  const { deals } = useGarantStore();
  const [filter, setFilter] = useState<'open'|'resolved'>('open');
  const open     = deals.filter(d => d.status === 'disputed');
  const resolved = deals.filter(d => d.status === 'completed' && d.disputeResult);
  const shown    = filter==='open' ? open : resolved;

  return (
    <div className="p-4 space-y-4">
      <div className="grid grid-cols-3 gap-2">
        {[{l:'Открытых',v:open.length,c:'var(--red)'},{l:'Решённых',v:resolved.length,c:'var(--green)'},{l:'Всего сделок',v:deals.length,c:'var(--accent)'}].map(({l,v,c})=>(
          <div key={l} className="rounded-xl p-3 text-center" style={{background:'var(--bg-l2)',border:'1px solid var(--border)'}}>
            <p className="text-lg font-black" style={{color:c}}>{v}</p>
            <p className="text-[9px] mt-0.5" style={{color:'var(--t3)'}}>{l}</p>
          </div>
        ))}
      </div>
      <div className="flex rounded-xl overflow-hidden" style={{border:'1px solid var(--border)'}}>
        {([['open','⚖️ Открытые'],['resolved','✅ Решённые']] as const).map(([k,l],i)=>(
          <button key={k} type="button" onClick={()=>setFilter(k)}
            className="flex-1 py-2.5 text-xs font-bold transition-all"
            style={{background:filter===k?'var(--accent)':'transparent',color:filter===k?'white':'var(--t3)',
              borderRight:i===0?'1px solid var(--border)':'none'}}>
            {l}{k==='open'&&open.length>0?` (${open.length})`:''}
          </button>
        ))}
      </div>
      {shown.length===0 ? (
        <div className="flex flex-col items-center gap-2 py-10">
          <Scale size={32} style={{color:'var(--t3)'}}/>
          <p className="text-sm" style={{color:'var(--t3)'}}>{filter==='open'?'Открытых споров нет':'Решённых споров нет'}</p>
        </div>
      ) : shown.map(d => <GarantDisputeCard key={d.id} deal={d}/>)}
    </div>
  );
};

export const AdminGarantPanel = () => {
  const { deals, adminForceConfirm, cancel } = useGarantStore();
  const [expanded, setExpanded] = useState<string|null>(null);
  const now = Date.now();
  const stalled = deals.filter(d => {
    if (d.status !== 'in_escrow') return false;
    return now - new Date(d.createdAt).getTime() > 86400000 && (!d.buyerConfirmed || !d.sellerConfirmed);
  });
  const escrow = deals.filter(d => d.status === 'in_escrow');

  return (
    <div className="p-4 space-y-3">
      <div className="rounded-xl px-3 py-2.5"
        style={{background:'rgba(245,158,11,0.07)',border:'1px solid rgba(245,158,11,0.2)'}}>
        <p className="text-[11px] leading-relaxed" style={{color:'rgba(245,158,11,0.8)'}}>
          👮 Принудительное подтверждение  -  используйте только если пользователь явно уклоняется. Зависшие &gt;24ч: <strong>{stalled.length}</strong> · У гаранта: <strong>{escrow.length}</strong>
        </p>
      </div>
      {escrow.length===0 && <div className="py-8 text-center"><p className="text-sm" style={{color:'var(--t3)'}}>Сделок у гаранта нет</p></div>}
      {escrow.map(deal => {
        const isOpen = expanded===deal.id;
        const isStalled = now - new Date(deal.createdAt).getTime() > 86400000;
        return (
          <div key={deal.id} className="rounded-2xl overflow-hidden"
            style={{background:'var(--bg-l1)',border:`1px solid ${isStalled?'rgba(245,158,11,0.3)':'var(--border)'}`}}>
            <div className="flex items-center gap-3 px-4 py-3 cursor-pointer" onClick={()=>setExpanded(isOpen?null:deal.id)}>
              <span className="text-xl">{deal.itemEmoji}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-white truncate">{deal.itemName}</p>
                <p className="text-[11px]" style={{color:'var(--t3)'}}>{deal.sellerName} → {deal.buyerName} · {deal.payType==='rubles'?`${deal.price} ₽`:`⭐${deal.price}`}</p>
              </div>
              {isStalled && <span className="text-[9px] font-bold px-2 py-0.5 rounded-full shrink-0" style={{background:'rgba(245,158,11,0.15)',color:'var(--amber)'}}>⚠️ Завис</span>}
              {isOpen?<ChevronUp size={14} style={{color:'var(--t3)'}}/>:<ChevronDown size={14} style={{color:'var(--t3)'}}/>}
            </div>
            <AnimatePresence>
              {isOpen && (
                <motion.div initial={{height:0,opacity:0}} animate={{height:'auto',opacity:1}} exit={{height:0,opacity:0}} transition={{duration:0.2}}
                  className="overflow-hidden border-t" style={{borderColor:'var(--border)'}}>
                  <div className="px-4 py-3 space-y-3">
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        {label:'Продавец',name:deal.sellerName,confirmed:deal.sellerConfirmed,side:'seller' as const},
                        {label:'Покупатель',name:deal.buyerName,confirmed:deal.buyerConfirmed,side:'buyer' as const},
                      ].map(({label,name,confirmed,side}) => (
                        <div key={label} className="rounded-xl p-3 space-y-2" style={{background:'rgba(255,255,255,0.03)'}}>
                          <p className="text-[9px] font-bold uppercase" style={{color:'var(--t3)'}}>{label}</p>
                          <p className="text-xs font-bold text-white">{name}</p>
                          <span className="text-[9px]" style={{color:confirmed?'var(--green)':'var(--red)'}}>
                            {confirmed?'✓ Подтвердил':'✗ Не подтвердил'}
                          </span>
                          {!confirmed && (
                            <button type="button" onClick={()=>adminForceConfirm(deal.id, side)}
                              className="w-full rounded-lg py-1.5 text-[10px] font-bold"
                              style={{background:'rgba(79,110,247,0.15)',color:'var(--accent)',border:'1px solid rgba(79,110,247,0.25)'}}>
                              👮 Подтвердить за {label==='Продавец'?'него':'неё'}
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                    <button type="button" onClick={()=>cancel(deal.id)}
                      className="w-full rounded-xl py-2 text-[10px] font-semibold"
                      style={{background:'rgba(248,113,113,0.08)',color:'var(--red)',border:'1px solid rgba(248,113,113,0.15)'}}>
                      Принудительно отменить сделку
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}
    </div>
  );
};
