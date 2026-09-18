-- Журнал безопасности защищён от порчи цепочкой отпечатков (050,
-- adminsec.mjs), но цепочка делает подмену строки заметной — она не
-- делает удаление невозможным. Строку всё ещё можно было вырезать из
-- середины обычным DELETE, и до сих пор это останавливало только то,
-- что ни один путь в приложении так не делает. Путь появится —
-- защиты не будет.
--
-- Здесь запрет ставится в самой базе: UPDATE и DELETE на admin_log
-- отклоняются триггером, а не проверкой в коде. Это не защита от
-- того, кто владеет базой целиком — такому человеку ничего не мешает
-- выключить сам триггер, — а защита от рядового пути: обычного
-- запроса через приложение, ошибки в будущем коде или чужого доступа
-- к учётным данным приложения без доступа к схеме базы.

CREATE OR REPLACE FUNCTION admin_log_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'admin_log: журнал безопасности только для записи — % запрещён', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS admin_log_no_update ON admin_log;
DROP TRIGGER IF EXISTS admin_log_no_delete ON admin_log;

CREATE TRIGGER admin_log_no_update BEFORE UPDATE ON admin_log
  FOR EACH ROW EXECUTE FUNCTION admin_log_append_only();

CREATE TRIGGER admin_log_no_delete BEFORE DELETE ON admin_log
  FOR EACH ROW EXECUTE FUNCTION admin_log_append_only();
