import { APP_VERSION_LABEL } from '../core/version';
import { fitImageToDataUrl } from '../shared/imageFit';
import { OwnerNotifySettings } from './OwnerNotifySettings';
import { StaffNotifySettings } from './StaffNotifySettings';
import { enablePush, disablePush, PUSH_TEXT } from '@/notifications/pushClient';
import { useCursorPet, CURSOR_ANIMALS } from '@/shared/cursorPet';
import { flash } from '../shared/flash';
import { Mic as MicIcon, PanelTop, QrCode, ScanLine } from 'lucide-react';
import { useWake, requestMicForWake } from '@/island/wake';
import { recognitionMode } from '@/ai/speech';
import { LanguageButtons } from '@/i18n/LanguageSwitch';
import { OwnProfileView } from './viewer/FullProfilePage';
import { UpdatesDialog } from '../updates/UpdatesDialog';
import { InviteDialog } from '../invite/InviteDialog';
import { MyQrDialog } from '../qr/MyQrDialog';
import { ScanContact } from '../qr/ScanContact';
import { ArchiveDialog } from '../archive/ArchiveDialog';
import { AppIconSettings } from '../appicon/AppIconSettings';
import { openGuide, goTo as goToGuide } from '../guide/nav';
import { SEASONS, SEASON_ORDER, resolveSeason, type Season } from '../settings/seasons';
import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Camera, Edit2, Check, X, Phone, Shield, Star, Crown, Clock,
  Lock, Eye, Bell, ChevronRight, LogOut, Gamepad2, Trophy, Swords, ChevronDown,
  Settings, Moon, Sun, Globe, Volume2, Download, Palette, Info, ExternalLink, WifiOff, Wallet, Gift, EyeOff, PawPrint, Briefcase, Users,
  RotateCcw, CheckCheck, MessageSquare, Send, Fingerprint, Coffee, Timer, Pause, Tv, Car,
  ArrowLeftRight, LifeBuoy, ScrollText, Video, Flower2, Sparkles, ChevronUp,
} from 'lucide-react';
import { useAuthStore } from '@/core/auth/store';
import { useModuleStore } from '@/data/state/modules';
import { ConfirmExit } from '@/auth/AuthScreen';
import { useIsMobile } from '@/interface/mobile/useIsMobile';
import { usePrivacyStore } from './privacyStore';
import { syncBloomAuthor } from '@/bloom/store';
import { useMessengerStore } from '@/messenger/store';
import { ConnectionPanel } from '@/proxy/ConnectionPanel';
import { APP_THEMES, activeAppTheme, appThemePatch } from '@/settings/appThemes';
import { CustomThemeEditor } from '@/settings/CustomThemeEditor';
import { useCustomThemes } from '@/settings/customThemes';
import { ReferralPanel } from '@/referral/Referral';
import { useSettings, ACCENT_COLORS, THEME_MODES, FONT_SIZES, type AccentColor, type ThemeMode, type FontSize, type ColorScheme } from '@/settings/store';
import { useBreakReminderStore, INTERVAL_OPTIONS, SNOOZE_OPTIONS } from '@/settings/breakReminderStore';
import { getTVModeSetting, setTVModeSetting, type TVModeSetting } from '@/interface/tv/useDeviceMode';
import { useCarMode, setCarMode } from '@/interface/car/useCarMode';
import { useSpeakerMode, setSpeakerMode } from '@/interface/speaker/useSpeakerMode';
import { useConsoleModeSetting, setConsoleModeSetting } from '@/interface/console/consoleMode';
import { useCallStore } from '@/calls/store';
import { SkyMoneyWallet } from '@/wallet/SkyMoneyWallet';
import { ProfileGiftsShowcase } from '@/gifts/SkyGifts';
import { GamingAccountsPanel, GamingActivityCard } from '@/gaming/GamingUI';
import { PetSprite } from '@/messenger/PetSprite';
import { CustomizationSettingsTab } from '@/customization/CustomizationSettingsTab';
import {
  apiMyPets, apiMySkins, apiPetVisibility, apiSetPetVisibility,
  PET_RARITY_LABEL, PET_RARITY_COLOR,
  type PetInstance, type SkinInventoryEntry,
} from '@/messenger/petsApi';
import { usePetMedia } from '@/messenger/petMedia';
import { apiQuickMenuGet, apiQuickMenuSet, apiQuickMenuReset, type QuickMenuItem } from '@/quickmenu/quickMenuApi';
import { useMoney, fmt } from '@/wallet/store';
import { SupportScreen } from '@/support/SupportScreen';
import { LegalDocs }     from '@/info/LegalDocs';
import { SkyIDTab }    from './SkyIDTab';
import { KassaBusiness } from '@/kassabiz/KassaBusiness';
import { ModuleGate } from '@/core/moduleClosures';

const fmtDur = (s: number) => s < 60 ? `${s}с` : `${Math.floor(s/60)}м ${s%60}с`;
const fmtDate = (iso: string) => { try { return new Date(iso).toLocaleString('ru-RU',{day:'numeric',month:'long',hour:'2-digit',minute:'2-digit'}); } catch { return iso; } };

type PrivacyVal = 'all'|'contacts'|'nobody';
type Section = 'main'|'privacy'|'game'|'settings'|'wallet'|'gifts'|'pets'|'gaming_acc'|'proxy'|'referral'|'skyid'|'business'|'customization'|'support'|'info';

