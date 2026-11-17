/** Мелкие общие кирпичи для вкладок админки (кнопка, блок, поле, запрос с понятной ошибкой). */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { apiCall } from '@/core/auth/api';
import { flash } from '@/shared/flash';

export const K = { l1: 'var(--bg-l1)', l2: 'var(--bg-l2)', brd: 'var(--border)', t1: 'var(--t1)', t2: 'var(--t2)', t3: 'var(--t3)', acc: 'var(--accent)', red: 'var(--red)' };
export const fieldSty = { background: K.l2, border: `1px solid ${K.brd}`, color: K.t1 };
export const inp = 'w-full rounded-xl px-3 py-2 text-sm outline-none';
export type D = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
export const Btn = ({ children, onClick, disabled, tone = 'acc' }: { children: ReactNode; onClick: () => void; disabled?: boolean; tone?: 'acc' | 'red' | 'plain' }) => (
  <button type="button" disabled={disabled} onClick={onClick} className="rounded-xl px-3 py-1.5 text-xs font-bold disabled:opacity-40"
    style={tone === 'acc' ? { background: K.acc, color: '#fff' } : tone === 'red' ? { background: 'rgba(239,68,68,.15)', color: K.red } : { background: K.l2, color: K.t1, border: `1px solid ${K.brd}` }}>{children}</button>
);
export const Box = ({ title, children }: { title: string; children: ReactNode }) => (
  <div className="space-y-2 rounded-2xl p-4" style={{ background: K.l1, border: `1px solid ${K.brd}` }}><p className="text-sm font-bold" style={{ color: K.t1 }}>{title}</p>{children}</div>
);
export const Note = ({ children }: { children: ReactNode }) => <p className="text-[11px]" style={{ color: K.t3 }}>{children}</p>;
const ERR: Record<string, string> = {
  not_allowed: 'Недостаточно прав.', owner_only: 'Это действие — только для владельца.', code_required: 'Нужен код подтверждения.', reason_required: 'Укажите причину (не короче 5–10 знаков).',
  self_review: 'Своё дело решать нельзя.', bad_state: 'Состояние уже изменилось — обновите.', not_found: 'Не найдено.', confirm_required: 'Нужно подтверждение.', not_serious: 'Ограничить можно только серьёзный случай.',
  bad_link: 'Ссылка должна начинаться с https:// и не содержать логина.', bad_dates: 'Проверьте даты: окончание позже начала и в будущем.', bad_media: 'Файл не подходит.', empty_name: 'Введите название.', empty_title: 'Введите заголовок.',
  bad_module: 'Недопустимый раздел.', bad_tab: 'Недопустимая вкладка.', bad_text: 'Текст слишком короткий.', bad_title: 'Название слишком короткое.', bad_body: 'Текст слишком короткий.', no_draft: 'Нет черновика.',
  change_note_required: 'Опишите, что изменилось (для новой редакции).', checklist_incomplete: 'Чек-лист не заполнен.', bad_settings: 'Недопустимые значения настроек.', bad_country: 'Код страны из двух букв.', bad_name: 'Название слишком короткое.',
  step_up_exhausted: 'Слишком много неверных кодов.', no_second_factor: 'Включите приложение-аутентификатор в Sky ID.',
};
export const errText = (r: { error?: string; reason?: string }) => ERR[r.error ?? ''] ?? r.reason ?? `Не получилось${r.error ? ` (${r.error})` : ''}`;
/** Запрос + флеш с причиной; возвращает данные или null. */
export const call = async <T = D,>(path: string, method = 'GET', body?: unknown): Promise<T | null> => {
  const r = await apiCall<T>(path, { method, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  if (!r.ok) { flash(errText(r)); return null; }
  return (r.data ?? ({} as T));
};
export const useLoad = <T = D,>(path: string) => {
  const [d, setD] = useState<T | null>(null);
  const load = useCallback(async () => { const r = await apiCall<T>(path); if (r.ok) setD(r.data ?? ({} as T)); else flash(errText(r)); }, [path]);
  useEffect(() => { void load(); }, [load]);
  return [d, load] as const;
};
/** Код подтверждения владельца: запросить и ввести. */
export const useCode = (stepUpPath: string) => {
  const [code, setCode] = useState(''); const [sent, setSent] = useState(false);
  const ask = async () => { const r = await apiCall(stepUpPath, { method: 'POST', body: '{}' }); setSent(r.ok); flash(r.ok ? 'Введите код из приложения-аутентификатора' : errText(r)); };
  const field = sent
    ? <input className={inp} style={fieldSty} value={code} inputMode="numeric" maxLength={8} placeholder="Код подтверждения" onChange={(e) => setCode(e.target.value)} />
    : <Btn tone="plain" onClick={() => void ask()}>Запросить код подтверждения</Btn>;
  return { code, field, reset: () => { setCode(''); setSent(false); } };
};
