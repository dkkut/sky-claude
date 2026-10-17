/** Админка → «Верификация»: очередь заявок, решения (причина обязательна при отказе и снятии), история, критерии, «Официальный» (только владелец). Сервер: server/skymarks.mjs, право `verification`. */
import { useCallback, useEffect, useState } from 'react';
import { Loader2, BadgeCheck } from 'lucide-react';
import { apiCall } from '@/core/auth/api';
import { flash } from '@/shared/flash';

interface Item { id: string; subjectType: string; subjectId: string; mark: string; status: string; createdAt: string; decidedAt?: string; note?: string; links?: string[]; reason?: string; requestedBy?: string;
  subject?: { title?: string; handle?: string; members?: number; videos?: number; ownerId?: string }; problems?: string[] }
interface Hist { event: string; actor?: string; reason?: string; at: string }
interface Settings { enabled: boolean; minAccountDays: number; requireEmail: boolean; minMembers: number; minVideos: number; retryDays: number; criteriaText: string }
interface Overview { items: Item[]; stats: Record<string, number>; settings: Settings }

const C = { l1: 'var(--bg-l1)', l2: 'var(--bg-l2)', brd: 'var(--border)', t1: 'var(--t1)', t2: 'var(--t2)', t3: 'var(--t3)', acc: 'var(--accent)', red: 'var(--red)', green: 'var(--green)' };
const field = { background: C.l2, border: `1px solid ${C.brd}`, color: C.t1 };
const TYPE: Record<string, string> = { user: 'Пользователь', chat_group: 'Группа', chat_channel: 'Канал', video_channel: 'Видеоканал', official: 'Официальный' };
const EVENT: Record<string, string> = { requested: 'Заявка подана', approved: 'Подтверждено', rejected: 'Отклонено', revoked: 'Отметка снята', withdrawn: 'Заявка отозвана', official_granted: 'Выдан статус «Официальный»' };
const ERR: Record<string, string> = { reason_required: 'Укажите причину (не короче 5 знаков).', self_review: 'Нельзя решать заявку на себя или на свой объект.', not_pending: 'Заявка уже решена.', owner_only: 'Только владелец сервиса.', not_allowed: 'Недостаточно прав.' };

const Detail = ({ id, onDone }: { id: string; onDone: () => void }) => {
  const [d, setD] = useState<{ item: Item; history: Hist[] } | null>(null);
  const [reason, setReason] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => { void apiCall<{ item: Item; history: Hist[] }>(`/api/admin/verification/${id}`).then((r) => { if (r.ok && r.data) setD(r.data); }); }, [id]);
  const act = async (path: 'decide' | 'revoke', approve?: boolean) => {
    setBusy(true);
    const r = await apiCall(`/api/admin/verification/${id}/${path}`, { method: 'POST', body: JSON.stringify({ approve, reason }) });
    setBusy(false);
    if (!r.ok) { flash(ERR[r.error ?? ''] ?? 'Не получилось'); return; }
    flash('Готово'); onDone();
  };
  if (!d) return <Loader2 size={14} className="animate-spin" />;
  const it = d.item;
  return (
    <div className="space-y-3 rounded-2xl p-4" style={{ background: C.l1, border: `1px solid ${C.brd}` }} data-ver-detail>
      <p className="text-sm font-bold" style={{ color: C.t1 }} translate="no">{it.subject?.title} <span className="font-normal" style={{ color: C.t3 }}>{it.subject?.handle}</span></p>
      <p className="text-[12px]" style={{ color: C.t2 }}>{TYPE[it.subjectType]}{it.subject?.members != null ? ` · участников: ${it.subject.members}` : ''}{it.subject?.videos != null ? ` · видео: ${it.subject.videos}` : ''}</p>
      {it.note && <p className="whitespace-pre-wrap rounded-xl p-3 text-[12.5px]" style={{ background: C.l2, color: C.t1 }} translate="no">{it.note}</p>}
      {!!it.links?.length && <ul className="space-y-0.5 text-[12px]">{it.links.map((l) => <li key={l}><a href={l} target="_blank" rel="noopener noreferrer nofollow" className="underline" style={{ color: C.acc }}>{l}</a></li>)}</ul>}
      {!!it.problems?.length && <p className="text-[12px]" style={{ color: C.red }}>Сейчас не выполнено: {it.problems.join('; ')}</p>}
      <ul className="space-y-0.5 text-[11.5px]" style={{ color: C.t3 }}>{d.history.map((h, i) => <li key={i}>{new Date(h.at).toLocaleString()} — {EVENT[h.event] ?? h.event}{h.actor ? ` (${h.actor})` : ''}{h.reason ? `: ${h.reason}` : ''}</li>)}</ul>
      {(it.status === 'pending' || it.status === 'approved') && (
        <>
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={it.status === 'pending' ? 'Причина (обязательна при отказе)' : 'Причина снятия'} className="w-full rounded-xl px-3 py-2 text-sm outline-none" style={field} aria-label="Причина" />
          <div className="flex flex-wrap gap-2">
            {it.status === 'pending' && <button type="button" disabled={busy} onClick={() => void act('decide', true)} className="rounded-xl px-4 py-2 text-xs font-bold text-white disabled:opacity-50" style={{ background: C.green }}>Подтвердить</button>}
            {it.status === 'pending' && <button type="button" disabled={busy} onClick={() => void act('decide', false)} className="rounded-xl px-4 py-2 text-xs font-bold text-white disabled:opacity-50" style={{ background: C.red }}>Отклонить</button>}
            {it.status === 'approved' && <button type="button" disabled={busy} onClick={() => void act('revoke')} className="rounded-xl px-4 py-2 text-xs font-bold text-white disabled:opacity-50" style={{ background: C.red }}>Снять отметку</button>}
          </div>
        </>
      )}
    </div>
  );
};

