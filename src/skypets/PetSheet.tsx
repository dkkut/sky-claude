import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useMessengerStore } from '@/messenger/store';
import { usePeopleSearch } from '@/messenger/usePeopleSearch';
import { sp, errText, RARITY, MOOD, CHARACTER, SKILL, ACTION_LABEL, type Pet, type InvRow } from './api';
import { PetPic } from './PetArt';
import { Btn, Bar, Chip, Card, Modal, INK, itemIcon } from './ui';
import { usePetsNav } from './nav';
import { StreakCard, StreakCelebration, type Streak } from './Streak';

type Detail = { streak: Streak; pet: Pet; history: { id: number; action: string; xp: number; at: string; detail: any; actor: { id: string; name?: string } | null }[]; levelTrack: { level: number; reward: { coins?: number; items?: Record<string, number>; eggs?: Record<string, number> }; unlock: string | null }[]; photos: { id: string; pose: string; caption: string; at: string }[]; achievements: { key: string; title: string; progress: number; target: number; ready: boolean; claimed: boolean; petId?: string; reward: any }[]; skins: { id: string; name: string; rarity: string; owned: boolean; priceCoins: number; unlockLevel?: number | null; art: any; imageId?: string | null; view?: any }[] };
const POSES = [['sit', 'Сидит'], ['jump', 'Прыжок'], ['dance', 'Танец'], ['love', 'Любовь']];

