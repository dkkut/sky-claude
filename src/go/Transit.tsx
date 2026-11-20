/** Sky GO → «Билеты на проезд»: каталог перевозчиков, покупка (прямой перевод перевозчику), мои билеты с QR, который обновляется каждые 30 секунд, возврат. */
import { useCallback, useEffect, useState } from 'react';
import { Bus, QrCode, ExternalLink } from 'lucide-react';
import { flash } from '@/shared/flash';
import { visibleTick } from '@/shared/visibleTick';
import { qrSvg } from '@/kassabiz/qr';
import { transit, transitErr, type TOperator, type TTicket } from './transitApi';
import { Back, Btn, Card, Chip, Col, Empty, ErrorState, Notice, Segmented, useAction, useLoad, C, GO, fmt } from './ui';

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');

/** QR с токеном, который меняется: скриншот через полминуты бесполезен. */
const TicketQr = ({ id }: { id: string }) => {
  const [svg, setSvg] = useState(''); const [err, setErr] = useState('');
  useEffect(() => {
    let alive = true; let timer = 0;
    const tick = async () => {
      const r = await transit.token(id); if (!alive) return;
      if (!r.ok) { setErr(transitErr(r)); setSvg(''); return; }
      setErr(''); setSvg(await qrSvg(r.data!.token, 240, false));
      timer = window.setTimeout(() => void tick(), Math.max(3, r.data!.refreshSec - 2) * 1000);
    };
    void tick();
    const vis = visibleTick(() => { window.clearTimeout(timer); void tick(); });
    document.addEventListener('visibilitychange', vis);
    return () => { alive = false; window.clearTimeout(timer); document.removeEventListener('visibilitychange', vis); };
  }, [id]);
  if (err) return <Notice tone="warn">{err}</Notice>;
  return svg ? <div style={{ display: 'grid', placeItems: 'center', padding: 12, background: '#fff', borderRadius: 16 }}><div style={{ width: 220 }} dangerouslySetInnerHTML={{ __html: svg }} /></div> : <Empty text="Загрузка…" />;
};

const TicketCard = ({ t, onChanged }: { t: TTicket; onChanged: () => void }) => {
  const [show, setShow] = useState(false); const [busy, run] = useAction();
  const act = (fn: () => Promise<{ ok: boolean; error?: string }>, msg: string) => void run(async () => { const r = await fn(); if (!r.ok) return flash(transitErr(r)); flash(msg); onChanged(); });
  const live = t.status === 'active';
  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ minWidth: 0 }}><div translate="no" style={{ fontWeight: 800, color: C.t1 }}>{t.name}</div><div translate="no" style={{ fontSize: 12, color: C.t2 }}>{t.operator} · {fmt(t.priceRub)}</div></div>
        <Chip color={live ? '#22c55e' : t.status === 'awaiting_payment' || t.status === 'refund_requested' ? '#f59e0b' : '#6b7280'}>{t.statusLabel}</Chip>
      </div>
      {live && <div style={{ fontSize: 12.5, color: C.t2, marginTop: 4 }}>Действует до {when(t.validUntil)}{t.ridesLeft != null ? ` · осталось поездок: ${t.ridesLeft}` : ''}</div>}
      {live && <div style={{ marginTop: 8 }}>{show ? <TicketQr id={t.id} /> : <Btn onClick={() => setShow(true)}><QrCode size={16} /> Показать QR</Btn>}</div>}
      {t.status === 'awaiting_payment' && <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
        {t.payUrl && <a href={t.payUrl} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none' }}><Btn><ExternalLink size={14} /> Оплатить перевозчику</Btn></a>}
        <Btn kind="soft" busy={busy} onClick={() => act(() => transit.cancel(t.id), 'Билет отменён')}>Отменить</Btn></div>}
      {t.canRefund && <div style={{ marginTop: 8 }}><Btn kind="soft" busy={busy} onClick={() => window.confirm('Запросить возврат? Деньги вернёт перевозчик.') && act(() => transit.refund(t.id), 'Запрос на возврат отправлен')}>Вернуть билет</Btn></div>}
      {t.note && <div style={{ fontSize: 12, color: C.t3, marginTop: 6 }}>{t.note}</div>}
    </Card>
  );
};

export const TransitScreen = ({ city, onBack }: { city: string; onBack: () => void }) => {
  const [tab, setTab] = useState<'buy' | 'mine'>('buy'); const [busy, run] = useAction();
  const [cat, reloadCat] = useLoad(() => transit.catalog(city), [city]);
  const [mine, reloadMine] = useLoad(() => transit.tickets(), [], 15000);
  const buy = useCallback((o: TOperator, id: string) => void run(async () => {
    const r = await transit.buy(id); if (!r.ok) return flash(transitErr(r));
    flash('Билет создан. Оплатите его перевозчиком — после подтверждения появится QR.'); reloadMine(); setTab('mine');
  }), [run, reloadMine]);
  return (
    <div>
      <Back onClick={onBack} title="Билеты на проезд" />
      <Col>
        <Segmented value={tab} onChange={setTab} options={[{ v: 'buy', t: 'Купить' }, { v: 'mine', t: 'Мои билеты' }]} />
        {tab === 'buy' ? (!cat ? <Empty text="Загрузка…" /> : !cat.ok ? <ErrorState text="Не удалось загрузить перевозчиков." onRetry={reloadCat} />
          : !cat.data!.operators.length ? <Empty text="Перевозчиков пока нет" hint="Они появляются, когда организация категории «Пассажирский транспорт» опубликует билеты." />
            : cat.data!.operators.map((o) => (
              <Card key={o.id}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}><Bus size={18} style={{ color: GO }} /><div><div translate="no" style={{ fontWeight: 800, color: C.t1 }}>{o.name}</div><div translate="no" style={{ fontSize: 12, color: C.t2 }}>{o.city}</div></div></div>
                {!o.canSell && <Notice tone="warn">Продажа билетов онлайн сейчас недоступна.</Notice>}
                {o.products.map((p) => (
                  <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '8px 0', borderTop: `1px solid ${C.brd}`, marginTop: 8 }}>
                    <div style={{ minWidth: 0 }}><div translate="no" style={{ fontWeight: 700, color: C.t1 }}>{p.name}</div>
                      <div style={{ fontSize: 12, color: C.t2 }}>{p.kindLabel}{p.rides ? ` · ${p.rides} поездок` : ''} · действует {p.validDays} дн.</div></div>
                    <Btn busy={busy} disabled={!o.canSell} onClick={() => buy(o, p.id)}>{fmt(p.priceRub)}</Btn>
                  </div>))}
              </Card>)))
          : !mine ? <Empty text="Загрузка…" /> : !mine.ok ? <ErrorState text="Не удалось загрузить билеты." onRetry={reloadMine} />
            : !mine.data!.tickets.length ? <Empty text="Билетов пока нет" hint="Купите билет — после подтверждения оплаты перевозчиком в нём появится QR для проверки." />
              : mine.data!.tickets.map((t) => <TicketCard key={t.id} t={t} onChanged={reloadMine} />)}
        <div style={{ fontSize: 11, color: C.t3 }}>Оплата — прямой перевод перевозчику по его реквизитам; Sky деньги не принимает. QR меняется каждые 30 секунд, поэтому скриншот не подойдёт. Расписаний и позиции транспорта в Sky нет — только билеты.</div>
      </Col>
    </div>
  );
};
