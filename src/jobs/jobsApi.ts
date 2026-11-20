/** Sky Работа: клиент API (/api/jobs/*). Права, лимиты, цены и статусы решает сервер. */
import { apiCall } from '@/core/auth/api';

export interface Cat { id: string; name: string }
export interface JobsConfig { schedule: Record<string, string>; employment: Record<string, string>; experience: Record<string, string>; appStatus: Record<string, string>; reportReasons: Record<string, string>;
  settings: { freeVacancies: number; vacancyPriceRub: number; promoPriceRub: number; vacancyDays: number; resumesNeedVerified: boolean }; categories: Cat[] }
export interface Vac {
  id: string; title: string; categoryId: string | null; city: string; remote: boolean; salaryFrom: number | null; salaryTo: number | null; scheduleLabel: string; employmentLabel: string; experienceLabel: string;
  schedule: string; employment: string; experience: string; status: string; promoted: boolean; fav?: boolean; myStatus?: string | null; myApplication?: string | null; snippet?: string; own?: boolean;
  description?: string; requirements?: string; conditions?: string; rejectReason?: string; flags?: string[]; apps?: number; appsNew?: number; views?: number; expiresAt?: string | null; promotedUntil?: string | null;
  company?: { id: string; name: string; verified: boolean; about?: string; site?: string; city?: string; verifyLabel?: string };
}
export interface Resume {
  id: string; position: string; categoryId: string | null; city: string; desiredSalary: number | null; schedule: string; employment: string; skills: string[]; experienceYears: number; visibility: 'public' | 'applied' | 'hidden'; status: string;
  about?: string; experience?: { company: string; role: string; from: string; to: string; text: string }[]; education?: { place: string; spec: string; year: string }[]; contact?: { phone: string; email: string }; name?: string; blockReason?: string;
}
export interface Company { id: string; name: string; about: string; city: string; site: string; status: string; blockReason: string; verifyStatus: string; verifyLabel: string; verifyReason: string; verified: boolean }
export interface App {
  id: string; vacancyId: string; vacancyTitle: string; company: string; companyVerified?: boolean; status: string; statusLabel: string; initiator: string; unread?: number; updatedAt: string; vacancyClosed?: boolean;
  name?: string; position?: string; experienceYears?: number; desiredSalary?: number | null;
}
export interface AppFull { id: string; role: 'employer' | 'applicant'; vacancyTitle: string; company: string; status: string; statusLabel: string; cover: string; contactsShared: boolean; events: { label: string; note: string; at: string }[];
  applicant?: { name: string }; resume?: Resume | null; contact?: { phone: string; email: string } | null; actions: string[] }
export interface Msg { id: number; mine: boolean; text: string; at: string }

