/* ===========================================================
   SKY REGION  —  типы
=========================================================== */

export interface Country {
  code: string;       // ISO 3166-1 alpha-2
  name: string;        // на русском
  nameEn: string;
  flag: string;        // emoji-флаг
  currency: string;    // код валюты
  currencySymbol: string;
  lang: string;        // код языка по умолчанию
  popular?: boolean;
}

export const COUNTRIES: Country[] = [
  { code:'RU', name:'Россия',        nameEn:'Russia',        flag:'🇷🇺', currency:'RUB', currencySymbol:'₽', lang:'ru', popular:true },
  { code:'KZ', name:'Казахстан',     nameEn:'Kazakhstan',    flag:'🇰🇿', currency:'KZT', currencySymbol:'₸', lang:'ru', popular:true },
  { code:'BY', name:'Беларусь',      nameEn:'Belarus',       flag:'🇧🇾', currency:'BYN', currencySymbol:'Br', lang:'ru', popular:true },
  { code:'UA', name:'Украина',       nameEn:'Ukraine',       flag:'🇺🇦', currency:'UAH', currencySymbol:'₴', lang:'uk', popular:true },
  { code:'UZ', name:'Узбекистан',    nameEn:'Uzbekistan',    flag:'🇺🇿', currency:'UZS', currencySymbol:'сум', lang:'ru', popular:true },
  { code:'AM', name:'Армения',       nameEn:'Armenia',       flag:'🇦🇲', currency:'AMD', currencySymbol:'֏', lang:'ru' },
  { code:'AZ', name:'Азербайджан',   nameEn:'Azerbaijan',    flag:'🇦🇿', currency:'AZN', currencySymbol:'₼', lang:'ru' },
  { code:'GE', name:'Грузия',        nameEn:'Georgia',       flag:'🇬🇪', currency:'GEL', currencySymbol:'₾', lang:'ru' },
  { code:'KG', name:'Киргизия',      nameEn:'Kyrgyzstan',    flag:'🇰🇬', currency:'KGS', currencySymbol:'с', lang:'ru' },
  { code:'TJ', name:'Таджикистан',   nameEn:'Tajikistan',    flag:'🇹🇯', currency:'TJS', currencySymbol:'смн', lang:'ru' },
  { code:'MD', name:'Молдова',       nameEn:'Moldova',       flag:'🇲🇩', currency:'MDL', currencySymbol:'L', lang:'ru' },
  { code:'US', name:'США',           nameEn:'United States', flag:'🇺🇸', currency:'USD', currencySymbol:'$', lang:'en', popular:true },
  { code:'GB', name:'Великобритания',nameEn:'United Kingdom',flag:'🇬🇧', currency:'GBP', currencySymbol:'£', lang:'en', popular:true },
  { code:'DE', name:'Германия',      nameEn:'Germany',       flag:'🇩🇪', currency:'EUR', currencySymbol:'€', lang:'de', popular:true },
  { code:'FR', name:'Франция',       nameEn:'France',        flag:'🇫🇷', currency:'EUR', currencySymbol:'€', lang:'fr' },
  { code:'ES', name:'Испания',       nameEn:'Spain',         flag:'🇪🇸', currency:'EUR', currencySymbol:'€', lang:'es' },
  { code:'IT', name:'Италия',        nameEn:'Italy',         flag:'🇮🇹', currency:'EUR', currencySymbol:'€', lang:'it' },
  { code:'PT', name:'Португалия',    nameEn:'Portugal',      flag:'🇵🇹', currency:'EUR', currencySymbol:'€', lang:'pt' },
  { code:'NL', name:'Нидерланды',    nameEn:'Netherlands',   flag:'🇳🇱', currency:'EUR', currencySymbol:'€', lang:'nl' },
  { code:'PL', name:'Польша',        nameEn:'Poland',        flag:'🇵🇱', currency:'PLN', currencySymbol:'zł', lang:'pl' },
  { code:'TR', name:'Турция',        nameEn:'Turkey',        flag:'🇹🇷', currency:'TRY', currencySymbol:'₺', lang:'tr', popular:true },
  { code:'AE', name:'ОАЭ',           nameEn:'UAE',           flag:'🇦🇪', currency:'AED', currencySymbol:'د.إ', lang:'ar', popular:true },
  { code:'SA', name:'Саудовская Аравия', nameEn:'Saudi Arabia', flag:'🇸🇦', currency:'SAR', currencySymbol:'﷼', lang:'ar' },
  { code:'IL', name:'Израиль',       nameEn:'Israel',        flag:'🇮🇱', currency:'ILS', currencySymbol:'₪', lang:'he' },
  { code:'CN', name:'Китай',         nameEn:'China',         flag:'🇨🇳', currency:'CNY', currencySymbol:'¥', lang:'zh', popular:true },
  { code:'JP', name:'Япония',        nameEn:'Japan',         flag:'🇯🇵', currency:'JPY', currencySymbol:'¥', lang:'ja', popular:true },
  { code:'KR', name:'Южная Корея',   nameEn:'South Korea',   flag:'🇰🇷', currency:'KRW', currencySymbol:'₩', lang:'ko', popular:true },
  { code:'IN', name:'Индия',         nameEn:'India',         flag:'🇮🇳', currency:'INR', currencySymbol:'₹', lang:'hi' },
  { code:'ID', name:'Индонезия',     nameEn:'Indonesia',     flag:'🇮🇩', currency:'IDR', currencySymbol:'Rp', lang:'id' },
  { code:'TH', name:'Таиланд',       nameEn:'Thailand',      flag:'🇹🇭', currency:'THB', currencySymbol:'฿', lang:'th' },
  { code:'VN', name:'Вьетнам',       nameEn:'Vietnam',       flag:'🇻🇳', currency:'VND', currencySymbol:'₫', lang:'vi' },
  { code:'BR', name:'Бразилия',      nameEn:'Brazil',        flag:'🇧🇷', currency:'BRL', currencySymbol:'R$', lang:'pt' },
  { code:'MX', name:'Мексика',       nameEn:'Mexico',        flag:'🇲🇽', currency:'MXN', currencySymbol:'$', lang:'es' },
  { code:'AR', name:'Аргентина',     nameEn:'Argentina',     flag:'🇦🇷', currency:'ARS', currencySymbol:'$', lang:'es' },
  { code:'CA', name:'Канада',        nameEn:'Canada',        flag:'🇨🇦', currency:'CAD', currencySymbol:'$', lang:'en' },
  { code:'AU', name:'Австралия',     nameEn:'Australia',     flag:'🇦🇺', currency:'AUD', currencySymbol:'$', lang:'en' },
  { code:'EG', name:'Египет',        nameEn:'Egypt',         flag:'🇪🇬', currency:'EGP', currencySymbol:'£', lang:'ar' },
  { code:'ZA', name:'ЮАР',           nameEn:'South Africa',  flag:'🇿🇦', currency:'ZAR', currencySymbol:'R', lang:'en' },
  { code:'FI', name:'Финляндия',     nameEn:'Finland',       flag:'🇫🇮', currency:'EUR', currencySymbol:'€', lang:'fi' },
  { code:'SE', name:'Швеция',        nameEn:'Sweden',        flag:'🇸🇪', currency:'SEK', currencySymbol:'kr', lang:'sv' },
  { code:'NO', name:'Норвегия',      nameEn:'Norway',        flag:'🇳🇴', currency:'NOK', currencySymbol:'kr', lang:'no' },
  { code:'CH', name:'Швейцария',     nameEn:'Switzerland',   flag:'🇨🇭', currency:'CHF', currencySymbol:'Fr', lang:'de' },
];

