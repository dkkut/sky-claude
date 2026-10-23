/**
 * Входящая передача: «Продолжить “X” с 12:34 на этом устройстве?». Сама ничего не запускает — только после нажатия «Продолжить».
 * Телефон/ПК — карточка снизу; ТВ — крупные кнопки под пульт; машина — крупные цели от 72 px, никакого ввода текста.
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, ArrowRightLeft } from 'lucide-react';
import { HO, KIND_LABEL, hReason, useHandoff, type Handoff } from './handoffApi';
import { openContent } from './openContent';
import { Place } from './Place';
import { TVFocusable } from '@/interface/tv/TVFocusable';
import { tvFocusManager } from '@/interface/tv/focusManager';

const SCOPE = 'handoff-in';
const btnStyle = (primary: boolean, focused: boolean, big: boolean): React.CSSProperties => ({ background: primary ? (focused ? '#fff' : '#8b7cff') : (focused ? '#8b7cff' : 'rgba(255,255,255,.12)'), color: primary && focused ? '#1c1740' : '#fff', boxShadow: focused ? '0 0 0 4px rgba(179,167,255,.9)' : 'none', minHeight: big ? 76 : 44, padding: big ? '0 36px' : '0 20px', borderRadius: 999, fontSize: big ? 28 : 15, fontWeight: 700 });
/** Кнопка вынесена на уровень модуля: объявленная внутри компонента, она пересоздавалась бы на каждый рендер и теряла фокус пульта. */
const Btn = ({ id, primary, onEnter, tv, big, disabled, children }: { id: string; primary?: boolean; onEnter: () => void; tv: boolean; big: boolean; disabled?: boolean; children: React.ReactNode }) => tv
  ? <TVFocusable id={id} scope={SCOPE} autoFocusPriority={primary ? 0 : 5} onEnter={onEnter}>{({ focused }) => <div className="grid place-items-center" style={btnStyle(!!primary, focused, big)}>{children}</div>}</TVFocusable>
  : <button type="button" onClick={onEnter} disabled={disabled} className="outline-none disabled:opacity-60" style={btnStyle(!!primary, false, big)}>{children}</button>;

const modeOf = () => document.documentElement.dataset.skyMode ?? '';

export const HandoffIncoming = () => {
  const incoming = useHandoff((s) => s.incoming);
  const h: Handoff | undefined = incoming.find((x) => new Date(x.expiresAt).getTime() > Date.now());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [now, setNow] = useState(Date.now());
  const handled = useRef<Set<string>>(new Set());
  const mode = modeOf();
  const big = mode === 'tv' || mode === 'car' || mode === 'console';
  const tv = mode === 'tv';

  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  useEffect(() => { setMsg(''); setBusy(false); }, [h?.id]);
  useEffect(() => {
    if (!h || !tv) return undefined;
    const prev = tvFocusManager.getScope();
    tvFocusManager.setScope(SCOPE);
    const t = window.setTimeout(() => tvFocusManager.focusDefault(), 40);
    return () => { window.clearTimeout(t); tvFocusManager.setScope(prev); };
  }, [h?.id, tv]);

  if (!h) return null;
  const remain = Math.max(0, Math.ceil((new Date(h.expiresAt).getTime() - now) / 1000));
  const drop = (id: string) => useHandoff.getState().setIncoming(useHandoff.getState().incoming.filter((x) => x.id !== id));

  const go = async () => {
    if (busy || handled.current.has(h.id)) return;
    handled.current.add(h.id); setBusy(true); setMsg('');
    const r = await HO.accept(h.id);
    if (!r.ok || !r.data) { handled.current.delete(h.id); setBusy(false); setMsg(hReason(r.error)); if (r.error === 'expired' || r.error === 'bad_state') setTimeout(() => drop(h.id), 2500); return; }
    const o = await openContent(r.data.handoff, r.data.handoff.position, r.data.handoff.extra);
    setBusy(false);
    if (!o.ok) { setMsg(o.message ?? 'Не получилось открыть.'); return; }
    drop(h.id);
  };
  const no = async () => { drop(h.id); await HO.decline(h.id); };

  return createPortal(
    <div role="alertdialog" aria-modal="true" aria-label="Продолжить на этом устройстве" data-keep-dark=""
      className={`fixed inset-x-0 z-[10070] flex justify-center px-3 ${big ? 'inset-y-0 items-center' : 'bottom-0 pb-[max(12px,env(safe-area-inset-bottom))]'}`} style={big ? { background: 'rgba(5,5,14,.7)' } : { pointerEvents: 'none' }}>
      <div className="w-full" style={{ maxWidth: big ? 880 : 460, pointerEvents: 'auto', background: 'linear-gradient(160deg,#1c1740,#0d0b20)', border: '1px solid rgba(179,167,255,.35)', borderRadius: big ? 40 : 22, padding: big ? 40 : 16, boxShadow: '0 12px 50px rgba(0,0,0,.55)', color: '#fff' }}>
        <div className="flex items-center gap-4">
          <div className="grid shrink-0 place-items-center rounded-full" style={{ width: big ? 84 : 44, height: big ? 84 : 44, background: 'rgba(139,124,255,.25)' }}><ArrowRightLeft size={big ? 40 : 22} color="#c4baff" /></div>
          <div className="min-w-0 flex-1">
            <div className="truncate font-bold" style={{ fontSize: big ? 34 : 16 }}><span translate="no">{h.title || KIND_LABEL[h.kind]}</span></div>
            <div style={{ fontSize: big ? 24 : 13, color: 'rgba(255,255,255,.72)' }}><span>{KIND_LABEL[h.kind]}</span>{' · '}<span>продолжить</span>{' '}<Place kind={h.kind} position={h.position} extra={h.extra} />{' · '}<span>с</span>{' '}{h.fromName ? <span translate="no">{h.fromName}</span> : <span>другого устройства</span>}</div>
          </div>
        </div>
        {msg && <p className="mt-3" style={{ fontSize: big ? 22 : 13, color: '#fca5a5' }}>{msg}</p>}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Btn id="hoin-go" primary tv={tv} big={big} disabled={busy} onEnter={() => void go()}>{busy ? <Loader2 className="animate-spin" size={big ? 34 : 18} /> : 'Продолжить'}</Btn>
          <Btn id="hoin-no" tv={tv} big={big} onEnter={() => void no()}>Не сейчас</Btn>
          <span className="ml-auto" style={{ fontSize: big ? 20 : 12, color: 'rgba(255,255,255,.5)' }}>{remain} с</span>
        </div>
      </div>
    </div>, document.body);
};
