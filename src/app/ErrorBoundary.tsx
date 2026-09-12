import React from 'react';
import { AlertTriangle } from 'lucide-react';

interface EBState { hasError: boolean; error: Error | null; }

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode; fallback?: React.ReactNode },
  EBState
> {
  state: EBState = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): EBState {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback ?? (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', height: '100%', gap: 16, padding: 32,
          background: 'var(--bg-l1)', color: 'var(--t1)',
        }}>
          <AlertTriangle size={40} style={{ color: 'var(--amber)' }}/>
          <p style={{ fontWeight: 700, fontSize: 16 }}>Что-то пошло не так</p>
          <p style={{ color: 'var(--t2)', fontSize: 13, textAlign: 'center', maxWidth: 320 }}>
            {this.state.error?.message ?? 'Неизвестная ошибка'}
          </p>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            style={{
              background: 'var(--accent)', color: '#fff', border: 'none',
              borderRadius: 10, padding: '9px 20px', fontSize: 14,
              fontWeight: 600, cursor: 'pointer',
            }}>
            Попробовать снова
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
