/**
 * Вкладка «Контент»: модерация и снятие материалов (музыка, кино, книги).
 * Очередь заявок на публикацию, поиск по каталогу, снятие с обязательной причиной
 * (в том числе по обращению правообладателя). Автор получает уведомление, действие
 * попадает в журнал администрации. Сервер — server/contentmod.mjs.
 */
import { useCallback, useEffect, useState } from 'react';
import { Check, X, Trash2, Search, Loader2, Music2, Film, BookOpen, Undo2 } from 'lucide-react';
import { apiCall } from '@/core/auth/api';
import { flash } from '@/shared/flash';
import { licenseOf } from '@/music/licenses';

type Kind = 'music' | 'movie' | 'book';
interface Item { kind: Kind; id: string; title: string; status: string; ownerId: string | null; ownerName: string | null; license?: string; views: number; createdAt: string | null }

interface TrashItem { trashId: number; kind: Kind; id: string; title: string; reason: string; ownerName: string | null; byName: string | null; deletedAt: string; purgeAt: string }

const KIND_LABEL: Record<Kind, string> = { music: 'Музыка', movie: 'Кино', book: 'Книги' };
const KIND_ICON = { music: Music2, movie: Film, book: BookOpen };
const STATUS_LABEL: Record<string, string> = { pending: 'на проверке', published: 'в каталоге', private: 'личное', rejected: 'отклонено' };

const C = { l1: 'var(--bg-l1)', l2: 'var(--bg-l2)', brd: 'var(--border)', t1: 'var(--t1)', t2: 'var(--t2)', t3: 'var(--t3)', acc: 'var(--accent)', red: 'var(--red)', green: 'var(--green)' };
const field = { background: C.l2, border: `1px solid ${C.brd}`, color: C.t1 };

const ERR: Record<string, string> = {
  reason_required: 'Укажите причину (не короче 3 символов).', not_allowed: 'Недостаточно прав.', not_found: 'Материал уже удалён.',
  already_trashed: 'Материал уже в корзине.', not_pending: 'Заявка уже рассмотрена.', too_many_requests: 'Слишком часто. Подождите минуту.',
};

