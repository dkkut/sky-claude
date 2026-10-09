-- Полученные подарки показываются в профиле получателя по умолчанию.
-- Раньше подарок из чата в профиль не попадал, а кнопки «сохранить» в
-- интерфейсе не было: раздел «Подарки» в профиле оставался пустым.
ALTER TABLE gift_instances ALTER COLUMN saved_to_profile SET DEFAULT TRUE;
UPDATE gift_instances SET saved_to_profile = TRUE WHERE saved_to_profile = FALSE AND status <> 'cancelled';
