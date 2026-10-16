/**
 * Отдельная страница для ссылок из писем (verify.html): /admin-verify, /ssh-verify, /unfreeze, /storage-verify.
 * Приложение Sky здесь не запускается — только нужная страница, тема и язык.
 */
import React from 'react';
import ReactDOM from 'react-dom/client';
import './styles.css';
import { initI18n } from './i18n';
import { useSettings } from './settings/store';
import { AdminVerifyPage } from './admin/AdminGate';
import { UnfreezeLinkPage } from './auth/AccountFreeze';
import { StorageVerifyPage } from './admin/StorageVerify';

void useSettings.getState(); // создание стора применяет сохранённую тему

const Page = () => {
  const p = location.pathname;
  if (p === '/ssh-verify') return <AdminVerifyPage kind="ssh" />;
  if (p === '/storage-verify') return <StorageVerifyPage />;
  if (p === '/unfreeze') return <UnfreezeLinkPage />;
  return <AdminVerifyPage />;
};

void initI18n().finally(() => ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><Page /></React.StrictMode>,
));
