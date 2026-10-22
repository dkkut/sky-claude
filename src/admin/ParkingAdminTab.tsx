/**
 * Вкладка «Парковки» в админке: очередь проверки (фильтры, поиск, закрепление, решение с причиной), опубликованные, жалобы, организации, сбои.
 * Права: parking_moderation (заявки), parking (организации, сбои). Раньше очередь лежала внутри вкладки «Sky GO» и была недоступна модератору без права go.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiCall } from '@/core/auth/api';
import { flash } from '@/shared/flash';
import { goError } from '@/go/api';

const C = { l1: 'var(--bg-l1)', l2: 'var(--bg-l2)', brd: 'var(--border)', t1: 'var(--t1)', t2: 'var(--t2)', t3: 'var(--t3)', acc: 'var(--accent)', red: 'var(--red)', green: 'var(--green)' };
const box = { background: C.l1, border: `1px solid ${C.brd}`, borderRadius: 14, padding: 12 } as const;
const inp = { background: C.l2, border: `1px solid ${C.brd}`, color: C.t1, borderRadius: 10, padding: '8px 10px', fontSize: 13, minWidth: 0 } as const;
const btn = (bg: string = C.acc, fg = '#fff', off = false) => ({ background: bg, color: fg, border: 'none', borderRadius: 10, padding: '8px 14px', fontSize: 13, fontWeight: 700, cursor: off ? 'default' : 'pointer', opacity: off ? 0.5 : 1, minHeight: 36 }) as const;
const PK = '/api/admin/parking';
const when = (iso: string) => new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
const ACTION: Record<string, string> = { lot_submitted: 'Отправлена на проверку', admin_approve: 'Одобрена', admin_reject: 'Отклонена', admin_suspend: 'Приостановлена', admin_restore: 'Возвращена в черновик', submit_failed: 'Отправка не прошла', lot_updated: 'Изменена', lot_created: 'Создана', tariff_added: 'Добавлен тариф', tariff_updated: 'Изменён тариф', tariff_removed: 'Удалён тариф', lot_closed: 'Закрыта владельцем', lot_reopened: 'Открыта владельцем' };
const bad = (r: { error?: string; hint?: string }) => flash(({ not_allowed: 'Недостаточно прав.', self_review: 'Свою парковку проверять нельзя.', reason_required: 'Укажите причину (от 5 знаков).', bad_state: 'Состояние уже изменилось — обновите список.', claimed_by_other: 'Заявку уже рассматривает другой сотрудник.', not_found: 'Не найдено.' } as Record<string, string>)[r.error ?? ''] ?? goError(r));

type View = 'review' | 'approved' | 'rejected' | 'suspended' | 'reports' | 'orgs' | 'errors';
const LIMIT = 20;

export const ParkingAdminTab = ({ canModerate, canOrgs }: { canModerate: boolean; canOrgs: boolean }) => {
  const [view, setView] = useState<View>(canModerate ? 'review' : 'orgs');
  const [items, setItems] = useState<any[] | null>(null);
  const [total, setTotal] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [q, setQ] = useState(''); const [qd, setQd] = useState('');
  const [kind, setKind] = useState(''); const [from, setFrom] = useState(''); const [to, setTo] = useState(''); const [off, setOff] = useState(0);
  const [open, setOpen] = useState<string | null>(null); const [detail, setDetail] = useState<any>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const seq = useRef(0);
  useEffect(() => { const t = setTimeout(() => { setQd(q.trim()); setOff(0); }, 350); return () => clearTimeout(t); }, [q]);

  const load = useCallback(async () => {
    const my = ++seq.current;
    setItems(null); setErr(null);
    const lotView = ['review', 'approved', 'rejected', 'suspended'].includes(view);
    const params = new URLSearchParams({ status: view, limit: String(LIMIT), offset: String(off), ...(kind ? { kind } : {}), ...(qd ? { q: qd } : {}), ...(from ? { from } : {}), ...(to ? { to } : {}) });
    const url = lotView ? `${PK}/lots?${params}` : view === 'reports' ? `${PK}/reports` : view === 'errors' ? `${PK}/errors` : `${PK}/orgs?q=${encodeURIComponent(qd)}`;
    const r = await apiCall<any>(url);
    if (my !== seq.current) return;                          // устаревший ответ не затирает свежий
    if (!r.ok) { setErr(goError(r)); return setItems([]); }
    const d = r.data; setItems(d.lots ?? d.reports ?? d.orgs ?? d.errors ?? []); setTotal(d.total ?? 0);
  }, [view, kind, qd, from, to, off]);
  useEffect(() => { void load(); }, [load]);

  const act = async (id: string, path: string, body: unknown, ok = 'Готово') => {
    setBusy(id + path);
    try { const r = await apiCall<any>(`${PK}${path}`, { method: 'POST', body: JSON.stringify(body) }); if (!r.ok) { bad(r); void load(); return; } flash(ok); setReason(''); setOpen(null); void load(); }
    finally { setBusy(null); }
  };
  const openDetail = async (id: string) => {
    if (open === id) { setOpen(null); return; }
    setOpen(id); setDetail(null);
    const r = await apiCall<any>(`${PK}/lots/${id}`); if (r.ok) setDetail(r.data); else bad(r);
  };
  const VIEWS: [View, string, boolean][] = [['review', 'На проверке', canModerate], ['approved', 'Опубликованы', canModerate], ['rejected', 'Отклонены', canModerate], ['suspended', 'Приостановлены', canModerate], ['reports', 'Жалобы', canOrgs], ['orgs', 'Организации', canOrgs], ['errors', 'Сбои', canOrgs]];
  const lotView = ['review', 'approved', 'rejected', 'suspended'].includes(view);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{VIEWS.filter((v) => v[2]).map(([k, t]) => <button key={k} type="button" onClick={() => { setView(k); setOff(0); setOpen(null); }} style={btn(view === k ? C.acc : C.l2, view === k ? '#fff' : C.t1)}>{t}</button>)}</div>
      {(lotView || view === 'orgs') && <input aria-label="Поиск" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск: название, адрес, организация, id" style={inp} />}
      {lotView && <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <select aria-label="Тип заявки" value={kind} onChange={(e) => { setKind(e.target.value); setOff(0); }} style={inp}><option value="">Любой тип</option><option value="new">Новые парковки</option><option value="edit">Изменения</option></select>
        <input aria-label="С даты" type="date" value={from} onChange={(e) => { setFrom(e.target.value); setOff(0); }} style={inp} /><input aria-label="По дату" type="date" value={to} onChange={(e) => { setTo(e.target.value); setOff(0); }} style={inp} />
      </div>}
      {(view === 'review' || view === 'approved' || view === 'suspended') && <input aria-label="Причина" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Причина или комментарий (обязательна при отказе и приостановке)" style={inp} />}
      {err && <div role="alert" style={{ ...box, color: C.red, display: 'flex', justifyContent: 'space-between', gap: 8 }}><span>Не удалось загрузить: {err}</span><button type="button" style={btn(C.l2, C.t1)} onClick={() => void load()}>Повторить</button></div>}
      {!items ? <div style={{ color: C.t3 }}>Загрузка…</div> : !err && items.length === 0 ? <div style={{ color: C.t3 }}>{qd || kind || from || to ? 'Ничего не найдено по этим условиям.' : 'Пусто.'}</div> : items.map((x) => (
        <div key={x.id} style={box}>
          {view === 'reports' ? <>
            <div><b>{x.lotTitle}</b> · {x.reason}</div><div style={{ fontSize: 12.5, color: C.t2 }}>{x.note}</div>
            <button type="button" style={btn(C.acc, '#fff', busy === x.id + '/r')} disabled={busy === x.id + '/r'} onClick={() => act(x.id, `/reports/${x.id}/resolve`, { resolution: reason }, 'Жалоба закрыта')}>Закрыть жалобу</button></>
          : view === 'errors' ? <div style={{ fontSize: 12.5 }}><b>{x.scope}</b> · {x.code} · {when(x.at)}<div style={{ color: C.t2 }}>{x.message}</div><div style={{ color: C.t3 }}>{x.org_id ?? ''} {x.lot_id ?? ''}</div></div>
          : view === 'orgs' ? <>
            <div><b>{x.name}</b> · {x.status === 'suspended' ? 'приостановлена' : 'активна'} · парковок: {x.lots}</div><div style={{ fontSize: 12, color: C.t3 }}>{x.id} · владелец {x.ownerId}</div>
            {x.status === 'suspended' ? <button type="button" style={btn()} onClick={() => act(x.id, `/orgs/${x.id}/restore`, {})}>Возобновить</button> : <button type="button" style={btn(C.red)} onClick={() => act(x.id, `/orgs/${x.id}/suspend`, { reason })}>Приостановить</button>}</>
          : <>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
              <div><b translate="no">{x.title}</b> · <span translate="no">{x.orgName}</span></div>
              <span style={{ fontSize: 12, color: C.t3 }}>{x.kind === 'new' ? 'новая парковка' : 'изменение'} · {when(x.updatedAt)}{x.submitter ? ` · @${x.submitter}` : ''}</span></div>
            <div style={{ fontSize: 12.5, color: C.t2 }} translate="no">{x.city}, {x.address} · мест: {x.spacesTotal} · {x.lat != null ? `${x.lat}, ${x.lng}` : 'без точки'}</div>
            <div style={{ fontSize: 12.5, color: C.t2 }}>Тарифы: {x.tariffs.map((t: any) => `${t.kind} ${t.priceRub} ₽`).join('; ') || '—'}</div>
            {x.rejectReason && <div style={{ fontSize: 12.5, color: C.red }}>Причина: {x.rejectReason}</div>}
            {x.claimedBy && !x.mine && <div style={{ fontSize: 12.5, color: C.t3 }}>Сейчас рассматривает другой сотрудник.</div>}
            <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
              <button type="button" style={btn(C.l2, C.t1)} onClick={() => openDetail(x.id)}>{open === x.id ? 'Скрыть' : 'Подробнее и история'}</button>
              {view === 'review' && !x.mine && <button type="button" style={btn(C.l2, C.t1, Boolean(x.claimedBy))} disabled={Boolean(x.claimedBy)} onClick={() => act(x.id, `/lots/${x.id}/claim`, {}, 'Заявка закреплена за вами на 15 минут')}>Взять в работу</button>}
              {view === 'review' && x.mine && <button type="button" style={btn(C.l2, C.t1)} onClick={() => act(x.id, `/lots/${x.id}/release`, {}, 'Заявка снова свободна')}>Отпустить</button>}
              {view === 'review' && <><button type="button" style={btn(C.green, '#fff', busy === x.id + '/a')} disabled={busy === x.id + '/a'} onClick={() => act(x.id, `/lots/${x.id}/approve`, {}, 'Парковка одобрена и опубликована')}>Одобрить</button>
                <button type="button" style={btn(C.red, '#fff', busy === x.id + '/r')} disabled={busy === x.id + '/r'} onClick={() => act(x.id, `/lots/${x.id}/reject`, { reason }, 'Парковка отклонена, владелец получил причину')}>Отклонить</button></>}
              {view === 'approved' && <button type="button" style={btn(C.red)} onClick={() => act(x.id, `/lots/${x.id}/suspend`, { reason })}>Приостановить</button>}
              {view === 'suspended' && <button type="button" style={btn()} onClick={() => act(x.id, `/lots/${x.id}/restore`, {}, 'Парковка возвращена владельцу в черновик')}>Вернуть в черновик</button>}
            </div>
            {open === x.id && <div style={{ marginTop: 8, borderTop: `1px solid ${C.brd}`, paddingTop: 8, fontSize: 12.5 }}>
              {!detail ? 'Загрузка…' : <>
                {detail.lot.description && <div style={{ color: C.t2, marginBottom: 6 }} translate="no">{detail.lot.description}</div>}
                <div style={{ color: C.t3, marginBottom: 4 }}>Часы: {detail.lot.hours || '—'}</div>
                {detail.events.map((e: any) => <div key={e.id} style={{ color: C.t2 }}>{when(e.at)} · {ACTION[e.action] ?? e.action}{e.actor ? ` · @${e.actor}` : ''}{e.detail?.reason ? `: ${e.detail.reason}` : ''}{e.detail?.missing ? `: не хватало ${e.detail.missing.join(', ')}` : ''}</div>)}</>}
            </div>}</>}
        </div>))}
      {lotView && total > LIMIT && <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <button type="button" style={btn(C.l2, C.t1, off <= 0)} disabled={off <= 0} onClick={() => setOff(Math.max(0, off - LIMIT))}>Назад</button>
        <span style={{ fontSize: 12.5, color: C.t3 }}>{off + 1}–{Math.min(total, off + LIMIT)} из {total}</span>
        <button type="button" style={btn(C.l2, C.t1, off + LIMIT >= total)} disabled={off + LIMIT >= total} onClick={() => setOff(off + LIMIT)}>Дальше</button></div>}
      <div style={{ fontSize: 12, color: C.t3 }}>Проверка ручная: реестры организаций и права на площадку Sky не сверяет. Свои парковки проверять нельзя. Решение по заявке фиксируется в журнале, владелец получает уведомление.</div>
    </div>
  );
};
