/**
 * Отслеживание посылок: СДЭК, Почта России и зарубежные службы.
 *
 * Что это и чего это не делает. Модуль только ЧИТАЕТ состояние посылки
 * у самой службы и приводит его к одному виду. Заказ он не двигает: то,
 * что служба написала «вручено», — информация для экрана, а не
 * основание считать сделку завершённой.
 *
 * Три источника данных:
 *   · СДЭК — официальный API v2 (OAuth, client_credentials);
 *   · Почта России — SOAP «Единый доступ» (логин и пароль API);
 *   · 17TRACK — агрегатор: DHL, UPS, FedEx, USPS, Royal Mail, China Post
 *     и ещё несколько сотен служб; службу он определяет по номеру сам.
 *
 * Каждый источник включается своими переменными окружения (см.
 * config.mjs). Не настроен — ручка честно отвечает «не подключено» и
 * отдаёт ссылку на публичную страницу отслеживания этой службы: без
 * ключей человек всё равно может проверить посылку, просто не внутри Sky.
 *
 * Про SSRF. Хосты — константы или значения из настроек сервера; номер
 * посылки проверен регуляркой и уходит только в значения параметров,
 * тело или заголовок, а не в хост и не в путь.
 */
import { config } from './config.mjs';

/* ─── Справочник служб ─────────────────────────────────────────────── */

/**
 * `source` — откуда берём данные: 'cdek' | 'russianpost' | 'track17'.
 * `url` — публичная страница службы, {n} заменяется номером.
 */
export const PROVIDERS = {
  cdek:        { title: 'СДЭК / CDEK',        region: 'ru',   source: 'cdek',        url: 'https://www.cdek.ru/ru/tracking?order_id={n}' },
  russianpost: { title: 'Почта России',       region: 'ru',   source: 'russianpost', url: 'https://www.pochta.ru/tracking#{n}' },
  dhl:         { title: 'DHL',                region: 'intl', source: 'track17',     url: 'https://www.dhl.com/global-en/home/tracking.html?tracking-id={n}' },
  ups:         { title: 'UPS',                region: 'intl', source: 'track17',     url: 'https://www.ups.com/track?tracknum={n}' },
  fedex:       { title: 'FedEx',              region: 'intl', source: 'track17',     url: 'https://www.fedex.com/fedextrack/?trknbr={n}' },
  usps:        { title: 'USPS',               region: 'intl', source: 'track17',     url: 'https://tools.usps.com/go/TrackConfirmAction?tLabels={n}' },
  royalmail:   { title: 'Royal Mail',         region: 'intl', source: 'track17',     url: 'https://www.royalmail.com/track-your-item#/tracking-results/{n}' },
  chinapost:   { title: 'China Post',         region: 'intl', source: 'track17',     url: 'https://www.17track.net/en/track?nums={n}' },
  dpd:         { title: 'DPD',                region: 'intl', source: 'track17',     url: 'https://www.dpd.com/tracking/?parcelNumber={n}' },
  gls:         { title: 'GLS',                region: 'intl', source: 'track17',     url: 'https://gls-group.com/EU/en/parcel-tracking?match={n}' },
  other:       { title: 'Other / auto-detect', region: 'intl', source: 'track17',    url: 'https://t.17track.net/en#nums={n}' },
};

/** Номер: латиница, цифры и дефис, 5–40 символов. */
export const NUMBER_RE = /^[A-Za-z0-9-]{5,40}$/;

export const trackingUrl = (provider, number) => {
  const p = PROVIDERS[provider];
  return p ? p.url.replace('{n}', encodeURIComponent(number)) : null;
};

/** Какие источники сейчас подключены на этом сервере. */
export const sourcesConfigured = () => ({
  cdek: Boolean(config.tracking.cdekClientId && config.tracking.cdekClientSecret),
  russianpost: Boolean(config.tracking.russianPostLogin && config.tracking.russianPostPassword),
  track17: Boolean(config.tracking.track17Key),
});

export const providerList = () => {
  const on = sourcesConfigured();
  return Object.entries(PROVIDERS).map(([code, p]) => ({
    code, title: p.title, region: p.region, live: on[p.source] === true,
  }));
};

/* ─── Общий вид ответа ─────────────────────────────────────────────── */

/**
 * status: created | in_transit | out_for_delivery | ready_for_pickup |
 *         delivered | exception | returned | unknown
 */
const EMPTY = (provider, number) => ({
  provider, number, status: 'unknown', statusText: '', events: [], carrierName: PROVIDERS[provider]?.title ?? provider,
});

const sortEvents = (events) => events
  .filter((e) => e && e.text)
  .sort((a, b) => String(b.time ?? '').localeCompare(String(a.time ?? '')));

