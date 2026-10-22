/** Карточка человека по QR или нику: видно, кого добавляешь, до самого добавления. */
import { useState } from 'react';
import { UserPlus, UserCheck, Clock, ExternalLink, Loader2 } from 'lucide-react';
import { apiSendFriendRequest } from '@/profile/viewer/friendsApi';
import { openProfile } from '@/profile/viewer/store';
import { flash } from '@/shared/flash';
import type { QrCard } from './qrApi';

export function ContactCard({ card, onDone }: { card: QrCard; onDone?: () => void }) {
  const [friend, setFriend] = useState(card.friend);
  const [busy, setBusy] = useState(false);
  const p = card.profile; const sh = card.shared;
  const add = async () => {
    setBusy(true);
    const r = await apiSendFriendRequest(p.id);
    setBusy(false);
    if (!r) { flash('Не удалось отправить заявку. Попробуйте ещё раз.'); return; }
    setFriend(r.status);
    flash(r.status === 'friends' ? 'Теперь вы в контактах' : 'Заявка отправлена');
  };
  return (
    <div className="space-y-3 rounded-3xl p-4 text-center" style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)' }}>
      <div className="mx-auto grid h-20 w-20 place-items-center overflow-hidden rounded-full text-2xl font-bold" style={{ background: 'linear-gradient(135deg,#6aa9ff,#8b7cff)', color: '#fff' }}>
        {p.avatar ? <img src={p.avatar} alt="" className="h-full w-full object-cover" /> : <span translate="no">{(p.name || p.username || '?').slice(0, 1).toUpperCase()}</span>}
      </div>
      <div>
        <p className="text-lg font-bold" style={{ color: 'var(--t1)' }} translate="no">{p.name}</p>
        <p className="text-sm" style={{ color: 'var(--t3)' }} translate="no">@{p.username}</p>
      </div>
      {(sh.status || sh.bio || sh.country || sh.links?.length) && (
        <div className="space-y-1 rounded-2xl p-3 text-left text-[13px]" style={{ background: 'var(--bg-l3)', color: 'var(--t2)' }}>
          {sh.status && <p translate="no">{sh.status}</p>}
          {sh.bio && <p translate="no">{sh.bio}</p>}
          {sh.country && <p translate="no">{sh.country}</p>}
          {sh.links?.map((l) => <p key={l} className="break-all" translate="no">{l}</p>)}
        </div>
      )}
      {card.self ? <p className="text-sm" style={{ color: 'var(--t3)' }}>Это ваш собственный код.</p> : (
        <div className="flex flex-col gap-2 sm:flex-row">
          <button type="button" disabled={busy || friend === 'friends' || friend === 'pending_out'} onClick={() => void add()}
            className="flex flex-1 items-center justify-center gap-2 rounded-full py-3 text-sm font-bold disabled:opacity-60" style={{ background: 'var(--accent)', color: '#fff', minHeight: 44 }}>
            {busy ? <Loader2 size={15} className="animate-spin" /> : friend === 'friends' ? <UserCheck size={15} /> : friend === 'pending_out' ? <Clock size={15} /> : <UserPlus size={15} />}
            {friend === 'friends' ? 'Уже в контактах' : friend === 'pending_out' ? 'Заявка отправлена' : friend === 'pending_in' ? 'Принять заявку' : 'Добавить в контакты'}
          </button>
          <button type="button" onClick={() => { openProfile(p.id); onDone?.(); }} className="flex flex-1 items-center justify-center gap-2 rounded-full py-3 text-sm font-bold" style={{ background: 'var(--bg-l3)', color: 'var(--t1)', minHeight: 44 }}><ExternalLink size={15} />Открыть профиль</button>
        </div>
      )}
    </div>
  );
}