export const VerificationTab = () => {
  const [ov, setOv] = useState<Overview | null>(null);
  const [status, setStatus] = useState('pending');
  const [sel, setSel] = useState<string | null>(null);
  const [err, setErr] = useState<string>();
  const [form, setForm] = useState<Settings | null>(null);
  const [off, setOff] = useState({ subjectType: 'user', subjectId: '', reason: '' });
  const load = useCallback(async () => {
    const r = await apiCall<Overview>(`/api/admin/verification?status=${status}`);
    if (!r.ok || !r.data) { setErr(r.error === 'not_allowed' ? 'Недостаточно прав.' : (r.reason ?? 'Не удалось загрузить')); return; }
    setErr(undefined); setOv(r.data); setForm((f) => f ?? r.data!.settings);
  }, [status]);
  useEffect(() => { void load(); }, [load]);

  if (err) return <p className="text-sm" style={{ color: C.red }}>{err}</p>;
  if (!ov || !form) return <p className="flex items-center gap-2 text-sm" style={{ color: C.t3 }}><Loader2 size={14} className="animate-spin" /> Загрузка…</p>;
  const num = (v: string) => Math.max(0, Math.floor(Number(v) || 0));
  const saveSettings = async () => {
    const r = await apiCall('/api/admin/verification/settings', { method: 'PUT', body: JSON.stringify(form) });
    flash(r.ok ? 'Сохранено' : 'Не удалось сохранить'); void load();
  };
  const grant = async () => {
    const r = await apiCall('/api/admin/verification/official', { method: 'POST', body: JSON.stringify(off) });
    flash(r.ok ? 'Статус «Официальный» выдан' : (ERR[r.error ?? ''] ?? 'Не получилось')); if (r.ok) void load();
  };
  return (
    <div className="space-y-4">
      <p className="flex items-center gap-2 text-sm font-bold" style={{ color: C.t1 }}><BadgeCheck size={16} style={{ color: C.acc }} />Верификация</p>
      <p className="text-[12.5px]" style={{ color: C.t2 }}>Проверка ручная; государственные реестры не подключены. Отказ и снятие отметки — только с причиной, она видна заявителю. Все решения пишутся в историю и журнал администрации.</p>
      <div className="flex flex-wrap gap-2">
        {(['pending', 'approved', 'rejected', 'revoked', 'all'] as const).map((s) => (
          <button key={s} type="button" onClick={() => { setStatus(s); setSel(null); }} className="rounded-xl px-3 py-1.5 text-xs font-bold" style={status === s ? { background: C.acc, color: '#fff' } : { background: C.l2, color: C.t2 }}>
            {{ pending: 'Ожидают', approved: 'Подтверждены', rejected: 'Отклонены', revoked: 'Сняты', all: 'Все' }[s]}{ov.stats[s] != null ? ` · ${ov.stats[s]}` : ''}
          </button>))}
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <ul className="space-y-2">
          {ov.items.map((i) => (
            <li key={i.id}><button type="button" onClick={() => setSel(i.id)} className="w-full rounded-xl p-3 text-left" style={{ background: sel === i.id ? C.l2 : C.l1, border: `1px solid ${C.brd}` }}>
              <p className="truncate text-[13px] font-semibold" style={{ color: C.t1 }} translate="no">{i.subject?.title ?? i.subjectId}</p>
              <p className="text-[11px]" style={{ color: C.t3 }}>{TYPE[i.subjectType]} · {new Date(i.createdAt).toLocaleDateString()} · {i.status}</p>
            </button></li>))}
          {!ov.items.length && <li className="py-6 text-center text-[12.5px]" style={{ color: C.t3 }}>Заявок нет</li>}
        </ul>
        <div>{sel && <Detail key={sel} id={sel} onDone={() => { setSel(null); void load(); }} />}</div>
      </div>

      <section className="space-y-3 rounded-2xl p-4" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
        <p className="text-sm font-bold" style={{ color: C.t1 }}>Критерии и приём заявок</p>
        <label className="flex items-center gap-2 text-[12.5px]" style={{ color: C.t2 }}><input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />Принимать заявки</label>
        <div className="grid gap-2 sm:grid-cols-2">
          {([['minAccountDays', 'Возраст аккаунта, дней'], ['minMembers', 'Участников в группе/канале'], ['minVideos', 'Опубликованных видео'], ['retryDays', 'Повторная заявка после отказа, дней']] as const).map(([k, l]) => (
            <label key={k} className="block text-[12px]" style={{ color: C.t2 }}>{l}
              <input inputMode="numeric" value={String(form[k])} onChange={(e) => setForm({ ...form, [k]: num(e.target.value.replace(/\D/g, '')) })} className="mt-1 w-full rounded-lg px-2.5 py-1.5 text-sm outline-none" style={field} aria-label={l} /></label>))}
        </div>
        <label className="flex items-center gap-2 text-[12.5px]" style={{ color: C.t2 }}><input type="checkbox" checked={form.requireEmail} onChange={(e) => setForm({ ...form, requireEmail: e.target.checked })} />Нужна подтверждённая почта</label>
        <textarea value={form.criteriaText} onChange={(e) => setForm({ ...form, criteriaText: e.target.value })} rows={5} className="w-full rounded-xl px-3 py-2 text-sm outline-none" style={field} aria-label="Критерии (видны заявителю, по строке на пункт)" />
        <button type="button" onClick={() => void saveSettings()} className="rounded-xl px-4 py-2 text-xs font-bold text-white" style={{ background: C.acc }}>Сохранить</button>
      </section>

      <section className="space-y-2 rounded-2xl p-4" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
        <p className="text-sm font-bold" style={{ color: C.t1 }}>Статус «Официальный» (только владелец сервиса)</p>
        <div className="flex flex-wrap gap-2">
          <select value={off.subjectType} onChange={(e) => setOff({ ...off, subjectType: e.target.value })} className="rounded-lg px-2 py-1.5 text-sm" style={field} aria-label="Тип объекта">
            {Object.entries(TYPE).filter(([k]) => k !== 'official').map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <input value={off.subjectId} onChange={(e) => setOff({ ...off, subjectId: e.target.value.trim() })} placeholder="Идентификатор объекта" className="min-w-0 flex-1 rounded-lg px-2.5 py-1.5 text-sm outline-none" style={field} aria-label="Идентификатор объекта" />
        </div>
        <input value={off.reason} onChange={(e) => setOff({ ...off, reason: e.target.value })} placeholder="Причина (запишется в историю)" className="w-full rounded-lg px-2.5 py-1.5 text-sm outline-none" style={field} aria-label="Причина" />
        <button type="button" onClick={() => void grant()} disabled={!off.subjectId || off.reason.trim().length < 5} className="rounded-xl px-4 py-2 text-xs font-bold text-white disabled:opacity-40" style={{ background: C.acc }}>Выдать</button>
      </section>
    </div>
  );
};
