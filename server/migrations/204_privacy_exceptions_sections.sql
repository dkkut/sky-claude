-- Исключения по людям теперь и для каждого раздела профиля (show*), не только для пяти основных областей.
ALTER TABLE privacy_exceptions DROP CONSTRAINT IF EXISTS privacy_exceptions_scope_check;
ALTER TABLE privacy_exceptions ADD CONSTRAINT privacy_exceptions_scope_check
  CHECK (scope IN ('write','call','online','gifts','music') OR scope ~ '^show[A-Za-z]{2,40}$');
