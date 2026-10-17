/* ===========================================================
   SKY SPEAKER — оболочка «умной колонки».
   Устройство (телефон, планшет, мини-ПК) с подключённой обычной колонкой
   становится умным: крупные часы Sky, голос Sky AI, музыка. Это интерфейс
   Sky, а не копия чужого ассистента; интеграции с чужими экосистемами нет.
=========================================================== */
import { useEffect, useState } from 'react';
import { Mic, MicOff, Settings, X, Play, Pause, SkipBack, SkipForward, Volume2, Bluetooth, LogOut, Users, Sparkles } from 'lucide-react';
import { setSpeakerMode } from './useSpeakerMode';
import { SpeakerDevice } from './SpeakerDevice';
import { useAudioDevices } from './useAudioDevices';
import { SP_ACCENT, SP_BG, SP_BORDER, SP_GLASS } from './speakerTheme';
import { NetBanner } from '@/shared/NetBanner';
import { PlayerEngine } from '@/player/PlayerEngine';
import { ActiveCallPanel, IncomingCallOverlay, MiniCallOverlay, CallAudio } from '@/calls/CallUI';
import { NotifBridge } from '@/notifications/NotifBridge';
import { usePlayerStore } from '@/player/playerStore';
import { useSettings } from '@/settings/store';
import { useAiSession } from '@/island/aiSession';
import { useWake, requestMicForWake } from '@/island/wake';
import { useAiState } from '@/ai/aiState';
import { useAuthStore } from '@/core/auth/store';

const NAME_KEY = 'sky:speaker:name';
const readName = () => { try { return localStorage.getItem(NAME_KEY) || 'Зал'; } catch { return 'Зал'; } };

const Row = ({ label, sub, on, onToggle }: { label: string; sub?: string; on: boolean; onToggle: () => void }) => (
  <button type="button" role="switch" aria-checked={on} onClick={onToggle}
    className="flex w-full items-center justify-between gap-4 rounded-2xl px-4 py-3 text-left" style={{ background: SP_GLASS, border: SP_BORDER, minHeight: 56 }}>
    <span><span className="block text-[16px] font-semibold text-white">{label}</span>{sub && <span className="block text-[12px] text-white/50">{sub}</span>}</span>
    <span className="h-7 w-12 shrink-0 rounded-full p-1 transition" style={{ background: on ? SP_ACCENT : 'rgba(255,255,255,0.18)' }}>
      <span className="block h-5 w-5 rounded-full bg-white transition" style={{ transform: on ? 'translateX(20px)' : 'none' }} />
    </span>
  </button>
);

