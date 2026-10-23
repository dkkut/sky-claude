/** Карточка музыканта в каталоге Sky Music: статус владения, описание, заявка «Это мой профиль», подсказка при загрузке трека. Сервер: server/artistcards.mjs. */
import { useEffect, useState } from 'react';
import { BadgeCheck, Loader2 } from 'lucide-react';
import { apiCall } from '@/core/auth/api';
import { flash } from '@/shared/flash';

interface Card { id: string; name: string; bio?: string; genres: string[]; autoCreated: boolean; confirmedOwner: boolean; rightsVerified?: boolean; isOwner?: boolean; canClaim?: boolean; myClaim?: string; tracks: number }
const ERR: Record<string, string> = { note_required: 'Опишите, почему карточка ваша (не короче 10 знаков).', no_own_track: 'Заявку подаёт тот, чей трек привязан к карточке.', already_pending: 'Заявка уже на проверке.', already_owned: 'У карточки уже есть владелец.' };
const field = { background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', color: 'var(--t1)' };

/** Блок на странице исполнителя. Ничего не показывает, если карточки ещё нет (её заводят при первой публикации трека). */
export const ArtistCardBlock = ({ name }: { name: string }) => {
  const [c, setC] = useState<Card | null | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState(''); const [links, setLinks] = useState(''); const [err, setErr] = useState('');
  const load = () => apiCall<{ card: Card }>(`/api/music/artist-cards/by-name?name=${encodeURIComponent(name)}`).then((r) => setC(r.ok && r.data ? r.data.card : null));
  useEffect(() => { setC(undefined); void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [name]);
  if (c === undefined) return <Loader2 size={13} className="mx-5 animate-spin" style={{ color: 'var(--t3)' }} />;
  if (!c) return null;
  const send = async () => {
    setErr('');
    const r = await apiCall(`/api/music/artist-cards/${c.id}/claim`, { method: 'POST', body: JSON.stringify({ note, links: links.split(/\s+/).filter(Boolean) }) });
    if (!r.ok) { setErr(ERR[r.error ?? ''] ?? 'Не получилось отправить заявку'); return; }
    flash('Заявка отправлена'); setOpen(false); void load();
  };
  return (
    <div className="mx-5 mb-3 space-y-2 rounded-2xl p-3" style={{ background: 'rgba(255,255,255,0.05)' }} data-artist-card>
      <div className="flex items-center gap-2 text-[12px]" style={{ color: 'var(--t2)' }}>
        {c.confirmedOwner ? <><BadgeCheck size={14} style={{ color: 'var(--accent)' }} />{c.rightsVerified ? 'Карточка подтверждена владельцем, права правообладателя подтверждены' : 'Карточка подтверждена владельцем'}</> : <>Карточка пока не подтверждена музыкантом{c.autoCreated ? ' (создана автоматически по трекам)' : ''}</>}
      </div>
      {c.bio && <p className="text-[12.5px] leading-relaxed" style={{ color: 'var(--t1)' }} translate="no">{c.bio}</p>}
      {c.canClaim && !open && <button type="button" onClick={() => setOpen(true)} className="rounded-xl px-3 py-1.5 text-xs font-bold text-white" style={{ background: 'var(--accent)' }}>Это моя карточка</button>}
      {c.myClaim === 'pending' && <p className="text-[12px]" style={{ color: 'var(--amber, #f59e0b)' }}>Заявка на проверке</p>}
      {open && (
        <div className="space-y-2">
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="Почему это ваша карточка" className="w-full rounded-xl px-3 py-2 text-sm outline-none" style={field} aria-label="Пояснение" />
          <textarea value={links} onChange={(e) => setLinks(e.target.value)} rows={2} placeholder="Ссылки-подтверждения (https://…)" className="w-full rounded-xl px-3 py-2 text-sm outline-none" style={field} aria-label="Ссылки" />
          {err && <p className="text-[12px]" style={{ color: 'var(--red)' }}>{err}</p>}
          <div className="flex gap-2"><button type="button" disabled={note.trim().length < 10} onClick={() => void send()} className="rounded-xl px-4 py-2 text-xs font-bold text-white disabled:opacity-40" style={{ background: 'var(--accent)' }}>Отправить</button>
            <button type="button" onClick={() => setOpen(false)} className="rounded-xl px-4 py-2 text-xs font-bold" style={{ background: 'rgba(255,255,255,0.08)', color: 'var(--t2)' }}>Отмена</button></div>
        </div>)}
    </div>
  );
};

/** Подсказка под полем «Исполнитель» в форме загрузки трека. */
export const ArtistSuggest = ({ name }: { name: string }) => {
  const [s, setS] = useState<{ exact: Card | null; similar: (Card & { match: number })[]; canCreate: boolean } | null>(null);
  useEffect(() => {
    setS(null);
    const q = name.trim();
    if (q.length < 2) return undefined;
    let alive = true;
    const t = setTimeout(() => { void apiCall<NonNullable<typeof s>>(`/api/music/artist-cards/suggest?name=${encodeURIComponent(q)}`).then((r) => { if (alive && r.ok && r.data) setS(r.data); }); }, 500);
    return () => { alive = false; clearTimeout(t); };
  }, [name]);
  if (!s) return null;
  return (
    <div className="mt-1.5 space-y-0.5 text-[11.5px]" style={{ color: 'var(--t3)' }} data-artist-suggest>
      {s.exact ? <p>Трек будет привязан к существующей карточке «{s.exact.name}».</p> : <p>Карточки с таким именем нет — она создастся автоматически, когда вы отправите трек на публикацию.</p>}
      {s.similar.length > 0 && <p style={{ color: 'var(--amber, #f59e0b)' }}>Похоже на: {s.similar.map((x) => x.name).join(', ')}. Проверьте написание, чтобы не плодить дубли.</p>}
    </div>
  );
};
