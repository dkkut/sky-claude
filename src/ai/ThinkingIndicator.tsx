/**
 * Индикатор «Думаю •••» Sky AI.
 * Показывается только пока запрос реально выполняется (после отправки на сервер) и убирается при ответе, ошибке или отмене.
 * Точки анимируются плавно; при «уменьшении анимации» в системе — статичны. Для скринридера — живая область с текстом.
 */
import { CloudBuddy } from './CloudBuddy';

export const ThinkingIndicator = ({ onCancel, label = 'Думаю' }: { onCancel?: () => void; label?: string }) => (
  <div className="flex items-end gap-2">
    <div className="shrink-0" style={{ marginBottom: -4 }}><CloudBuddy mood="code" size={64} /></div>
    <div role="status" aria-live="polite" className="flex items-center gap-2 rounded-2xl px-4 py-2.5" style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)' }}>
      <span className="text-[13px] font-semibold" style={{ color: 'var(--t2)' }}>{label}</span>
      <span className="sky-think-dots" aria-hidden="true"><i /><i /><i /></span>
      {onCancel && (
        <button type="button" onClick={onCancel} className="ml-1 text-[11px] font-semibold" style={{ color: 'var(--t3)', cursor: 'pointer' }}>Отменить</button>
      )}
    </div>
  </div>
);