export function PetSheet({ id, inventory, myId, onClose, onChanged, toast }: { id: string; inventory: InvRow[]; myId: string; onClose: () => void; onChanged: () => void; toast: (m: string, bad?: boolean) => void }) {
  const [d, setD] = useState<Detail | null>(null); const [busy, setBusy] = useState(false); const [pick, setPick] = useState<null | 'feed' | 'play' | 'heal'>(null);
  const [view, setView] = useState<'main' | 'skins' | 'dress' | 'history' | 'manage'>('main'); const [name, setName] = useState<string | null>(null); const nav = usePetsNav();
  const load = useCallback(async () => { const r = await sp<Detail>(`/pet/${id}`); if (r.ok) setD(r.data); else { toast(errText(r.data.error), true); onClose(); } }, [id, toast, onClose]);
  useEffect(() => { void load(); const h = () => void load(); window.addEventListener('sky:skypets', h); return () => window.removeEventListener('sky:skypets', h); }, [load]);
  if (!d) return <Modal onClose={onClose} title="Питомец"><div className="py-10 text-center text-[13px]" style={{ color: INK }}>Загрузка…</div></Modal>;
  const p = d.pet; const rar = RARITY[p.species?.rarity ?? 'common'];
  const inv = (k: string) => inventory.filter((r) => r.item?.kind === k || (k === 'food' && r.item?.kind === 'food'));
  const run = async (action: string, extra: Record<string, unknown> = {}) => {
    if (busy) return; setBusy(true);
    const r = await sp<any>(`/pet/${id}/act`, 'POST', { action, ...extra }); setBusy(false);
    if (!r.ok) { toast(errText(r.data.error), true); return; }
    const parts: string[] = []; if (r.data.xp) parts.push(`+${r.data.xp} опыта`); if (r.data.coins) parts.push(`+${r.data.coins} монет`); if (r.data.levelUps?.length) parts.push(`Уровень ${r.data.levelUps.at(-1)}!`);
    toast(parts.join(' · ') || 'Готово'); setPick(null); await load(); onChanged();
  };
  const post = async (path: string, body: unknown, ok = 'Готово') => { const r = await sp<any>(path, 'POST', body); if (!r.ok) { toast(errText(r.data.error), true); return r; } toast(ok); await load(); onChanged(); return r; };
  const sendToChat = (text: string) => { if (!nav.chatId) return; useMessengerStore.getState().sendMessage({ text }); toast('Отправлено в чат'); };
  const foods = inv('food').filter((r) => r.item?.effect?.satiety); const meds = inv('food').filter((r) => r.item?.effect?.health); const toys = inv('toy'); const acc = [...inv('accessory'), ...inv('clothes')];
  return (
    <Modal onClose={onClose} title={p.name} wide>
      <div className="grid gap-3 sm:grid-cols-[220px_1fr]">
        <div className="text-center">
          <div className="mx-auto grid place-items-center rounded-[28px] py-2" style={{ background: 'radial-gradient(circle at 50% 35%,#fff,#e6dcff)' }}><div className={p.sleeping ? '' : 'sp-bob'}><PetPic pet={p} size={170} /></div></div>
          <div className="mt-2 flex flex-wrap justify-center gap-1"><Chip color={rar.color}>{rar.name}</Chip><Chip>{CHARACTER[p.character] ?? p.character}</Chip><Chip color="#e0709a">{MOOD[p.mood] ?? p.mood}</Chip>{p.shared && <Chip color="#2fa36b">Совместный</Chip>}</div>
          <div className="mt-2 text-[12px] font-semibold" style={{ color: INK }}>{p.species?.name} · уровень {p.level}</div>
          <div className="mt-1.5"><Bar v={p.xp} max={p.xpNeed} label="Опыт" color="linear-gradient(90deg,#ffb02e,#ff7a59)" /></div>
          {p.owners.length > 1 && <div className="mt-2 text-[11px] opacity-80" style={{ color: INK }}>Растят: {p.owners.map((o) => o.name).join(' и ')}</div>}
        </div>
        <div className="min-w-0">
          {d.streak && <div className="mb-3"><StreakCard s={d.streak} busy={busy} onRestore={() => { setBusy(true); void post(`/pet/${id}/streak-restore`, {}, 'Серия восстановлена!').finally(() => setBusy(false)); }} onFreeze={() => { setBusy(true); void post(`/pet/${id}/streak-freeze`, {}, 'Серия заморожена').finally(() => setBusy(false)); }} /></div>}
          <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 sm:grid-cols-3">
            <Bar v={p.satiety} label="Сытость" color="#ff9a3a" /><Bar v={p.energy} label="Энергия" color="#4aa3ff" /><Bar v={p.hygiene} label="Чистота" color="#38c9c9" /><Bar v={p.fun} label="Радость" color="#ff6fa8" /><Bar v={p.health} label="Здоровье" color="#48c774" />
          </div>
          {p.needs.length > 0 && !p.sleeping && <div className="mt-2 text-[12px] font-bold" style={{ color: '#d0507a' }}>Нужно: {p.needs.map((n) => ({ feed: 'покормить', bathe: 'искупать', play: 'поиграть', sleep: 'уложить спать', heal: 'полечить' } as Record<string, string>)[n]).join(', ')}</div>}
          {p.sleeping ? <div className="mt-3"><Card><div className="text-[13px] font-bold">Спит… Энергия восстанавливается.</div><div className="mt-2"><Btn onClick={() => run('wake')} disabled={busy} kind="soft">Разбудить</Btn></div></Card></div> : (
            <div className="mt-3 flex flex-wrap gap-2">
              <Btn onClick={() => setPick(pick === 'feed' ? null : 'feed')}>🍖 Кормить</Btn><Btn onClick={() => setPick(pick === 'play' ? null : 'play')}>🎾 Играть</Btn><Btn onClick={() => run('bathe')} disabled={busy}>🛁 Купать</Btn>
              <Btn onClick={() => run('sleep')} disabled={busy}>😴 Спать</Btn><Btn onClick={() => run('walk')} disabled={busy}>🌳 Гулять</Btn><Btn onClick={() => setPick(pick === 'heal' ? null : 'heal')}>💊 Лечить</Btn>
            </div>
          )}
          {pick && (
            <Card className="mt-2"><div className="mb-1 text-[12px] font-bold">{pick === 'feed' ? 'Чем покормить?' : pick === 'play' ? 'Во что играть?' : 'Чем лечить?'}</div>
              <div className="flex flex-wrap gap-2">
                {(pick === 'feed' ? foods : pick === 'heal' ? meds : toys).map((r) => <Btn key={r.itemId} kind="soft" small onClick={() => run(pick, { itemId: r.itemId })}>{itemIcon(r.item)} {r.item?.name} ×{r.qty}</Btn>)}
                {pick === 'play' && <Btn kind="soft" small onClick={() => run('play')}>Просто побегать</Btn>}
                {(pick === 'feed' ? foods : pick === 'heal' ? meds : toys).length === 0 && pick !== 'play' && <div className="text-[12px] opacity-70">Нет подходящего — загляните в магазин.</div>}
              </div></Card>
          )}
          <div className="mt-3"><div className="mb-1 text-[12px] font-extrabold" style={{ color: INK }}>Навыки (учить тратит энергию)</div>
            <div className="grid grid-cols-2 gap-2">{Object.entries(SKILL).map(([k, label]) => { const s = p.skills[k] ?? { l: 0, x: 0 }; return (
              <div key={k} className="flex items-center gap-2 rounded-2xl p-2" style={{ background: 'rgba(122,92,240,.08)' }}><div className="min-w-0 flex-1"><div className="text-[12px] font-bold" style={{ color: INK }}>{label} · ур. {s.l}</div><Bar v={s.x} max={(s.l + 1) * 2} color="#9a7bff" /></div><Btn kind="soft" small disabled={busy || p.sleeping} onClick={() => run('teach', { skill: k })}>Учить</Btn></div>); })}</div></div>
          <div className="mt-3 flex flex-wrap gap-2">
            {(['main', 'skins', 'dress', 'history', 'manage'] as const).map((v) => <Btn key={v} kind={view === v ? 'main' : 'soft'} small onClick={() => setView(v)}>{{ main: 'Награды уровней', skins: 'Скины', dress: 'Наряды', history: 'История', manage: 'Ещё' }[v]}</Btn>)}
          </div>
        </div>
      </div>
      <div className="mt-3">
        {view === 'main' && (
          <div className="space-y-2">
            {d.levelTrack.length === 0 && <Card><div className="text-[13px] font-bold">Максимальный уровень достигнут 🎉</div></Card>}
            {d.levelTrack.map((l) => <Card key={l.level}><div className="flex items-center justify-between gap-2"><div className="text-[13px] font-extrabold">Уровень {l.level}</div><div className="flex flex-wrap justify-end gap-1">{l.reward.coins ? <Chip color="#d99a00">+{l.reward.coins} монет</Chip> : null}{Object.keys(l.reward.items ?? {}).map((k) => <Chip key={k} color="#7b5cf0">предмет</Chip>)}{Object.keys(l.reward.eggs ?? {}).length ? <Chip color="#e0709a">яйцо</Chip> : null}</div></div>{l.unlock && <div className="mt-1 text-[12px] font-semibold" style={{ color: '#2fa36b' }}>Откроется: {l.unlock}</div>}</Card>)}
            {d.achievements.length > 0 && <Card><div className="mb-1 text-[13px] font-extrabold">Достижения питомца</div>{d.achievements.map((a) => <div key={a.key} className="flex items-center justify-between gap-2 py-1"><div className="min-w-0 text-[12px] font-semibold">{a.title}<div className="opacity-60">{a.progress}/{a.target}</div></div>{a.claimed ? <Chip color="#2fa36b">Получено</Chip> : <Btn small kind={a.ready ? 'gold' : 'soft'} disabled={!a.ready} onClick={() => post('/achievements/claim', { key: a.key, petId: a.petId ?? p.id }, 'Награда получена')}>Забрать</Btn>}</div>)}</Card>}
          </div>
        )}
        {view === 'skins' && (d.skins.length === 0 ? <Card><div className="text-[13px]">Для этого вида пока нет скинов. Загляните в магазин позже.</div></Card> : <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Card onClick={() => post(`/pet/${id}/skin`, { skinId: null }, 'Скин снят')} style={{ outline: !p.skin ? '2px solid #7b5cf0' : undefined }}><div className="text-center text-[12px] font-bold">Стандартный</div></Card>
          {d.skins.map((s) => <Card key={s.id} onClick={() => s.owned ? post(`/pet/${id}/skin`, { skinId: s.id }, 'Скин надет') : toast(s.unlockLevel ? `Откроется на уровне ${s.unlockLevel}` : `Купите в магазине (${s.priceCoins} монет)`, true)} style={{ outline: p.skin?.id === s.id ? '2px solid #7b5cf0' : undefined, opacity: s.owned ? 1 : 0.6 }}><div className="flex justify-center"><PetPic pet={{ species: { art: s.art, imageId: s.imageId, view: s.view }, mood: 'happy' }} size={72} /></div><div className="mt-1 text-center text-[12px] font-bold">{s.name}</div><div className="text-center"><Chip color={RARITY[s.rarity]?.color}>{RARITY[s.rarity]?.name}</Chip></div></Card>)}
        </div>)}
        {view === 'dress' && <Card><div className="mb-1 text-[13px] font-extrabold">Надето</div><div className="flex flex-wrap gap-2">{p.accessories.length === 0 && <span className="text-[12px] opacity-70">Пока ничего</span>}{p.accessories.map((a) => <Btn key={a.slot} kind="soft" small onClick={() => post(`/pet/${id}/unequip`, { slot: a.slot }, 'Снято')}>Снять: {a.slot === 'head' ? 'голова' : a.slot === 'neck' ? 'шея' : a.slot}</Btn>)}</div>
          <div className="mb-1 mt-3 text-[13px] font-extrabold">Из инвентаря</div><div className="flex flex-wrap gap-2">{acc.length === 0 && <span className="text-[12px] opacity-70">Нет аксессуаров — загляните в магазин.</span>}{acc.map((r) => <Btn key={r.itemId} small kind="soft" onClick={() => post(`/pet/${id}/equip`, { itemId: r.itemId }, 'Надето')}>{itemIcon(r.item)} {r.item?.name}</Btn>)}</div></Card>}
        {view === 'history' && <div className="space-y-1">{d.history.map((h) => <div key={h.id} className="flex items-center justify-between gap-2 rounded-2xl px-3 py-2 text-[12px]" style={{ background: 'rgba(255,255,255,.7)', color: INK }}><div className="min-w-0"><b>{ACTION_LABEL[h.action] ?? h.action}</b>{h.actor && <span className="opacity-70"> · {h.actor.id === myId ? 'вы' : h.actor.name}</span>}{h.detail?.level ? ` · ур. ${h.detail.level}` : ''}</div><div className="shrink-0 opacity-60">{new Date(h.at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}{h.xp ? ` · +${h.xp}` : ''}</div></div>)}
          {d.photos.length > 0 && <Card><div className="text-[13px] font-extrabold">Фото</div>{d.photos.map((f) => <div key={f.id} className="text-[12px]">📷 {POSES.find((x) => x[0] === f.pose)?.[1] ?? f.pose} {f.caption && `— ${f.caption}`} <span className="opacity-60">{new Date(f.at).toLocaleDateString('ru-RU')}</span></div>)}</Card>}</div>}
        {view === 'manage' && (
          <div className="space-y-2">
            <Card><div className="flex flex-wrap gap-2">
              <Btn kind="soft" small onClick={() => setName(p.name)}>✏️ Переименовать</Btn><Btn kind="soft" small onClick={() => post(`/pet/${id}/favorite`, { on: !p.favorite }, p.favorite ? 'Убрано из избранного' : 'В избранном')}>{p.favorite ? '★ В избранном' : '☆ В избранное'}</Btn>
              {POSES.map(([k, l]) => <Btn key={k} kind="soft" small disabled={p.sleeping} onClick={() => run('photo', { pose: k })}>📷 {l}</Btn>)}
              {p.canEvolve && <Btn kind="gold" small onClick={() => post(`/pet/${id}/evolve`, {}, 'Эволюция!')}>✨ Эволюция</Btn>}
            </div></Card>
            {nav.chatId && <Card><div className="mb-1 text-[12px] font-extrabold">Отправить в чат</div><div className="flex flex-wrap gap-2">
              <Btn small kind="soft" onClick={() => sendToChat(`🐾 ${p.name}: ${MOOD[p.mood] ?? p.mood}! Уровень ${p.level}`)}>Эмоцию</Btn>
              <Btn small kind="soft" onClick={() => sendToChat(`🏆 ${p.name} (${p.species?.name}) достиг уровня ${p.level} в Sky Pets!`)}>Карточку уровня</Btn></div></Card>}
            <TransferBox petId={id} shared={p.shared} onDone={() => { onChanged(); onClose(); }} toast={toast} />
          </div>
        )}
      </div>
      {name !== null && <Modal onClose={() => setName(null)} title="Имя питомца"><input autoFocus maxLength={20} value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded-2xl px-4 py-3 text-[14px] outline-none" style={{ background: '#fff', color: INK }} translate="no" /><div className="mt-3 flex justify-end"><Btn onClick={async () => { const r = await post(`/pet/${id}/rename`, { name }, 'Имя изменено'); if (r.ok) setName(null); }}>Сохранить</Btn></div></Modal>}
      {d.streak?.unseen?.length > 0 && createPortal(<StreakCelebration milestone={d.streak.unseen[0]} reward={d.streak.milestones.find((x) => x.m === d.streak.unseen[0])?.reward ?? 0} pet={p} onClose={() => { const m = d.streak.unseen[0]; setD({ ...d, streak: { ...d.streak, unseen: d.streak.unseen.slice(1) } }); void sp(`/pet/${id}/streak-seen`, 'POST', { milestone: m }); }} />, document.body)}
    </Modal>
  );
}

function TransferBox({ petId, shared, onDone, toast }: { petId: string; shared: boolean; onDone: () => void; toast: (m: string, bad?: boolean) => void }) {
  const [q, setQ] = useState(''); const { people } = usePeopleSearch(q); const [confirm, setConfirm] = useState(false);
  const start = async (kind: 'transfer' | 'delete', toId?: string) => { const r = await sp<any>(`/pet/${petId}/transfer`, 'POST', { kind, toId }); if (!r.ok) { toast(errText(r.data.error), true); return; } toast(r.data.status === 'done' ? (kind === 'delete' ? 'Питомец удалён' : 'Питомец передан') : 'Ждём согласия остальных'); if (r.data.status === 'done') onDone(); };
  return (
    <Card>
      <div className="mb-1 text-[12px] font-extrabold">Передать или удалить</div>
      <div className="mb-2 text-[11px] opacity-70">{shared ? 'Питомец общий: любое изменение владельца, передача и удаление требуют согласия обоих владельцев.' : 'Передача требует согласия получателя. Удаление необратимо.'}</div>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Кому передать: имя или @ник" className="w-full rounded-2xl px-3 py-2 text-[13px] outline-none" style={{ background: '#fff', color: INK }} />
      <div className="mt-1 flex flex-wrap gap-1">{people.slice(0, 5).map((pp) => <Btn key={pp.id} kind="soft" small onClick={() => start('transfer', pp.id)}>→ {pp.name}</Btn>)}</div>
      <div className="mt-2">{confirm ? <div className="flex items-center gap-2"><span className="text-[12px] font-bold" style={{ color: '#d0507a' }}>Точно удалить?</span><Btn kind="danger" small onClick={() => start('delete')}>Да, удалить</Btn><Btn kind="ghost" small onClick={() => setConfirm(false)}>Нет</Btn></div> : <Btn kind="ghost" small onClick={() => setConfirm(true)}>🗑 Удалить питомца</Btn>}</div>
    </Card>
  );
}
