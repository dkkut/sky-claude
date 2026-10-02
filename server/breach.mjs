/**
 * Автоматический ответ на вероятный взлом администраторского аккаунта.
 *
 * Решение «при подозрении выключать сервер целиком, пока владелец сам
 * не проверит и не включит обратно» — осознанный выбор владельца,
 * сделанный с пониманием цены: на это время сайт недоступен вообще
 * всем, не только атакующему. Поэтому сигнал здесь узкий: не любой
 * сработавший в приложении лимит (их задевает обычный трафик —
 * ошибся паролем, промахнулся кодом), а именно несколько подряд
 * провалов входа в САМ администраторский аккаунт — то, что обычному
 * человеку получить почти неоткуда, не зная пароль или TOTP-секрет
 * владельца/администратора.
 *
 * Процесс API в контейнере намеренно без прав root (см. docker-
 * compose.yml) — это результат отдельного прохода этого же аудита, и
 * ломать его ради этой функции нельзя: процесс внутри контейнера
 * физически не может выключить хост, и не должен получать для этого
 * привилегии, иначе дыра в самом API стала бы дырой во всей машине.
 * Поэтому отсюда идёт только сигнал: аварийный режим панели — сразу
 * (это обычный SQL-запрос, доступен без лишних прав), и файл на
 * разделяемом с хостом томе — для отдельного сторожа вне Docker,
 * который и выполняет настоящее выключение (server/scripts, см.
 * инструкцию, выданную владельцу отдельно).
 */
import fs from 'node:fs/promises';
import { query } from './db.mjs';
import { sendEmail } from './notify.mjs';
import { setLockdownSystem } from './adminsec.mjs';

/** Подряд, в пределах получаса — одного провала недостаточно (обычная
    опечатка в пароле), двух подряд в этом окне обычному человеку уже
    почти не бывает. */
const WINDOW_MS = 30 * 60 * 1000;
const THRESHOLD = 2;

/** Sky ID → отметки времени провалов. Живёт в памяти процесса, как и
    остальные счётчики частоты в этом проекте (server/security.mjs) —
    процесс один, перезапуск сервера и так сбрасывает счётчики попыток
    у всех защит здесь, это не новое поведение. */
const events = new Map();

const SIGNAL_PATH = process.env.SHUTDOWN_SIGNAL_PATH || '/control/shutdown-requested';

/** Администратор ли этот Sky ID — хотя бы один его профиль. */
const isAdminSkyId = async (skyId) => {
  const { rows } = await query(
    'SELECT 1 FROM profiles WHERE sky_id = $1 AND is_admin LIMIT 1', [skyId]);
  return rows.length > 0;
};

/** Куда слать срочное письмо — подтверждённые почты всех администраторов. */
const adminEmails = async () => {
  const { rows } = await query(
    `SELECT DISTINCT s.email FROM profiles p JOIN sky_ids s ON s.id = p.sky_id
      WHERE p.is_admin AND s.email IS NOT NULL AND s.email_verified`);
  return rows.map((r) => r.email);
};

const REASON_LABEL = {
  password: 'перебор пароля',
  totp: 'перебор кода из приложения-аутентификатора',
};

const triggerEmergencyShutdown = async (skyId, reason, count) => {
  const when = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const why = `${count} провалов входа администратора подряд ` +
    `(${REASON_LABEL[reason] ?? reason}) — sky-${skyId}`;

  // Аварийный режим — немедленно: это обычный запрос к базе, срабатывает
  // быстрее, чем сторож на хосте успевает заметить файл-сигнал и выключить
  // машину.
  await setLockdownSystem(why);

  const owners = await adminEmails();
  const text = `Похоже, кто-то подбирает вход в администраторский аккаунт: ` +
    `${count} провалов подряд, причина — ${REASON_LABEL[reason] ?? reason}, ${when} UTC.\n\n` +
    'Аварийный режим панели включён автоматически прямо сейчас. Сервер ' +
    'будет выключен целиком — так настроено по вашему собственному решению: ' +
    'недоступность сайта для всех сейчас важнее, чем риск, что атакующий ' +
    'получит данные, пока вы не проверите, что произошло.\n\n' +
    'Включить сервер обратно можно только вручную, через панель хостинга, ' +
    'после того как убедитесь, что опасность миновала.';
  await Promise.all(owners.map((email) =>
    sendEmail(email, 'СРОЧНО: Sky — автоматическая аварийная остановка сервера', text)
      .catch((err) => console.error('[breach] письмо администратору:', err.message))));

  try {
    await fs.mkdir('/control', { recursive: true });
    await fs.writeFile(SIGNAL_PATH, `${when} UTC\n${why}\n`);
  } catch (err) {
    // Файл не записался — сторож на хосте ничего не увидит и машину не
    // выключит. Аварийный режим панели при этом уже включён письмом выше,
    // так что защита не нулевая, но об этом важно знать из журнала сервера.
    console.error('[breach] не удалось записать сигнал на выключение:', err.message);
  }
};

/**
 * Отметить провал входа в администраторский аккаунт. Вызывается из
 * routes/password.mjs (блокировка после перебора пароля) и skyid.mjs
 * (исчерпан лимit попыток TOTP) — только когда это действительно
 * администраторский Sky ID, не любой.
 */
export const noteAdminBreachSignal = async (skyId, reason) => {
  if (!(await isAdminSkyId(skyId))) return;

  const now = Date.now();
  const list = (events.get(skyId) ?? []).filter((t) => now - t < WINDOW_MS);
  list.push(now);

  if (list.length < THRESHOLD) {
    events.set(skyId, list);
    return;
  }
  events.delete(skyId);
  await triggerEmergencyShutdown(skyId, reason, list.length);
};
