/**
 * Sky Market: «Происхождение и доставка» в форме товара и панель
 * публикации карточки.
 *
 * Отметки «Отправка из-за рубежа» и «Международная доставка» экран не
 * ставит: он присылает сведения (страна происхождения, страна отправки,
 * где лежит товар), а отметки считает сервер. Страна производства и
 * место отправки — разные поля и нигде не подменяют друг друга.
 */
import { useCallback, useEffect, useState } from 'react';
import { Loader2, CheckCircle2, AlertCircle, Send, History } from 'lucide-react';
import { C, Field, inputStyle, Alert } from './ui';
import { COUNTRIES, countryName } from './countries';
import {
  apiListingCheck, apiSubmitProduct, apiProductHistory, apiListDocs, apiAppeal,
  type ListingCheck, type DocView,
} from './verifyApi';
import { DocUpload } from './SellerVerification';
import type { Product, ModerationStatus, MarketType } from './types';

export interface OriginState {
  itemSource: '' | 'personal' | 'own_production' | 'resale';
  itemCondition: '' | 'new' | 'used';
  originCountry: string;
  shipFromCountry: string;
  itemLocationCountry: string;
  intlShipping: boolean;
  deliveryDaysMin: string;
  deliveryDaysMax: string;
  importInfo: string;
  markingDeclared: '' | 'not_required' | 'required' | 'unsure';
}

export const originFromProduct = (p: Product | null): OriginState => ({
  itemSource: p?.itemSource ?? '',
  itemCondition: p?.itemCondition ?? '',
  originCountry: p?.originCountry ?? '',
  shipFromCountry: p?.shipFromCountry ?? '',
  itemLocationCountry: p?.itemLocationCountry ?? '',
  intlShipping: p?.intlShipping ?? false,
  deliveryDaysMin: p?.deliveryDaysMin ? String(p.deliveryDaysMin) : '',
  deliveryDaysMax: p?.deliveryDaysMax ? String(p.deliveryDaysMax) : '',
  importInfo: p?.importInfo ?? '',
  markingDeclared: p?.markingDeclared ?? '',
});

/** Поля в виде, который принимает сервер. Пустое — null, чтобы не затирать молча. */
export const originToInput = (o: OriginState, marketType: MarketType) => {
  const days = (v: string) => (v.trim() ? Number(v) || null : null);
  const base = { itemSource: o.itemSource || null };
  if (marketType !== 'standard') return base;
  return {
    ...base,
    itemCondition: o.itemCondition || null,
    originCountry: o.originCountry || null,
    shipFromCountry: o.shipFromCountry || null,
    itemLocationCountry: o.itemLocationCountry || null,
    intlShipping: o.intlShipping,
    deliveryDaysMin: days(o.deliveryDaysMin),
    deliveryDaysMax: days(o.deliveryDaysMax),
    importInfo: o.importInfo.trim(),
    markingDeclared: o.markingDeclared || null,
  };
};

const CountrySelect = ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
  <select value={value} onChange={(e) => onChange(e.target.value)} className="w-full rounded-xl px-3 py-2 text-[12px]" style={inputStyle}>
    <option value="">Выберите страну</option>
    {COUNTRIES.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
  </select>
);

