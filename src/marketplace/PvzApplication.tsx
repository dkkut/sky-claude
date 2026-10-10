/**
 * Sky ПВЗ: заявка на открытие пункта выдачи.
 *
 * Пункты выдачи открывают только ИП и юридические лица с подтверждённым
 * статусом продавца. Здесь — отдельная анкета ПВЗ, документ на
 * помещение и статус проверки; точка заводится только по одобренной
 * заявке. Самозанятым и физлицам экран показывает причину и ведёт в
 * «Проверку» кабинета продавца.
 */
import { useCallback, useEffect, useState } from 'react';
import { Loader2, Store } from 'lucide-react';
import { C, Field, inputStyle, Alert, fmtTime } from './ui';
import {
  apiMyPvzApplication, apiSavePvzApplication, apiSubmitPvzApplication, type MyPvzApplication, type PvzApplicationView,
} from './verifyApi';
import { DocUpload } from './SellerVerification';
import { apiPvzConfig, apiPvzCreate } from './pvzStaffApi';

const STATUS: Record<string, string> = {
  draft: 'Черновик', submitted: 'Отправлена', in_review: 'На проверке', needs_changes: 'Требуются исправления',
  approved: 'Одобрена', rejected: 'Отклонена',
};

export const PvzApplicationFlow = ({ onCreated }: { onCreated: () => void }) => {
  const [my, setMy] = useState<MyPvzApplication | null>(null);
  const [failed, setFailed] = useState(false);
  const load = useCallback(async () => {
    const r = await apiMyPvzApplication();
    if (r.ok) { setMy(r.data); setFailed(false); } else setFailed(true);
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (failed) return <div className="p-4"><Alert text="Не удалось загрузить заявку ПВЗ." /></div>;
  if (!my) return <div className="grid place-items-center p-8"><Loader2 className="animate-spin" style={{ color: C.t3 }} /></div>;

  const app = my.items.find((a) => !a.pvzId) ?? null;

  return (
    <div className="h-full space-y-3 overflow-y-auto p-4">
      <div className="flex items-center gap-2">
        <Store size={18} style={{ color: C.acc }} />
        <p className="text-sm font-bold" style={{ color: C.t1 }}>Открыть пункт выдачи</p>
      </div>
      <p className="text-[11px]" style={{ color: C.t3 }}>
        Заявки на ПВЗ принимаются от ИП и юридических лиц. Заявку проверяют сотрудники Sky вручную; точка
        заводится только после одобрения.
      </p>

      {!my.eligible && <Alert text={my.reason ?? 'Открыть ПВЗ сейчас нельзя.'} />}

      {my.eligible && (!app || app.status === 'draft' || app.status === 'needs_changes' || app.status === 'rejected') && (
        <PvzForm app={app && app.status !== 'rejected' ? app : null} lastRejected={app?.status === 'rejected' ? app : null} onChanged={() => void load()} />
      )}

      {my.eligible && app && (app.status === 'submitted' || app.status === 'in_review') && (
        <div className="rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
          <p className="text-[13px] font-bold" style={{ color: C.t1 }}>{STATUS[app.status]}</p>
          <p className="text-[11px]" style={{ color: C.t2 }}>
            Заявка «<span translate="no">{app.title}</span>» подана {app.submittedAt ? fmtTime(app.submittedAt) : ''}. Мы сообщим о решении здесь.
          </p>
        </div>
      )}

      {my.eligible && app?.status === 'approved' && <CreateFromApplication app={app} onCreated={onCreated} />}

      {my.history.length > 0 && (
        <div className="space-y-1">
          <p className="text-[12px] font-bold" style={{ color: C.t1 }}>История заявки</p>
          {my.history.map((h, i) => (
            <p key={i} className="text-[11px]" style={{ color: C.t2 }}>
              {fmtTime(h.at)} · {h.action}{h.comment && <span style={{ color: C.t3 }} translate="no"> · {h.comment}</span>}
            </p>
          ))}
        </div>
      )}
    </div>
  );
};

const PvzForm = ({ app, lastRejected, onChanged }: { app: PvzApplicationView | null; lastRejected: PvzApplicationView | null; onChanged: () => void }) => {
  const base = app ?? lastRejected;
  const [title, setTitle] = useState(base?.title ?? '');
  const [city, setCity] = useState(base?.city ?? '');
  const [address, setAddress] = useState(base?.address ?? '');
  const [phone, setPhone] = useState(base?.phone ?? '');
  const [contactName, setContactName] = useState(base?.contactName ?? '');
  const [ownership, setOwnership] = useState(base?.premises?.ownership ?? '');
  const [area, setArea] = useState(base?.premises?.areaM2 ? String(base.premises.areaM2) : '');
  const [note, setNote] = useState(base?.premises?.note ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [saved, setSaved] = useState<PvzApplicationView | null>(app);

  const save = async () => {
    setBusy(true); setError(''); setMsg('');
    const r = await apiSavePvzApplication({
      title, city, address, phone, contactName, premises: { ownership, areaM2: Number(area) || 0, note },
    });
    setBusy(false);
    if (!r.ok) { setError(r.error === 'pvz_needs_ip_or_legal' ? 'ПВЗ открывают только ИП и юридические лица.' : (r.reason ?? 'Не сохранилось.')); return null; }
    setSaved(r.data.application); onChanged();
    return r.data.application;
  };

  const submit = async () => {
    const a = await save();
    if (!a) return;
    setBusy(true);
    const r = await apiSubmitPvzApplication();
    setBusy(false);
    if (!r.ok) { setError((r.data?.problems ?? []).map((p: { message: string }) => p.message).join(' ') || (r.reason ?? 'Не отправилось.')); return; }
    setMsg('Заявка отправлена на проверку.'); onChanged();
  };

  const ref = saved?.id;
  return (
    <div className="space-y-3">
      {lastRejected && (
        <Alert text={`Прошлая заявка отклонена: ${lastRejected.rejectReason || 'без пояснения'}. Исправьте данные и подайте заново.`} />
      )}
      {app?.status === 'needs_changes' && (
        <div className="rounded-xl p-3 text-[12px]" style={{ background: C.l2, color: C.t1 }} translate="no">
          {app.adminComment && <p>Комментарий: {app.adminComment}</p>}
          {app.missing.length > 0 && <ul className="ml-4 list-disc">{app.missing.map((m) => <li key={m}>{m}</li>)}</ul>}
        </div>
      )}
      <Field label="Название пункта"><input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} className="w-full rounded-xl px-3 py-2 text-[12px]" style={inputStyle} /></Field>
      <Field label="Город"><input value={city} onChange={(e) => setCity(e.target.value)} maxLength={80} className="w-full rounded-xl px-3 py-2 text-[12px]" style={inputStyle} /></Field>
      <Field label="Адрес"><input value={address} onChange={(e) => setAddress(e.target.value)} maxLength={300} className="w-full rounded-xl px-3 py-2 text-[12px]" style={inputStyle} /></Field>
      <Field label="Телефон"><input value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={40} className="w-full rounded-xl px-3 py-2 text-[12px]" style={inputStyle} /></Field>
      <Field label="Контактное лицо"><input value={contactName} onChange={(e) => setContactName(e.target.value)} maxLength={120} className="w-full rounded-xl px-3 py-2 text-[12px]" style={inputStyle} /></Field>
      <Field label="Помещение">
        <select value={ownership} onChange={(e) => setOwnership(e.target.value)} className="w-full rounded-xl px-3 py-2 text-[12px]" style={inputStyle}>
          <option value="">Выберите</option><option value="own">В собственности</option><option value="rent">В аренде</option>
        </select>
      </Field>
      <Field label="Площадь, м²"><input value={area} inputMode="numeric" onChange={(e) => setArea(e.target.value.replace(/\D/g, ''))} className="w-full rounded-xl px-3 py-2 text-[12px]" style={inputStyle} /></Field>
      <Field label="О помещении и режиме работы"><textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={500} className="w-full rounded-xl px-3 py-2 text-[12px]" style={inputStyle} /></Field>

      {ref ? (
        <DocUpload scope="pvz" refId={ref} type="premises_doc" label="Документ на помещение (право пользования)" docs={saved?.docs ?? []}
          onChanged={() => { void save(); onChanged(); }} />
      ) : (
        <p className="text-[11px]" style={{ color: C.t3 }}>Сохраните черновик, чтобы приложить документ на помещение.</p>
      )}

      {error && <Alert text={error} />}
      {msg && <Alert kind="info" text={msg} />}
      <div className="flex gap-2">
        <button type="button" disabled={busy} onClick={() => void save().then((a) => a && setMsg('Черновик сохранён.'))}
          className="flex-1 rounded-xl py-2.5 text-[12px] font-bold disabled:opacity-40" style={{ background: C.l2, color: C.t1, border: `1px solid ${C.brd}` }}>
          Сохранить черновик
        </button>
        <button type="button" disabled={busy} onClick={() => void submit()}
          className="flex-1 rounded-xl py-2.5 text-[12px] font-bold disabled:opacity-40" style={{ background: C.acc, color: '#fff' }}>
          Отправить на проверку
        </button>
      </div>
    </div>
  );
};

const CreateFromApplication = ({ app, onCreated }: { app: PvzApplicationView; onCreated: () => void }) => {
  const [cells, setCells] = useState('10');
  const [price, setPrice] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { void apiPvzConfig().then((r) => { if (r.ok && r.data) setPrice(r.data.subscriptionPrice); }); }, []);

  const create = async () => {
    setBusy(true); setError('');
    const r = await apiPvzCreate({ applicationId: app.id, cellCount: Number(cells) || 0 });
    setBusy(false);
    if (!r.ok) { setError(r.reason ?? 'Не получилось завести точку'); return; }
    onCreated();
  };

  return (
    <div className="space-y-3 rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.green}` }}>
      <p className="text-[13px] font-bold" style={{ color: C.t1 }}>Заявка одобрена</p>
      <p className="text-[12px]" style={{ color: C.t2 }} translate="no">{app.title} · {app.city}, {app.address}</p>
      <p className="text-[11px]" style={{ color: C.t3 }}>
        Точка сразу видна вам в кабинете, но в публичный каталог не попадёт, пока не оплачена активация
        {price != null ? ` — ${price} ₽/мес` : ''}. Оплата спишется с кошелька Sky.
      </p>
      <Field label="Сколько ячеек завести сразу">
        <input value={cells} onChange={(e) => setCells(e.target.value.replace(/\D/g, ''))} inputMode="numeric" className="w-full rounded-xl px-3 py-2 text-[12px]" style={inputStyle} />
      </Field>
      {error && <Alert text={error} />}
      <button type="button" disabled={busy} onClick={() => void create()}
        className="w-full rounded-xl py-3 text-[13px] font-bold disabled:opacity-40" style={{ background: C.acc, color: '#fff' }}>
        {busy ? 'Заводим…' : 'Завести точку'}
      </button>
    </div>
  );
};
