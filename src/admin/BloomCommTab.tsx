/** Админка → «Bloom: сообщества» (право `bloom_communities`): жалобы, поиск, блокировка/разблокировка сообществ с причиной. Содержимое закрытых сообществ администрации не показывается. */
import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { flash } from '@/shared/flash';
import { Box, Btn, Note, K, fieldSty, inp, call, useLoad, type D } from './kit';

export const BloomCommTab = () => {
  const [q, setQ] = useState(''); const [status, setStatus] = useState(''); const [reason, setReason] = useState('');
  const [d, load] = useLoad<D>(`/api/admin/bloom-communities?status=${status}${q ? `&q=${encodeURIComponent(q)}` : ''}`);
  if (!d) return <Loader2 size={16} className="animate-spin" style={{ color: K.t3 }} />;
  const block = async (id: string, on: boolean) => { if (reason.trim().length < 5) return flash('Укажите причину (не короче 5 знаков)'); if (await call(`/api/admin/bloom-communities/${id}/block`, 'POST', { block: on, reason })) { flash(on ? 'Сообщество заблокировано' : 'Сообщество разблокировано'); setReason(''); void load(); } };
  return (
    <div className="space-y-4">
      <Note>Блокировка скрывает сообщество и его посты у всех; содержимое не удаляется, владелец получает уведомление с причиной. Посты закрытых сообществ здесь не показываются.</Note>
      <input className={inp} style={fieldSty} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Причина (для блокировки, разблокировки и решения жалоб)" />
      <Box title={`Жалобы: ${d.reports.length}`}>
        {!(d.reports as D[]).length ? <Note>Открытых жалоб нет.</Note> : (d.reports as D[]).map((r) => (
          <div key={r.id} className="space-y-1 rounded-xl p-3" style={{ background: K.l2 }}><p className="text-sm font-bold" style={{ color: K.t1 }} translate="no">{r.name} <span style={{ color: K.t3 }}>@{r.slug}</span></p><p className="text-xs" style={{ color: K.t2 }}>{r.reason}{r.text ? ` — ${r.text}` : ''}</p>
            <div className="flex flex-wrap gap-2"><Btn tone="red" onClick={() => void block(r.communityId, true)}>Заблокировать сообщество</Btn>
              <Btn tone="plain" onClick={async () => { if (reason.trim().length < 5) return flash('Укажите причину'); if (await call(`/api/admin/bloom-communities/reports/${r.id}`, 'POST', { action: 'dismiss', note: reason })) { setReason(''); void load(); } }}>Жалоба необоснована</Btn></div></div>))}
      </Box>
      <Box title="Сообщества">
        <div className="flex gap-2"><input className={inp} style={fieldSty} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Название или адрес" />
          <select className={inp} style={fieldSty} value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Все</option><option value="reported">С жалобами</option><option value="blocked">Заблокированные</option></select></div>
        {(d.communities as D[]).map((c) => (
          <div key={c.id} className="flex flex-wrap items-center gap-2 rounded-xl p-3" style={{ background: K.l2 }}>
            <span className="min-w-0 flex-1 text-xs" style={{ color: K.t1 }} translate="no">{c.emoji} {c.name} · @{c.slug} · {c.privacy === 'closed' ? 'закрытое' : 'открытое'} · участников {c.members} · постов {c.posts}{c.blocked ? ` · ЗАБЛОКИРОВАНО: ${c.blockReason ?? ''}` : ''}</span>
            {c.blocked ? <Btn tone="plain" onClick={() => void block(c.id, false)}>Разблокировать</Btn> : <Btn tone="red" onClick={() => void block(c.id, true)}>Заблокировать</Btn>}
          </div>))}
      </Box>
    </div>
  );
};
