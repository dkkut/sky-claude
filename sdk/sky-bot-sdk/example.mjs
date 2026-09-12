/**
 * Пример бота. Запускается НА ВАШЕМ СЕРВЕРЕ.
 *
 *   SKY_BOT_API=https://ваш-sky/api/bots/rt \
 *   SKY_BOT_PAIRING_CODE=SKY-XXXX-XXXX \
 *   node example.mjs
 *
 * Код привязки нужен только первый раз: дальше учётные данные лежат
 * в .sky-bot.json рядом с файлом, и запускать можно без него.
 */
import { SkyBot } from './index.mjs';

const bot = new SkyBot({ label: 'мой домашний сервер' });

/* Человек открыл диалог с ботом. */
bot.on('start', () => 'Привет! Я работаю на сервере своего владельца.\n\n'
                    + '/help — что я умею\n'
                    + '/echo <текст> — повторю за вами');

/*
 * Сообщение в чате.
 *
 * Вернуть строку — самый короткий способ ответить. Можно и вручную:
 * await api.send(data.chatId, 'текст').
 */
bot.on('message', async (data, api) => {
  const { command, args, text, from } = data;

  if (command === '/help') {
    return '/echo <текст> — повторю\n/time — скажу время на моём сервере\n/who — кто вы';
  }
  if (command === '/echo') return args || 'После /echo надо что-нибудь написать';
  if (command === '/time') return `На моём сервере сейчас ${new Date().toLocaleString('ru')}`;
  if (command === '/who')  return `Вы ${from.name || 'без имени'}`;

  /* Долгий ответ можно отправить и вручную, а потом ещё один. */
  if (text.length > 200) {
    await api.send(data.chatId, 'Длинное сообщение, читаю…');
    return `Прочитал ${text.length} символов.`;
  }
  return 'Не понял. Попробуйте /help';
});

/*
 * Inline: человек набрал «#ваштриггер что-то» прямо в чате.
 *
 * Мы НЕ отправляем сообщение — возвращаем варианты. Отправит их
 * человек, нажав «Отправить» у себя. Иначе бот писал бы за него.
 */
bot.on('inline_query', ({ query, from }) => {
  const who = from.name || 'Кто-то';
  if (!query.trim()) {
    return [
      { title: 'Поздороваться', text: `${who} машет рукой всем` },
      { title: 'Подбросить монетку', text: `${who} подбросил монетку: ${Math.random() > 0.5 ? 'орёл' : 'решка'}` },
    ];
  }
  return [
    { title: 'Сказать',   text: `${who}: ${query}` },
    { title: 'Громко',    text: `${who}: ${query.toUpperCase()}` },
    { title: 'Задуматься', text: `${who} размышляет о «${query}»` },
  ];
});

bot.start().catch((err) => {
  console.error('[пример] не удалось запуститься:', err.message);
  process.exit(1);
});

/* Закрываемся аккуратно: событие, которое мы не подтвердили, Sky
   выдаст снова следующему запуску. */
process.on('SIGINT',  () => { bot.stop(); process.exit(0); });
process.on('SIGTERM', () => { bot.stop(); process.exit(0); });
