/** Sky Market: настройки способов получения продавца — самовывоз из магазина, доставка курьером, пункт выдачи, отправка. */
import { useEffect, useState } from 'react';
import { C, Field, inputStyle, Alert } from './ui';
import { apiMyDelivery, apiSaveMyDelivery } from './marketApi';
import { DELIVERY_LABEL } from './types';
import type { DeliveryMethod } from './types';

const METHODS: DeliveryMethod[] = ['store_pickup', 'courier', 'pvz', 'post'];
type Row = { enabled: boolean; price: string; freeFrom: string; minDays: string; maxDays: string; city: string; address: string; hours: string; note: string };
const empty = (): Row => ({ enabled: false, price: '0', freeFrom: '', minDays: '', maxDays: '', city: '', address: '', hours: '', note: '' });
const HINT: Record<DeliveryMethod, string> = {
  store_pickup: 'Покупатель сам забирает заказ в вашем магазине. Бесплатно. Адрес и часы увидит покупатель.',
  courier: 'Вы сами привозите заказ по адресу покупателя. Цену и порог бесплатной доставки задаёте вы.',
  pvz: 'Заказ едет в пункт выдачи Sky Market. Можно взять плату за доставку.',
  post: 'Отправка перевозчиком или почтой на адрес покупателя. Можно взять плату за доставку.',
};
const ERR: Record<string, string> = {
  pickup_address_required: 'Для самовывоза укажите адрес магазина.', pickup_must_be_free: 'Самовывоз бесплатный.',
  bad_price: 'Цена и порог бесплатной доставки — неотрицательные числа.', bad_days: 'Срок «от» не может быть больше срока «до».',
};

export const DeliverySettings = () => {
  const [rows, setRows] = useState<Record<DeliveryMethod, Row> | null>(null);
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<{ t: string; k: 'error' | 'info' } | null>(null);
  useEffect(() => {
    void apiMyDelivery().then((r) => {
      const base = Object.fromEntries(METHODS.map((m) => [m, empty()])) as Record<DeliveryMethod, Row>;
      for (const o of r.data?.options ?? []) base[o.method] = { enabled: o.enabled, price: String(o.price), freeFrom: o.freeFrom == null ? '' : String(o.freeFrom), minDays: o.minDays == null ? '' : String(o.minDays), maxDays: o.maxDays == null ? '' : String(o.maxDays), city: o.city, address: o.address, hours: o.hours, note: o.note };
      setRows(base);
    });
  }, []);
  if (!rows) return <div className="p-4 text-[12px]" style={{ color: C.t3 }}>Загрузка…</div>;
  const set = (m: DeliveryMethod, k: keyof Row, v: string | boolean) => setRows({ ...rows, [m]: { ...rows[m], [k]: v } });
  const save = async () => {
    setBusy(true); setMsg(null);
    const options = METHODS.filter((m) => rows[m].enabled || rows[m].address || Number(rows[m].price) > 0).map((m) => ({ method: m, ...rows[m], price: Number(rows[m].price || 0), freeFrom: rows[m].freeFrom === '' ? null : Number(rows[m].freeFrom), minDays: rows[m].minDays === '' ? null : Number(rows[m].minDays), maxDays: rows[m].maxDays === '' ? null : Number(rows[m].maxDays) }));
    const r = await apiSaveMyDelivery(options as never);
    setBusy(false);
    setMsg(r.ok ? { t: 'Сохранено', k: 'info' } : { t: ERR[r.reason ?? ''] ?? r.reason ?? 'Не сохранилось', k: 'error' });
  };
  const num = 'w-full rounded-xl px-3 py-2 text-[12px]';
  return (
    <div className="space-y-3 p-4">
      <p className="text-[13px] font-bold" style={{ color: C.t1 }}>Доставка и самовывоз</p>
      <p className="text-[11px]" style={{ color: C.t3 }}>
        Включите способы, которыми покупатель сможет получить физический товар. Стоимость доставки считает сервер по этим настройкам. Пока ничего не включено, покупатели оформляют заказ по-старому: на адрес или в пункт выдачи без платы. Для игровых лотов и услуг доставки нет.
      </p>
      {METHODS.map((m) => (
        <div key={m} className="space-y-2 rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
          <label className="flex items-center gap-2 text-[12px] font-bold" style={{ color: C.t1 }}>
            <input type="checkbox" checked={rows[m].enabled} onChange={(e) => set(m, 'enabled', e.target.checked)} />{DELIVERY_LABEL[m]}
          </label>
          <p className="text-[11px]" style={{ color: C.t3 }}>{HINT[m]}</p>
          {rows[m].enabled && (
            <div className="space-y-2">
              {m === 'store_pickup' && (<>
                <Field label="Адрес магазина"><input value={rows[m].address} maxLength={200} onChange={(e) => set(m, 'address', e.target.value)} className={num} style={inputStyle} placeholder="Город, улица, дом" /></Field>
                <Field label="Часы работы"><input value={rows[m].hours} maxLength={120} onChange={(e) => set(m, 'hours', e.target.value)} className={num} style={inputStyle} placeholder="Пн–Вс 9:00–21:00" /></Field>
              </>)}
              {m !== 'store_pickup' && (
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Стоимость, ₽"><input inputMode="decimal" value={rows[m].price} onChange={(e) => set(m, 'price', e.target.value.replace(/[^\d.]/g, ''))} className={num} style={inputStyle} /></Field>
                  <Field label="Бесплатно от, ₽" hint="Пусто — всегда платно."><input inputMode="decimal" value={rows[m].freeFrom} onChange={(e) => set(m, 'freeFrom', e.target.value.replace(/[^\d.]/g, ''))} className={num} style={inputStyle} /></Field>
                  <Field label="Срок от, дн."><input inputMode="numeric" value={rows[m].minDays} onChange={(e) => set(m, 'minDays', e.target.value.replace(/\D/g, ''))} className={num} style={inputStyle} /></Field>
                  <Field label="Срок до, дн."><input inputMode="numeric" value={rows[m].maxDays} onChange={(e) => set(m, 'maxDays', e.target.value.replace(/\D/g, ''))} className={num} style={inputStyle} /></Field>
                </div>
              )}
              {m === 'courier' && <Field label="Город доставки"><input value={rows[m].city} maxLength={80} onChange={(e) => set(m, 'city', e.target.value)} className={num} style={inputStyle} /></Field>}
              <Field label="Примечание для покупателя"><input value={rows[m].note} maxLength={300} onChange={(e) => set(m, 'note', e.target.value)} className={num} style={inputStyle} /></Field>
            </div>
          )}
        </div>
      ))}
      {msg && <Alert text={msg.t} kind={msg.k} />}
      <button type="button" disabled={busy} onClick={() => void save()} className="w-full rounded-xl py-2.5 text-[12px] font-bold disabled:opacity-40" style={{ background: C.acc, color: '#fff' }}>{busy ? 'Сохраняем…' : 'Сохранить'}</button>
      <p className="text-[10px]" style={{ color: C.t3 }}>Sky не проверяет, что магазин действительно находится по указанному адресу и что доставка будет выполнена в срок.</p>
    </div>
  );
};
