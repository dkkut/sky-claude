-- Sky Работа: самостоятельная вкладка поиска работы (соискатели, работодатели, отклики, переписка, модерация).
CREATE TABLE IF NOT EXISTS job_categories (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, sort INT NOT NULL DEFAULT 0, hidden BOOLEAN NOT NULL DEFAULT FALSE
);
INSERT INTO job_categories (id, name, sort) VALUES
  ('it','IT и разработка',10),('design','Дизайн',20),('marketing','Маркетинг',30),('sales','Продажи',40),('management','Управление',50),('finance','Финансы',60),
  ('construction','Строительство',70),('transport','Транспорт и логистика',80),('production','Производство',90),('education','Образование',100),('medicine','Медицина',110),
  ('retail','Розничная торговля',120),('service','Обслуживание',130),('hospitality','Гостиницы и рестораны',140),('remote','Удалённая работа',150),('other','Другие направления',160)
ON CONFLICT (id) DO NOTHING;

-- Тарифы и продвижение (правит администрация, право jobs_tariffs). Всё в рублях целыми, платит работодатель с кошелька Sky.
CREATE TABLE IF NOT EXISTS job_settings (
  id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  free_vacancies INT NOT NULL DEFAULT 3,        -- сколько вакансий можно держать открытыми бесплатно
  vacancy_price_rub INT NOT NULL DEFAULT 0,     -- цена каждой следующей вакансии (0 — лимит жёсткий, платных нет)
  promo_price_rub INT NOT NULL DEFAULT 0,       -- продвижение на 7 дней (0 — продвижение выключено)
  vacancy_days INT NOT NULL DEFAULT 30,         -- срок жизни публикации
  resumes_need_verified BOOLEAN NOT NULL DEFAULT TRUE,   -- искать резюме могут только проверенные работодатели
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO job_settings (id) VALUES (TRUE) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS job_companies (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL UNIQUE REFERENCES profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL, about TEXT NOT NULL DEFAULT '', city TEXT NOT NULL DEFAULT '', site TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','blocked')),
  verify_status TEXT NOT NULL DEFAULT 'none' CHECK (verify_status IN ('none','pending','verified','rejected')),
  verify_claim_enc TEXT,            -- ИНН/ОГРН и пояснение (зашифровано), проверка ручная; реестры ФНС не подключены
  verify_reason TEXT NOT NULL DEFAULT '', verified_by TEXT, verified_at TIMESTAMPTZ, verify_submitted_at TIMESTAMPTZ,
  block_reason TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS job_vacancies (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES job_companies(id) ON DELETE CASCADE,
  title TEXT NOT NULL, category_id TEXT REFERENCES job_categories(id), city TEXT NOT NULL DEFAULT '', remote BOOLEAN NOT NULL DEFAULT FALSE,
  salary_from INT, salary_to INT,
  schedule TEXT NOT NULL DEFAULT 'full_day', employment TEXT NOT NULL DEFAULT 'full', experience TEXT NOT NULL DEFAULT 'none',
  description TEXT NOT NULL DEFAULT '', requirements TEXT NOT NULL DEFAULT '', conditions TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','pending','published','rejected','closed','blocked')),
  reject_reason TEXT NOT NULL DEFAULT '', flags TEXT[] NOT NULL DEFAULT '{}',
  promoted_until TIMESTAMPTZ, published_at TIMESTAMPTZ, expires_at TIMESTAMPTZ, submitted_at TIMESTAMPTZ, moderated_by TEXT, moderated_at TIMESTAMPTZ,
  views INT NOT NULL DEFAULT 0, paid_rub INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS job_vac_pub_idx ON job_vacancies (category_id, city) WHERE status = 'published';
CREATE INDEX IF NOT EXISTS job_vac_company_idx ON job_vacancies (company_id, status);
CREATE INDEX IF NOT EXISTS job_vac_queue_idx ON job_vacancies (status, submitted_at);

CREATE TABLE IF NOT EXISTS job_resumes (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL UNIQUE REFERENCES profiles(id) ON DELETE CASCADE,
  position TEXT NOT NULL, category_id TEXT REFERENCES job_categories(id), city TEXT NOT NULL DEFAULT '', desired_salary INT,
  schedule TEXT NOT NULL DEFAULT 'full_day', employment TEXT NOT NULL DEFAULT 'full', skills TEXT[] NOT NULL DEFAULT '{}',
  experience_years INT NOT NULL DEFAULT 0,
  body_enc TEXT NOT NULL,           -- о себе, места работы, образование (зашифровано)
  contact_enc TEXT,                 -- телефон/почта: работодатель видит только если кандидат открыл их в отклике
  visibility TEXT NOT NULL DEFAULT 'applied' CHECK (visibility IN ('public','applied','hidden')),
  consent_at TIMESTAMPTZ NOT NULL,  -- согласие на обработку персональных данных
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','blocked')), block_reason TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS job_resume_search_idx ON job_resumes (category_id, city) WHERE visibility = 'public' AND status = 'active';

CREATE TABLE IF NOT EXISTS job_resume_views (
  resume_id TEXT NOT NULL REFERENCES job_resumes(id) ON DELETE CASCADE,
  company_id TEXT NOT NULL REFERENCES job_companies(id) ON DELETE CASCADE,
  day DATE NOT NULL DEFAULT CURRENT_DATE,
  PRIMARY KEY (resume_id, company_id, day)
);

CREATE TABLE IF NOT EXISTS job_applications (
  id TEXT PRIMARY KEY,
  vacancy_id TEXT NOT NULL REFERENCES job_vacancies(id) ON DELETE CASCADE,
  applicant_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  resume_id TEXT REFERENCES job_resumes(id) ON DELETE SET NULL,
  initiator TEXT NOT NULL DEFAULT 'applicant' CHECK (initiator IN ('applicant','employer')),
  cover_enc TEXT,
  status TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent','viewed','invited','interview','rejected','offer','hired')),
  contacts_shared BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (vacancy_id, applicant_id)
);
CREATE INDEX IF NOT EXISTS job_app_applicant_idx ON job_applications (applicant_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS job_app_vacancy_idx ON job_applications (vacancy_id, status);
CREATE TABLE IF NOT EXISTS job_app_events (
  id BIGSERIAL PRIMARY KEY, application_id TEXT NOT NULL REFERENCES job_applications(id) ON DELETE CASCADE,
  status TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', actor TEXT, at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS job_app_events_idx ON job_app_events (application_id, id);
CREATE TABLE IF NOT EXISTS job_messages (
  id BIGSERIAL PRIMARY KEY, application_id TEXT NOT NULL REFERENCES job_applications(id) ON DELETE CASCADE,
  sender_id TEXT NOT NULL, body_enc TEXT NOT NULL, read_at TIMESTAMPTZ, at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS job_msg_idx ON job_messages (application_id, id);

CREATE TABLE IF NOT EXISTS job_favs (
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE, vacancy_id TEXT NOT NULL REFERENCES job_vacancies(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (profile_id, vacancy_id)
);
CREATE TABLE IF NOT EXISTS job_reports (
  id TEXT PRIMARY KEY, reporter_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN ('vacancy','company','resume')), target_id TEXT NOT NULL,
  reason TEXT NOT NULL, text TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','dismissed')), note TEXT NOT NULL DEFAULT '', handled_by TEXT, handled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS job_reports_idx ON job_reports (status, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS job_reports_open_uq ON job_reports (reporter_id, target_type, target_id) WHERE status = 'open';
CREATE TABLE IF NOT EXISTS job_profile_blocks (
  profile_id TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE, reason TEXT NOT NULL, blocked_by TEXT, at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS job_log (
  id BIGSERIAL PRIMARY KEY, actor TEXT, action TEXT NOT NULL, target TEXT, detail TEXT NOT NULL DEFAULT '', at TIMESTAMPTZ NOT NULL DEFAULT now()
);
