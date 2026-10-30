-- Сколько файлов можно выбрать за один раз при массовой загрузке (NULL/0 = без ограничения). Правит администрация (upload_limits).
ALTER TABLE upload_limits ADD COLUMN IF NOT EXISTS max_batch INT CHECK (max_batch IS NULL OR max_batch >= 0);
