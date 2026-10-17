/* Общие кирпичи кабинета SkyKassa Business. */
export const card = { background: 'var(--bg-l1)', border: '1px solid var(--border)' } as const;
export const field = { background: 'var(--bg-l2)', border: '1px solid var(--border)', color: 'var(--t1)' } as const;
export const REASON: Record<string, string> = {
  no_business: 'Сначала подключите бизнес.', already_exists: 'Уже создано.', bad_field: 'Проверьте заполнение полей.', suspended: 'Бизнес приостановлен администрацией Sky.',
  subscription_required: 'Нужна действующая подписка SkyKassa Business.', insufficient_funds: 'Не хватает денег на кошельке SkyMoney.', requisites_required: 'Сначала укажите реквизиты.',
  secret_words: 'В тексте есть слова вроде PIN/CVV/пароль — такие данные здесь не нужны. Уберите их.', two_factor_required: 'Введите действующий код аутентификатора.',
  too_many_requests: 'Слишком часто. Подождите немного.', too_many_qr: 'Слишком много QR-кодов — заархивируйте ненужные.', bad_state: 'Это действие сейчас недоступно для заявки.',
  comment_required: 'Напишите короткий комментарий.', bad_logo: 'Логотип — PNG, JPEG или WebP.', logo_too_large: 'Логотип не больше 300 КБ.', archived: 'QR-код в архиве.',
  forbidden: 'Недостаточно прав для этого действия.', code_taken: 'Такой код уже есть.', promo_invalid: 'Промокод не найден или выключен.', not_published: 'Сначала опубликуйте бизнес.',
  slug_taken: 'Этот адрес витрины занят — выберите другой.', too_many_items: 'Слишком много позиций — уберите ненужные в архив.', too_many_media: 'Слишком много фотографий.',
  shop_not_configured: 'Сначала задайте адрес витрины и сохраните.', package_unavailable: 'Пакет сейчас недоступен на сервере.',
};
export const why = (r: { error?: string; field?: string }) => REASON[r.error ?? ''] ?? `Не получилось${r.field ? ` (поле: ${r.field})` : ''}. Повторите позже.`;
export const dt = (iso?: string | null) => (iso ? new Date(iso).toLocaleString([], { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');
export const Btn = ({ children, onClick, tone = 'ghost', disabled, small }: { children: React.ReactNode; onClick: () => void; tone?: 'ghost' | 'accent' | 'danger'; disabled?: boolean; small?: boolean }) => (
  <button type="button" onClick={onClick} disabled={disabled}
    className={`rounded-xl font-semibold disabled:opacity-50 ${small ? 'px-2.5 py-1.5 text-xs' : 'px-4 py-2.5 text-sm'}`}
    style={tone === 'accent' ? { background: 'var(--accent)', color: '#fff' } : tone === 'danger' ? { background: 'color-mix(in srgb, var(--red) 14%, transparent)', color: 'var(--red)', border: '1px solid color-mix(in srgb, var(--red) 40%, transparent)' } : { ...field }}>
    {children}
  </button>
);
export const In = ({ label, value, onChange, ph, type = 'text', max = 120 }: { label: string; value: string; onChange: (v: string) => void; ph?: string; type?: string; max?: number }) => (
  <label className="block text-[11px]" style={{ color: 'var(--t3)' }}>{label}
    <input type={type} value={value} maxLength={max} placeholder={ph} onChange={(e) => onChange(e.target.value)} className="mt-0.5 block w-full rounded-lg px-3 py-2 text-sm outline-none" style={field} />
  </label>
);
export const Stat = ({ k, v, sub }: { k: string; v: string | number; sub?: string }) => (
  <div className="rounded-2xl p-3" style={card}><p className="text-[11px]" style={{ color: 'var(--t3)' }}>{k}</p><p className="text-xl font-black" style={{ color: 'var(--t1)' }}>{v}</p>{sub && <p className="text-[10px]" style={{ color: 'var(--t3)' }}>{sub}</p>}</div>
);