export const OriginSection = ({ marketType, value, onChange }: {
  marketType: MarketType; value: OriginState; onChange: (v: OriginState) => void;
}) => {
  const set = <K extends keyof OriginState>(k: K, v: OriginState[K]) => onChange({ ...value, [k]: v });
  const abroadShip = value.shipFromCountry !== '' && value.shipFromCountry !== 'RU';
  const abroadLoc = value.itemLocationCountry !== '' && value.itemLocationCountry !== 'RU';

  return (
    <div className="space-y-3 rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
      <p className="text-[13px] font-bold" style={{ color: C.t1 }}>Происхождение и доставка</p>

      <Field label="Чей это товар" hint="Допуск к публикации зависит от вашего подтверждённого статуса.">
        <select value={value.itemSource} onChange={(e) => set('itemSource', e.target.value as OriginState['itemSource'])}
          className="w-full rounded-xl px-3 py-2 text-[12px]" style={inputStyle}>
          <option value="">Выберите</option>
          <option value="personal">Личная вещь</option>
          <option value="own_production">Собственное производство</option>
          <option value="resale">Перепродажа</option>
        </select>
      </Field>

      {marketType === 'standard' && (
        <>
          <Field label="Состояние">
            <select value={value.itemCondition} onChange={(e) => set('itemCondition', e.target.value as OriginState['itemCondition'])}
              className="w-full rounded-xl px-3 py-2 text-[12px]" style={inputStyle}>
              <option value="">Выберите</option>
              <option value="new">Новый</option>
              <option value="used">Бывший в употреблении</option>
            </select>
          </Field>

          <Field label="Страна происхождения товара" hint="Где товар произведён. Это не место отправки.">
            <CountrySelect value={value.originCountry} onChange={(v) => set('originCountry', v)} />
          </Field>
          <Field label="Страна, из которой отправляется заказ">
            <CountrySelect value={value.shipFromCountry} onChange={(v) => set('shipFromCountry', v)} />
          </Field>
          <Field label="Где находится товар" hint="Например: произведён в Китае, но лежит на складе в России — тогда здесь Россия.">
            <CountrySelect value={value.itemLocationCountry} onChange={(v) => set('itemLocationCountry', v)} />
          </Field>

          <label className="flex items-center gap-2 text-[12px]" style={{ color: C.t2 }}>
            <input type="checkbox" checked={value.intlShipping} onChange={(e) => set('intlShipping', e.target.checked)} />
            Доступна международная доставка
          </label>

          <div className="grid grid-cols-2 gap-2">
            <Field label="Срок доставки от, дней">
              <input value={value.deliveryDaysMin} inputMode="numeric" onChange={(e) => set('deliveryDaysMin', e.target.value.replace(/\D/g, ''))}
                className="w-full rounded-xl px-3 py-2 text-[12px]" style={inputStyle} />
            </Field>
            <Field label="до, дней">
              <input value={value.deliveryDaysMax} inputMode="numeric" onChange={(e) => set('deliveryDaysMax', e.target.value.replace(/\D/g, ''))}
                className="w-full rounded-xl px-3 py-2 text-[12px]" style={inputStyle} />
            </Field>
          </div>

          {(abroadShip || abroadLoc) && (
            <Field label="Сведения о ввозе" hint="Как товар попадает к покупателю: кто импортёр, есть ли документы. Такие карточки проверяет модератор вручную.">
              <textarea value={value.importInfo} onChange={(e) => set('importInfo', e.target.value)} rows={3} maxLength={1000}
                className="w-full rounded-xl px-3 py-2 text-[12px]" style={inputStyle} />
            </Field>
          )}

          <Field label="Обязательная маркировка" hint="Подлежит ли товар обязательной маркировке. Если не уверены — выберите «Не уверен»: проверит модератор.">
            <select value={value.markingDeclared} onChange={(e) => set('markingDeclared', e.target.value as OriginState['markingDeclared'])}
              className="w-full rounded-xl px-3 py-2 text-[12px]" style={inputStyle}>
              <option value="">Не указано</option>
              <option value="not_required">Не подлежит</option>
              <option value="required">Подлежит</option>
              <option value="unsure">Не уверен</option>
            </select>
          </Field>

          <div className="flex flex-wrap gap-1.5">
            {value.shipFromCountry && (
              <span className="rounded-lg px-2 py-1 text-[10px] font-semibold" style={{ background: C.l2, color: C.t2 }}>
                {abroadShip ? 'Отправка из-за рубежа' : 'Отправка из России'}
              </span>
            )}
            {value.intlShipping && <span className="rounded-lg px-2 py-1 text-[10px] font-semibold" style={{ background: C.l2, color: C.t2 }}>Международная доставка</span>}
            {abroadLoc && <span className="rounded-lg px-2 py-1 text-[10px] font-semibold" style={{ background: C.l2, color: C.t2 }}>Товар находится за рубежом</span>}
            {value.originCountry && (
              <span className="rounded-lg px-2 py-1 text-[10px] font-semibold" style={{ background: C.l2, color: C.t2 }}>
                {`Страна происхождения: ${countryName(value.originCountry)}`}
              </span>
            )}
          </div>
          <p className="text-[10px]" style={{ color: C.t3 }}>
            Так отметки увидит покупатель. Окончательные отметки считает сервер по этим сведениям.
          </p>
        </>
      )}
    </div>
  );
};

/* ── Статус публикации ────────────────────────────────────────────── */

export const MOD_LABEL: Record<ModerationStatus, string> = {
  draft: 'Черновик', pending: 'На проверке', needs_changes: 'Требуются исправления', approved: 'Одобрен',
  published: 'Опубликован', hidden: 'Временно скрыт', blocked: 'Заблокирован', archived: 'В архиве',
};
export const MOD_TINT: Record<ModerationStatus, string> = {
  draft: C.t3, pending: C.acc, needs_changes: C.amber, approved: C.green, published: C.green,
  hidden: C.amber, blocked: C.red, archived: C.t3,
};

