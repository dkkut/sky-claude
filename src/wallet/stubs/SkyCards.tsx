/**
 * SkyCards — визуальная заглушка будущего сервиса виртуальных карт. Только оформление: карт нет, номеров нет, платежей нет, запросов нет.
 * Все элементы неактивны (<Dead>), живёт лишь «Назад». Цвета и узоры нарисованы кодом.
 */
import { ShieldCheck, SlidersHorizontal, Zap, Sparkles } from 'lucide-react';
import { BetaBanner, Dead, StubTop } from './Stub';

const TINT = '#8b7bff';

type Look = { name: string; a: string; b: string; c: string };
const LOOKS: Look[] = [
  { name: 'Небула', a: '#1b2a6b', b: '#5b3fd0', c: '#b06cff' },
  { name: 'Аврора', a: '#0b3b5c', b: '#1fa0c8', c: '#7be0d0' },
  { name: 'Графит', a: '#16181f', b: '#2b2f3d', c: '#6b7390' },
  { name: 'Рассвет', a: '#4a1d5e', b: '#c2417a', c: '#ffb08a' },
];

/** Виртуальная карта оригинального дизайна Sky: стекло, мягкий блик, орбиты и звёзды. Без реальных данных. */
const Card = ({ look, big = false, label = 'Виртуальная карта' }: { look: Look; big?: boolean; label?: string }) => (
  <div className={`stub-sheen relative overflow-hidden ${big ? 'w-full max-w-[420px]' : 'w-full'}`}
    style={{ aspectRatio: '1.586', borderRadius: big ? 26 : 18, background: `radial-gradient(120% 120% at 100% 0%, ${look.c}55, transparent 55%), linear-gradient(145deg, ${look.a}, ${look.b})`,
      border: '1px solid rgba(255,255,255,.18)', boxShadow: `0 ${big ? 30 : 14}px ${big ? 60 : 28}px ${look.b}55, inset 0 1px 0 rgba(255,255,255,.28)` }}>
    <svg className="absolute inset-0 h-full w-full" viewBox="0 0 320 200" preserveAspectRatio="none" aria-hidden="true">
      <g fill="none" stroke="rgba(255,255,255,.14)"><ellipse cx="250" cy="40" rx="120" ry="46" transform="rotate(-18 250 40)" /><ellipse cx="250" cy="40" rx="86" ry="30" transform="rotate(-18 250 40)" /><circle cx="250" cy="40" r="6" fill="rgba(255,255,255,.55)" stroke="none" /></g>
      {[[30, 30], [70, 150], [120, 60], [190, 170], [290, 120], [210, 90]].map(([x, y], i) => <circle key={i} cx={x} cy={y} r={i % 2 ? 1.1 : 1.6} fill="rgba(255,255,255,.55)" />)}
    </svg>
    <div className="relative flex h-full flex-col justify-between" style={{ padding: big ? 24 : 14 }}>
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2"><span className="grid place-items-center rounded-lg" style={{ width: big ? 30 : 20, height: big ? 30 : 20, background: 'rgba(255,255,255,.16)', border: '1px solid rgba(255,255,255,.3)' }}><Sparkles size={big ? 16 : 11} color="#fff" /></span>
          <span className="font-black tracking-[.18em] text-white" style={{ fontSize: big ? 15 : 10 }}>SKY</span></div>
        <span className="font-semibold uppercase tracking-widest text-white/70" style={{ fontSize: big ? 10 : 7 }}>{label}</span>
      </div>
      <div>
        <div className="mb-3 rounded-md" style={{ width: big ? 44 : 28, height: big ? 33 : 21, background: 'linear-gradient(135deg,#e8d9a8,#b79b5a)', opacity: .92, border: '1px solid rgba(255,255,255,.4)' }} />
        <p className="font-mono text-white/90" style={{ fontSize: big ? 19 : 11, letterSpacing: '.18em' }}>•••• •••• •••• ••••</p>
        <div className="mt-2 flex items-end justify-between"><span className="font-semibold uppercase tracking-widest text-white/70" style={{ fontSize: big ? 11 : 8 }}>Имя владельца</span><span className="font-mono text-white/70" style={{ fontSize: big ? 11 : 8 }}>••/••</span></div>
      </div>
    </div>
  </div>
);