const b = (x: unknown) => JSON.stringify(x ?? {});
const qs = (o: Record<string, string | number | boolean | undefined>) => { const u = new URLSearchParams(); for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== '' && v !== false) u.set(k, v === true ? '1' : String(v)); return u.toString(); };
const J = '/api/jobs';
export const jobs = {
  config: () => apiCall<JobsConfig>(`${J}/config`),
  search: (q: Record<string, string | number | boolean | undefined>) => apiCall<{ vacancies: Vac[]; more: boolean }>(`${J}/vacancies?${qs(q)}`),
  vacancy: (id: string) => apiCall<{ vacancy: Vac }>(`${J}/vacancies/${id}`),
  fav: (id: string, on: boolean) => apiCall(`${J}/vacancies/${id}/fav`, { method: on ? 'PUT' : 'DELETE' }),
  apply: (id: string, x: { resumeId?: string; cover?: string }) => apiCall<{ id: string; duplicate?: boolean }>(`${J}/vacancies/${id}/apply`, { method: 'POST', body: b(x) }),
  myApps: () => apiCall<{ applications: App[] }>(`${J}/applications`),
  app: (id: string) => apiCall<{ application: AppFull }>(`${J}/applications/${id}`),
  setStatus: (id: string, to: string, note = '') => apiCall(`${J}/applications/${id}/status`, { method: 'POST', body: b({ to, note }) }),
  contacts: (id: string, on: boolean) => apiCall(`${J}/applications/${id}/contacts`, { method: 'POST', body: b({ on }) }),
  messages: (id: string) => apiCall<{ messages: Msg[] }>(`${J}/applications/${id}/messages`),
  send: (id: string, text: string) => apiCall(`${J}/applications/${id}/messages`, { method: 'POST', body: b({ text }) }),
  report: (type: string, targetId: string, reason: string, text = '') => apiCall(`${J}/report`, { method: 'POST', body: b({ type, targetId, reason, text }) }),
  resume: () => apiCall<{ resume: Resume | null; views?: { company: string; verified: boolean; day: string }[] }>(`${J}/resume`),
  saveResume: (r: unknown) => apiCall(`${J}/resume`, { method: 'PUT', body: b(r) }),
  resumeVisibility: (visibility: string) => apiCall(`${J}/resume/visibility`, { method: 'PUT', body: b({ visibility }) }),
  deleteResume: () => apiCall(`${J}/resume`, { method: 'DELETE' }),
  exportData: () => apiCall<unknown>(`${J}/export`),
  company: () => apiCall<{ company: Company | null }>(`${J}/company`),
  saveCompany: (c: Partial<Company>) => apiCall(`${J}/company`, { method: 'PUT', body: b(c) }),
  verify: (inn: string, note: string) => apiCall(`${J}/company/verify`, { method: 'POST', body: b({ inn, note }) }),
  myVacancies: () => apiCall<{ vacancies: Vac[] }>(`${J}/my/vacancies`),
  saveVacancy: (id: string | null, v: unknown) => apiCall<{ id: string; returnedToDraft?: boolean }>(id ? `${J}/my/vacancies/${id}` : `${J}/my/vacancies`, { method: id ? 'PUT' : 'POST', body: b(v) }),
  vacancyAction: (id: string, a: 'submit' | 'close' | 'promote') => apiCall<{ paidRub?: number }>(`${J}/my/vacancies/${id}/${a}`, { method: 'POST', body: b({}) }),
  vacancyApps: (id: string) => apiCall<{ applications: App[] }>(`${J}/my/vacancies/${id}/applications`),
  searchResumes: (q: Record<string, string | undefined>) => apiCall<{ resumes: Resume[] }>(`${J}/resumes?${qs(q)}`),
  openResume: (id: string) => apiCall<{ resume: Resume }>(`${J}/resumes/${id}`),
  invite: (id: string, vacancyId: string, text: string) => apiCall(`${J}/resumes/${id}/invite`, { method: 'POST', body: b({ vacancyId, text }) }),
};
export const money = (v: number | null) => (v == null ? '' : `${v.toLocaleString('ru-RU')} ₽`);
export const salaryText = (v: { salaryFrom: number | null; salaryTo: number | null }) => (v.salaryFrom == null && v.salaryTo == null ? 'Зарплата не указана' : `${v.salaryFrom != null ? `от ${money(v.salaryFrom)} ` : ''}${v.salaryTo != null ? `до ${money(v.salaryTo)}` : ''}`.trim());
const ERR: Record<string, string> = {
  payment_demand: 'В тексте есть требование денег или вложений. Работодатель не вправе просить деньги у соискателя.', contact_in_text: 'Телефоны, ссылки и мессенджеры в тексте запрещены: общение идёт внутри Sky, а на сайт компании есть отдельное поле.',
  message_blocked: 'Сообщение не отправлено: в нём деньги, пароли/коды или контакты вне Sky.', personal_secret: 'Уберите из резюме паспортные данные, номера карт и пароли — они там не нужны.', consent_required: 'Нужно согласие на обработку персональных данных.',
  verification_required: 'Поиск резюме доступен только проверенным работодателям. Отправьте компанию на проверку.', vacancy_limit: 'Достигнут лимит открытых вакансий. Закройте одну из них.', insufficient_funds: 'Недостаточно средств на кошельке Sky.',
  promotion_unavailable: 'Продвижение сейчас недоступно.', blocked: 'Доступ к разделу «Работа» ограничен администрацией.', no_company: 'Сначала создайте компанию во вкладке «Работодателю».', own_vacancy: 'Нельзя откликнуться на свою вакансию.',
  resume_or_cover_required: 'Приложите резюме или напишите сопроводительное письмо.', too_many_requests: 'Слишком часто. Попробуйте позже.', bad_transition: 'Такой переход статуса недоступен.', reason_required: 'Укажите причину.', content_blocked: 'Текст не прошёл автоматическую проверку.', incomplete: 'Заполните вакансию подробнее (описание не короче 50 знаков).',
  already_exists: 'Уже есть отклик или приглашение.', closed: 'Переписка закрыта.',
};
export const jobErr = (r: { error?: string; status?: number }) => ERR[r.error ?? ''] ?? (r.status === 403 ? 'Недостаточно прав.' : r.status === 404 ? 'Не найдено.' : 'Не получилось. Попробуйте ещё раз.');
