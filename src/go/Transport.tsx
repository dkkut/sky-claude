/** Sky GO → «Для транспорта»: блок на странице организации (топливо, удобства, акции, связанные разделы Sky) и «Мои работы» клиента. */
import { useState } from 'react';
import { Fuel, ParkingCircle, Link2, Wrench, ExternalLink } from 'lucide-react';
import { flash } from '@/shared/flash';
import { shareOrigin } from '@/core/nativeApp';
import { tr, type TrWork } from './transportApi';
import { Back, Btn, Card, Chip, Col, Empty, ErrorState, Notice, fail, useAction, useLoad, C, GO, fmt } from './ui';

const ago = (iso: string) => new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
/** Ссылка на организацию. Открывается и в вебе, и в приложении (после входа): `?place=<id>`; в приложениях Android/Windows своя схема ссылок не регистрируется. */
export const placeLink = (id: string) => `${shareOrigin()}/?place=${id}`;

export const TransportInfo = ({ placeId, onOpenApp }: { placeId: string; onOpenApp: (k: 'fuel' | 'parking') => void }) => {
  const [res] = useLoad(() => tr.info(placeId), [placeId]);
  if (!res || !res.ok || !res.data!.transport) return null;
  const d = res.data!;
  return (
    <Col>
      {d.features.length > 0 && <Card><div style={{ fontWeight: 800, marginBottom: 6, color: C.t1 }}>Услуги и удобства</div><div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{d.features.map((f) => <Chip key={f.id}>{f.name}</Chip>)}</div></Card>}
      {d.categoryId === 'fuel' && (
        <Card>
          <div style={{ fontWeight: 800, marginBottom: 6, color: C.t1 }}><Fuel size={15} style={{ verticalAlign: -2 }} /> Топливо и цены</div>
          {d.fuel.length === 0 ? <div style={{ fontSize: 13, color: C.t2 }}>Организация пока не указала цены. Sky цен не знает и не подставляет.</div>
            : d.fuel.map((f) => (
              <div key={f.fuel} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0', fontSize: 14, color: C.t1 }}>
                <span>{f.name}{!f.available && <span style={{ color: '#ef4444', fontSize: 12 }}> · нет в наличии</span>}</span>
                <span><b>{f.priceRub.toFixed(2)} ₽</b> <span style={{ fontSize: 11, color: f.stale ? '#f59e0b' : C.t3 }}>{f.stale ? 'устарела · ' : ''}на {ago(f.updatedAt)}</span></span>
              </div>))}
          <div style={{ fontSize: 11, color: C.t3, marginTop: 6 }}>Цены вносит организация, Sky их не проверяет.</div>
        </Card>)}
      {d.promos.length > 0 && <Card><div style={{ fontWeight: 800, marginBottom: 6, color: C.t1 }}>Акции</div>
        {d.promos.map((p) => <div key={p.id} style={{ padding: '4px 0' }}><div translate="no" style={{ fontWeight: 700, color: C.t1 }}>{p.title}</div>{p.body && <div translate="no" style={{ fontSize: 13, color: C.t2 }}>{p.body}</div>}{p.endsOn && <div style={{ fontSize: 11, color: C.t3 }}>до {p.endsOn.split('-').reverse().join('.')}</div>}</div>)}</Card>}
      <Card>
        <div style={{ fontWeight: 800, marginBottom: 8, color: C.t1 }}>Связанные разделы Sky</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {d.apps.map((a) => <Btn key={a.key} kind="soft" onClick={() => onOpenApp(a.key)}>{a.key === 'fuel' ? <Fuel size={15} /> : <ParkingCircle size={15} />} {a.title}</Btn>)}
          <Btn kind="soft" onClick={() => { void navigator.clipboard?.writeText(placeLink(placeId)).then(() => flash('Ссылка скопирована')); }}><Link2 size={15} /> Ссылка на организацию</Btn>
        </div>
        <div style={{ fontSize: 11, color: C.t3, marginTop: 6 }}>Ссылка откроет эту карточку в Sky после входа (веб, Android и Windows).</div>
      </Card>
    </Col>
  );
};

