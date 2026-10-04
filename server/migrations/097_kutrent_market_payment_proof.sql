-- ============================================================
-- KutRent Market — оплата переводом на расчётный счёт вместо заявки
-- администратора «на слово».
--
-- Раньше у заказа не было никакого платёжного шага вообще: единственный
-- путь из 'pending' в 'paid' — заявка администратора, подтверждённая
-- владельцем (см. server/adminsec.mjs, PENDING_KINDS.kutrent_mark_paid).
-- Теперь появляется настоящий цикл: после создания заказа покупателю
-- показываются реквизиты расчётного счёта (kutrent_market_requisites
-- ниже), он переводит деньги и указывает номер телефона, с которого
-- придёт перевод — администратор ищет по нему операцию в банке и только
-- тогда оформляет заявку владельцу. Второй ключ владельца остаётся тем
-- же: подключённой кассы по-прежнему нет, подтверждение делает человек.
-- ============================================================

ALTER TABLE kutrent_market_orders
  ADD COLUMN IF NOT EXISTS sender_phone TEXT,
  ADD COLUMN IF NOT EXISTS proof_submitted_at TIMESTAMPTZ;

-- 'rejected' — владелец не нашёл перевод по заявке администратора.
-- Отдельный статус от 'cancelled' (тот — когда заказ закрывает сам
-- покупатель): отклонённый заказ не похоронен навсегда, покупатель
-- может уточнить номер телефона и отправить его заново — см.
-- submitPaymentProof в server/kutrentmarket.mjs, переводит 'rejected'
-- обратно в 'pending'.
ALTER TABLE kutrent_market_orders DROP CONSTRAINT IF EXISTS kutrent_market_orders_status_check;
ALTER TABLE kutrent_market_orders ADD CONSTRAINT kutrent_market_orders_status_check
  CHECK (status IN ('pending', 'paid', 'rejected', 'cancelled'));

-- Реквизиты расчётного счёта — одна строка, как у platform_shutdown
-- (093_platform_modes.sql) и по той же причине: это переключатель
-- такого масштаба, что его не отдают рядовому администратору. Показывать
-- реквизиты можно всем покупателям без ограничений (это номер счёта,
-- на который и так переводят деньги все) — но изменить их может
-- только владелец, с повторным подтверждением личности (см.
-- server/kutrentmarket.mjs::setRequisites): это ровно то место, куда
-- идут настоящие переводы, подменить его — украсть деньги у всех
-- будущих покупателей разом.
CREATE TABLE IF NOT EXISTS kutrent_market_requisites (
  id              BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  account_number  TEXT NOT NULL DEFAULT '',
  bank_name       TEXT NOT NULL DEFAULT '',
  bik             TEXT NOT NULL DEFAULT '',
  bank_inn        TEXT NOT NULL DEFAULT '',
  bank_kpp        TEXT NOT NULL DEFAULT '',
  corr_account    TEXT NOT NULL DEFAULT '',
  recipient_name  TEXT NOT NULL DEFAULT '',
  updated_by      TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  updated_at      TIMESTAMPTZ
);
INSERT INTO kutrent_market_requisites
  (id, account_number, bank_name, bik, bank_inn, bank_kpp, corr_account, recipient_name, updated_at)
VALUES (
  TRUE,
  '40817810390189570579',
  'Филиал № 3652 Банка ВТБ (публичное акционерное общество) в г. Воронеже',
  '042007855',
  '7702070139',
  '366543001',
  '30101810545250000855',
  'Кутузов Денис Алексеевич',
  now()
)
ON CONFLICT (id) DO NOTHING;
