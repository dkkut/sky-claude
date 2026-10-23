/**
 * Кнопка «Продолжить на другом устройстве» и окно выбора устройства. Одна на все плееры Sky (музыка, кино, видео, подкасты, книги).
 *  • телефон/ПК — окно снизу/по центру в стиле Sky; ТВ — крупные фокусные кнопки (пульт); машина — крупные цели от 72 px, без ввода текста и без лишних шагов.
 *  • отправитель по умолчанию ОСТАНАВЛИВАЕТ воспроизведение в момент передачи (нет двух одновременных звуков и места, которое «убегает»);
 *    если устройство не ответило — «Продолжить здесь» возвращает воспроизведение.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ArrowRightLeft, Smartphone, Monitor, Tv, Car, Globe, X, Loader2, Check, RotateCw, Bluetooth, Clock } from 'lucide-react';
import { HO, KIND_LABEL, fmtPos, hReason, useHandoff, type HDevice, type HKind, type Handoff, type ContinueItem } from './handoffApi';
import { canPickOutput, currentSink, pickOutput, resetOutput } from './audioOutput';
import { openContent } from './openContent';
import { Place } from './Place';
import { TVFocusable } from '@/interface/tv/TVFocusable';
import { tvFocusManager } from '@/interface/tv/focusManager';
import { useModuleStore } from '@/data/state/modules';

export type Variant = 'default' | 'tv' | 'car';
export interface ReadState { position: number; duration: number; extra?: Record<string, number | string> }
export interface ContinueProps {
  kind: HKind; itemId: string; title: string;
  read: () => ReadState;
  pause?: () => void; resume?: () => void;
  variant?: Variant; /** ТВ: область фокуса экрана, на котором стоит кнопка (например, 'full-now') */ tvScope?: string; label?: boolean; className?: string; style?: React.CSSProperties;
}

const ICON: Record<string, typeof Smartphone> = { phone: Smartphone, desktop: Monitor, web: Globe, tv: Tv, car: Car, other: Globe };
const KIND_NAME: Record<string, string> = { phone: 'Телефон', desktop: 'Компьютер', web: 'Браузер', tv: 'Телевизор', car: 'Автомобиль', other: 'Устройство' };
const uuid = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `k${Date.now()}${Math.random().toString(16).slice(2)}`);
const AUDIO: HKind[] = ['music', 'podcast', 'book'];
const SCOPE = 'handoff-sheet';

type Step = { s: 'list' } | { s: 'wait'; h: Handoff; to: HDevice } | { s: 'done'; h: Handoff } | { s: 'fail'; text: string; to?: HDevice };

const Row = ({ variant, id, onEnter, disabled, children }: { variant: Variant; id: string; onEnter: () => void; disabled?: boolean; children: (focused: boolean) => ReactNode }) => {
  if (variant === 'tv') return <TVFocusable id={id} scope={SCOPE} disabled={disabled} onEnter={onEnter}>{({ focused }) => <div style={{ opacity: disabled ? 0.45 : 1 }}>{children(focused)}</div>}</TVFocusable>;
  return <button type="button" disabled={disabled} onClick={onEnter} className="block w-full text-left outline-none disabled:opacity-45" style={{ minHeight: variant === 'car' ? 72 : 52 }}>{children(false)}</button>;
};

