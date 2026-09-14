-- ============================================================
--  Журналы хранят идентификатор, даже когда строка удалена
-- ============================================================
--
-- У admin_log были внешние ключи на profiles с ON DELETE SET NULL. Это
-- обычное решение для рабочих таблиц и неверное для журнала: удаление
-- профиля молча переписывало уже сделанные записи — «кого наказали»
-- превращалось в пустоту.
--
-- Важнее другое. Записи журнала связаны отпечатками в цепочку, и
-- отпечаток считается в том числе по target_id. Обнуление поля рвало
-- цепочку, и проверка целостности честно сообщала «журнал изменён» —
-- хотя изменил его не злоумышленник, а каскад от обычного действия.
-- Проверка, которая срабатывает сама по себе, перестаёт что-либо
-- значить: на неё быстро приучаются не смотреть.
--
-- Удаление профиля при этом не выдумка и не только про тесты: владелец
-- бота удаляет бота, и его профиль удаляется вместе с ним
-- (server/bots.mjs). То есть переписать чужую историю в журнале мог
-- любой обычный пользователь — не трогая сам журнал.
--
-- Убираем ключи со всех журнальных таблиц. Идентификатор остаётся
-- текстом: запись «что было сделано и с кем» должна пережить того, о
-- ком она сделана. Кто это был, по-прежнему видно — имя и ник лежат в
-- detail записи, а не добываются соединением.
--
-- Таблицы не журнальные (chats.owner_id, support_tickets.assignee_id и
-- прочие рабочие поля) не трогаем: там обнуление при удалении — как раз
-- то, что нужно.

ALTER TABLE admin_log             DROP CONSTRAINT IF EXISTS admin_log_actor_id_fkey;
ALTER TABLE admin_log             DROP CONSTRAINT IF EXISTS admin_log_target_id_fkey;
ALTER TABLE admin_security_events DROP CONSTRAINT IF EXISTS admin_security_events_actor_id_fkey;
ALTER TABLE admin_pending_actions DROP CONSTRAINT IF EXISTS admin_pending_actions_decided_by_fkey;
ALTER TABLE admin_lockdown        DROP CONSTRAINT IF EXISTS admin_lockdown_set_by_fkey;
ALTER TABLE chat_log              DROP CONSTRAINT IF EXISTS chat_log_actor_id_fkey;
ALTER TABLE chat_log              DROP CONSTRAINT IF EXISTS chat_log_target_id_fkey;
ALTER TABLE ticket_log            DROP CONSTRAINT IF EXISTS ticket_log_actor_id_fkey;
ALTER TABLE logi_cell_events      DROP CONSTRAINT IF EXISTS logi_cell_events_actor_id_fkey;
ALTER TABLE support_events        DROP CONSTRAINT IF EXISTS support_events_actor_id_fkey;

-- Кто наложил запрет — тоже часть записи о запрете, а не ссылка на
-- действующего сотрудника.
ALTER TABLE sky_ids               DROP CONSTRAINT IF EXISTS sky_ids_blocked_by_fkey;
ALTER TABLE chat_bans             DROP CONSTRAINT IF EXISTS chat_bans_by_id_fkey;
