/**
 * SkyCrypto — визуальная заглушка будущего раздела цифровых активов. Только оформление: нет кошельков, ключей, бирж, обмена и сделок,
 * нет запросов к серверу. Все названия активов выдуманы, а цифры и график — условные и так подписаны. Элементы неактивны (<Dead>).
 */
import { Layers, LineChart, ShieldCheck, Hexagon } from 'lucide-react';
import { BetaBanner, Dead, StubTop } from './Stub';

const TINT = '#22d3ee';

/** Условные активы: вымышленные названия, значения — только для оформления. */
const ASSETS = [
  { name: 'Nova', code: 'NVA', hue: '#22d3ee', pts: [4, 6, 5, 8, 7, 10, 9, 12] },
  { name: 'Lumen', code: 'LMN', hue: '#a78bfa', pts: [9, 8, 9, 7, 8, 6, 7, 5] },
  { name: 'Orbit', code: 'ORB', hue: '#60a5fa', pts: [3, 5, 4, 6, 8, 7, 9, 11] },
];

const spark = (pts: number[], w: number, h: number) => {
  const max = Math.max(...pts), min = Math.min(...pts);
  return pts.map((v, i) => `${(i / (pts.length - 1)) * w},${h - ((v - min) / (max - min || 1)) * (h - 4) - 2}`).join(' ');
};

const Hero = () => (
  <svg viewBox="0 0 360 220" className="h-auto w-full" role="img" aria-label="Декоративная иллюстрация цифровой экосистемы">
    <defs>
      <radialGradient id="scg" cx="50%" cy="50%" r="50%"><stop offset="0" stopColor="#22d3ee" stopOpacity=".5" /><stop offset="1" stopColor="#22d3ee" stopOpacity="0" /></radialGradient>
      <linearGradient id="scl" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#22d3ee" /><stop offset="1" stopColor="#8b5cf6" /></linearGradient>
    </defs>
    <circle cx="180" cy="110" r="100" fill="url(#scg)" />
    <g fill="none" stroke="url(#scl)" strokeOpacity=".55"><ellipse cx="180" cy="110" rx="150" ry="52" transform="rotate(-14 180 110)" /><ellipse cx="180" cy="110" rx="110" ry="80" transform="rotate(24 180 110)" /><circle cx="180" cy="110" r="64" /></g>
    {[[60, 72], [300, 150], [250, 40], [96, 168], [318, 84]].map(([x, y], i) => <g key={i} className="stub-pulse" style={{ animationDelay: `${i * .5}s` }}><polygon points={`${x},${y - 9} ${x + 8},${y - 4.5} ${x + 8},${y + 4.5} ${x},${y + 9} ${x - 8},${y + 4.5} ${x - 8},${y - 4.5}`} fill="rgba(34,211,238,.12)" stroke="#22d3ee" strokeOpacity=".8" /></g>)}
    <polygon points="180,66 218,88 218,132 180,154 142,132 142,88" fill="rgba(139,92,246,.18)" stroke="url(#scl)" strokeWidth="1.6" />
    <polygon points="180,86 200,98 200,122 180,134 160,122 160,98" fill="none" stroke="#fff" strokeOpacity=".55" />
    <circle cx="180" cy="110" r="5" fill="#fff" />
  </svg>
);

const FEATURES = [
  { icon: Layers, title: 'Управление цифровыми активами', text: 'Единое место для ваших цифровых активов.' },
  { icon: LineChart, title: 'Отслеживание стоимости', text: 'Наглядная динамика и уведомления об изменениях.' },
  { icon: ShieldCheck, title: 'Инструменты безопасности', text: 'Защита доступа и контроль каждого действия.' },
];

