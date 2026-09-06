/* ===============================================================
   SKY AUDIO  -  звуки уведомлений и рингтон через Web Audio API
   Не нужны файлы  -  всё генерируется программно
=============================================================== */

let ctx: AudioContext | null = null;

const getCtx = () => {
  if (!ctx || ctx.state === 'closed') {
    ctx = new AudioContext();
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
};

/* -- Helpers ----------------------------------------------- */
const osc = (ac: AudioContext, freq: number, type: OscillatorType, startT: number, endT: number, gainPeak: number) => {
  const o = ac.createOscillator();
  const g = ac.createGain();
  o.connect(g); g.connect(ac.destination);
  o.type = type;
  o.frequency.setValueAtTime(freq, startT);
  g.gain.setValueAtTime(0, startT);
  g.gain.linearRampToValueAtTime(gainPeak, startT + 0.01);
  g.gain.exponentialRampToValueAtTime(0.001, endT);
  o.start(startT);
  o.stop(endT + 0.05);
};

/* === RINGTONE  -  Sky фирменный рингтон =================== */
let ringtoneTimer: ReturnType<typeof setInterval> | null = null;

const playRingtoneOnce = () => {
  try {
    const ac = getCtx();
    const t  = ac.currentTime;

    // Sky signature: восходящая пентатоника C-E-G-B
    const notes = [
      { f: 523.25, d: 0.12 },  // C5
      { f: 659.25, d: 0.12 },  // E5
      { f: 783.99, d: 0.12 },  // G5
      { f: 987.77, d: 0.20 },  // B5
      { f: 783.99, d: 0.12 },  // G5
      { f: 987.77, d: 0.30 },  // B5 (долгая)
    ];

    let time = t;
    notes.forEach(({ f, d }) => {
      // Основная нота
      osc(ac, f, 'sine', time, time + d, 0.22);
      // Лёгкий обертон
      osc(ac, f * 2, 'sine', time, time + d * 0.6, 0.06);
      time += d + 0.02;
    });

    // Пауза + ещё раз
    time += 0.25;
    notes.slice(0, 4).forEach(({ f, d }) => {
      osc(ac, f, 'sine', time, time + d, 0.18);
      time += d + 0.02;
    });
  } catch {}
};

export const startRingtone = () => {
  stopRingtone();
  playRingtoneOnce();
  ringtoneTimer = setInterval(playRingtoneOnce, 2800);
};

export const stopRingtone = () => {
  if (ringtoneTimer) { clearInterval(ringtoneTimer); ringtoneTimer = null; }
};

/* === MESSAGE SOUND ====================================== */
export const playMessageSound = () => {
  try {
    const ac = getCtx();
    const t  = ac.currentTime;
    // Мягкий «тик» двух нот
    osc(ac, 1046.5, 'sine', t,        t + 0.08, 0.14);  // C6
    osc(ac, 1318.5, 'sine', t + 0.09, t + 0.18, 0.10);  // E6
  } catch {}
};

/* === MENTION SOUND ====================================== */
export const playMentionSound = () => {
  try {
    const ac = getCtx();
    const t  = ac.currentTime;
    // Три быстрых восходящих пинга
    osc(ac, 880,  'sine', t,        t + 0.09, 0.15);
    osc(ac, 1100, 'sine', t + 0.1,  t + 0.18, 0.12);
    osc(ac, 1320, 'sine', t + 0.2,  t + 0.30, 0.18);
  } catch {}
};

/* === CALL CONNECTED SOUND =============================== */
export const playCallConnected = () => {
  try {
    const ac = getCtx();
    const t  = ac.currentTime;
    osc(ac, 880,  'sine', t,       t + 0.12, 0.15);
    osc(ac, 1100, 'sine', t + 0.1, t + 0.22, 0.12);
  } catch {}
};

/* === CALL ENDED SOUND =================================== */
export const playCallEnded = () => {
  try {
    const ac = getCtx();
    const t  = ac.currentTime;
    osc(ac, 440, 'sine', t,        t + 0.15, 0.16);
    osc(ac, 330, 'sine', t + 0.14, t + 0.35, 0.12);
  } catch {}
};

/* === SUCCESS SOUND ====================================== */
export const playSuccess = () => {
  try {
    const ac = getCtx();
    const t  = ac.currentTime;
    osc(ac, 783.99, 'sine', t,        t + 0.10, 0.14);
    osc(ac, 987.77, 'sine', t + 0.09, t + 0.22, 0.16);
  } catch {}
};