export const SpeakerShell = () => {
  const [name, setName] = useState(readName);
  const [panel, setPanel] = useState(false);
  const settings = useSettings((s) => s.settings);
  const set = useSettings((s) => s.set);
  const phase = useAiSession((s) => s.phase);
  const level = useAiSession((s) => s.level);
  const answer = useAiSession((s) => s.answer);
  const heard = useAiSession((s) => s.heard);
  const wake = useWake((s) => s.state);
  const ai = useAiState();
  const item = usePlayerStore((s) => s.item);
  const playing = usePlayerStore((s) => s.isPlaying);
  const volume = usePlayerStore((s) => s.volume);
  const [permAsked, setPermAsked] = useState(0);
  const dev = useAudioDevices(permAsked);
  const unavailable = !!ai && !ai.configured;

  const micOn = settings.aiWake;
  const toggleMic = async () => {
    if (micOn) { set({ aiWake: false }); useAiSession.getState().stop(); return; }
    const ok = await requestMicForWake();
    setPermAsked((n) => n + 1);
    if (ok) set({ aiWake: true });
  };
  const call = () => { if (!unavailable) useAiSession.getState().start('manual'); };

  const sessionActive = phase !== 'off';
  const status = unavailable ? 'Недоступен'
    : phase === 'listening' ? 'Слушаю'
    : phase === 'processing' ? 'Думаю'
    : phase === 'speaking' ? 'Отвечаю'
    : phase === 'error' ? 'Ошибка'
    : !micOn ? 'Микрофон выключен'
    : wake === 'listening' ? 'Жду «Привет, Скай»'
    : wake === 'no-permission' ? 'Нет доступа к микрофону'
    : wake === 'unsupported' ? 'Фраза не поддерживается'
    : 'Готов';
  const glow = !micOn && !sessionActive ? 'off' : phase === 'processing' || phase === 'speaking' ? 'busy' : phase === 'listening' ? 'active' : 'idle';

  useEffect(() => { try { localStorage.setItem(NAME_KEY, name); } catch { /* ок */ } }, [name]);
  const me = useAuthStore((s) => s.accounts.find((a) => a.id === s.currentUserId));

  return (
    <div className="fixed inset-0 flex flex-col overflow-hidden text-white app-root-h" style={{ background: SP_BG }} data-keep-dark>
      <PlayerEngine />
      <NotifBridge />
      <ActiveCallPanel /><IncomingCallOverlay /><MiniCallOverlay /><CallAudio />
      <NetBanner />

      <header className="flex flex-wrap items-center justify-between gap-3 px-5 pt-4">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[20px] font-extrabold" translate="no">Sky Speaker · {name}</p>
          <p className="truncate text-[12px] text-white/50" translate="no">{me?.name ?? ''}</p>
        </div>
        <div className="flex items-center gap-2">
          <span role="status" className="flex items-center gap-2 rounded-full px-3 py-2 text-[13px]" style={{ background: SP_GLASS, border: SP_BORDER }}>
            <Sparkles size={14} color={SP_ACCENT} />
            <span className="h-2 w-2 rounded-full" style={{ background: unavailable ? '#f87171' : micOn || sessionActive ? SP_ACCENT : 'rgba(255,255,255,0.35)' }} />
            <span className="hidden sm:inline">Sky AI · </span>{status}
          </span>
          <button type="button" aria-label="Настройки" onClick={() => setPanel(true)} className="grid h-12 w-12 place-items-center rounded-full" style={{ background: SP_GLASS, border: SP_BORDER }}>
            <Settings size={20} />
          </button>
        </div>
      </header>

      <main className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-5">
        <SpeakerDevice glow={glow} level={level ?? 0} onTap={call} />
        <p className="min-h-[44px] max-w-[640px] text-center text-[15px] text-white/70" translate="no">
          {phase === 'listening' || phase === 'processing' ? heard : phase === 'speaking' ? answer : ''}
        </p>
      </main>

      <footer className="flex flex-col gap-3 px-5 pb-5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-3xl px-4 py-3" style={{ background: SP_GLASS, border: SP_BORDER }}>
          <div className="min-w-0 basis-full sm:flex-1 sm:basis-0">
            <p className="truncate text-[16px] font-bold" translate="no">{item ? item.title : 'Ничего не играет'}</p>
            <p className="truncate text-[12px] text-white/50" translate="no">{item ? item.author : 'Скажите «Включи музыку»'}</p>
          </div>
          <button type="button" aria-label="Назад" disabled={!item} onClick={() => usePlayerStore.getState().prevTrack()} className="grid h-12 w-12 place-items-center rounded-full disabled:opacity-30"><SkipBack size={22} /></button>
          <button type="button" aria-label={playing ? 'Пауза' : 'Играть'} disabled={!item} onClick={() => usePlayerStore.getState().requestPlay(!playing)}
            className="grid h-14 w-14 place-items-center rounded-full disabled:opacity-30" style={{ background: SP_ACCENT, color: '#04211d' }}>
            {playing ? <Pause size={26} /> : <Play size={26} />}
          </button>
          <button type="button" aria-label="Дальше" disabled={!item} onClick={() => usePlayerStore.getState().nextTrack()} className="grid h-12 w-12 place-items-center rounded-full disabled:opacity-30"><SkipForward size={22} /></button>
          <button type="button" role="switch" aria-checked={micOn} aria-label={micOn ? 'Выключить микрофон Sky AI' : 'Включить микрофон Sky AI'} onClick={() => void toggleMic()}
            className="ml-auto grid h-14 w-14 sm:ml-2 place-items-center rounded-full" style={{ background: micOn ? SP_ACCENT : 'rgba(248,113,113,0.22)', color: micOn ? '#04211d' : '#fca5a5' }}>
            {micOn ? <Mic size={26} /> : <MicOff size={26} />}
          </button>
        </div>
        <p className="flex items-center justify-center gap-2 text-[12px] text-white/50" translate="no">
          <Bluetooth size={13} />
          {!dev.supported ? 'Список устройств недоступен в этом браузере'
            : dev.labelsHidden ? 'Включите микрофон, чтобы увидеть названия устройств'
            : `Звук: ${dev.output ?? 'устройство по умолчанию'}${dev.input ? ` · Микрофон: ${dev.input}` : ''}`}
        </p>
      </footer>

      {panel && (
        <div className="absolute inset-0 z-50 flex justify-end" style={{ background: 'rgba(0,0,0,0.55)' }} onClick={() => setPanel(false)}>
          <div className="flex h-full w-[min(420px,100%)] flex-col gap-3 overflow-y-auto p-5" style={{ background: '#0b1224', borderLeft: SP_BORDER }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <p className="text-[20px] font-extrabold">Настройки колонки</p>
              <button type="button" aria-label="Закрыть" onClick={() => setPanel(false)} className="grid h-11 w-11 place-items-center rounded-full" style={{ background: SP_GLASS }}><X size={20} /></button>
            </div>
            <label className="block rounded-2xl px-4 py-3" style={{ background: SP_GLASS, border: SP_BORDER }}>
              <span className="block text-[12px] text-white/50">Название колонки</span>
              <input value={name} maxLength={24} onChange={(e) => setName(e.target.value)} translate="no"
                className="mt-1 w-full bg-transparent text-[18px] font-semibold text-white outline-none" />
            </label>
            <Row label="Микрофон Sky AI" sub={micOn ? 'Слушает фразу «Привет, Скай»' : 'Выключен'} on={micOn} onToggle={() => void toggleMic()} />
            <Row label="Голосовые ответы" sub="Sky AI отвечает вслух" on={settings.aiVoiceAnswers} onToggle={() => set({ aiVoiceAnswers: !settings.aiVoiceAnswers })} />
            <Row label="Продолжать диалог" sub="Слушать после ответа" on={settings.aiContinue} onToggle={() => set({ aiContinue: !settings.aiContinue })} />
            <label className="block rounded-2xl px-4 py-3" style={{ background: SP_GLASS, border: SP_BORDER }}>
              <span className="mb-2 flex items-center gap-2 text-[14px] font-semibold"><Volume2 size={16} />Громкость · {Math.round(volume * 100)}%</span>
              <input type="range" min={0} max={100} value={Math.round(volume * 100)} onChange={(e) => usePlayerStore.getState().setVolume(Number(e.target.value) / 100)} className="w-full" />
            </label>
            <div className="rounded-2xl px-4 py-3 text-[13px] text-white/60" style={{ background: SP_GLASS, border: SP_BORDER }} translate="no">
              <p>Звук: {dev.output ?? 'неизвестно'}</p>
              <p>Микрофон: {dev.input ?? 'неизвестно'}</p>
              <p className="mt-1 text-white/40">Браузер не сообщает, как подключена колонка (Bluetooth или кабель).</p>
            </div>
            <button type="button" onClick={() => { setPanel(false); useAuthStore.getState().switchProfile(); }}
              className="flex items-center gap-3 rounded-2xl px-4 py-3 text-[16px] font-semibold" style={{ background: SP_GLASS, border: SP_BORDER, minHeight: 56 }}><Users size={18} />Сменить профиль</button>
            <button type="button" onClick={() => { useAiSession.getState().stop(); setSpeakerMode(false); }}
              className="flex items-center gap-3 rounded-2xl px-4 py-3 text-[16px] font-semibold text-red-300" style={{ background: SP_GLASS, border: SP_BORDER, minHeight: 56 }}><LogOut size={18} />Выйти из режима колонки</button>
          </div>
        </div>
      )}
    </div>
  );
};