export const ModerationBadge = ({ status }: { status?: ModerationStatus }) => {
  if (!status) return null;
  return (
    <span className="rounded-md px-1.5 py-0.5 text-[10px] font-bold"
      style={{ background: 'color-mix(in srgb, currentColor 12%, transparent)', color: MOD_TINT[status] }}>
      {MOD_LABEL[status]}
    </span>
  );
};

const ACT: Record<string, string> = {
  created: 'Создана', submitted: 'Отправлена на публикацию', auto_published: 'Опубликована автоматически',
  approve: 'Одобрена модератором', request_changes: 'Запрошены исправления', hide: 'Скрыта', block: 'Заблокирована',
  re_review: 'Возвращена на проверку', edited_recheck: 'Проверка после изменений', recheck_hidden: 'Скрыта после смены статуса',
  archived: 'Снята с витрины',
};

export const ListingPanel = ({ product: initial, onChanged }: { product: Product; onChanged: () => void }) => {
  const [product, setProduct] = useState(initial);
  const [check, setCheck] = useState<ListingCheck | null>(null);
  const [docs, setDocs] = useState<DocView[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [history, setHistory] = useState<{ action: string; reason: string; by: string; at: string }[] | null>(null);
  const [appeal, setAppeal] = useState('');
  const status = product.moderationStatus ?? 'draft';

  const load = useCallback(async () => {
    const [c, d] = await Promise.all([apiListingCheck(product.id), apiListDocs('product', product.id)]);
    if (c.ok) setCheck(c.data.check);
    if (d.ok) setDocs(d.data.items);
  }, [product.id]);
  useEffect(() => { void load(); }, [load, status]);

  const submit = async () => {
    setBusy(true); setMsg('');
    const r = await apiSubmitProduct(product.id);
    setBusy(false);
    if (!r.ok) {
      if (r.data?.check) setCheck(r.data.check);
      setMsg(r.error === 'listing_blocked' ? 'Публикация пока невозможна — исправьте пункты ниже.' : (r.reason ?? 'Не получилось отправить.'));
      return;
    }
    setCheck(r.data.check);
    setProduct(r.data.product);
    setMsg(r.data.product.moderationStatus === 'published' ? 'Карточка опубликована.' : 'Карточка отправлена на проверку модератору.');
    onChanged();
  };

  const canSubmit = ['draft', 'needs_changes', 'hidden', 'archived'].includes(status);

  return (
    <div className="space-y-3 rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
      <div className="flex items-center gap-2">
        <p className="text-[13px] font-bold" style={{ color: C.t1 }}>Публикация</p>
        <ModerationBadge status={status} />
      </div>
      {product.moderationReason && (
        <p className="rounded-lg p-2 text-[12px]" style={{ background: C.l2, color: C.t1 }} translate="no">
          Причина решения: {product.moderationReason}
        </p>
      )}

      {check && check.blockers.length > 0 && (
        <div className="space-y-1">
          <p className="text-[11px] font-bold" style={{ color: C.red }}>Что мешает публикации:</p>
          {check.blockers.map((b) => (
            <p key={b.code} className="flex gap-1.5 text-[12px]" style={{ color: C.t1 }}>
              <AlertCircle size={13} className="mt-0.5 shrink-0" style={{ color: C.red }} />{b.message}
            </p>
          ))}
        </div>
      )}
      {check && check.review.length > 0 && (
        <div className="space-y-1">
          <p className="text-[11px] font-bold" style={{ color: C.amber }}>Потребуется ручная проверка:</p>
          {check.review.map((b) => <p key={b.code} className="text-[12px]" style={{ color: C.t2 }}>• {b.message}</p>)}
        </div>
      )}
      {check && check.ok && check.review.length === 0 && (
        <p className="flex items-center gap-1.5 text-[12px]" style={{ color: C.green }}>
          <CheckCircle2 size={13} /> Карточка соответствует правилам и опубликуется сразу.
        </p>
      )}

      {check && check.requiredDocs.length > 0 && (
        <div className="space-y-2">
          <p className="text-[12px] font-bold" style={{ color: C.t1 }}>Обязательные документы</p>
          {check.requiredDocs.map((t) => (
            <DocUpload key={t} scope="product" refId={product.id} type={t} label={DOC_LABEL[t] ?? t} docs={docs} onChanged={() => void load()} />
          ))}
          <p className="text-[10px]" style={{ color: C.t3 }}>
            Документы проверяет модератор вручную. Интеграции с «Честным знаком», таможней и реестрами нет.
          </p>
        </div>
      )}

      {msg && <Alert kind="info" text={msg} />}

      {canSubmit && (
        <button type="button" disabled={busy} onClick={() => void submit()}
          className="flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-[12px] font-bold disabled:opacity-40"
          style={{ background: C.acc, color: '#fff' }}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Опубликовать
        </button>
      )}
      {status === 'pending' && <p className="text-[11px]" style={{ color: C.t2 }}>Карточка у модератора. Мы сообщим о решении, ответ появится здесь.</p>}

      {['blocked', 'hidden', 'needs_changes'].includes(status) && (
        <div className="space-y-2">
          <p className="text-[11px] font-bold" style={{ color: C.t1 }}>Не согласны с решением?</p>
          <textarea value={appeal} onChange={(e) => setAppeal(e.target.value)} rows={2} maxLength={2000} placeholder="Опишите, что нужно пересмотреть"
            className="w-full rounded-xl px-3 py-2 text-[12px]" style={inputStyle} />
          <button type="button" disabled={appeal.trim().length < 10}
            onClick={async () => { const r = await apiAppeal({ subjectType: 'product', subjectId: product.id, text: appeal }); setMsg(r.ok ? 'Апелляция отправлена.' : r.error === 'already_appealed' ? 'Апелляция уже подана.' : (r.reason ?? 'Не получилось.')); if (r.ok) setAppeal(''); }}
            className="rounded-xl px-3 py-1.5 text-[11px] font-bold disabled:opacity-40" style={{ background: C.l2, color: C.t1, border: `1px solid ${C.brd}` }}>
            Подать апелляцию
          </button>
        </div>
      )}

      <button type="button" className="flex items-center gap-1 text-[11px] font-semibold" style={{ color: C.acc }}
        onClick={async () => { if (history) { setHistory(null); return; } const r = await apiProductHistory(product.id); if (r.ok) setHistory(r.data.items); }}>
        <History size={12} /> {history ? 'Скрыть историю' : 'История решений'}
      </button>
      {history && history.map((h, i) => (
        <p key={i} className="text-[11px]" style={{ color: C.t2 }}>
          {new Date(h.at).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} · {ACT[h.action] ?? h.action}
          {h.reason && <span style={{ color: C.t3 }} translate="no"> · {h.reason}</span>}
        </p>
      ))}
    </div>
  );
};

const DOC_LABEL: Record<string, string> = {
  certificate: 'Сертификат или декларация соответствия',
  marking_proof: 'Подтверждение маркировки',
  permit: 'Разрешительный документ',
  importer_info: 'Сведения об импортёре / ввозе',
  origin_proof: 'Подтверждение происхождения товара',
  other: 'Другой документ',
};

/* ── Отметки в каталоге и карточке ───────────────────────────────── */

/** Отметки считает сервер из сведений о товаре; здесь они только рисуются. */
export const shippingBadges = (p: Product): string[] => {
  const out: string[] = [];
  if (p.shipsFromAbroad === true) out.push('Отправка из-за рубежа');
  if (p.intlShipping === true) out.push('Международная доставка');
  if (p.locatedAbroad === true) out.push('Товар находится за рубежом');
  return out;
};

export const OriginBlock = ({ product }: { product: Product }) => {
  const badges = shippingBadges(product);
  const rows: [string, string][] = [];
  if (product.originCountry) rows.push(['Страна происхождения', countryName(product.originCountry)]);
  if (product.shipFromCountry) rows.push(['Отправка из', countryName(product.shipFromCountry)]);
  if (product.itemLocationCountry) rows.push(['Товар находится', countryName(product.itemLocationCountry)]);
  if (product.deliveryDaysMax) {
    rows.push(['Ориентировочный срок', product.deliveryDaysMin && product.deliveryDaysMin !== product.deliveryDaysMax
      ? `${product.deliveryDaysMin}–${product.deliveryDaysMax} дн.` : `до ${product.deliveryDaysMax} дн.`]);
  }
  if (badges.length === 0 && rows.length === 0) return null;
  return (
    <div className="space-y-2 rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
      <p className="text-[12px] font-bold" style={{ color: C.t1 }}>Происхождение и доставка</p>
      {badges.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {badges.map((b) => (
            <span key={b} className="rounded-lg px-2 py-1 text-[10px] font-bold" style={{ background: C.accBg, color: C.acc }}>{b}</span>
          ))}
        </div>
      )}
      {rows.map(([k, v]) => (
        <p key={k} className="text-[12px]" style={{ color: C.t2 }}>
          <span style={{ color: C.t3 }}>{k}:</span> {v}
        </p>
      ))}
      {product.importInfo && <p className="text-[11px]" style={{ color: C.t2 }} translate="no">{product.importInfo}</p>}
    </div>
  );
};
