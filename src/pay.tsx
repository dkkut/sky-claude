/**
 * Страница оплаты SkyKassa Business (pay.html): /p/<id>. Приложение Sky здесь не запускается — только страница оплаты, тема и язык.
 * Работает без входа в Sky.
 */
import React from 'react';
import ReactDOM from 'react-dom/client';
import './styles.css';
import { initI18n } from './i18n';
import { useSettings } from './settings/store';
import { PayPage } from './kassabiz/PayPage';

void useSettings.getState(); // создание стора применяет сохранённую тему

const Page = () => {
  const m = /^\/p\/([a-z0-9]{12,24})\/?$/.exec(location.pathname);
  if (!m) return <p style={{ padding: 40, textAlign: 'center', color: 'var(--t2)' }}>Страница оплаты не найдена.</p>;
  return <PayPage pid={m[1]} />;
};

void initI18n().finally(() => ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><Page /></React.StrictMode>));
