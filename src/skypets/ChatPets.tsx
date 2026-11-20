import { useEffect, useState } from 'react';
import { sp, MOOD, type Pet } from './api';
import { PetPic } from './PetArt';
import { openSkyPets } from './nav';

/** Карточка «Питомцы» в информации о чате: совместные питомцы с этим человеком + переход в Sky Pets. */
export function ChatPetsCard({ peerId, peerName, chatId }: { peerId: string; peerName: string; chatId: string }) {
  const [pets, setPets] = useState<Pet[] | null>(null);
  useEffect(() => { let on = true; const load = () => void sp<{ pets: Pet[] }>(`/with/${encodeURIComponent(peerId)}`).then((r) => on && setPets(r.ok ? r.data.pets : [])); load(); window.addEventListener('sky:skypets', load); return () => { on = false; window.removeEventListener('sky:skypets', load); }; }, [peerId]);
  if (pets === null) return null;
  return (
    <div className="rounded-xl p-3" style={{ background: '#1e1e24' }}>
      <p className="mb-2 text-xs font-semibold" style={{ color: 'var(--t2)' }}>Питомцы вместе</p>
      {pets.length === 0 ? <p className="mb-2 text-xs" style={{ color: 'var(--t2)' }}>Пока нет общих питомцев. Заведите первого — яйцо станет общим после принятия.</p>
        : <div className="mb-2 space-y-2">{pets.map((p) => <button key={p.id} type="button" onClick={() => void openSkyPets({ peerId, peerName, chatId, tab: 'shared' })} className="flex w-full items-center gap-3 rounded-xl p-2 text-left" style={{ background: 'rgba(255,255,255,.06)' }}>
          <PetPic pet={p} size={44} /><div className="min-w-0 flex-1"><div className="truncate text-sm font-semibold" style={{ color: '#fff' }} translate="no">{p.name}</div><div className="text-xs" style={{ color: 'var(--t2)' }}>Уровень {p.level} · {MOOD[p.mood] ?? p.mood}</div></div></button>)}</div>}
      <button type="button" onClick={() => void openSkyPets({ peerId, peerName, chatId, tab: pets.length ? 'shared' : 'eggs' })} className="w-full rounded-xl py-2 text-sm font-semibold" style={{ background: 'rgba(122,92,240,.25)', color: '#d8ccff' }}>{pets.length ? 'Открыть дом питомцев' : 'Завести питомца вместе'}</button>
    </div>
  );
}