export const ContentModTab = () => {
  const [kind, setKind] = useState<'all' | Kind>('all');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'' | 'published' | 'private' | 'rejected' | 'pending'>('published');
  const [trash, setTrash] = useState<TrashItem[] | null>(null);
  const [queue, setQueue] = useState<Item[] | null>(null);
  const [found, setFound] = useState<Item[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const loadQueue = useCallback(async () => {
    const r = await apiCall<{ items: Item[] }>('/api/admin/content/queue');
    setQueue(r.ok ? (r.data?.items ?? []) : []);
  }, []);
  const search = useCallback(async () => {
    const p = new URLSearchParams();
    if (kind !== 'all') p.set('kind', kind);
    if (q.trim()) p.set('q', q.trim());
    if (status) p.set('status', status);
    const r = await apiCall<{ items: Item[] }>(`/api/admin/content/search?${p}`);
    setFound(r.ok ? (r.data?.items ?? []) : []);
    if (!r.ok) flash(ERR[r.error ?? ''] ?? 'Не удалось выполнить поиск');
  }, [kind, q, status]);

  const loadTrash = useCallback(async () => {
    const r = await apiCall<{ items: TrashItem[] }>('/api/admin/content/trash');
    setTrash(r.ok ? (r.data?.items ?? []) : []);
  }, []);
  useEffect(() => { void loadTrash(); }, [loadTrash]);
  const restore = async (t: TrashItem) => {
    setBusy(String(t.trashId));
    const r = await apiCall(`/api/admin/content/trash/${t.trashId}/restore`, { method: 'POST', body: '{}' });
    setBusy(null);
    if (!r.ok) { flash(ERR[r.error ?? ''] ?? 'Не удалось вернуть'); return; }
    flash('Материал возвращён.');
    void loadTrash(); void loadQueue(); void search();
  };
  useEffect(() => { void loadQueue(); }, [loadQueue]);
  useEffect(() => { const t = setTimeout(() => void search(), 250); return () => clearTimeout(t); }, [search]);

  const decide = async (it: Item, approve: boolean) => {
    let reason = '';
    if (!approve) {
      reason = (window.prompt(`Причина отклонения «${it.title}» (её увидит автор):`) ?? '').trim();
      if (reason.length < 3) { if (reason) flash(ERR.reason_required); return; }
    }
    setBusy(it.id);
    const r = await apiCall(`/api/admin/content/${it.kind}/${encodeURIComponent(it.id)}/decide`, { method: 'POST', body: JSON.stringify({ approve, reason }) });
    setBusy(null);
    if (!r.ok) { flash(ERR[r.error ?? ''] ?? 'Не удалось сохранить решение'); return; }
    void loadQueue(); void search();
  };

  const takedown = async (it: Item) => {
    const reason = (window.prompt(`Снять «${it.title}» с платформы? Он 7 дней полежит в корзине, потом будет стёрт. Укажите причину (её увидит автор):`) ?? '').trim();
    if (reason.length < 3) { if (reason) flash(ERR.reason_required); return; }
    setBusy(it.id);
    const r = await apiCall(`/api/admin/content/${it.kind}/${encodeURIComponent(it.id)}`, { method: 'DELETE', body: JSON.stringify({ reason }) });
    setBusy(null);
    if (!r.ok) { flash(ERR[r.error ?? ''] ?? 'Не удалось удалить'); return; }
    flash('Материал снят и лежит в корзине 7 дней, автору отправлено уведомление.');
    void loadQueue(); void search(); void loadTrash();
  };

  const Row = ({ it, inQueue }: { it: Item; inQueue?: boolean }) => {
    const Icon = KIND_ICON[it.kind];
    return (
      <div className="flex items-center gap-2 rounded-2xl p-2.5" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl" style={{ background: C.l2 }}><Icon size={16} style={{ color: C.t2 }} /></span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12.5px] font-semibold" style={{ color: C.t1 }} translate="no">{it.title}</p>
          <p className="truncate text-[10.5px]" style={{ color: C.t3 }}>
            <span translate="no">{it.ownerName ? `@${it.ownerName}` : 'без владельца'}</span> · {STATUS_LABEL[it.status] ?? it.status}
            {it.license && it.license !== 'own' ? ` · ${licenseOf(it.license).short}` : ''} · {KIND_LABEL[it.kind]}
          </p>
        </div>
        {busy === it.id ? <Loader2 size={16} className="animate-spin" style={{ color: C.t3 }} /> : (
          <div className="flex shrink-0 items-center gap-1">
            {it.status === 'pending' && (<>
              <button type="button" aria-label="Одобрить" onClick={() => void decide(it, true)} className="grid h-8 w-8 place-items-center rounded-full" style={{ background: 'rgba(34,197,94,0.15)', color: C.green }}><Check size={15} /></button>
              <button type="button" aria-label="Отклонить" onClick={() => void decide(it, false)} className="grid h-8 w-8 place-items-center rounded-full" style={{ background: 'rgba(239,68,68,0.12)', color: C.red }}><X size={15} /></button>
            </>)}
            {!inQueue && <button type="button" aria-label="Удалить" onClick={() => void takedown(it)} className="grid h-8 w-8 place-items-center rounded-full" style={{ background: 'rgba(239,68,68,0.12)', color: C.red }}><Trash2 size={14} /></button>}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <section className="space-y-2">
        <p className="text-[11px] font-bold" style={{ color: C.t3 }}>ЗАЯВКИ НА ПУБЛИКАЦИЮ{queue ? ` · ${queue.length}` : ''}</p>
        {queue === null && <Loader2 size={16} className="animate-spin" style={{ color: C.t3 }} />}
        {queue?.length === 0 && <p className="text-[12px]" style={{ color: C.t3 }}>Очередь пуста.</p>}
        {queue?.map((it) => <Row key={`${it.kind}-${it.id}`} it={it} inQueue />)}
      </section>

      <section className="space-y-2">
        <p className="text-[11px] font-bold" style={{ color: C.t3 }}>КАТАЛОГ: ПОИСК И УДАЛЕНИЕ</p>
        <div className="flex flex-wrap gap-1.5">
          {(['all', 'music', 'movie', 'book'] as const).map((k) => (
            <button key={k} type="button" onClick={() => setKind(k)} className="rounded-xl px-3 py-1.5 text-[11px] font-semibold"
              style={{ background: kind === k ? C.acc : C.l2, color: kind === k ? '#fff' : C.t3 }}>{k === 'all' ? 'Всё' : KIND_LABEL[k]}</button>
          ))}
          <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className="rounded-xl px-2 py-1.5 text-[11px]" style={field}>
            <option value="">любой статус</option><option value="published">в каталоге</option><option value="pending">на проверке</option><option value="private">личное</option><option value="rejected">отклонено</option>
          </select>
        </div>
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: C.t3 }} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Название, исполнитель, автор или идентификатор" className="w-full rounded-full py-2 pl-9 pr-3 text-[12.5px] outline-none" style={field} />
        </div>
        {found === null && <Loader2 size={16} className="animate-spin" style={{ color: C.t3 }} />}
        {found?.length === 0 && <p className="text-[12px]" style={{ color: C.t3 }}>Ничего не найдено.</p>}
        {found?.map((it) => <Row key={`${it.kind}-${it.id}`} it={it} />)}
        <p className="text-[10.5px] leading-snug" style={{ color: C.t3 }}>
          Снятый материал сразу пропадает из каталога, но 7 дней лежит в корзине — его можно вернуть; потом запись и файлы стираются. Автор получает уведомление с причиной, действие записывается в журнал. Сами по себе файлы не удаляются.
          Обращения правообладателей приходят в «Тех. поддержку».
        </p>
      </section>

      <section className="space-y-2">
        <p className="text-[11px] font-bold" style={{ color: C.t3 }}>КОРЗИНА · РЕЗЕРВ 7 ДНЕЙ{trash ? ` · ${trash.length}` : ''}</p>
        {trash?.length === 0 && <p className="text-[12px]" style={{ color: C.t3 }}>Корзина пуста.</p>}
        {trash?.map((t) => (
          <div key={t.trashId} className="flex items-center gap-2 rounded-2xl p-2.5" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[12.5px] font-semibold" style={{ color: C.t1 }} translate="no">{t.title}</p>
              <p className="truncate text-[10.5px]" style={{ color: C.t3 }}>
                {KIND_LABEL[t.kind]} · <span translate="no">{t.ownerName ? `@${t.ownerName}` : 'без владельца'}</span> · будет стёрт {new Date(t.purgeAt).toLocaleDateString()} · <span translate="no">{t.reason}</span>
              </p>
            </div>
            {busy === String(t.trashId) ? <Loader2 size={16} className="animate-spin" style={{ color: C.t3 }} /> : (
              <button type="button" aria-label="Вернуть" onClick={() => void restore(t)} className="grid h-8 w-8 shrink-0 place-items-center rounded-full" style={{ background: 'rgba(34,197,94,0.15)', color: C.green }}><Undo2 size={15} /></button>
            )}
          </div>
        ))}
      </section>
    </div>
  );
};