export const WORLDWIDE: Country = { code:'WW', name:'Весь мир', nameEn:'Worldwide', flag:'🌍', currency:'USD', currencySymbol:'$', lang:'ru' };

/* Грубое сопоставление часового пояса → страна, для «автоопределения» без запроса геолокации */
export const TIMEZONE_COUNTRY: Record<string,string> = {
  'Europe/Moscow':'RU','Europe/Kaliningrad':'RU','Asia/Yekaterinburg':'RU','Asia/Novosibirsk':'RU','Asia/Krasnoyarsk':'RU',
  'Asia/Irkutsk':'RU','Asia/Yakutsk':'RU','Asia/Vladivostok':'RU','Asia/Kamchatka':'RU',
  'Asia/Almaty':'KZ','Asia/Aqtobe':'KZ','Europe/Minsk':'BY','Europe/Kyiv':'UA','Asia/Tashkent':'UZ',
  'Asia/Yerevan':'AM','Asia/Baku':'AZ','Asia/Tbilisi':'GE','Asia/Bishkek':'KG','Asia/Dushanbe':'TJ','Europe/Chisinau':'MD',
  'America/New_York':'US','America/Chicago':'US','America/Denver':'US','America/Los_Angeles':'US',
  'Europe/London':'GB','Europe/Berlin':'DE','Europe/Paris':'FR','Europe/Madrid':'ES','Europe/Rome':'IT',
  'Europe/Lisbon':'PT','Europe/Amsterdam':'NL','Europe/Warsaw':'PL','Europe/Istanbul':'TR',
  'Asia/Dubai':'AE','Asia/Riyadh':'SA','Asia/Jerusalem':'IL','Asia/Shanghai':'CN','Asia/Tokyo':'JP','Asia/Seoul':'KR',
  'Asia/Kolkata':'IN','Asia/Jakarta':'ID','Asia/Bangkok':'TH','Asia/Ho_Chi_Minh':'VN',
  'America/Sao_Paulo':'BR','America/Mexico_City':'MX','America/Argentina/Buenos_Aires':'AR',
  'America/Toronto':'CA','Australia/Sydney':'AU','Africa/Cairo':'EG','Africa/Johannesburg':'ZA',
  'Europe/Helsinki':'FI','Europe/Stockholm':'SE','Europe/Oslo':'NO','Europe/Zurich':'CH',
};
