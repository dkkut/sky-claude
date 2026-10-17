import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { isChunkError } from './lazyChunk';
import { reportClient } from '@/core/telemetry';

interface EBState { hasError: boolean; error: Error | null; }

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode; fallback?: React.ReactNode },
  EBState
> {
  state: EBState = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): EBState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error) {
    // Сбой отрисовки уходит в единый журнал (без содержимого экрана): тип, короткое сообщение, адрес без идентификаторов.
    reportClient(isChunkError(error) ? 'stale_chunk' : 'render_error', error, isChunkError(error) ? 'WARN' : 'ERROR');
  }

  render() {
    if (this.state.hasError) {
      /*
       * Пропавший кусок приложения — не поломка, а след обновления: у
       * страницы на руках старый список частей, а на сервере уже новый.
       * Лечится это перезагрузкой, и только ею. Обычное «Попробовать
       * снова» здесь бесполезно: React запоминает неудачную загрузку и
       * повторяет её из памяти, не обращаясь к сети. Поэтому и кнопка,
       * и объяснение тут другие.
       */
      const stale = isChunkError(this.state.error);

      return this.props.fallback ?? (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', height: '100%', gap: 16, padding: 32,
          background: 'var(--bg-l1)', color: 'var(--t1)',
        }}>
          <AlertTriangle size={40} style={{ color: 'var(--amber)' }}/>
          <p style={{ fontWeight: 700, fontSize: 16 }}>
            {stale ? 'Приложение обновилось' : 'Что-то пошло не так'}
          </p>
          <p style={{ color: 'var(--t2)', fontSize: 13, textAlign: 'center', maxWidth: 320 }}>
            {stale
              ? 'Эта вкладка открыта со старой версии. Обновите страницу — всё продолжится с того же места.'
              : (this.state.error?.message ?? 'Неизвестная ошибка')}
          </p>
          <button
            onClick={() => {
              if (stale) {
                /* Метку не трогаем: если и после этой перезагрузки
                   кусок не придёт, защита должна удержать страницу от
                   круга и показать честную ошибку. */
                window.location.reload();
                return;
              }
              this.setState({ hasError: false, error: null });
            }}
            style={{
              background: 'var(--accent)', color: '#fff', border: 'none',
              borderRadius: 10, padding: '9px 20px', fontSize: 14,
              fontWeight: 600, cursor: 'pointer',
            }}>
            {stale ? 'Обновить' : 'Попробовать снова'}
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
