/* ===========================================================
   SKY CAR — Sky AI только голосом. Тот же голосовой режим и чат Sky AI
   (VoiceMode / apiAiSend), без текстового ввода: за рулём не печатают.
=========================================================== */
import { useState } from 'react';
import { Mic, Sparkles } from 'lucide-react';
import { VoiceMode } from '@/ai/VoiceMode';
import { useAiState } from '@/ai/aiState';
import { CAR_ACCENT, CAR_BLUR, CAR_GLASS, CAR_GLASS_BORDER } from './carTheme';

export const CarAI = () => {
  const state = useAiState();
  const [open, setOpen] = useState(false);
  const unavailable = state && !state.configured;
  return (
    <div className="flex h-full flex-col items-center justify-center gap-8 rounded-[40px] p-10 text-center" style={{ background: CAR_GLASS, border: CAR_GLASS_BORDER, backdropFilter: CAR_BLUR }}>
      <Sparkles size={64} color="#c4baff" />
      <div>
        <p className="text-[40px] font-extrabold text-white">Sky AI</p>
        <p className="mt-2 text-[24px] text-white/60">{unavailable ? 'Sky AI сейчас недоступен' : 'Спросите голосом — ответ прозвучит вслух'}</p>
      </div>
      <button type="button" disabled={!!unavailable} onClick={() => setOpen(true)} aria-label="Говорить"
        className="grid h-[180px] w-[180px] place-items-center rounded-full outline-none transition active:scale-95 disabled:opacity-40 focus-visible:ring-8 focus-visible:ring-violet-300"
        style={{ background: CAR_ACCENT, boxShadow: '0 0 60px rgba(139,124,255,0.55)' }}>
        <Mic size={80} color="#fff" />
      </button>
      <p className="text-[20px] text-white/45">Нажмите и говорите</p>
      {open && <VoiceMode chatId={null} serverStt={!!state?.transcription} onClose={() => setOpen(false)} onTurn={() => {}} />}
    </div>
  );
};