export const SkyCrypto = ({ onBack }: { onBack: () => void }) => (
  <div className="flex h-full flex-col overflow-hidden" style={{ background: 'radial-gradient(90% 55% at 80% -5%, #0e3a52 0%, #0d1224 42%, #07080f 100%)', color: '#fff' }}>
    <StubTop title="SkyCrypto" onBack={onBack} mark={<span className="grid h-8 w-8 place-items-center rounded-xl" style={{ background: 'linear-gradient(135deg,#0ea5c6,#7c3aed)' }}><Hexagon size={15} color="#fff" /></span>} />
    <div className="min-w-0 flex-1 overflow-y-auto overflow-x-hidden px-4 pb-10 pt-4" style={{ scrollbarWidth: 'none' }}>
      <BetaBanner tint={TINT} />
      <Dead className="mx-auto mt-6 w-full max-w-3xl space-y-8">
        <section className="text-center">
          <div className="mx-auto max-w-sm"><Hero /></div>
          <h1 className="-mt-2 text-4xl font-black tracking-tight sm:text-5xl" style={{ background: 'linear-gradient(90deg,#67e8f9,#a78bfa)', WebkitBackgroundClip: 'text', color: 'transparent' }}>SkyCrypto</h1>
          <p className="mx-auto mt-2 max-w-md text-sm text-white/60">Цифровые активы в экосистеме Sky. Раздел в разработке.</p>
        </section>

        <section>
          <h2 className="mb-1 text-xs font-bold uppercase tracking-widest text-white/50">Примеры активов</h2>
          <p className="mb-3 text-[11px] text-white/40">Условные названия и данные — для оформления, не рыночные.</p>
          <div className="grid gap-3 sm:grid-cols-3">
            {ASSETS.map((a) => (
              <div key={a.code} className="rounded-2xl p-4" style={{ background: 'linear-gradient(160deg, rgba(255,255,255,.07), rgba(255,255,255,.02))', border: `1px solid ${a.hue}44`, boxShadow: `0 0 24px ${a.hue}18` }}>
                <div className="flex items-center gap-2.5"><span className="grid h-8 w-8 place-items-center rounded-full" style={{ background: `${a.hue}26`, border: `1px solid ${a.hue}77` }}><Hexagon size={13} color={a.hue} /></span>
                  <div><p className="text-sm font-bold">{a.name}</p><p className="text-[10px] font-semibold tracking-widest text-white/45">{a.code} · условный</p></div></div>
                <svg viewBox="0 0 120 36" className="mt-3 h-9 w-full" aria-hidden="true"><polyline points={spark(a.pts, 120, 36)} fill="none" stroke={a.hue} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                <p className="mt-2 text-lg font-extrabold text-white/90">— — —</p>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-3xl p-5" style={{ background: 'linear-gradient(160deg, rgba(34,211,238,.08), rgba(139,92,246,.07))', border: '1px solid rgba(255,255,255,.12)' }}>
          <div className="flex items-center justify-between"><p className="text-sm font-bold">Динамика стоимости</p><span className="rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider" style={{ background: 'rgba(255,255,255,.08)', color: 'rgba(255,255,255,.65)' }}>Условный график</span></div>
          <svg viewBox="0 0 320 120" className="mt-3 h-auto w-full" role="img" aria-label="Декоративный график без реальных данных">
            <defs><linearGradient id="scf" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#22d3ee" stopOpacity=".35" /><stop offset="1" stopColor="#22d3ee" stopOpacity="0" /></linearGradient></defs>
            {[30, 60, 90].map((y) => <line key={y} x1="0" x2="320" y1={y} y2={y} stroke="rgba(255,255,255,.07)" />)}
            <polygon points={`0,120 ${spark([20, 34, 28, 52, 44, 70, 62, 88, 76, 100], 320, 110)} 320,120`} fill="url(#scf)" />
            <polyline points={spark([20, 34, 28, 52, 44, 70, 62, 88, 76, 100], 320, 110)} fill="none" stroke="#67e8f9" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <p className="mt-2 text-[11px] text-white/40">Форма линии придумана для оформления и не отражает реальные цены.</p>
        </section>

        <section>
          <h2 className="mb-3 text-xs font-bold uppercase tracking-widest text-white/50">Что появится</h2>
          <div className="grid gap-3 sm:grid-cols-3">
            {FEATURES.map(({ icon: Icon, title, text }) => (
              <div key={title} className="rounded-2xl p-4" style={{ background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.1)' }}>
                <span className="mb-3 grid h-9 w-9 place-items-center rounded-xl" style={{ background: `${TINT}22`, border: `1px solid ${TINT}55` }}><Icon size={16} color={TINT} /></span>
                <p className="text-sm font-bold">{title}</p><p className="mt-1 text-xs leading-relaxed text-white/55">{text}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-2xl p-5" style={{ background: 'rgba(255,255,255,.04)', border: '1px dashed rgba(255,255,255,.18)' }}>
          <p className="text-sm font-bold">Сервис в разработке</p>
          <p className="mt-1 text-xs leading-relaxed text-white/55">SkyCrypto пока не работает: нет кошельков и ключей, нет покупки, продажи и обмена, нет подключения к биржам и блокчейнам. Названия активов, значения и график на этой странице вымышлены и показаны только для оформления.</p>
        </section>
      </Dead>
    </div>
  </div>
);
