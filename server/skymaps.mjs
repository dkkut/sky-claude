/**
 * Sky Maps Core — единый вход в карты для остальных модулей Sky.
 *
 * Модули (такси, еда, доставка, бизнес, ПВЗ, Market, друзья) обращаются только к функциям `maps.mjs` / этого файла; кто именно за ними —
 * Яндекс или Google — решает `maps.mjs` (pickProvider). Смена поставщика не требует правок в модулях.
 *
 * Здесь же — честная таблица возможностей Sky Routing: что реально настроено и доступно сейчас, а чего нет. Ничего не выдумывается:
 * если режим недоступен у выбранного поставщика, об этом сказано, а маршрут не рисуется «по прямой» под видом настоящего.
 */
import { config } from './config.mjs';
import { providersAvailable } from './maps.mjs';

const MODES = [
  { id: 'car', label: 'Автомобиль', google: 'driving' },
  { id: 'foot', label: 'Пешком', google: 'walking' },
  { id: 'bike', label: 'Велосипед', google: 'bicycling' },
  { id: 'taxi', label: 'Такси (Sky GO)', google: 'driving', note: 'Это обычный автомобильный маршрут: свои заказы такси Sky ведёт сама.' },
  { id: 'courier', label: 'Курьер', google: 'driving', note: 'Порядок точек задаёт Sky (забор раньше вручения); поставщик строит путь между ними.' },
];

/** Что умеет каждый поставщик в Sky СЕЙЧАС (по подключённым ключам и написанному коду). */
export const capabilities = () => {
  const have = providersAvailable();
  const google = have.includes('google');
  const yandex = have.includes('yandex');
  return {
    providers: {
      google: { configured: google },
      yandex: { configured: yandex, geocoderKey: Boolean(config.yandexGeocoderKey), routingKey: Boolean(process.env.YANDEX_ROUTING_KEY) },
    },
    features: {
      staticMap: { google, yandex },
      geocode:   { google, yandex },
      /* Интерактивная карта Яндекса (JS API v3) НЕ подключена: нужны публичный ключ и разрешение домена api-maps.yandex.ru в политике безопасности. */
      interactiveMap: { google: false, yandex: false },
      /* Поиск организаций (Yandex Search API) НЕ подключён: отдельный коммерческий ключ. */
      organizationSearch: { yandex: false },
    },
    routing: MODES.map((m) => ({
      mode: m.id, label: m.label, note: m.note ?? null,
      /* Маршруты строит Google Directions. Покрытие пешеходных и велосипедных маршрутов Google в России ограничено — это зависит от поставщика, а не от Sky. */
      google: { available: google, via: google ? `Directions API (${m.google})` : null },
      /* Яндекс: Routing API — отдельный платный продукт с договором и своим ключом; в Sky не подключён. */
      yandex: { available: false, reason: 'not_integrated' },
    })),
  };
};
