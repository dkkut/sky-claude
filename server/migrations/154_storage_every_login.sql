-- Sky Storage: каждый вход в управление хранилищем подтверждает владелец (как вход по SSH).
UPDATE storage_state SET settings = jsonb_set(jsonb_set(settings, '{approvalScope}', '"every_login"'), '{approvalValidMin}', '480')
 WHERE coalesce(settings->>'approvalScope', 'admin') = 'admin';