const Sheet = ({ p, onClose }: { p: ContinueProps; onClose: () => void }) => {
  const v = p.variant ?? 'default';
  const big = v !== 'default';
  const [list, setList] = useState<HDevice[] | null>(null);
  const [pendingApproval, setPendingApproval] = useState(0);
  const [accept, setAccept] = useState<'ask' | 'off'>('ask');
  const [step, setStep] = useState<Step>({ s: 'list' });
  const [keep, setKeep] = useState(false);
  const [tab, setTab] = useState<'dev' | 'recent'>('dev');
  const [recent, setRecent] = useState<{ cont: ContinueItem[]; hist: Handoff[] } | null>(null);
  const [now, setNow] = useState(Date.now());
  const [sink, setSink] = useState(currentSink());
  const [btNote, setBtNote] = useState('');
  const paused = useRef(false);
  const waitId = useRef<string | null>(null);
  const sent = useHandoff((s) => s.sent);
  const lastTarget = useRef<string | null>((() => { try { return localStorage.getItem('sky:handoff:last'); } catch { return null; } })());

  const load = useCallback(async () => {
    const r = await HO.devices();
    if (r.ok && r.data) { setList(r.data.devices.filter((d) => !d.current)); setPendingApproval(r.data.pendingApproval); setAccept(r.data.prefs.accept); }
    else setList([]);
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  useEffect(() => {
    if (tab !== 'recent' || recent) return;
    void Promise.all([HO.cont(), HO.history()]).then(([c, h]) => setRecent({ cont: c.data?.items ?? [], hist: h.data?.history ?? [] }));
  }, [tab, recent]);

  /* ТВ: пульт работает внутри окна, «Назад» закрывает. */
  useEffect(() => {
    if (v !== 'tv') return undefined;
    const prev = tvFocusManager.getScope();
    tvFocusManager.setScope(SCOPE);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' || e.key === 'Backspace' || e.key === 'BrowserBack' || e.keyCode === 10009 || e.keyCode === 461) { e.preventDefault(); e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', onKey, true);
    const t = window.setTimeout(() => tvFocusManager.focusDefault(), 40);
    return () => { window.clearTimeout(t); window.removeEventListener('keydown', onKey, true); tvFocusManager.setScope(prev); };
  }, [v, onClose]);
  useEffect(() => {
    if (v === 'tv') return undefined;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [v, onClose]);

  /* Ответ получателя приходит событием; опрос — запас. */
  const live = step.s === 'wait' ? sent[step.h.id] : undefined;
  useEffect(() => {
    if (step.s !== 'wait') return undefined;
    const t = window.setInterval(async () => { const r = await HO.status(step.h.id); if (r.ok && r.data) useHandoff.getState().upsert(r.data.handoff); }, 2500);
    return () => window.clearInterval(t);
  }, [step]);
  useEffect(() => {
    if (step.s !== 'wait' || !live) return;
    if (live.state === 'accepted') setStep({ s: 'done', h: live });
    else if (live.state === 'declined') setStep({ s: 'fail', text: `«${step.to.name}» отклонило передачу.`, to: step.to });
    else if (live.state === 'expired') setStep({ s: 'fail', text: `«${step.to.name}» не ответило вовремя. Откройте Sky на этом устройстве и повторите.`, to: step.to });
    else if (live.state === 'superseded') setStep({ s: 'fail', text: 'Передачу заменила более новая.', to: step.to });
  }, [live, step]);

  const resumeHere = () => { if (paused.current) { paused.current = false; p.resume?.(); } };
  const send = async (d: HDevice) => {
    const st = p.read();
    const key = uuid();
    if (!keep && p.pause) { p.pause(); paused.current = true; }
    const r = await HO.send({ toDevice: d.id, kind: p.kind, itemId: p.itemId, title: p.title, position: st.position, duration: st.duration, extra: st.extra, keepPlaying: keep, idemKey: key });
    if (!r.ok || !r.data) { resumeHere(); setStep({ s: 'fail', text: hReason(r.error), to: d }); void load(); return; }
    try { localStorage.setItem('sky:handoff:last', d.id); } catch { /* */ }
    useHandoff.getState().upsert(r.data.handoff);
    waitId.current = r.data.handoff.id;
    setStep({ s: 'wait', h: r.data.handoff, to: d });
  };
  const cancel = async () => { if (step.s === 'wait') await HO.cancel(step.h.id); resumeHere(); setStep({ s: 'list' }); };
  const close = () => { if (step.s === 'wait') void HO.cancel(step.h.id).then(resumeHere); onClose(); };
  const pickBt = async () => {
    const r = await pickOutput();
    if (r.ok) { setSink(currentSink()); setBtNote(''); }
    else setBtNote(r.reason === 'denied' ? 'Доступ к выбору устройства не разрешён.' : r.reason === 'unsupported' ? 'Этот браузер не даёт выбрать устройство вывода. Подключите Bluetooth в настройках системы — Sky зазвучит на нём.' : 'Не получилось выбрать устройство. Повторите.');
  };

  const fs = big ? (v === 'car' ? 24 : 26) : 14;
  const sm = big ? (v === 'car' ? 18 : 20) : 12;
  const card = (focused: boolean): React.CSSProperties => ({ background: focused ? 'rgba(139,124,255,.32)' : 'var(--bg-l2, rgba(255,255,255,.07))', border: `1px solid ${focused ? '#b3a7ff' : 'var(--border, rgba(255,255,255,.12))'}`, boxShadow: focused ? '0 0 0 3px rgba(179,167,255,.8)' : 'none', borderRadius: big ? 28 : 16, padding: big ? '14px 20px' : '10px 14px' });
  const remain = step.s === 'wait' ? Math.max(0, Math.ceil((new Date(step.h.expiresAt).getTime() - now) / 1000)) : 0;
  const hint = (t: string) => <p style={{ fontSize: sm, color: 'var(--t3, rgba(255,255,255,.55))' }}>{t}</p>;

  const devRow = (d: HDevice) => {
    const Icon = ICON[d.kind] ?? Globe;
    const why = !d.online ? 'не на связи' : !d.sameProfile ? 'другой профиль' : d.problem === 'recipient_not_trusted' ? 'не подтверждено' : (d.kind === 'tv' && p.kind === 'book') ? 'не открывает книги' : (d.kind === 'car' && p.kind === 'book' && p.read().extra?.mode !== 'audio') ? 'в машине — только аудио' : '';
    const can = d.canReceive && !why;
    return (
      <Row key={d.id} variant={v} id={`ho-${d.id}`} onEnter={() => (can ? void send(d) : setStep({ s: 'fail', text: why === 'не на связи' ? hReason('device_offline') : why === 'другой профиль' ? hReason('other_profile') : why === 'не подтверждено' ? hReason('recipient_not_trusted') : hReason('unsupported_here'), to: d }))}>
        {(f) => (
          <div className="flex items-center gap-3" style={card(f)}>
            <Icon size={big ? 40 : 22} style={{ color: can ? '#b3a7ff' : 'var(--t3)' }} />
            <div className="min-w-0 flex-1">
              <div className="truncate font-bold" style={{ fontSize: fs, color: 'var(--t1, #fff)' }} translate="no">{d.name}{lastTarget.current === d.id ? ' ★' : ''}</div>
              <div style={{ fontSize: sm, color: can ? '#6ee7b7' : 'var(--t3, rgba(255,255,255,.55))' }}>{can ? 'на связи' : why || 'недоступно'} · {KIND_NAME[d.kind] ?? ''}</div>
            </div>
          </div>
        )}
      </Row>
    );
  };

  const body = (
    <div className="flex max-h-[85vh] flex-col gap-3 overflow-y-auto" style={{ color: 'var(--t1, #fff)' }}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="font-bold" style={{ fontSize: big ? 30 : 17 }}>Продолжить на другом устройстве</div>
          <div className="truncate" style={{ fontSize: sm, color: 'var(--t3, rgba(255,255,255,.6))' }}><span translate="no">{p.title}</span> · <span>{KIND_LABEL[p.kind]}</span> · <Place kind={p.kind} position={p.read().position} extra={p.read().extra} /></div>
        </div>
        <Row variant={v} id="ho-close" onEnter={close}>{(f) => <div className="grid place-items-center rounded-full" style={{ width: big ? 64 : 36, height: big ? 64 : 36, background: f ? '#8b7cff' : 'rgba(255,255,255,.1)' }} aria-label="Закрыть"><X size={big ? 30 : 18} /></div>}</Row>
      </div>

      {step.s === 'list' && (<>
        {v === 'default' && (
          <div className="flex gap-2" role="tablist">
            {(['dev', 'recent'] as const).map((k) => <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className="rounded-full px-3 py-1 text-xs font-bold" style={{ background: tab === k ? '#8b7cff' : 'rgba(255,255,255,.08)', color: '#fff' }}>{k === 'dev' ? 'Устройства' : 'Недавнее'}</button>)}
          </div>
        )}
        {tab === 'dev' && (<>
          {accept === 'off' && hint('Передача воспроизведения выключена в настройках — включите её в «Передача файлов».')}
          {list === null && <div className="flex items-center gap-2" style={{ fontSize: sm }}><Loader2 size={16} className="animate-spin" />Ищем ваши устройства…</div>}
          {list?.length === 0 && (<div className="space-y-1" style={{ fontSize: sm, color: 'var(--t2, rgba(255,255,255,.75))' }}>
            <p>Других устройств пока нет.</p>
            {hint('Войдите в Sky под этим Sky ID на телефоне, компьютере, ТВ или в машине (на ТВ и в машине — по QR) и откройте Sky: устройство появится здесь.')}
          </div>)}
          {list?.map(devRow)}
          {pendingApproval > 0 && (
            <Row variant={v} id="ho-approve" onEnter={() => { useModuleStore.getState().setActiveModule('extras'); useModuleStore.getState().setPendingExtrasTab('transfer'); onClose(); }}>
              {(f) => <div style={{ ...card(f), fontSize: sm }}>{`Ждут подтверждения устройств: ${pendingApproval}. Подтвердите их в «Передаче файлов» — тогда они появятся здесь.`}</div>}
            </Row>
          )}
          {v !== 'tv' && p.pause && (
            <label className="flex items-center gap-2" style={{ fontSize: sm }}><input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} />Не останавливать здесь, пока другое устройство не откроет</label>
          )}
          <div className="rounded-2xl p-3" style={{ background: 'rgba(255,255,255,.05)', fontSize: sm }}>
            <div className="mb-1 flex items-center gap-2 font-bold"><Bluetooth size={big ? 26 : 16} />Bluetooth</div>
            {AUDIO.includes(p.kind) ? (<>
              <p style={{ color: 'var(--t2, rgba(255,255,255,.75))' }}>Bluetooth передаёт только звук: он идёт на выбранную колонку, наушники или магнитолу, а Sky продолжает играть здесь. Состояние приложения и видео им не передаются.</p>
              {sink && <p className="mt-1" style={{ color: '#6ee7b7' }} translate="no">{sink.label || 'Выбранное устройство'}</p>}
              {canPickOutput()
                ? <div className="mt-2 flex gap-2"><button type="button" onClick={() => void pickBt()} className="rounded-xl px-3 py-1.5 font-bold" style={{ background: '#8b7cff', color: '#fff', minHeight: big ? 56 : 0 }}>Выбрать устройство звука</button>{sink && <button type="button" onClick={() => { resetOutput(); setSink(null); }} className="rounded-xl px-3 py-1.5 font-bold" style={{ background: 'rgba(255,255,255,.1)' }}>Сбросить</button>}</div>
                : <p className="mt-1" style={{ color: 'var(--t3, rgba(255,255,255,.55))' }}>Этот браузер не даёт выбрать устройство звука. Подключите Bluetooth в настройках системы — звук Sky пойдёт на него сам.</p>}
              {btNote && <p className="mt-1" style={{ color: '#fca5a5' }}>{btNote}</p>}
            </>) : <p style={{ color: 'var(--t2, rgba(255,255,255,.75))' }}>Видео по Bluetooth не передаётся — используйте список устройств выше: на нём Sky откроет то же видео с этого места.</p>}
          </div>
        </>)}
        {tab === 'recent' && (<>
          {!recent && <Loader2 size={16} className="animate-spin" />}
          {recent && recent.cont.length === 0 && hint('Пока нет начатых материалов.')}
          {recent?.cont.map((c) => (
            <button key={`${c.kind}:${c.itemId}`} type="button" onClick={() => { void openContent({ id: '', kind: c.kind, itemId: c.itemId, title: c.title, position: c.position, duration: c.duration, extra: {}, state: 'accepted', reason: null, fromDevice: '', toDevice: '', fromName: '', toName: '', keepPlaying: false, createdAt: '', expiresAt: '' }, c.position).then(() => onClose()); }}
              className="flex w-full items-center gap-3 rounded-2xl px-3 py-2 text-left" style={{ background: 'rgba(255,255,255,.07)', fontSize: fs }}>
              <Clock size={16} /><span className="min-w-0 flex-1 truncate" translate="no">{c.title}</span><span style={{ fontSize: sm, color: 'var(--t3)' }}>{KIND_LABEL[c.kind]} · <span translate="no">{c.kind === 'book' ? '' : fmtPos(c.position)}</span></span>
            </button>
          ))}
          {recent && recent.hist.length > 0 && <div className="mt-2 text-xs font-bold" style={{ color: 'var(--t3)' }}>История передач</div>}
          {recent?.hist.slice(0, 8).map((h) => <div key={h.id} className="flex items-center gap-2 text-xs" style={{ color: 'var(--t2)' }}><span className="min-w-0 flex-1 truncate" translate="no">{h.title}</span><span translate="no">{h.fromName} → {h.toName}</span><span>{h.state === 'accepted' ? 'открыто' : h.state === 'declined' ? 'отклонено' : h.state === 'expired' ? 'не ответило' : h.state === 'pending' ? 'ждёт' : 'отменено'}</span></div>)}
        </>)}
      </>)}

      {step.s === 'wait' && (
        <div className="space-y-3 text-center">
          <Loader2 className="mx-auto animate-spin" size={big ? 56 : 32} style={{ color: '#b3a7ff' }} />
          <div style={{ fontSize: fs }} translate="no">{`Ждём ответ от «${step.to.name}»…`}</div>
          {hint(`Нажмите «Продолжить» на этом устройстве. Осталось ${remain} с.`)}
          <Row variant={v} id="ho-cancel" onEnter={() => void cancel()}>{(f) => <div className="rounded-2xl px-4 py-3 text-center font-bold" style={{ ...card(f), fontSize: fs }}>Отменить</div>}</Row>
        </div>
      )}
      {step.s === 'done' && (
        <div className="space-y-3 text-center">
          <Check className="mx-auto" size={big ? 64 : 40} style={{ color: '#6ee7b7' }} />
          <div style={{ fontSize: fs }} translate="no">{`Открыто на «${step.h.toName}»`}</div>
          {hint(paused.current ? 'Здесь воспроизведение остановлено — чтобы не играло в двух местах.' : '')}
          <Row variant={v} id="ho-ok" onEnter={onClose}>{(f) => <div className="rounded-2xl px-4 py-3 text-center font-bold" style={{ ...card(f), fontSize: fs }}>Готово</div>}</Row>
        </div>
      )}
      {step.s === 'fail' && (
        <div className="space-y-3">
          <div style={{ fontSize: fs, color: '#fca5a5' }}>{step.text}</div>
          {step.to && <Row variant={v} id="ho-retry" onEnter={() => { const d = step.to; if (d) { void load().then(() => send(d)); } }}>{(f) => <div className="flex items-center justify-center gap-2 rounded-2xl px-4 py-3 font-bold" style={{ ...card(f), fontSize: fs }}><RotateCw size={big ? 28 : 16} />Повторить</div>}</Row>}
          <Row variant={v} id="ho-here" onEnter={() => { resumeHere(); onClose(); }}>{(f) => <div className="rounded-2xl px-4 py-3 text-center font-bold" style={{ ...card(f), fontSize: fs }}>{paused.current ? 'Продолжить здесь' : 'Закрыть'}</div>}</Row>
          <Row variant={v} id="ho-back" onEnter={() => setStep({ s: 'list' })}>{(f) => <div className="rounded-2xl px-4 py-3 text-center" style={{ ...card(f), fontSize: sm }}>Выбрать другое устройство</div>}</Row>
        </div>
      )}
    </div>
  );

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label="Продолжить на другом устройстве" data-keep-dark=""
      className={`fixed inset-0 z-[10060] flex ${v === 'default' ? 'items-end justify-center sm:items-center' : 'items-center justify-center'}`} style={{ background: 'rgba(5,5,14,.72)' }}
      onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="w-full" style={{ maxWidth: v === 'tv' ? 980 : v === 'car' ? 760 : 460, background: 'linear-gradient(160deg,#1c1740,#0d0b20)', border: '1px solid rgba(179,167,255,.28)', borderRadius: big ? 36 : 24, padding: big ? 32 : 18, paddingBottom: v === 'default' ? 'max(18px, env(safe-area-inset-bottom))' : undefined, margin: v === 'default' ? 8 : 0 }}>
        {body}
      </div>
    </div>, document.body);
};