const FEATURES = [
  { icon: SlidersHorizontal, title: 'Управление картами', text: 'Лимиты, заморозка и настройки каждой карты в одном месте.' },
  { icon: ShieldCheck, title: 'Безопасность', text: 'Защита от несанкционированных операций и мгновенное закрытие карты.' },
  { icon: Zap, title: 'Удобство', text: 'Быстрые платежи и единый баланс SkyMoney под рукой.' },
];

export const SkyCards = ({ onBack }: { onBack: () => void }) => (
  <div className="flex h-full flex-col overflow-hidden" style={{ background: 'radial-gradient(120% 60% at 50% -10%, #2a2a78 0%, #14152c 45%, #0b0c14 100%)', color: '#fff' }}>
    <StubTop title="SkyCards" onBack={onBack} mark={<span className="grid h-8 w-8 place-items-center rounded-xl" style={{ background: 'linear-gradient(135deg,#3b4bd8,#8b5cf6)' }}><Sparkles size={15} color="#fff" /></span>} />
    <div className="min-w-0 flex-1 overflow-y-auto overflow-x-hidden px-4 pb-10 pt-4" style={{ scrollbarWidth: 'none' }}>
      <BetaBanner tint={TINT} />
      <Dead className="mx-auto mt-6 w-full max-w-3xl space-y-8">
        <section className="relative grid place-items-center py-4">
          <div className="pointer-events-none absolute inset-0" style={{ background: `radial-gradient(50% 60% at 50% 45%, ${TINT}33, transparent 70%)` }} />
          <div className="stub-float relative w-full max-w-[420px]" style={{ ['--r' as string]: '-2deg' }}><Card look={LOOKS[0]} big /></div>
          <h1 className="relative mt-7 text-center text-3xl font-black tracking-tight sm:text-4xl">Карты Sky</h1>
          <p className="relative mt-2 max-w-md text-center text-sm text-white/65">Виртуальные карты для вашего кошелька SkyMoney. Скоро.</p>
        </section>

        <section>
          <h2 className="mb-3 text-xs font-bold uppercase tracking-widest text-white/50">Оформления</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{LOOKS.map((l) => <div key={l.name}><Card look={l} label="" /><p className="mt-2 text-center text-xs text-white/60">{l.name}</p></div>)}</div>
        </section>

        <section>
          <h2 className="mb-3 text-xs font-bold uppercase tracking-widest text-white/50">Ваши карты</h2>
          <div className="space-y-2.5">
            {LOOKS.slice(0, 2).map((l, i) => (
              <div key={l.name} className="flex items-center gap-3 rounded-2xl p-3" style={{ background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.1)', backdropFilter: 'blur(12px)' }}>
                <div className="w-20 shrink-0"><Card look={l} label="" /></div>
                <div className="min-w-0 flex-1"><p className="truncate text-sm font-bold">{i ? 'Для покупок' : 'Основная'}</p><p className="text-xs text-white/50">•••• ••••</p></div>
                <span className="rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider" style={{ background: 'rgba(255,255,255,.08)', color: 'rgba(255,255,255,.65)' }}>Пример</span>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h2 className="mb-3 text-xs font-bold uppercase tracking-widest text-white/50">Что появится</h2>
          <div className="grid gap-3 sm:grid-cols-3">
            {FEATURES.map(({ icon: Icon, title, text }) => (
              <div key={title} className="rounded-2xl p-4" style={{ background: 'linear-gradient(160deg, rgba(255,255,255,.08), rgba(255,255,255,.03))', border: '1px solid rgba(255,255,255,.12)' }}>
                <span className="mb-3 grid h-9 w-9 place-items-center rounded-xl" style={{ background: `${TINT}26`, border: `1px solid ${TINT}55` }}><Icon size={16} color={TINT} /></span>
                <p className="text-sm font-bold">{title}</p><p className="mt-1 text-xs leading-relaxed text-white/55">{text}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-2xl p-5" style={{ background: 'rgba(255,255,255,.04)', border: '1px dashed rgba(255,255,255,.18)' }}>
          <p className="text-sm font-bold">Сервис в разработке</p>
          <p className="mt-1 text-xs leading-relaxed text-white/55">SkyCards пока не работает: карты не выпускаются, платежи и переводы недоступны, банковские данные не принимаются. Всё, что вы видите, — оформление будущего раздела. Номера и имена на картах условные.</p>
        </section>
      </Dead>
    </div>
  </div>
);