// --- Toggle row --------------------------------------------------------------
const PrivRow = ({ label, sub, value, onChange }: { label:string; sub?:string; value:PrivacyVal; onChange:(v:PrivacyVal)=>void }) => {
  const [open, setOpen] = useState(false);
  const opts:[PrivacyVal,string][] = [['all','Все'],['contacts','Контакты'],['nobody','Никто']];
  const cur = opts.find(o=>o[0]===value)?.[1]??'Все';
  return (
    <div>
      <button type="button" onClick={()=>setOpen(v=>!v)}
        className="flex w-full items-center justify-between rounded-2xl px-4 py-3 transition-colors hover:bg-[color:var(--bg-l2)]">
        <div>
          <p className="text-sm text-[color:var(--t1)]">{label}</p>
          {sub&&<p className="text-xs mt-0.5" style={{color:'var(--t3)'}}>{sub}</p>}
        </div>
        <div className="flex items-center gap-1.5" style={{color:'var(--accent)'}}>
          <span className="text-sm">{cur}</span><ChevronDown size={14} className={`transition-transform ${open?'rotate-180':''}`}/>
        </div>
      </button>
      {/* Список раскрывается в потоке, а не абсолютно: карточка вокруг строк
          обрезает всё, что выходит за её края (overflow-hidden), и «Никто»
          оказывался за краем и не нажимался. */}
      <AnimatePresence initial={false}>
        {open&&(
          <motion.div initial={{height:0,opacity:0}} animate={{height:'auto',opacity:1}} exit={{height:0,opacity:0}}
            className="overflow-hidden mx-4 mb-2 rounded-2xl" style={{background:'var(--bg-l2)',border:'1px solid var(--border)'}}>
            {opts.map(([k,l])=>(
              <button key={k} type="button" onClick={()=>{onChange(k);setOpen(false);}}
                className="flex w-full items-center justify-between px-4 py-2.5 text-sm transition-colors hover:bg-[color:var(--bg-l3)]"
                style={{color:value===k?'var(--accent)':'var(--t1)'}}>
                {l}{value===k&&<Check size={13} style={{color:'var(--accent)'}}/>}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

// --- Профиль -----------------------------------------------------------------

/* -- Profile Pets Section -----------------------------------
   Раньше «мои питомцы» были фиксированным каталогом из 12 имён, а
   «скины» — локальной перекраской за Баллы Прайма (petSkins.ts).
   Теперь и то, и другое — настоящие данные: владение питомцами с
   /api/pets/mine, инвентарь — с реального Sky Skin Market
   (/api/pets/market/mine), видимость в профиле — тот же переключатель,
   что читает/пишет сервер (server/pets.mjs::getVisibility/setVisibility),
   а не отдельный локальный флаг. */
const ProfilePetsSection = () => {
  const [pets, setPets] = useState<PetInstance[] | null>(null);
  const [skins, setSkins] = useState<SkinInventoryEntry[] | null>(null);
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void apiMyPets().then(r => { if (r.ok && r.data) setPets(r.data.pets); });
    void apiMySkins().then(r => { if (r.ok && r.data) setSkins(r.data.skins); });
    void apiPetVisibility().then(r => { if (r.ok && r.data) setHidden(!r.data.showInProfile); });
  }, []);

  const toggleHidden = async () => {
    setBusy(true);
    const next = !hidden;
    const r = await apiSetPetVisibility({ showInProfile: !next });
    setBusy(false);
    if (r.ok) setHidden(next);
  };

  return (
    <div className="flex flex-col h-full overflow-y-auto px-4 py-4 space-y-4" style={{ scrollbarWidth:'none' }}>
      {/* Header with hide toggle */}
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold uppercase tracking-wider" style={{ color:'var(--t3)' }}>
          <PawPrint size={13} className="inline mr-1"/>Мои питомцы
        </p>
        <button type="button" disabled={busy} onClick={() => void toggleHidden()}
          className="flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold transition-all disabled:opacity-50"
          style={{
            background: hidden ? 'rgba(248,113,113,0.1)' : 'rgba(52,211,153,0.1)',
            border: `1px solid ${hidden ? 'rgba(248,113,113,0.25)' : 'rgba(52,211,153,0.25)'}`,
            color: hidden ? 'var(--red)' : 'var(--green)',
          }}>
          {hidden ? <><EyeOff size={11}/> Скрыто</> : <><Eye size={11}/> Видно</>}
        </button>
      </div>

      {hidden && (
        <div className="rounded-2xl px-4 py-3 text-center"
          style={{ background:'rgba(248,113,113,0.06)', border:'1px solid rgba(248,113,113,0.15)' }}>
          <p className="text-xs" style={{ color:'var(--red)' }}>
            Питомцы скрыты в вашем профиле для других пользователей
          </p>
        </div>
      )}

      {/* Активные питомцы */}
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wider mb-3" style={{ color:'var(--t3)' }}>
          Мои питомцы {pets ? `(${pets.length})` : ''}
        </p>
        {pets === null ? (
          <p className="text-xs py-4 text-center" style={{ color:'var(--t3)' }}>Загрузка…</p>
        ) : pets.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-6">
            <PawPrint size={28} className="opacity-40" style={{ color:'var(--t3)' }}/>
            <p className="text-xs" style={{ color:'var(--t3)' }}>Пока нет питомцев</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {pets.map(pet => {
              const color = pet.type?.color ?? '#8b5cf6';
              const rc = PET_RARITY_COLOR[pet.rarity];
              return (
                <div key={pet.id} className="rounded-2xl p-3 flex flex-col items-center gap-2 relative"
                  style={{ background: `linear-gradient(155deg,${color}12,${color}08)`, border: `1.5px solid ${rc}30` }}>
                  <PetSprite typeId={pet.typeId} color={color} mood="idle" size={72} showParticles={false}/>
                  <div className="text-center">
                    <p className="text-xs font-bold text-[color:var(--t1)]">{pet.name}</p>
                    <p className="text-[9px] mt-0.5" style={{ color:rc }}>Ур.{pet.level} · {PET_RARITY_LABEL[pet.rarity]}</p>
                  </div>
                  {pet.isActive && (
                    <span className="absolute top-1.5 right-1.5 h-2.5 w-2.5 rounded-full" style={{ background:'#22c55e' }}/>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Инвентарь Sky Skin Market */}
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wider mb-3" style={{ color:'var(--t3)' }}>
          Sky Skin Market ({skins?.length ?? 0})
        </p>
        {skins === null ? (
          <p className="text-xs py-4 text-center" style={{ color:'var(--t3)' }}>Загрузка…</p>
        ) : skins.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-6">
            <Palette size={28} className="opacity-40" style={{ color:'var(--t3)' }}/>
            <p className="text-xs" style={{ color:'var(--t3)' }}>Нет купленных предметов</p>
          </div>
        ) : (
          <div className="grid grid-cols-4 gap-2">
            {skins.map(skin => {
              const rc = PET_RARITY_COLOR[skin.rarity];
              return (
                <div key={skin.inventoryId}
                  className="rounded-2xl p-2.5 flex flex-col items-center gap-1"
                  style={{ background: `${rc}10`, border: `1.5px solid ${rc}35` }}>
                  <div className="w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs text-white overflow-hidden"
                    style={{ background: rc }}>
                    {skin.previewUrl ? <SkinThumb path={skin.previewUrl}/> : skin.name[0]}
                  </div>
                  <p className="text-[8px] font-bold text-[color:var(--t1)] text-center truncate w-full">{skin.name}</p>
                  <span className="text-[7px] font-bold" style={{ color:rc }}>{PET_RARITY_LABEL[skin.rarity]}</span>
                  {skin.instanceNumber != null && (
                    <span className="text-[7px]" style={{ color:'var(--t3)' }}>#{skin.instanceNumber}</span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

/** Маленькая превьюшка предмета Sky Skin Market — медиа авторизовано
 *  токеном, поэтому обычный <img src> не сработает (см. petMedia.ts). */
const SkinThumb = ({ path }: { path: string }) => {
  const url = usePetMedia(path);
  return url ? <img src={url} alt="" className="w-full h-full object-cover"/> : null;
};


/* ============================================================
   SETTINGS SECTION  -  полноценные рабочие настройки
============================================================ */
const Toggle = ({ on, onToggle, disabled=false }: { on:boolean; onToggle:()=>void; disabled?:boolean }) => (
  <div role="switch" aria-checked={on} onClick={disabled?undefined:onToggle}
    className="relative h-6 w-11 rounded-full shrink-0 transition-colors"
    style={{ background: on ? 'var(--accent)' : 'var(--border-m)', opacity: disabled?0.4:1, cursor: disabled?'default':'pointer', flexShrink:0 }}>
    <motion.div className="absolute top-1 h-4 w-4 rounded-full bg-white shadow"
      animate={{ left: on ? 22 : 2 }} transition={{ type:'spring', stiffness:500, damping:30 }}/>
  </div>
);

/* ── Sky Island: где показывать плеер и события, Sky AI ──────────────── */
const Seg = <T extends string | number>({ value, options, onChange, label }: {
  value: T; options: { v: T; t: string }[]; onChange: (v: T) => void; label: string;
}) => (
  <div role="radiogroup" aria-label={label} className="flex shrink-0 gap-1 rounded-xl p-1" style={{ background: 'var(--bg-l2)' }}>
    {options.map(o => (
      <button key={String(o.v)} type="button" role="radio" aria-checked={value === o.v} onClick={() => onChange(o.v)}
        className="rounded-lg px-2.5 py-1 text-[11.5px] font-semibold outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
        style={{ background: value === o.v ? 'var(--accent)' : 'transparent', color: value === o.v ? '#fff' : 'var(--t2)' }}>{o.t}</button>
    ))}
  </div>
);

const IslandSection = () => {
  const s = useSettings(st => st.settings);
  const set = useSettings(st => st.set);
  const wake = useWake(w => w.state);
  const wakeMode = useWake(w => w.mode);
  const [mic, setMic] = useState<'granted' | 'denied' | 'prompt' | 'unknown'>('unknown');
  const [canListen, setCanListen] = useState(true);

  useEffect(() => {
    let off = false;
    void recognitionMode().then(m => { if (!off) setCanListen(m !== 'none'); });
    navigator.permissions?.query({ name: 'microphone' as PermissionName })
      .then(q => { if (off) return; setMic(q.state as typeof mic); q.onchange = () => setMic(q.state as typeof mic); })
      .catch(() => {});
    return () => { off = true; };
  }, []);

  const [outputs, setOutputs] = useState<string[] | null>(null);
  useEffect(() => {
    if (!s.aiSpeaker || !navigator.mediaDevices?.enumerateDevices) return;
    let off = false;
    const read = () => navigator.mediaDevices.enumerateDevices()
      .then(d => { if (!off) setOutputs(d.filter(x => x.kind === 'audiooutput' && x.label).map(x => x.label)); }).catch(() => {});
    void read();
    navigator.mediaDevices.addEventListener?.('devicechange', read);
    return () => { off = true; navigator.mediaDevices.removeEventListener?.('devicechange', read); };
  }, [s.aiSpeaker, mic]);
  const toggleSpeaker = async () => {
    if (s.aiSpeaker) { set({ aiSpeaker: false }); return; }
    if (!(await askMic())) return;
    set({ aiSpeaker: true, aiWake: true, aiVoiceAnswers: true, aiContinue: true });
  };
  const askMic = async () => {
    const ok = await requestMicForWake();
    setMic(ok ? 'granted' : 'denied');
    if (!ok) flash('Микрофон не разрешён. Разрешите его для этого сайта в настройках браузера.');
    return ok;
  };
  const toggleWake = async () => {
    if (s.aiWake) { set({ aiWake: false }); return; }
    if (!(await askMic())) return;
    set({ aiWake: true });
  };
  const wakeSub = !s.aiWake ? 'Выключено — слушает только по кнопке'
    : wake === 'unsupported' ? 'Этот браузер не умеет слушать фразу — вызывайте кнопкой'
      : wake === 'no-permission' ? 'Нет доступа к микрофону'
        : wake === 'error' ? 'Служба распознавания недоступна — вызывайте кнопкой'
          : wakeMode === 'local' ? 'Слушает на устройстве, пока приложение открыто. Ничего не записывается'
            : 'Слушает, пока приложение открыто. В этом браузере распознавание речи выполняет сервис браузера. Ничего не записывается';

  return (
    <SectionBlock title="Sky Island и Sky AI">
      <SettingsRow icon={PanelTop} label="Где показывать плеер" sub="Остров сверху или боковой плеер"
        right={<Seg label="Где показывать плеер" value={s.islandMode} onChange={v => set({ islandMode: v })}
          options={[{ v: 'both', t: 'Оба' }, { v: 'island', t: 'Остров' }, { v: 'side', t: 'Сбоку' }]}/>}/>
      <SettingsRow icon={Bell} label="Отсчёт перед удалением" sub="Сколько секунд можно отменить удаление"
        right={<Seg label="Отсчёт перед удалением" value={String(s.deleteCountdown)} onChange={v => set({ deleteCountdown: Number(v) as 3 | 5 | 10 })}
          options={[{ v: '3', t: '3 с' }, { v: '5', t: '5 с' }, { v: '10', t: '10 с' }]}/>}/>
      <SettingsRow icon={Bell} label="Уведомления на острове" sub={s.islandNotifs ? 'Сообщения, звонки, события' : 'Обычные всплывающие уведомления'}
        right={<Toggle on={s.islandNotifs} onToggle={() => set({ islandNotifs: !s.islandNotifs })}/>}/>
      <SettingsRow icon={Bell} label="Сообщения мессенджера" sub={s.islandMessages ? 'Показывать' : 'Не показывать на острове'}
        right={<Toggle on={s.islandMessages} onToggle={() => set({ islandMessages: !s.islandMessages })}/>}/>
      <SettingsRow icon={Bell} label="Смена трека" sub={s.islandTracks ? 'Показывать на 3 секунды' : 'Не показывать'}
        right={<Toggle on={s.islandTracks} onToggle={() => set({ islandTracks: !s.islandTracks })}/>}/>
      <SettingsRow icon={Bell} label="Завершение скачиваний" sub={s.islandDownloads ? 'Показывать' : 'Не показывать'}
        right={<Toggle on={s.islandDownloads} onToggle={() => set({ islandDownloads: !s.islandDownloads })}/>}/>
      <SettingsRow icon={Bell} label="Время показа события" sub="Секунд на экране"
        right={<Seg label="Время показа" value={s.islandSeconds} onChange={v => set({ islandSeconds: v })}
          options={[{ v: 3, t: '3' }, { v: 4, t: '4' }, { v: 6, t: '6' }, { v: 10, t: '10' }]}/>}/>
      <SettingsRow icon={Bell} label="Текст сообщений на острове" sub="Что видно посторонним на экране"
        right={<Seg label="Текст сообщений" value={s.islandPrivacy} onChange={v => set({ islandPrivacy: v })}
          options={[{ v: 'full', t: 'Весь' }, { v: 'sender', t: 'Имя' }, { v: 'hidden', t: 'Скрыть' }]}/>}/>
      <SettingsRow icon={Palette} label="Анимация острова" sub="Упрощённая — без пружин и растяжения"
        right={<Seg label="Анимация острова" value={s.islandAnim} onChange={v => set({ islandAnim: v })}
          options={[{ v: 'full', t: 'Обычная' }, { v: 'simple', t: 'Простая' }]}/>}/>
      <div className="h-px mx-4" style={{ background:'var(--border)' }}/>
      <SettingsRow icon={MicIcon} label="Позвать Sky AI кнопкой" sub={s.aiManualCall ? 'Кнопка в боковой панели и в меню «Ещё»' : 'Выключено'}
        right={<Toggle on={s.aiManualCall} onToggle={() => set({ aiManualCall: !s.aiManualCall })}/>}/>
      <SettingsRow icon={MicIcon} label="Фраза «Привет, Скай»" sub={wakeSub}
        right={<Toggle on={s.aiWake} disabled={!canListen} onToggle={() => { void toggleWake(); }}/>}/>
      <SettingsRow icon={Sparkles} label="Скрывать Explicit (E)" sub={s.hideExplicit ? 'Материалы с меткой «E» не показываются в каталогах музыки, кино и книг' : 'Показывать всё; метка «E» стоит рядом с названием'}
        right={<Toggle on={s.hideExplicit} onToggle={() => set({ hideExplicit: !s.hideExplicit })}/>}/>
      <SettingsRow icon={MicIcon} label="Умная колонка"
        sub={!s.aiSpeaker ? 'Подключите Bluetooth-колонку к телефону или ПК и говорите «Привет, Скай, включи …»'
          : `Включено: слушает фразу, отвечает голосом, музыка играет через устройство вывода звука${outputs?.length ? ` (${outputs.join(', ')})` : ''}. Работает, пока приложение открыто; индикатор микрофона виден на острове`}
        right={<Toggle on={s.aiSpeaker} disabled={!canListen} onToggle={() => { void toggleSpeaker(); }}/>}/>
      <SettingsRow icon={MicIcon} label="Микрофон"
        sub={mic === 'granted' ? 'Разрешён. Используется только во время разговора с Sky AI и пока включена фраза' : mic === 'denied' ? 'Запрещён — разрешите в настройках браузера' : 'Разрешение запросим, когда понадобится'}
        right={mic !== 'granted' ? <button type="button" onClick={() => { void askMic(); }} className="rounded-lg px-3 py-1.5 text-xs font-semibold text-white" style={{ background:'var(--accent)' }}>Разрешить</button> : undefined}/>
      <SettingsRow icon={Sparkles} label="Голосовые ответы" sub={s.aiVoiceAnswers ? 'Sky AI отвечает голосом' : 'Только текстом на острове'}
        right={<Toggle on={s.aiVoiceAnswers} onToggle={() => set({ aiVoiceAnswers: !s.aiVoiceAnswers })}/>}/>
      <SettingsRow icon={Sparkles} label="Продолжать диалог" sub={s.aiContinue ? 'Слушает ответ, если Sky AI задал вопрос' : 'Один вопрос — один ответ'}
        right={<Toggle on={s.aiContinue} onToggle={() => set({ aiContinue: !s.aiContinue })}/>}/>
      <SettingsRow icon={Sparkles} label="Завершать при тишине" sub={s.aiIdleEnd ? 'Через 12 секунд' : 'Через минуту'}
        right={<Toggle on={s.aiIdleEnd} onToggle={() => set({ aiIdleEnd: !s.aiIdleEnd })}/>}/>
    </SectionBlock>
  );
};

const SettingsRow = ({ icon:Icon, iconColor='var(--accent)', label, sub, right, onClick }: {
  icon:any; iconColor?:string; label:string; sub?:string;
  right?:React.ReactNode; onClick?:()=>void;
}) => {
  const isMobile = useIsMobile();
  return (
  <div onClick={onClick} data-compact-row
    className={isMobile ? 'flex w-full items-center gap-2.5 px-3 py-2 transition-colors hover:bg-white/[0.04]' : 'flex w-full items-center gap-3 px-4 py-3 transition-colors hover:bg-white/[0.04]'}
    style={{ cursor: onClick ? 'pointer' : 'default' }}>
    <div className={isMobile ? 'grid h-7 w-7 place-items-center rounded-lg shrink-0' : 'grid h-9 w-9 place-items-center rounded-xl shrink-0'}
      style={{ background:`${iconColor}15` }}>
      <Icon size={isMobile ? 14 : 16} style={{ color:iconColor }}/>
    </div>
    <div className="flex-1 text-left min-w-0">
      <p className={isMobile ? 'text-[13px] text-[color:var(--t1)]' : 'text-sm text-[color:var(--t1)]'}>{label}</p>
      {sub && <p className={isMobile ? 'text-[10.5px] mt-0.5 truncate' : 'text-xs mt-0.5 truncate'} style={{ color:'var(--t3)' }}>{sub}</p>}
    </div>
    {right}
  </div>
  );
};

const SectionBlock = ({ title, children }: { title:string; children:React.ReactNode }) => {
  const isMobile = useIsMobile();
  return (
  <div className="rounded-2xl overflow-hidden" style={{ background:'var(--bg-l1)', border:'1px solid var(--border)' }}>
    <p className={isMobile ? 'px-3 pt-2.5 pb-1 text-[9.5px] font-bold uppercase tracking-widest' : 'px-4 pt-3 pb-1.5 text-[10px] font-bold uppercase tracking-widest'} style={{ color:'var(--t3)' }}>
      {title}
    </p>
    {children}
  </div>
  );
};

const C = { accent:'var(--accent)' };

/* -- Перерыв от просмотра ------------------------------------------- */
const BreakReminderSection = () => {
  const { settings, setSettings } = useBreakReminderStore();

  const selCls = "rounded-lg px-2 py-1 text-xs font-bold outline-none";
  const selStyle = { background:'var(--bg-l2)', color:'var(--t1)', border:'1px solid var(--border)' };

  return (
    <SectionBlock title="Перерыв от просмотра">
      <SettingsRow icon={Coffee} label="Напоминать о перерыве" sub={settings.enabled ? 'Включено' : 'Выключено'}
        right={<Toggle on={settings.enabled} onToggle={() => setSettings({ enabled: !settings.enabled })}/>}/>
      <div className="h-px mx-4" style={{ background:'var(--border)' }}/>
      <SettingsRow icon={Timer} label="Интервал напоминания"
        sub={settings.enabled ? undefined : 'Включите функцию, чтобы настроить'}
        right={
          <select disabled={!settings.enabled} value={settings.intervalMinutes}
            onChange={e => setSettings({ intervalMinutes: Number(e.target.value) })}
            className={selCls} style={selStyle}>
            {INTERVAL_OPTIONS.map(m => <option key={m} value={m}>{m} мин</option>)}
          </select>
        }/>
      <div className="h-px mx-4" style={{ background:'var(--border)' }}/>
      <SettingsRow icon={Clock} label="«Напомнить позже» — через"
        right={
          <select disabled={!settings.enabled} value={settings.snoozeMinutes}
            onChange={e => setSettings({ snoozeMinutes: Number(e.target.value) })}
            className={selCls} style={selStyle}>
            {SNOOZE_OPTIONS.map(m => <option key={m} value={m}>{m} мин</option>)}
          </select>
        }/>
      <div className="h-px mx-4" style={{ background:'var(--border)' }}/>
      <SettingsRow icon={Pause} label="Ставить видео на паузу" sub="При выборе «Сделать перерыв»"
        right={<Toggle on={settings.pauseOnBreak} disabled={!settings.enabled} onToggle={() => setSettings({ pauseOnBreak: !settings.pauseOnBreak })}/>}/>
    </SectionBlock>
  );
};
/* -- TV-версия (ручное включение на случай проблем с автоопределением) -- */
const TVModeSection = () => {
  const [mode, setMode] = useState<TVModeSetting>(getTVModeSetting());
  const enable = () => { setTVModeSetting('on'); setMode('on'); };
  const disable = () => { setTVModeSetting('off'); setMode('off'); };
  const auto = () => { setTVModeSetting('auto'); setMode('auto'); };

  return (
    <SectionBlock title="TV-версия">
      <SettingsRow icon={Tv} label="Включить ТВ-версию"
        sub={mode === 'on' ? 'Включена вручную' : mode === 'off' ? 'Выключена вручную' : 'Автоопределение по устройству'}
        right={
          mode === 'on' ? (
            <button type="button" onClick={disable} className="rounded-lg px-3 py-1.5 text-xs font-bold" style={{ background:'var(--bg-l2)', color:'var(--t1)' }}>Выключить</button>
          ) : (
            <button type="button" onClick={enable} className="rounded-lg px-3 py-1.5 text-xs font-bold text-white" style={{ background:'var(--accent)' }}>Включить</button>
          )
        }/>
      {mode !== 'auto' && (
        <>
          <div className="h-px mx-4" style={{ background:'var(--border)' }}/>
          <SettingsRow icon={RotateCcw} label="Вернуть автоопределение" sub="Обычно определяется само — по типу устройства"
            right={<button type="button" onClick={auto} className="rounded-lg px-3 py-1.5 text-xs font-bold" style={{ background:'var(--bg-l2)', color:'var(--t1)' }}>Сбросить</button>}/>
        </>
      )}
      <p className="px-4 pb-3 pt-1 text-[11px]" style={{ color:'var(--t3)' }}>
        Полезно, если приложение неверно определило ваш телевизор или, наоборот, ошибочно включило TV-режим на обычном устройстве.
      </p>
    </SectionBlock>
  );
};

/* -- Sky Console (оболочка для игровых консолей) -------------------- */
const ConsoleModeSection = () => {
  const mode = useConsoleModeSetting();
  const on = mode === 'on';
  return (
    <SectionBlock title="Sky Console">
      <SettingsRow icon={Gamepad2} label="Режим Sky Console"
        sub={mode === 'on' ? 'Включён вручную' : mode === 'off' ? 'Выключен вручную' : 'Автоопределение по устройству (консоли)'}
        right={<Toggle on={on} onToggle={() => setConsoleModeSetting(on ? 'off' : 'on')} />} />
      <p className="px-4 pb-3 pt-1 text-[11px]" style={{ color: 'var(--t3)' }}>
        Полноэкранная оболочка для консолей и больших экранов с геймпадом: заставка, выбор профиля, главное меню и управление геймпадом. Обычный интерфейс и Sky TV не меняются. Вернуться можно в настройках консоли.
      </p>
    </SectionBlock>
  );
};

/* -- Car Mode (крупный интерфейс для экрана в машине) --------------- */
const CarModeSection = () => {
  const on = useCarMode();
  return (
    <SectionBlock title="Car Mode">
      <SettingsRow icon={Car} label="Включить Car Mode" sub={on ? 'Включён' : 'Выключен'}
        right={<Toggle on={on} onToggle={() => setCarMode(!on)} />} />
      <p className="px-4 pb-3 pt-1 text-[11px]" style={{ color: 'var(--t3)' }}>
        Крупный интерфейс без лишних деталей: Музыка, Кино, Подкасты, Сообщения и Sky AI одним касанием. Включайте, когда экран телефона подключён к машине.
      </p>
    </SectionBlock>
  );
};

const SpeakerModeSection = () => {
  const on = useSpeakerMode();
  return (
    <SectionBlock title="Sky Speaker">
      <SettingsRow icon={MicIcon} label="Режим умной колонки" sub={on ? 'Включён' : 'Выключен'}
        right={<Toggle on={on} onToggle={() => setSpeakerMode(!on)} />} />
      <p className="px-4 pb-3 pt-1 text-[11px]" style={{ color: 'var(--t3)' }}>
        Превращает устройство с подключённой колонкой в умную: часы Sky, голос Sky AI и музыка. Настройки колонки — внутри режима.
      </p>
    </SectionBlock>
  );
};

/* -- Quick Menu (набор разделов в PC Quick Actions) ------------------ */
const QuickMenuSection = () => {
  const [items, setItems] = useState<QuickMenuItem[] | null>(null);

  useEffect(() => { void apiQuickMenuGet().then(r => setItems(r.items)); }, []);

  const persist = (next: QuickMenuItem[]) => {
    setItems(next);
    void apiQuickMenuSet(next);
  };

  // Граница «закреплённых» — они всегда идут первыми, это же порядок
  // потом использует и сама панель Quick Actions.
  const boundary = (list: QuickMenuItem[]) => {
    const idx = list.findIndex(i => !i.pinned);
    return idx === -1 ? list.length : idx;
  };

  const toggleEnabled = (key: string) => {
    if (!items) return;
    persist(items.map(i => (i.key === key ? { ...i, enabled: !i.enabled } : i)));
  };

  const togglePinned = (key: string) => {
    if (!items) return;
    const item = items.find(i => i.key === key);
    if (!item) return;
    const rest = items.filter(i => i.key !== key);
    const b = boundary(rest);
    persist([...rest.slice(0, b), { ...item, pinned: !item.pinned }, ...rest.slice(b)]);
  };

  const move = (key: string, dir: -1 | 1) => {
    if (!items) return;
    const idx = items.findIndex(i => i.key === key);
    const swapIdx = idx + dir;
    if (idx === -1 || swapIdx < 0 || swapIdx >= items.length) return;
    if (items[idx].pinned !== items[swapIdx].pinned) return; // не пересекаем границу закреплённых
    const next = [...items];
    [next[idx], next[swapIdx]] = [next[swapIdx], next[idx]];
    persist(next);
  };

  const restoreDefaults = () => { void apiQuickMenuReset().then(setItems); };

  if (!items) return null;

  return (
    <SectionBlock title="Quick Menu">
      <p className="px-4 pt-3 pb-2 text-[11px]" style={{ color: 'var(--t3)' }}>
        Разделы для быстрого доступа в PC Quick Actions (Ctrl/Cmd+Shift+Space на компьютере) — включайте нужное, закрепляйте важное вперёд списка.
      </p>
      {items.map((it, i) => (
        <div key={it.key}>
          {i > 0 && <div className="h-px mx-4" style={{ background: 'var(--border)' }}/>}
          <SettingsRow icon={Sparkles} label={it.label} sub={it.pinned ? 'Закреплён' : undefined}
            right={
              <div className="flex items-center gap-1">
                <button type="button" onClick={() => move(it.key, -1)} disabled={i === 0 || items[i - 1]?.pinned !== it.pinned}
                  className="rounded-lg p-1 disabled:opacity-25" style={{ color: 'var(--t3)' }}><ChevronUp size={14}/></button>
                <button type="button" onClick={() => move(it.key, 1)} disabled={i === items.length - 1 || items[i + 1]?.pinned !== it.pinned}
                  className="rounded-lg p-1 disabled:opacity-25" style={{ color: 'var(--t3)' }}><ChevronDown size={14}/></button>
                <button type="button" onClick={() => togglePinned(it.key)} className="rounded-lg p-1"
                  style={{ color: it.pinned ? 'var(--accent)' : 'var(--t3)' }}>
                  <Star size={14} fill={it.pinned ? 'currentColor' : 'none'}/>
                </button>
                <Toggle on={it.enabled} onToggle={() => toggleEnabled(it.key)}/>
              </div>
            }/>
        </div>
      ))}
      <div className="px-4 pb-3 pt-1">
        <button type="button" onClick={restoreDefaults} className="text-xs font-bold flex items-center gap-1" style={{ color: 'var(--t3)' }}>
          <RotateCcw size={12}/>Вернуть по умолчанию
        </button>
      </div>
    </SectionBlock>
  );
};

const SettingsSection = ({ logout, username, onOpen }: {
  logout:()=>void; username:string;
  onOpen:(section:Section)=>void;
}) => {
  const switchProfile = useAuthStore(s=>s.switchProfile);
  const [confirmExit, setConfirmExit] = useState(false);
  const [updatesOpen, setUpdatesOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [myQrOpen, setMyQrOpen] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const { settings, set, reset } = useSettings();
  const cursorPet = useCursorPet();
  const s = settings;

  const { accounts, currentUserId } = useAuthStore();
  // Подписку выдаёт сервер: цену и срок он берёт из своей таблицы.
  // Раньше эти кнопки писали признак прямо в localStorage — то есть
  // «покупка» за 249 ₽ проходила бесплатно и до сервера не доходила.
  const [buying, setBuying] = useState(false);
  const [subNotice, setSubNotice] = useState<string | null>(null);
  const REASONS: Record<string, string> = {
    payments_not_configured: 'Оплата пока не подключена.',
    invalid_plan:            'Такого срока подписки нет.',
    insufficient_funds:      'Не хватает средств на счёте.',
    not_active_profile:      'Подписка оформляется на активный профиль.',
  };
  const buyPrime = async () => {
    setSubNotice(null); setBuying(true);
    const res = await useAuthStore.getState().purchasePrime('standard', 730);
    setBuying(false);
    if (!res.ok) setSubNotice(REASONS[res.reason ?? ''] ?? 'Не получилось оформить подписку.');
  };
  const me = accounts.find(a => a.id === currentUserId);
  const isPrime = me?.isPrime ?? false;
  const isPrimeBusiness = me?.isPrimeBusiness ?? false;

  return (
    <>
    <div className="flex flex-col px-4 py-4 pb-10 space-y-3" style={{ scrollbarWidth:'none' }}>

      {/* -- ТЕМА ------------------------------- */}
      <SectionBlock title="Язык / Language">
        <LanguageButtons />
      </SectionBlock>

      <SectionBlock title="Тема оформления">
        <div className="px-4 pb-3 pt-1">
          <p className="mb-1.5 px-1 text-[12px] font-bold" style={{ color: 'var(--t2)' }}>Готовые темы</p>
          <div className="mb-4 grid grid-cols-4 gap-2" role="radiogroup" aria-label="Готовые темы">
            {APP_THEMES.map((t) => {
              const on = activeAppTheme(s) === t.id;
              return (
                <button key={t.id} type="button" role="radio" aria-checked={on} onClick={() => { useCustomThemes.getState().activate(null); set(appThemePatch(t)); }}
                  className="flex flex-col items-center gap-1.5">
                  <span className="relative block w-full overflow-hidden" style={{ aspectRatio: '1/1.1', borderRadius: 14, background: t.swatch[0], border: `2.5px solid ${on ? t.swatch[2] : 'rgba(128,128,128,0.25)'}` }}>
                    <span className="absolute inset-x-1.5 top-2 h-2.5 rounded-full" style={{ background: t.swatch[1] }} />
                    <span className="absolute inset-x-1.5 top-6 h-2.5 w-1/2 rounded-full" style={{ background: t.swatch[1] }} />
                    <span className="absolute bottom-1.5 right-1.5 h-4 w-4 rounded-full" style={{ background: t.swatch[2] }} />
                  </span>
                  <span className="text-[10px] font-semibold" style={{ color: on ? t.swatch[2] : 'var(--t2)' }}>{t.name}</span>
                </button>
              );
            })}
          </div>
          {/* Светлая/тёмная — отдельный переключатель: AMOLED и Dim ниже
              это поднастройки именно тёмной, у светлой темы их нет. */}
          <div className="grid grid-cols-2 gap-2.5 mb-3">
            {([['dark', 'Тёмная', Moon], ['light', 'Светлая', Sun]] as [ColorScheme, string, typeof Moon][]).map(([key, label, Icon]) => {
              const isActive = s.colorScheme === key;
              return (
                <button key={key} type="button" onClick={() => set({ colorScheme: key })}
                  className="flex items-center justify-center gap-2 rounded-2xl py-3 transition-all"
                  style={{
                    background: isActive ? `${ACCENT_COLORS[s.accent].hex}18` : 'rgba(255,255,255,0.04)',
                    border: `2px solid ${isActive ? ACCENT_COLORS[s.accent].hex : 'var(--border)'}`,
                  }}>
                  <Icon size={15} style={{ color: isActive ? ACCENT_COLORS[s.accent].hex : 'var(--t2)' }} />
                  <span className="text-[12px] font-bold"
                    style={{ color: isActive ? ACCENT_COLORS[s.accent].hex : 'var(--t2)' }}>
                    {label}
                  </span>
                </button>
              );
            })}
          </div>
          <CustomThemeEditor />
          <p className="mb-1.5 mt-3 px-1 text-[12px] font-bold" style={{ color: 'var(--t2)' }}>Сезонная тема</p>
          <div className="mb-2 flex flex-wrap gap-2 px-1" role="radiogroup" aria-label="Сезонная тема">
            {([['none', 'Нет', '—'], ['auto', 'Авто', '📅'], ...SEASON_ORDER.map((k) => [k, SEASONS[k].label, SEASONS[k].emoji])] as [Season, string, string][]).map(([k, label, emoji]) => {
              const on = s.season === k;
              return (
                <button key={k} type="button" role="radio" aria-checked={on} onClick={() => { if (k !== 'none') useCustomThemes.getState().activate(null); set({ season: k }); }}
                  className="flex items-center gap-1.5 rounded-full px-3.5 py-2 text-[12px] font-bold"
                  style={{ minHeight: 40, background: on ? `${ACCENT_COLORS[s.accent].hex}22` : 'rgba(255,255,255,0.04)', border: `2px solid ${on ? ACCENT_COLORS[s.accent].hex : 'var(--border)'}`, color: on ? 'var(--t1)' : 'var(--t2)' }}>
                  <span aria-hidden="true">{emoji}</span>{label}
                </button>
              );
            })}
          </div>
          {s.season === 'auto' && <p className="mb-2 px-1 text-[11px]" style={{ color: 'var(--t3)' }}>{`Сейчас по дате: ${SEASONS[resolveSeason('auto')!].label}. Хэллоуин — с 24 октября по 1 ноября.`}</p>}
          {s.season !== 'none' && (
            <SettingsRow icon={Palette} label="Украшения" sub="Снежинки, листья, лепестки — лёгкая анимация"
              right={<Toggle on={s.seasonDecor} onToggle={() => set({ seasonDecor: !s.seasonDecor })}/>}/>
          )}
          <SettingsRow icon={Moon} label="Автопереключение по времени"
            sub={s.autoTheme ? `Светлая с ${s.autoThemeLight}, тёмная с ${s.autoThemeDark}` : 'Тема меняется сама в выбранные часы'}
            right={<Toggle on={s.autoTheme} onToggle={() => set({ autoTheme: !s.autoTheme })}/>}/>
          {s.autoTheme && (
            <div className="grid grid-cols-2 gap-2.5 mb-3 px-1">
              {([['autoThemeLight', 'Светлая с', Sun], ['autoThemeDark', 'Тёмная с', Moon]] as const).map(([key, label, Icon]) => (
                <label key={key} className="flex flex-col gap-1 rounded-2xl px-3 py-2" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)' }}>
                  <span className="flex items-center gap-1.5 text-[11px] font-semibold" style={{ color: 'var(--t2)' }}><Icon size={12}/>{label}</span>
                  <input type="time" value={s[key]} onChange={e => { if (e.target.value) set({ [key]: e.target.value }); }}
                    className="bg-transparent text-base font-bold outline-none" style={{ color: 'var(--t1)', colorScheme: s.colorScheme }}/>
                </label>
              ))}
            </div>
          )}
          {s.colorScheme === 'dark' && (
          <div className="grid grid-cols-3 gap-2.5">
            {(Object.entries(THEME_MODES) as [ThemeMode, any][]).map(([key, t]) => {
              const isActive = s.theme === key;
              return (
                <button key={key} type="button" onClick={() => set({ theme: key })}
                  className="flex flex-col items-center gap-2 rounded-2xl py-3.5 px-2 transition-all"
                  style={{
                    background: isActive
                      ? `${ACCENT_COLORS[s.accent].hex}18`
                      : 'rgba(255,255,255,0.04)',
                    border: `2px solid ${isActive ? ACCENT_COLORS[s.accent].hex : 'var(--border)'}`,
                    boxShadow: isActive ? `0 0 0 3px ${ACCENT_COLORS[s.accent].hex}18` : 'none',
                  }}>
                  <span className="text-2xl">{t.icon}</span>
                  {/* Mini preview */}
                  <div className="flex gap-1 items-center">
                    {[t.bg, t.l1, t.l2].map((col,i) => (
                      <div key={i} className="rounded-full border border-white/20 shrink-0"
                        style={{ width: i===0?12:8, height: i===0?12:8, background: col }}/>
                    ))}
                  </div>
                  <span className="text-[11px] font-bold"
                    style={{ color: isActive ? ACCENT_COLORS[s.accent].hex : 'rgba(255,255,255,0.55)' }}>
                    {t.label}
                  </span>
                </button>
              );
            })}
          </div>
          )}
        </div>
      </SectionBlock>

      {/* -- ЦВЕТ АКЦЕНТА ----------------------- */}
      <SectionBlock title="Цвет акцента">
        <div className="px-4 pb-3 pt-1">
          <div className="flex flex-wrap gap-2.5">
            {(Object.entries(ACCENT_COLORS) as [AccentColor, any][]).map(([key, a]) => (
              <button key={key} type="button" onClick={() => set({ accent: key })}
                title={a.label}
                className="relative h-9 w-9 rounded-full transition-transform hover:scale-110"
                style={{
                  background: a.hex,
                  boxShadow: s.accent===key ? `0 0 0 3px ${a.hex}50, 0 0 0 5px ${a.hex}25` : 'none',
                }}>
                {s.accent===key && (
                  <Check size={16} className="absolute inset-0 m-auto text-white"/>
                )}
              </button>
            ))}
          </div>
          <p className="text-[10px] mt-2" style={{ color:'var(--t3)' }}>
            {ACCENT_COLORS[s.accent].label} · {ACCENT_COLORS[s.accent].hex}
          </p>
        </div>
      </SectionBlock>

      {/* -- РАЗМЕР ШРИФТА ----------------------- */}
      <SectionBlock title="Размер текста">
        <div className="px-4 pb-4 pt-1">
          <div className="flex rounded-2xl overflow-hidden" style={{ border:'1px solid var(--border)' }}>
            {(Object.entries(FONT_SIZES) as [FontSize, any][]).map(([key, f], idx) => {
              const isActive = s.fontSize === key;
              const sizes: Record<string,string> = { small:'12px', normal:'14px', large:'17px' };
              return (
                <button key={key} type="button" onClick={() => set({ fontSize: key })}
                  className="flex-1 py-3 text-center font-semibold transition-all"
                  style={{
                    background: isActive ? ACCENT_COLORS[s.accent].hex : 'rgba(0,0,0,0)',
                    color: isActive ? '#fff' : 'var(--t2)',
                    fontSize: sizes[key],
                    borderRight: idx < 2 ? '1px solid var(--border)' : 'none',
                  }}>
                  {f.label}
                </button>
              );
            })}
          </div>
          <p className="text-[10px] mt-1.5 text-center" style={{ color:'var(--t3)' }}>
            Текущий: {FONT_SIZES[s.fontSize].label}
          </p>
        </div>
      </SectionBlock>

      {/* -- ИНТЕРФЕЙС --------------------------- */}
      <SectionBlock title="Интерфейс">
        <SettingsRow icon={Palette} label="Анимации" sub={s.animationsOn ? "Включены" : "Выключены"}
          right={<Toggle on={s.animationsOn} onToggle={() => set({ animationsOn: !s.animationsOn })}/>}/>
        <SettingsRow icon={Sparkles} label="Заставка при запуске" sub={s.introAnim ? "Показывать анимацию" : "Сразу открывать приложение"}
          right={<Toggle on={s.introAnim} onToggle={() => set({ introAnim: !s.introAnim })}/>}/>
        <div className="h-px mx-4" style={{ background:'var(--border)' }}/>
        <SettingsRow icon={Settings} label="Компактный режим" sub={s.compactMode ? "Включён" : "Выключен"}
          right={<Toggle on={s.compactMode} onToggle={() => set({ compactMode: !s.compactMode })}/>}/>
      </SectionBlock>

      <IslandSection/>

      {/* -- ПЕРЕРЫВ ОТ ПРОСМОТРА ----------------- */}
      <BreakReminderSection/>

      {/* -- TV-ВЕРСИЯ ---------------------------- */}
      <TVModeSection/>
      <ConsoleModeSection/>

      {/* -- CAR MODE ----------------------------- */}
      <CarModeSection/>
      <SpeakerModeSection/>

      {/* -- QUICK MENU --------------------------- */}
      <QuickMenuSection/>

      {/* -- МЕССЕНДЖЕР -------------------------- */}
      <SectionBlock title="Мессенджер">
        <SettingsRow icon={Send} label="Enter для отправки" sub={s.enterToSend ? "Enter отправляет, Shift+Enter  -  перенос" : "Только кнопка отправки"}
          right={<Toggle on={s.enterToSend} onToggle={() => set({ enterToSend: !s.enterToSend })}/>}/>
        <div className="h-px mx-4" style={{ background:'var(--border)' }}/>
        <SettingsRow icon={CheckCheck} label="Уведомления о прочтении" sub={s.showReadReceipts ? "Галочки показываются" : "Скрыты"}
          right={<Toggle on={s.showReadReceipts} onToggle={() => set({ showReadReceipts: !s.showReadReceipts })}/>}/>
        <div className="h-px mx-4" style={{ background:'var(--border)' }}/>
        <SettingsRow icon={MessageSquare} label="«Печатает...»" sub={s.showTyping ? "Показывать статус набора" : "Скрыто"}
          right={<Toggle on={s.showTyping} onToggle={() => set({ showTyping: !s.showTyping })}/>}/>
        <div className="h-px mx-4" style={{ background:'var(--border)' }}/>
        <SettingsRow icon={Download} label="Авто-загрузка медиа" sub={s.autoDownloadMedia ? "Авто" : "Вручную"}
          right={<Toggle on={s.autoDownloadMedia} onToggle={() => set({ autoDownloadMedia: !s.autoDownloadMedia })}/>}/>
      </SectionBlock>

      {/* -- УВЕДОМЛЕНИЯ ------------------------- */}
      <SectionBlock title="Уведомления">
        <SettingsRow icon={Bell} label="Звук сообщений"
          right={<Toggle on={s.soundMessages} onToggle={() => set({ soundMessages: !s.soundMessages })}/>}/>
        <div className="h-px mx-4" style={{ background:'var(--border)' }}/>
        <SettingsRow icon={Phone} label="Звук звонков"
          right={<Toggle on={s.soundCalls} onToggle={() => set({ soundCalls: !s.soundCalls })}/>}/>
        <div className="h-px mx-4" style={{ background:'var(--border)' }}/>
        <SettingsRow icon={Bell} iconColor="#f59e0b" label="Упоминания (@)"
          right={<Toggle on={s.soundMentions} onToggle={() => set({ soundMentions: !s.soundMentions })}/>}/>
        <div className="h-px mx-4" style={{ background:'var(--border)' }}/>
        <SettingsRow icon={Globe} label="Push-уведомления"
          sub={s.desktopNotifs ? "Включены — придут и при закрытом приложении" : "Запросить разрешение"}
          right={<Toggle on={s.desktopNotifs} onToggle={() => {
            if (s.desktopNotifs) { set({ desktopNotifs: false }); void disablePush(); return; }
            void enablePush().then((r) => {
              const local = typeof Notification !== 'undefined' && Notification.permission === 'granted';
              set({ desktopNotifs: r === 'ok' || local });
              flash(PUSH_TEXT[r]);
            });
          }}/>}/>
      </SectionBlock>

      <OwnerNotifySettings/>
      <StaffNotifySettings/>

      {/* -- КАРТЫ ------------------ */}
      <SectionBlock title="Карты">
        <div className="px-4 py-3">
          <p className="text-xs mb-2" style={{ color: 'var(--t3)' }}>Какой сервис рисует карты. «Авто» выбирает по месту: Россия и соседи — Яндекс Карты, остальной мир — Google Карты. Выбор действует, если сервер подключил ключ этого сервиса.</p>
          <div className="flex flex-wrap gap-1.5">
            {([['auto', 'Авто'], ['yandex', 'Яндекс Карты'], ['google', 'Google Карты']] as const).map(([k, l]) => (
              <button key={k} type="button" onClick={() => set({ mapProvider: k })}
                className="rounded-xl px-3 py-1.5 text-xs font-semibold"
                style={{ background: s.mapProvider === k ? 'color-mix(in srgb, var(--accent) 22%, transparent)' : 'var(--bg-l2)',
                  border: `1px solid ${s.mapProvider === k ? 'var(--accent)' : 'var(--border)'}`, color: 'var(--t1)' }}>{l}</button>
            ))}
          </div>
        </div>
      </SectionBlock>

      {/* -- КУРСОР-ПИТОМЕЦ ------------------ */}
      <SectionBlock title="Курсор-питомец">
        <SettingsRow icon={Sparkles} label="Питомец бегает за курсором"
          sub="Для Prime на компьютере"
          right={<Toggle on={cursorPet.enabled} onToggle={() => cursorPet.setEnabled(!cursorPet.enabled)}/>}/>
        <div className="flex flex-wrap gap-1.5 px-4 pb-3">
          {CURSOR_ANIMALS.map((a) => (
            <button key={a} type="button" onClick={() => cursorPet.setAnimal(a)} aria-label={a}
              className="grid h-9 w-9 place-items-center rounded-xl text-lg"
              style={{ background: cursorPet.enabled && cursorPet.animal === a ? 'color-mix(in srgb, var(--accent) 22%, transparent)' : 'var(--bg-l2)',
                border: `1px solid ${cursorPet.enabled && cursorPet.animal === a ? 'var(--accent)' : 'var(--border)'}` }}>{a}</button>
          ))}
        </div>
      </SectionBlock>

      {/* -- КОНФИДЕНЦИАЛЬНОСТЬ ------------------ */}
      <SectionBlock title="Конфиденциальность">
        <SettingsRow icon={EyeOff} label="Скрыть «был(а) в сети»"
          right={<Toggle on={s.hideLastSeen} onToggle={() => set({ hideLastSeen: !s.hideLastSeen })}/>}/>
      </SectionBlock>

      {/* -- ПОДПИСКИ -------------------------------------------- */}
      <div className="rounded-2xl overflow-hidden"
        style={{ background:'linear-gradient(135deg,rgba(245,158,11,0.07),rgba(79,110,247,0.05))',
          border:'1px solid rgba(245,158,11,0.18)' }}>
        <div className="px-4 pt-3 pb-1">
          <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color:'rgba(245,158,11,0.65)' }}>⭐ Подписки</p>
        </div>
        <div className="flex items-center gap-3 px-4 py-3">
          <div className="grid h-9 w-9 place-items-center rounded-xl" style={{ background:'rgba(245,158,11,0.12)' }}>
            <Crown size={16} style={{ color:'var(--amber)' }}/>
          </div>
          <div className="flex-1">
            <p className="text-sm font-bold text-[color:var(--t1)]">Sky Prime</p>
            <p className="text-xs" style={{ color: isPrime ? 'var(--green)' : 'var(--t3)' }}>
              {isPrime ? 'Активна' : 'Не активна'}
            </p>
          </div>
          {!isPrime && (
            <button type="button" disabled={buying} onClick={buyPrime}
              className="rounded-xl px-3 py-1.5 text-[11px] font-bold disabled:opacity-50"
              style={{ background:'rgba(245,158,11,0.12)', color:'var(--amber)' }}>
              {buying ? 'Проверяем…' : 'Активировать'}
            </button>
          )}
        </div>
        <div className="h-px mx-4" style={{ background:'var(--border)' }}/>
        <div className="flex items-center gap-3 px-4 py-3">
          <div className="grid h-9 w-9 place-items-center rounded-xl" style={{ background:'rgba(79,110,247,0.12)' }}>
            <Briefcase size={16} style={{ color:'var(--accent)' }}/>
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-1.5">
              <p className="text-sm font-bold text-[color:var(--t1)]">Prime Business</p>
              <span className="text-[8px] font-black px-1.5 py-0.5 rounded-full"
                style={{ background:'rgba(79,110,247,0.2)', color:'var(--accent)' }}>NEW</span>
            </div>
            <p className="text-[11px]" style={{ color: isPrimeBusiness ? 'var(--green)' : 'var(--t3)' }}>
              {isPrimeBusiness ? 'Почта · Диск 50ГБ · Бизнес' : 'Почта @skymessenger · 50 ГБ · CRM'}
            </p>
          </div>
          {!isPrimeBusiness && (
            <button type="button" onClick={() => setSubNotice('Prime Business ещё не подключён к оплате.')}
              className="rounded-xl px-3 py-1.5 text-[11px] font-bold"
              style={{ background:'rgba(79,110,247,0.12)', color:'var(--accent)' }}>
              249 ₽/мес
            </button>
          )}
        </div>
      </div>

      {subNotice && (
        <p className="px-1 text-xs" style={{ color:'var(--amber)' }}>{subNotice}</p>
      )}

      {/* -- ПОДДЕРЖКА И ДОКУМЕНТЫ -------------------------------- */}
      {/* Путь «Настройки — Тех. поддержка» назван в документах дословно,
          поэтому пункт называется так и лежит именно здесь. */}
      <SectionBlock title="Помощь">
        <SettingsRow icon={LifeBuoy} iconColor="var(--accent)" label="Тех. поддержка"
          sub="Вопрос · Ошибка · Жалоба · Обжалование"
          onClick={() => onOpen('support')}
          right={<ChevronRight size={14} style={{ color:'var(--t3)' }}/>}/>
        <div className="h-px mx-4" style={{ background:'var(--border)' }}/>
        <SettingsRow icon={ScrollText} iconColor="var(--t3)" label="Информация"
          sub="Правила · Оферта · Политика · Контакты"
          onClick={() => onOpen('info')}
          right={<ChevronRight size={14} style={{ color:'var(--t3)' }}/>}/>
      </SectionBlock>

      {/* -- О ПРИЛОЖЕНИИ ------------------------ */}
      <SectionBlock title="О приложении">
        <SettingsRow icon={Info} iconColor="var(--t3)" label={APP_VERSION_LABEL} sub="Текущая версия"/>
        <div className="h-px mx-4" style={{ background:'var(--border)' }}/>
        <SettingsRow icon={Users} iconColor="var(--t3)" label="Пригласить друзей" sub="Личная ссылка для регистрации"
          onClick={() => setInviteOpen(true)}
          right={<ChevronRight size={14} style={{ color:'var(--t3)' }}/>}/>
        {inviteOpen && <InviteDialog onClose={() => setInviteOpen(false)}/>}
        <div className="h-px mx-4" style={{ background:'var(--border)' }}/>
        <SettingsRow icon={QrCode} iconColor="var(--t3)" label="Мой QR-код" sub="Обмен контактами: покажите код — вас добавят"
          onClick={() => setMyQrOpen(true)}
          right={<ChevronRight size={14} style={{ color:'var(--t3)' }}/>}/>
        <div className="h-px mx-4" style={{ background:'var(--border)' }}/>
        <SettingsRow icon={ScanLine} iconColor="var(--t3)" label="Сканировать QR" sub="Добавить человека в контакты по его коду"
          onClick={() => setScanOpen(true)}
          right={<ChevronRight size={14} style={{ color:'var(--t3)' }}/>}/>
        {myQrOpen && <MyQrDialog onClose={() => setMyQrOpen(false)}/>}
        {scanOpen && <ScanContact onClose={() => setScanOpen(false)}/>}
        <div className="h-px mx-4" style={{ background:'var(--border)' }}/>
        <SettingsRow icon={Info} iconColor="var(--t3)" label="Архив материалов" sub="Удалённое хранится 20 дней — можно вернуть"
          onClick={() => setArchiveOpen(true)}
          right={<ChevronRight size={14} style={{ color:'var(--t3)' }}/>}/>
        {archiveOpen && <ArchiveDialog onClose={() => setArchiveOpen(false)}/>}
        <div className="h-px mx-4" style={{ background:'var(--border)' }}/>
        <AppIconSettings/>
        <div className="h-px mx-4" style={{ background:'var(--border)' }}/>
        <SettingsRow icon={Info} iconColor="#8b5cf6" label="Познакомиться с Sky" sub="Короткое знакомство с сервисами"
          onClick={openGuide}
          right={<ChevronRight size={14} style={{ color:'var(--t3)' }}/>}/>
        <div className="h-px mx-4" style={{ background:'var(--border)' }}/>
        <SettingsRow icon={ExternalLink} iconColor="#8b5cf6" label="Путеводитель по Sky" sub="Все сервисы экосистемы"
          onClick={() => goToGuide({ module:'extras', tab:'guide' })}
          right={<ChevronRight size={14} style={{ color:'var(--t3)' }}/>}/>
        <div className="h-px mx-4" style={{ background:'var(--border)' }}/>
        <SettingsRow icon={Download} iconColor="var(--t3)" label="Обновления" sub="Скачать приложения Sky"
          onClick={() => setUpdatesOpen(true)}
          right={<ChevronRight size={14} style={{ color:'var(--t3)' }}/>}/>
        {updatesOpen && <UpdatesDialog onClose={() => setUpdatesOpen(false)}/>}
        <div className="h-px mx-4" style={{ background:'var(--border)' }}/>
        <SettingsRow icon={ExternalLink} iconColor="var(--t3)" label="Сайт Sky" sub="skymessenger.online"
          onClick={() => window.open('https://skymessenger.online', '_blank')}
          right={<ChevronRight size={14} style={{ color:'var(--t3)' }}/>}/>
        <div className="h-px mx-4" style={{ background:'var(--border)' }}/>
        <SettingsRow icon={RotateCcw} iconColor="#f59e0b" label="Сбросить настройки" sub="Вернуть всё к значениям по умолчанию"
          onClick={reset}
          right={<ChevronRight size={14} style={{ color:'var(--t3)' }}/>}/>
      </SectionBlock>

      {/* -- ОФЛАЙН ------------------------------ */}
      <div className="rounded-2xl overflow-hidden" style={{ background:'rgba(248,113,113,0.05)', border:'1px solid rgba(248,113,113,0.18)' }}>
        <button type="button" onClick={() => window.dispatchEvent(new Event('offline'))}
          className="flex w-full items-center gap-3 px-4 py-3 transition-colors hover:bg-red-500/5">
          <div className="grid h-9 w-9 place-items-center rounded-xl" style={{ background:'rgba(248,113,113,0.12)' }}>
            <WifiOff size={16} style={{ color:'var(--red)' }}/>
          </div>
          <div className="text-left flex-1">
            <p className="text-sm" style={{ color:'var(--red)' }}>Перейти в офлайн-режим</p>
            <p className="text-xs" style={{ color:'var(--t3)' }}>Чаты · Музыка · Кино · Маркет</p>
          </div>
          <ChevronRight size={15} style={{ color:'rgba(248,113,113,0.5)' }}/>
        </button>
      </div>

      {/* -- СМЕНА ПРОФИЛЯ И ВЫХОД --------------- */}
      {/* Смена профиля не выходит из Sky ID: код из SMS заново не нужен. */}
      <div className="rounded-2xl overflow-hidden" style={{ background:'var(--bg-l2)', border:'1px solid var(--border)' }}>
        <button type="button" onClick={switchProfile}
          className="flex w-full items-center gap-3 px-4 py-3 transition-colors hover:bg-white/[0.03]">
          <div className="grid h-9 w-9 place-items-center rounded-xl" style={{ background:'var(--accent-bg)' }}>
            <ArrowLeftRight size={16} style={{ color:'var(--accent)' }}/>
          </div>
          <div className="text-left">
            <p className="text-sm" style={{ color:'var(--t1)' }}>Сменить профиль</p>
            <p className="text-xs" style={{ color:'var(--t3)' }}>Sky ID останется открытым</p>
          </div>
        </button>
      </div>

      <div className="rounded-2xl overflow-hidden" style={{ background:'rgba(239,68,68,0.05)', border:'1px solid rgba(239,68,68,0.15)' }}>
        <button type="button" onClick={()=>setConfirmExit(true)}
          className="flex w-full items-center gap-3 px-4 py-3 transition-colors hover:bg-red-500/10">
          <div className="grid h-9 w-9 place-items-center rounded-xl" style={{ background:'rgba(239,68,68,0.1)' }}>
            <LogOut size={16} style={{ color:'var(--red)' }}/>
          </div>
          <div className="text-left">
            <p className="text-sm" style={{ color:'var(--red)' }}>Выйти из Sky ID</p>
            <p className="text-xs" style={{ color:'var(--t3)' }}>@{username}</p>
          </div>
        </button>
      </div>

      <AnimatePresence>
        {confirmExit && <ConfirmExit onCancel={()=>setConfirmExit(false)} onConfirm={logout}/>}
      </AnimatePresence>

      <div className="h-4"/>
    </div>
    </>
  );
};

export const ProfileModule = () => {
  const { accounts, currentUserId, updateProfile, logout } = useAuthStore();
  const history = useCallStore(s => s.history);
  const me = accounts.find(a => a.id === currentUserId);
  const isMobile = useIsMobile();

  const [section, setSection] = useState<Section>('main');
  const [legacyOpen, setLegacyOpen] = useState(false);
  // Пришли сюда из другого раздела с заявкой на подарок мероприятия —
  // открываем «Поддержку» сразу на её тикете, тем же приёмом, что
  // pendingExtrasTab открывает вкладку внутри «Прочего». Значение забираем
  // в локальный стейт один раз при входе: общий стор гасим сразу же, иначе
  // повторный заход в «Поддержку» из меню открывал бы тот же тикет снова.
  const [openSupportTicketId] = useState(() => useModuleStore.getState().pendingSupportTicketId);
  useEffect(() => {
    if (!openSupportTicketId) return;
    setSection('support');
    useModuleStore.getState().setPendingSupportTicketId(null);
  }, [openSupportTicketId]);
  // Голосовая команда «открой быстрое меню» доносит сюда нужный раздел
  // («Настройки», где живёт Quick Menu) — тем же приёмом.
  const [openProfileSection] = useState(() => useModuleStore.getState().pendingProfileSection);
  useEffect(() => {
    if (!openProfileSection) return;
    setSection(openProfileSection as Section);
    useModuleStore.getState().setPendingProfileSection(null);
  }, [openProfileSection]);
  const [editing, setEditing] = useState(false);
  const [nameVal,     setNameVal]     = useState(me?.name ?? '');
  const [bioVal,      setBioVal]      = useState(me?.bio ?? '');
  const [stickerVal,  setStickerVal]  = useState(me?.nameSticker ?? '');
  const [nameColor,   setNameColor]   = useState(me?.nameColor ?? '');
  const [showSticker, setShowSticker] = useState(false);
  const avatarRef = useRef<HTMLInputElement>(null);
  const bannerRef = useRef<HTMLInputElement>(null);

  // Game profile state
  const [gNick, setGNick] = useState(me?.gameProfile?.nickname ?? '');
  const [gRank, setGRank] = useState(me?.gameProfile?.rank ?? '');
  const [gGame, setGGame] = useState(me?.gameProfile?.game ?? '');

  // Приватность решает сервер: здесь зеркало его состояния. Раньше она
  // лежала в профиле в localStorage и до сервера не доходила.
  // Подписка на неё — до возврата: хук, вызванный через раз, роняет
  // экран целиком.
  const privacy = usePrivacyStore(st => st.privacy);
  const savePrivacy = usePrivacyStore(st => st.save);

  if (!me) return <div className="p-6 text-sm" style={{color:'var(--t3)'}}>Профиль не найден</div>;

  const saveEdit = () => {
    if (nameVal.trim().length >= 2) {
      updateProfile({ name: nameVal.trim(), bio: bioVal.trim() });
      const acc = useAuthStore.getState().accounts.find(a => a.id === currentUserId);
      if (acc) {
        // Save sticker and color
        updateProfile({ nameSticker: stickerVal || undefined });
        if (nameColor) updateProfile({ nameColor });
        else updateProfile({ nameColor: undefined });
        syncBloomAuthor(currentUserId!, nameVal.trim(), acc.username);
        // Sync name in DM chat titles (other users see our name in their chat list)
        useMessengerStore.setState(s => ({
          chats: s.chats.map(ch =>
            ch.type === 'direct' && ch.participants?.includes(currentUserId!) &&
            ch.name === acc.name  // only update if it was our old name
              ? { ...ch, name: nameVal.trim() }
              : ch
          ),
        }));
      }
    }
    setEditing(false);
  };

  const onFile = (ref: React.RefObject<HTMLInputElement>, key: 'avatar'|'banner') => {
    const f = ref.current?.files?.[0]; if (!f) return;
    // Сжимаем до лимита сервера (~190 КБ): исходное фото весит мегабайты.
    void fitImageToDataUrl(f, key === 'avatar' ? { maxSide: 512, maxChars: 250_000 } : { maxSide: 1280, maxChars: 250_000 })
      .then((url) => updateProfile({ [key]: url }))
      .catch(() => flash('Не удалось подготовить картинку. Выберите другое изображение (PNG, JPEG или WebP).'))
      .finally(() => { if (ref.current) ref.current.value = ''; });
  };

  const saveGame = () =>
    updateProfile({ gameProfile: { nickname: gNick.trim()||me.name, rank: gRank.trim()||'Новичок', game: gGame.trim()||'Unknown', wins: me.gameProfile?.wins??0 } });

  const NAV = [
    {key:'main',   label:'Профиль', icon:Crown},
    {key:'privacy',label:'Конфиденциальность', icon:Lock},
    {key:'game',     label:'Игровой профиль', icon:Gamepad2},
    {key:'settings',  label:'Настройки',        icon:Settings},
    {key:'wallet',    label:'SkyMoney',          icon:Wallet},
    {key:'gifts',     label:'Мои подарки',        icon:Gift},
    {key:'pets',          label:'Питомцы',            icon:PawPrint},
    {key:'customization', label:'Кастомизация',       icon:Palette},
    {key:'gaming_acc',    label:'Игровые аккаунты',   icon:Gamepad2},
    {key:'proxy',         label:'Подключение',        icon:Shield},
    {key:'referral',      label:'Приглашения',          icon:Users},
    {key:'skyid',         label:'Sky ID',               icon:Fingerprint},
    {key:'business',      label:'Sky для бизнеса',      icon:Briefcase},
    {key:'support',       label:'Тех. поддержка',       icon:LifeBuoy},
    {key:'info',          label:'Информация',           icon:ScrollText},
  ] as const;

  // Bloom и Sky Video — отдельные модули, не разделы этого экрана: не
  // переключают section, а уходят в свой модуль на вкладке «моё» —
  // тем же приёмом (pendingExtrasTab), что уже используют для Sky Music.
  const MODULE_LINKS = [
    {key:'bloom' as const, label:'Мой Bloom',    icon:Flower2},
    {key:'video' as const, label:'Мой Sky Video', icon:Video},
  ];
  const goToModule = (key: 'bloom' | 'video') => {
    const m = useModuleStore.getState();
    if (key === 'bloom') m.setPendingBloomTab('mine');
    else m.setPendingVideoTab('mine');
    m.setActiveModule(key);
  };
  const navigate = (key: Section | 'bloom' | 'video') => {
    if (key === 'bloom' || key === 'video') goToModule(key);
    else setSection(key);
  };

  return (
    <div className="flex h-full flex-col overflow-hidden sm:flex-row">
      {/* Mobile top strip: user row + horizontal scrollable section pills */}
      <div className="flex shrink-0 flex-col border-b sm:hidden" style={{ borderColor: 'var(--border)' }}>
        <div className="flex items-center gap-2.5 px-4 pb-3" style={{ paddingTop: 'calc(var(--safe-top) + 14px)' }}>
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-sm font-bold text-white"
            style={{background: `linear-gradient(135deg,${['#2CA5E0','#E84393','#FF7043','#7E57C2'][(me.name.charCodeAt(0)||0)%4]},${['#1a85c4','#c4276e','#d45a30','#6340a8'][(me.name.charCodeAt(0)||0)%4]})`}}>
            {me.name.split(' ').map((w:string)=>w[0]).join('').slice(0,2).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold truncate" style={{color:'var(--t1)'}}>{me.name}</p>
            <p className="text-[11px] truncate" style={{color:'var(--t3)'}}>@{me.username}</p>
          </div>
          <button type="button" onClick={logout}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full transition-colors hover:bg-red-500/10"
            style={{color:'var(--red)'}}><LogOut size={15}/></button>
        </div>
        <div className="flex gap-1.5 overflow-x-auto px-3 pb-3" style={{ scrollbarWidth: 'none' }}>
          {[...NAV, ...MODULE_LINKS].map(({key,label,icon:Icon})=>(
            <button key={key} type="button" onClick={()=>navigate(key)}
              className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-[12px] transition-all"
              style={{
                background: section===key ? 'var(--accent-bg)' : 'var(--bg-l2)',
                color: section===key ? 'var(--accent)' : 'var(--t2)',
                fontWeight: section===key ? 600 : 400,
                border: section===key ? '1px solid rgba(79,110,247,0.2)' : '1px solid transparent',
              }}>
              <Icon size={13} strokeWidth={section===key ? 2.2 : 1.6}/>{label}
            </button>
          ))}
        </div>
      </div>

      {/* Left nav (desktop) */}
      <nav className="hidden w-52 shrink-0 flex-col border-r overflow-y-auto sm:flex" style={{borderColor:'var(--border)', scrollbarWidth:'none'}}>
        {/* User mini-header */}
        <div className="flex items-center gap-2.5 px-4 py-4 border-b" style={{borderColor:'var(--border)'}}>
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-sm font-bold text-white"
            style={{background: `linear-gradient(135deg,${['#2CA5E0','#E84393','#FF7043','#7E57C2'][(me.name.charCodeAt(0)||0)%4]},${['#1a85c4','#c4276e','#d45a30','#6340a8'][(me.name.charCodeAt(0)||0)%4]})`}}>
            {me.name.split(' ').map((w:string)=>w[0]).join('').slice(0,2).toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold truncate" style={{color:'var(--t1)'}}>{me.name}</p>
            <p className="text-[11px] truncate" style={{color:'var(--t3)'}}>@{me.username}</p>
          </div>
        </div>
        <div className="flex-1 py-2 px-2 space-y-0.5">
        {[...NAV, ...MODULE_LINKS].map(({key,label,icon:Icon})=>(
          <button key={key} type="button" onClick={()=>navigate(key)}
            className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-[13px] text-left w-full transition-all"
            style={{
              background: section===key ? 'var(--accent-bg)' : 'rgba(0,0,0,0)',
              color: section===key ? 'var(--accent)' : 'var(--t2)',
              fontWeight: section===key ? 600 : 400,
              border: section===key ? '1px solid rgba(79,110,247,0.2)' : '1px solid transparent',
            }}>
            <Icon size={14} strokeWidth={section===key ? 2.2 : 1.6} style={{flexShrink:0}}/>{label}
          </button>
        ))}
        </div>
        <div className="px-2 py-3 border-t" style={{borderColor:'var(--border)'}}>
          <button type="button" onClick={logout}
            className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-[13px] transition-colors hover:bg-red-500/10"
            style={{color:'var(--red)'}}>
            <LogOut size={14}/>Выйти
          </button>
        </div>
      </nav>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">

        {/* -- MAIN -- */}
        {section === 'main' && (
          <div>
            {/* Тот же модуль, что видят другие у чужого профиля. Прежний
                редактор (аватар, баннер, имя, история звонков) остался
                ниже под переключателем, чтобы ничего не пропало. */}
            <OwnProfileView userId={currentUserId ?? me.id}/>
            <div className="max-w-xl mx-auto px-2.5 sm:px-4 pb-4">
              <button type="button" onClick={()=>setLegacyOpen(v=>!v)}
                className="flex w-full items-center justify-between rounded-2xl px-4 py-3 text-sm font-semibold"
                style={{background:'var(--bg-l1)',border:'1px solid var(--border)',color:'var(--t1)'}}>
                Имя, аватар, баннер и история звонков
                <ChevronDown size={16} className={`transition-transform ${legacyOpen?'rotate-180':''}`} style={{color:'var(--t3)'}}/>
              </button>
            </div>
            {legacyOpen && (
          <div>
            {/* Banner */}
            <div className={isMobile ? 'relative h-24 w-full overflow-hidden' : 'relative h-36 w-full overflow-hidden'}
              style={{background: me.banner ? undefined : 'linear-gradient(135deg,var(--accent-bg),var(--accent-bg),rgba(54,224,190,0.08))'}}>
              {me.banner && <img src={me.banner} alt="" className="h-full w-full object-cover"/>}
              <input ref={bannerRef} type="file" accept="image/*" className="hidden" onChange={()=>onFile(bannerRef,'banner')}/>
              <button type="button" onClick={()=>bannerRef.current?.click()}
                className={isMobile ? 'absolute bottom-1.5 right-1.5 flex items-center gap-1 rounded-xl px-2.5 py-1 text-[10.5px] text-white' : 'absolute bottom-2 right-2 flex items-center gap-1.5 rounded-2xl px-3 py-1.5 text-xs text-white'}
                style={{background:'rgba(0,0,0,0.6)',backdropFilter:'blur(8px)'}}>
                <Camera size={11}/> Баннер
              </button>
            </div>

            <div className={isMobile ? 'px-3.5 pb-4' : 'px-5 pb-6'}>
              {/* Avatar */}
              <div className="flex items-end justify-between" style={{marginTop: isMobile ? -22 : -32}}>
                <div className="relative">
                  <div className={isMobile ? 'h-14 w-14 overflow-hidden rounded-full border-[3px]' : 'h-20 w-20 overflow-hidden rounded-full border-4'} style={{borderColor:'var(--bg)'}}>
                    {me.avatar
                      ? <img src={me.avatar} alt="" className="h-full w-full object-cover"/>
                      : <div className={isMobile ? 'grid h-full w-full place-items-center text-lg font-bold text-white' : 'grid h-full w-full place-items-center text-2xl font-bold text-white'}
                          style={{background:'var(--bg-l3)'}}>{me.name[0]}</div>}
                  </div>
                  <input ref={avatarRef} type="file" accept="image/*" className="hidden" onChange={()=>onFile(avatarRef,'avatar')}/>
                  <button type="button" onClick={()=>avatarRef.current?.click()}
                    className={isMobile ? 'absolute bottom-0 right-0 grid h-5 w-5 place-items-center rounded-full border-2 border-black' : 'absolute bottom-0 right-0 grid h-7 w-7 place-items-center rounded-full border-2 border-black'}
                    style={{background:'var(--accent-bg)'}}>
                    <Camera size={isMobile ? 10 : 12} className="text-white"/>
                  </button>
                </div>
                <div className="flex gap-1.5 sm:gap-2 pb-1">
                  {editing
                    ? <>
                        <button type="button" onClick={saveEdit}
                          className={isMobile ? 'flex items-center gap-1 rounded-xl px-2.5 py-1 text-[12px] text-white' : 'flex items-center gap-1.5 rounded-2xl px-3 py-1.5 text-sm text-white'}
                          style={{background:'rgba(34,197,94,0.2)',border:'1px solid rgba(34,197,94,0.3)'}}>
                          <Check size={12}/> Сохранить
                        </button>
                        <button type="button" onClick={()=>setEditing(false)}
                          className={isMobile ? 'grid h-7 w-7 place-items-center rounded-xl' : 'grid h-8 w-8 place-items-center rounded-2xl'}
                          style={{background:'var(--border)',color:'var(--t3)'}}>
                          <X size={13}/>
                        </button>
                      </>
                    : <button type="button" onClick={()=>{setEditing(true);setNameVal(me.name);setBioVal(me.bio??'');}}
                        className={isMobile ? 'flex items-center gap-1 rounded-xl px-2.5 py-1 text-[12px]' : 'flex items-center gap-1.5 rounded-2xl px-3 py-1.5 text-sm'}
                        style={{background:'var(--border)',border:'1px solid rgba(255,255,255,0.1)',color:'var(--t2)'}}>
                        <Edit2 size={12}/> Редактировать
                      </button>}
                </div>
              </div>

              {/* Name / bio */}
              <div className={isMobile ? 'mt-2' : 'mt-3'}>
                {editing
                  ? <div className="space-y-2">
                      <input value={nameVal} onChange={e=>setNameVal(e.target.value)}
                        className={isMobile ? 'w-full rounded-xl px-3 py-2 text-[13px] text-[color:var(--t1)] font-bold outline-none' : 'w-full rounded-2xl px-4 py-2.5 text-sm text-[color:var(--t1)] font-bold outline-none'}
                        style={{background:'var(--border)',border:'1px solid var(--accent-bg)'}}/>
                      <textarea value={bioVal} onChange={e=>setBioVal(e.target.value)} rows={2}
                        placeholder="О себе..."
                        className={isMobile ? 'w-full resize-none rounded-xl px-3 py-2 text-[13px] outline-none' : 'w-full resize-none rounded-2xl px-4 py-2.5 text-sm outline-none'}
                        style={{background:'var(--bg-l2)',border:'1px solid var(--border)',color:'var(--t2)'}}/>
                      {/* Sticker picker */}
                      <div className="rounded-xl p-2.5 sm:p-3 space-y-2" style={{background:'var(--bg-l2)',border:'1px solid var(--border)'}}>
                        <p className="text-[10px] font-bold uppercase tracking-wider" style={{color:'var(--t3)'}}>Стикер у имени</p>
                        <div className="flex flex-wrap gap-1.5">
                          {['','⭐','🔥','💎','👑','🎮','🎵','⚡','🌟','🐱','🦊','🐲','🌙','🎯','💜','🏆','🎭','💫','🌈','🎪','🐺','🐼','🦄','🐧'].map(s=>(
                            <button key={s} type="button" onClick={()=>setStickerVal(s)}
                              className={isMobile ? 'w-7 h-7 rounded-lg flex items-center justify-center transition-all' : 'w-8 h-8 rounded-lg flex items-center justify-center transition-all'}
                              style={{background:stickerVal===s?'rgba(79,110,247,0.2)':'transparent',
                                border:`1.5px solid ${stickerVal===s?'var(--accent)':'var(--border)'}`,
                                fontSize:s?'16px':'10px',color:s?undefined:'var(--t3)'}}>
                              {s||'∅'}
                            </button>
                          ))}
                        </div>
                        <p className="text-[10px] font-bold uppercase tracking-wider mt-1" style={{color:'var(--t3)'}}>Цвет имени</p>
                        <div className="flex flex-wrap gap-1.5">
                          {['','#f0f0f8','#5b7cf8','#f43f5e','#10b981','#f59e0b','#8b5cf6','#06b6d4','#f97316','#ec4899'].map(col=>(
                            <button key={col} type="button" onClick={()=>setNameColor(col)}
                              className="w-6 h-6 sm:w-7 sm:h-7 rounded-full transition-all"
                              style={{background:col||'var(--bg-l3)',
                                border:`2px solid ${nameColor===col?'white':'var(--border)'}`,
                                boxShadow:nameColor===col?'0 0 0 2px var(--accent)':undefined}}>
                              {!col&&<span style={{color:'var(--t3)',fontSize:'10px',lineHeight:'22px',display:'block',textAlign:'center'}}>∅</span>}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  : <>
                      <div className="flex items-center gap-1.5 sm:gap-2">
                        <h2 className={isMobile ? 'text-[15px] font-bold text-[color:var(--t1)]' : 'text-xl font-bold text-[color:var(--t1)]'}>{me.name}</h2>
                        {me.isPrime && <Crown size={14} style={{color:'var(--amber)'}}/>}
                        {me.isAdmin && <Shield size={14} style={{color:'var(--accent)'}}/>}
                      </div>
                      <p className={isMobile ? 'text-[11.5px]' : 'text-sm'} style={{color:'var(--t3)'}}>@{me.username} · {me.phone}</p>
                      {me.bio && <p className={isMobile ? 'mt-1.5 text-[12.5px]' : 'mt-2 text-sm'} style={{color:'var(--t2)'}}>{me.bio}</p>}
                    </>}
              </div>

              {/* Stats */}
              <div className={isMobile ? 'mt-3 grid grid-cols-3 gap-2' : 'mt-4 grid grid-cols-3 gap-3'}>
                {[
                  {label:'Звонков', val: history.length},
                  {label:'Минут',   val: Math.round(history.reduce((s,h)=>s+h.durationSec,0)/60)},
                  {label:'Побед',   val: me.gameProfile?.wins ?? 0},
                ].map(s=>(
                  <div key={s.label} className={isMobile ? 'rounded-xl px-2 py-2 text-center' : 'rounded-2xl px-3 py-3 text-center'}
                    style={{background:'var(--bg-l2)',border:'1px solid var(--border)'}}>
                    <p className={isMobile ? 'text-base font-bold text-[color:var(--t1)]' : 'text-xl font-bold text-[color:var(--t1)]'}>{s.val}</p>
                    <p className={isMobile ? 'text-[10.5px]' : 'text-xs'} style={{color:'var(--t3)'}}>{s.label}</p>
                  </div>
                ))}
              </div>

              {/* Gaming activity */}
              <GamingActivityCard userId={currentUserId ?? ''}/>

              {/* Call history */}
              {history.length > 0 && (
                <div className={isMobile ? 'mt-4' : 'mt-5'}>
                  <p className={isMobile ? 'text-[10.5px] font-semibold uppercase tracking-wider mb-2' : 'text-xs font-semibold uppercase tracking-wider mb-3'} style={{color:'var(--t3)'}}>История звонков</p>
                  <div className={isMobile ? 'space-y-1.5' : 'space-y-2'}>
                    {history.slice(0,8).map(h=>(
                      <div key={h.id} className={isMobile ? 'flex items-center gap-2.5 rounded-xl px-3 py-2' : 'flex items-center gap-3 rounded-2xl px-4 py-3'}
                        style={{background:'rgba(255,255,255,0.03)'}}>
                        <div className={isMobile ? 'grid h-7 w-7 place-items-center rounded-xl shrink-0' : 'grid h-9 w-9 place-items-center rounded-2xl shrink-0'}
                          style={{background:h.status==='missed'?'rgba(239,68,68,0.1)':'var(--accent-bg)'}}>
                          <Phone size={13} style={{color:h.status==='missed'?'var(--red)':'var(--accent)'}}/>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className={isMobile ? 'text-[12.5px] text-[color:var(--t1)] truncate' : 'text-sm text-[color:var(--t1)] truncate'}>{h.peerName}</p>
                          <p className={isMobile ? 'text-[10.5px]' : 'text-xs'} style={{color:'var(--t3)'}}>
                            {h.direction==='in'?'Входящий':'Исходящий'} · {h.mode==='video'?'Видео':'Голос'} · {h.status==='missed'?'Пропущен':fmtDur(h.durationSec)}
                          </p>
                        </div>
                        <p className={isMobile ? 'text-[10.5px] shrink-0' : 'text-xs shrink-0'} style={{color:'var(--t3)'}}>{fmtDate(h.startedAt)}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
          </div>
        )}

        {/* -- PRIVACY -- */}
        {section === 'privacy' && (
          <div className="p-5 space-y-2">
            <div className="mb-4">
              <h3 className="font-semibold text-[color:var(--t1)]">Конфиденциальность</h3>
              <p className="text-sm mt-1" style={{color:'var(--t3)'}}>Управляй тем, кто видит твою информацию</p>
            </div>
            <div className="rounded-xl overflow-hidden" style={{background:'var(--bg-l1)',border:'1px solid var(--border)'}}>
              <div className="px-2 py-1">
                <PrivRow label="Кто может писать" sub="Личные сообщения"
                  value={privacy.whoCanWrite as PrivacyVal}
                  onChange={v=>savePrivacy({whoCanWrite:v})}/>
                <div className="h-px mx-4" style={{background:'var(--border)'}}/>
                <PrivRow label="Кто видит 'в сети'"
                  value={privacy.whoSeesOnline as PrivacyVal}
                  onChange={v=>savePrivacy({whoSeesOnline:v})}/>
                <div className="h-px mx-4" style={{background:'var(--border)'}}/>
                <PrivRow label="Кто может звонить"
                  value={privacy.whoCanCall as PrivacyVal}
                  onChange={v=>savePrivacy({whoCanCall:v})}/>
              </div>
            </div>
            <div className="rounded-xl p-4" style={{background:'var(--accent-bg)',border:'1px solid var(--accent-bg)'}}>
              <p className="text-xs" style={{color:'var(--accent)'}}>
                Проверяет сервер, а не приложение: настройка действует на всех
                устройствах и её не обойти изменённым клиентом. «Контакты» — это
                те, с кем есть общая группа или кому вы сами писали. Переписку,
                которую вы начали сами, запрет не прерывает.
              </p>
            </div>

            <div className="mt-5 mb-2">
              <h3 className="font-semibold text-[color:var(--t1)]">Кто видит информацию профиля</h3>
              <p className="text-sm mt-1" style={{color:'var(--t3)'}}>
                Отдельно по каждому разделу. Сейчас сервер и так сообщает о вас
                другим только имя и ник — эти разделы никуда не уходят с
                устройства. Выбор сохраняется на сервере и будет действовать,
                когда они туда переедут.
              </p>
            </div>
            <div className="rounded-xl overflow-hidden" style={{background:'var(--bg-l1)',border:'1px solid var(--border)'}}>
              <div className="px-2 py-1">
                {([
                  ['showPhone',        'Телефон'],
                  ['showBirthDate',    'Дата рождения'],
                  ['showBio',          'О себе'],
                  ['showBanner',       'Баннер'],
                  ['showNameCustomization', 'Оформление ника'],
                  ['showCustomStatus', 'Статус'],
                  ['showLinks',        'Ссылки'],
                  ['showCountry',      'Страну'],
                  ['showTimezone',     'Часовой пояс'],
                  // Общий выключатель: гасит игры/музыку/фильмы/истории разом,
                  // даже если каждый из них включён отдельно ниже — см.
                  // showActivity в src/profile/viewer/useProfileData.ts.
                  ['showActivity',     'Активность (игры, музыка, фильмы, истории)'],
                  ['showGames',        'Игры'],
                  ['showMusic',        'Музыку'],
                  ['showMovies',       'Фильмы'],
                  ['showGifts',        'Подарки'],
                  ['showAchievements', 'Достижения'],
                  ['showFollowing',    'Подписки'],
                  ['showFriends',      'Друзей'],
                  ['showPhotos',       'Фотографии'],
                  ['showStories',      'Истории'],
                  ['showPosts',        'Публикации'],
                ] as const).map(([key, label], i, arr) => (
                  <div key={key}>
                    <div className="flex items-center justify-between py-3 px-2">
                      <span className="text-sm" style={{color:'var(--t1)'}}>{label}</span>
                      <Toggle on={privacy.profileVisibility?.[key] ?? true}
                        onToggle={() => savePrivacy({ profileVisibility: {
                          ...privacy.profileVisibility,
                          [key]: !(privacy.profileVisibility?.[key] ?? true),
                        } })}/>
                    </div>
                    {i < arr.length - 1 && <div className="h-px mx-4" style={{background:'var(--border)'}}/>}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* -- GAME PROFILE -- */}
        {section === 'game' && (
          <div className="p-5 space-y-4">
            <div>
              <h3 className="font-semibold text-[color:var(--t1)]">Игровой профиль</h3>
              <p className="text-sm mt-1" style={{color:'var(--t3)'}}>Твои данные в играх</p>
            </div>

            {/* Current game profile preview */}
            {me.gameProfile && (
              <div className="rounded-xl p-4 flex items-center gap-4"
                style={{background:'var(--bg-l3)',border:'1px solid var(--accent-bg)'}}>
                <div className="grid h-14 w-14 place-items-center rounded-2xl"
                  style={{background:'var(--accent-bg)'}}>
                  <Gamepad2 size={26} style={{color:'var(--accent)'}}/>
                </div>
                <div>
                  <p className="font-bold text-[color:var(--t1)]">{me.gameProfile.nickname}</p>
                  <p className="text-sm" style={{color:'var(--t2)'}}>{me.gameProfile.game}</p>
                  <div className="mt-1 flex items-center gap-3">
                    <span className="flex items-center gap-1 text-xs" style={{color:'var(--amber)'}}><Trophy size={11}/>{me.gameProfile.rank}</span>
                    <span className="flex items-center gap-1 text-xs" style={{color:'var(--accent)'}}><Swords size={11}/>{me.gameProfile.wins} побед</span>
                  </div>
                </div>
              </div>
            )}

            <div className="rounded-xl p-4 space-y-3" style={{background:'var(--bg-l1)',border:'1px solid var(--border)'}}>
              {[
                {label:'Никнейм',  val:gNick,  set:setGNick,  ph:'Твой игровой ник'},
                {label:'Игра',     val:gGame,  set:setGGame,  ph:'CS2, Valorant, Dota 2...'},
                {label:'Ранг',     val:gRank,  set:setGRank,  ph:'Silver, Gold, Platinum...'},
              ].map(f=>(
                <div key={f.label}>
                  <label className="text-xs mb-1 block" style={{color:'var(--t3)'}}>{f.label}</label>
                  <input value={f.val} onChange={e=>f.set(e.target.value)} placeholder={f.ph}
                    className="w-full rounded-2xl px-4 py-2.5 text-sm text-[color:var(--t1)] outline-none"
                    style={{background:'var(--bg-l2)',border:'1px solid var(--border)'}}/>
                </div>
              ))}
              <motion.button whileTap={{scale:0.97}} type="button" onClick={saveGame}
                className="w-full rounded-2xl py-3 text-sm font-bold text-white"
                style={{background:'var(--accent)'}}>
                Сохранить профиль
              </motion.button>
            </div>
          </div>
        )}


        {/* -- SETTINGS -- */}
        {section === 'settings' && (
          <div className="flex flex-col min-h-0 h-full overflow-hidden">
            <div className="flex-1 overflow-y-auto" style={{scrollbarWidth:'none'}}>
              <SettingsSection logout={logout} username={me.username}
                onOpen={setSection}/>
            </div>
          </div>
        )}

        {section === 'wallet' && (
          <div className="flex flex-col h-full overflow-hidden">
            <SkyMoneyWallet />
          </div>
        )}

        {section === 'gifts' && (
          <div className="flex flex-col h-full overflow-y-auto px-4 py-4" style={{ scrollbarWidth:'none' }}>
            <p className="text-xs font-bold uppercase tracking-wider mb-4" style={{ color:'var(--t3)' }}>
              Моя коллекция подарков
            </p>
            <ProfileGiftsShowcase userId={currentUserId ?? ''} isOwn={true}/>
          </div>
        )}

        {section === 'pets'        && <ProfilePetsSection/>}
        {section === 'customization' && <CustomizationSettingsTab/>}
        {section === 'proxy' && (
          <div className="flex flex-col h-full overflow-hidden">
            <ConnectionPanel/>
          </div>
        )}

        {section === 'referral' && (
          <div className="flex flex-col h-full overflow-hidden">
            <ReferralPanel/>
          </div>
        )}

        {section === 'gaming_acc' && (
          <div className="flex flex-col h-full overflow-y-auto px-4 py-4" style={{ scrollbarWidth:'none' }}>
            <GamingAccountsPanel userId={currentUserId ?? ''}/>
          </div>
        )}

        {section === 'business' && (
          <div className="flex flex-col h-full overflow-hidden">
            <ModuleGate id="kbiz"><KassaBusiness /></ModuleGate>
          </div>
        )}

        {section === 'skyid' && (
          <div className="flex flex-col h-full overflow-hidden">
            <SkyIDTab />
          </div>
        )}

        {section === 'support' && (
          <div className="flex flex-col h-full overflow-hidden">
            <SupportScreen initialTicketId={openSupportTicketId} />
          </div>
        )}

        {section === 'info' && (
          <div className="flex flex-col h-full overflow-hidden">
            <LegalDocs />
          </div>
        )}



      </div>
    </div>
  );
};