const clip = (v, n = 300) => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);

/* ─── СДЭК ─────────────────────────────────────────────────────────── */

let cdekToken = { value: '', exp: 0 };

const cdekBase = () => config.tracking.cdekBase || 'https://api.cdek.ru/v2';

const cdekAuth = async () => {
  if (cdekToken.value && cdekToken.exp > Date.now() + 30_000) return cdekToken.value;
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: config.tracking.cdekClientId,
    client_secret: config.tracking.cdekClientSecret,
  });
  const res = await fetch(`${cdekBase()}/oauth/token`, {
    method: 'POST', body, headers: { 'content-type': 'application/x-www-form-urlencoded' },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`cdek_auth_${res.status}`);
  const data = await res.json();
  cdekToken = { value: data.access_token, exp: Date.now() + Number(data.expires_in ?? 3600) * 1000 };
  return cdekToken.value;
};

const CDEK_STATUS = (code) => {
  const c = String(code ?? '').toUpperCase();
  if (c === 'DELIVERED') return 'delivered';
  if (c.includes('RETURN')) return 'returned';
  if (c === 'NOT_DELIVERED' || c === 'INVALID' || c === 'REMOVED' || c.includes('LOST')) return 'exception';
  if (c === 'TAKEN_BY_COURIER') return 'out_for_delivery';
  if (c === 'READY_FOR_SHIPMENT_IN_RECIPIENT_CITY' || c === 'ACCEPTED_AT_PICK_UP_POINT' || c === 'READY_FOR_PICKUP') return 'ready_for_pickup';
  if (c === 'CREATED' || c === 'ACCEPTED') return 'created';
  return 'in_transit';
};

/** Разбор ответа GET /v2/orders — вынесен для проверки без сети. */
export const normalizeCdek = (data, number) => {
  const out = EMPTY('cdek', number);
  const entity = data?.entity;
  if (!entity) return out;
  const events = (entity.statuses ?? []).map((s) => ({
    time: s.date_time ?? '', text: clip(s.name), location: clip(s.city), code: s.code,
  }));
  const sorted = sortEvents(events);
  out.events = sorted;
  const last = sorted[0];
  if (last) { out.status = CDEK_STATUS(last.code); out.statusText = last.text; }
  return out;
};

const lookupCdek = async (number) => {
  const token = await cdekAuth();
  const key = /^\d{9,12}$/.test(number) ? 'cdek_number' : 'im_number';
  const res = await fetch(`${cdekBase()}/orders?${key}=${encodeURIComponent(number)}`, {
    headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000),
  });
  if (res.status === 404 || res.status === 400) return EMPTY('cdek', number);
  if (!res.ok) throw new Error(`cdek_${res.status}`);
  return normalizeCdek(await res.json(), number);
};

/* ─── Почта России ─────────────────────────────────────────────────── */

const tag = (xml, name) => {
  const m = xml.match(new RegExp(`<(?:[\\w-]+:)?${name}[^>]*>([\\s\\S]*?)</(?:[\\w-]+:)?${name}>`));
  return m ? m[1].trim() : '';
};

const unxml = (s) => String(s ?? '')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

const RP_STATUS = (typeId, attrId) => {
  const t = Number(typeId); const a = Number(attrId);
  if (t === 2) return 'delivered';
  if (t === 3) return 'returned';
  if (t === 8 && (a === 2 || a === 3 || a === 8 || a === 9 || a === 10 || a === 11)) return 'ready_for_pickup';
  if (t === 8 && a === 2) return 'ready_for_pickup';
  if (t === 1) return 'created';
  if (t === 12 || t === 13) return 'exception';
  return 'in_transit';
};

/** Разбор SOAP-ответа getOperationHistory — вынесен для проверки без сети. */
export const normalizeRussianPost = (xml, number) => {
  const out = EMPTY('russianpost', number);
  const records = String(xml ?? '').match(/<(?:[\w-]+:)?historyRecord[\s>][\s\S]*?<\/(?:[\w-]+:)?historyRecord>/g) ?? [];
  const events = records.map((r) => {
    const typeId = tag(tag(r, 'OperType'), 'Id');
    const typeName = unxml(tag(tag(r, 'OperType'), 'Name'));
    const attrId = tag(tag(r, 'OperAttr'), 'Id');
    const attrName = unxml(tag(tag(r, 'OperAttr'), 'Name'));
    return {
      time: tag(r, 'OperDate'),
      text: clip([typeName, attrName].filter(Boolean).join(': ')),
      location: clip(unxml(tag(tag(r, 'OperationAddress'), 'Description')) || unxml(tag(tag(r, 'OperationAddress'), 'Index'))),
      code: `${typeId}/${attrId}`,
      _t: typeId, _a: attrId,
    };
  });
  // Почта отдаёт историю от старого к новому
  const sorted = sortEvents(events);
  out.events = sorted.map(({ _t, _a, ...e }) => e);
  const last = sorted[0];
  if (last) { out.status = RP_STATUS(last._t, last._a); out.statusText = last.text; }
  return out;
};