export const ContinueOnDevice = (p: ContinueProps) => {
  const [open, setOpen] = useState(false);
  const v = p.variant ?? 'default';
  const lab = p.label !== false;
  const onOpen = () => setOpen(true);
  const style: React.CSSProperties = p.style ?? (v === 'default' ? {} : { minWidth: 72, minHeight: 72 });
  const inner = (focused = false): ReactNode => (
    <span className="inline-flex items-center justify-center gap-2" aria-label="Продолжить на другом устройстве" title="Продолжить на другом устройстве">
      <ArrowRightLeft size={v === 'default' ? 18 : v === 'car' ? 34 : 32} style={{ color: focused ? '#fff' : undefined }} />
      {lab && <span className={v === 'default' ? 'text-xs font-semibold' : 'text-[22px] font-bold'}>На другое устройство</span>}
    </span>
  );
  return (<>
    {v === 'tv'
      ? <TVFocusable id={`ho-btn-${p.itemId}`} scope={p.tvScope} onEnter={onOpen} className={p.className} style={style}>{({ focused }) => <span className="inline-flex items-center rounded-full px-5 py-3 text-white" style={{ background: focused ? '#8b7cff' : 'rgba(255,255,255,.14)', boxShadow: focused ? '0 0 0 4px rgba(179,167,255,.9)' : 'none' }}>{inner(focused)}</span>}</TVFocusable>
      : <button type="button" onClick={onOpen} className={p.className ?? 'inline-flex items-center rounded-full px-3 py-2 outline-none'} style={{ color: 'inherit', ...style }}>{inner()}</button>}
    {open && <Sheet p={p} onClose={() => setOpen(false)} />}
  </>);
};