const ORDER = ['accepted', 'diagnostics', 'awaiting_approval', 'in_work', 'ready', 'issued'];
const Timeline = ({ w }: { w: TrWork }) => (
  <div style={{ marginTop: 8 }}>
    {w.events.map((e, i) => (
      <div key={i} style={{ display: 'flex', gap: 8, fontSize: 12, color: C.t2, padding: '2px 0' }}>
        <span style={{ color: GO }}>●</span><span><b style={{ color: C.t1 }}>{e.label}</b> · {ago(e.at)}{e.comment ? ` — ${e.comment}` : ''}</span>
      </div>))}
  </div>
);

export const MyWork = ({ onBack }: { onBack: () => void }) => {
  const [res, reload] = useLoad(() => tr.myWork(), [], 15000);
  const [busy, run] = useAction();
  const act = (w: TrWork, to: string) => void run(async () => {
    if (to === 'cancelled' && !window.confirm('Отменить работу?')) return;
    const r = await tr.buyerStatus(w.id, to); if (!r.ok) return fail(r); reload();
  });
  return (
    <div>
      <Back onClick={onBack} title="Мои работы" />
      {!res ? <Empty text="Загрузка…" /> : !res.ok ? <ErrorState text="Не удалось загрузить." onRetry={reload} />
        : !res.data!.orders.length ? <Empty text="Работ пока нет" hint="Когда организация примет ваш автомобиль, ход работ появится здесь." />
          : <Col>{res.data!.orders.map((w) => (
            <Card key={w.id}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <div style={{ minWidth: 0 }}><div translate="no" style={{ fontWeight: 800, color: C.t1 }}><Wrench size={14} style={{ verticalAlign: -2 }} /> {w.title}</div>
                  <div translate="no" style={{ fontSize: 12, color: C.t2 }}>{w.placeName}{w.vehicle.model ? ` · ${w.vehicle.model}` : ''}{w.vehicle.plate ? ` · ${w.vehicle.plate}` : ''}</div></div>
                <Chip color={w.status === 'cancelled' ? '#ef4444' : GO}>{w.statusLabel}</Chip>
              </div>
              {w.status !== 'cancelled' && <div style={{ display: 'flex', gap: 3, margin: '8px 0 2px' }}>{ORDER.map((s, i) => <div key={s} style={{ flex: 1, height: 4, borderRadius: 4, background: i <= ORDER.indexOf(w.status) ? GO : C.l2 }} />)}</div>}
              {w.priceRub != null && <div style={{ fontSize: 13, color: C.t1, marginTop: 4 }}>Стоимость: <b>{fmt(w.priceRub)}</b>{w.paidRub > 0 && <> · оплачено {fmt(w.paidRub)}</>} · <span style={{ color: C.t2 }}>{w.payLabel}</span></div>}
              <Timeline w={w} />
              {w.status === 'awaiting_approval' && <Notice tone="warn">Организация просит согласовать работы{w.priceRub != null ? ` на сумму ${fmt(w.priceRub)}` : ''}.</Notice>}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                {w.actions.includes('in_work') && <Btn busy={busy} onClick={() => act(w, 'in_work')}>Согласовать</Btn>}
                {w.actions.includes('cancelled') && <Btn kind="soft" busy={busy} onClick={() => act(w, 'cancelled')}>Отменить</Btn>}
                {w.payUrl && <a href={w.payUrl} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none' }}><Btn kind="soft"><ExternalLink size={14} /> Оплатить организации</Btn></a>}
              </div>
            </Card>))}</Col>}
      <div style={{ fontSize: 11, color: C.t3, marginTop: 10 }}>Оплата — прямой перевод организации по её реквизитам; Sky деньги не принимает. Подтверждает поступление организация.</div>
    </div>
  );
};