const lookupRussianPost = async (number) => {
  const { russianPostLogin: login, russianPostPassword: password } = config.tracking;
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope" xmlns:oper="http://russianpost.org/operationhistory" xmlns:data="http://russianpost.org/operationhistory/data">
 <soap:Header/>
 <soap:Body>
  <oper:getOperationHistory>
   <data:OperationHistoryRequest>
    <data:Barcode>${esc(number)}</data:Barcode>
    <data:MessageType>0</data:MessageType>
    <data:Language>RUS</data:Language>
   </data:OperationHistoryRequest>
   <data:AuthorizationHeader soap:mustUnderstand="1">
    <data:login>${esc(login)}</data:login>
    <data:password>${esc(password)}</data:password>
   </data:AuthorizationHeader>
  </oper:getOperationHistory>
 </soap:Body>
</soap:Envelope>`;
  const res = await fetch('https://tracking.russianpost.ru/rtm34', {
    method: 'POST', body, headers: { 'content-type': 'application/soap+xml; charset=utf-8' },
    signal: AbortSignal.timeout(12_000),
  });
  const xml = await res.text();
  if (!res.ok && !/historyRecord/.test(xml)) {
    // 500 с «Fault» — неверный логин или номер без операций; для экрана это «нет данных»
    if (/AuthorizationFault|Unauthorized/i.test(xml)) throw new Error('russianpost_auth');
    return EMPTY('russianpost', number);
  }
  return normalizeRussianPost(xml, number);
};

/* ─── 17TRACK (зарубежные службы) ──────────────────────────────────── */

const T17 = 'https://api.17track.net/track/v2.2';

const T17_STATUS = (s) => ({
  NotFound: 'unknown', InfoReceived: 'created', InTransit: 'in_transit', Expired: 'exception',
  AvailableForPickup: 'ready_for_pickup', OutForDelivery: 'out_for_delivery',
  DeliveryFailure: 'exception', Delivered: 'delivered', Exception: 'exception',
}[s] ?? 'unknown');

/** Разбор ответа gettrackinfo — вынесен для проверки без сети. */
export const normalize17track = (data, provider, number) => {
  const out = EMPTY(provider, number);
  const item = data?.data?.accepted?.[0];
  if (!item) return out;
  const info = item.track_info ?? {};
  const events = [];
  for (const p of info.tracking?.providers ?? []) {
    for (const e of p.events ?? []) {
      events.push({
        time: e.time_iso ?? e.time_utc ?? '',
        text: clip(e.description),
        location: clip(e.location),
        carrier: clip(p.provider?.name, 60),
      });
    }
  }
  out.events = sortEvents(events);
  out.status = T17_STATUS(info.latest_status?.status);
  out.statusText = out.events[0]?.text ?? '';
  const name = info.tracking?.providers?.[0]?.provider?.name;
  if (name) out.carrierName = clip(name, 60);
  return out;
};

const t17 = async (path, payload) => {
  const res = await fetch(`${T17}${path}`, {
    method: 'POST', body: JSON.stringify(payload),
    headers: { '17token': config.tracking.track17Key, 'content-type': 'application/json' },
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) throw new Error(`track17_${res.status}`);
  return res.json();
};

const lookup17 = async (provider, number) => {
  // Регистрация идемпотентна: уже зарегистрированный номер вернёт rejected,
  // и это не ошибка. Службу 17TRACK определяет по номеру сам.
  await t17('/register', [{ number }]).catch(() => null);
  const data = await t17('/gettrackinfo', [{ number }]);
  return normalize17track(data, provider, number);
};

/* ─── Вход ─────────────────────────────────────────────────────────── */

/**
 * Состояние посылки у службы. Бросает Error('not_configured'), если
 * источник для этой службы на сервере не подключён.
 */
export const fetchTracking = async (provider, number) => {
  const p = PROVIDERS[provider];
  if (!p || !NUMBER_RE.test(number)) throw new Error('bad_input');
  const on = sourcesConfigured();
  if (!on[p.source]) throw new Error('not_configured');
  if (p.source === 'cdek') return lookupCdek(number);
  if (p.source === 'russianpost') return lookupRussianPost(number);
  return lookup17(provider, number);
};
