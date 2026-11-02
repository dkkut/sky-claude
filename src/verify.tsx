/**
 * Отдельная страница для ссылок из писем (verify.html): /admin-verify, /ssh-verify, /unfreeze, /storage-verify.
 * Приложение Sky здесь не запускается — только нужная страница, тема и язык.
 */
import React from 'react';
import ReactDOM from 'react-dom/client';
import './styles.css';
import { initI18n } from './i18n';
import { useSettings } from './settings/store';
import { AdminVerifyPage, SshLegacyConfirmPage, ShutdownConfirmPage } from './admin/AdminGate';
import { UnfreezeLinkPage, TwoFactorResetLinkPage } from './auth/AccountFreeze';
import { StorageVerifyPage } from './admin/StorageVerify';
import { DefenseUndoPage } from './defense/UndoPage';

void useSettings.getState(); // создание стора применяет сохранённую тему

const Page = () => {
  const p = location.pathname;
  if (p === '/ssh-confirm') return <SshLegacyConfirmPage />;
  if (p === '/shutdown-confirm') return <ShutdownConfirmPage />;
  if (p === '/ssh-verify') return <AdminVerifyPage kind="ssh" />;
  if (p === '/defense-undo') return <DefenseUndoPage />;
  if (p === '/storage-verify') return <StorageVerifyPage />;
  if (p === '/2fa-reset') return <TwoFactorResetLinkPage />;
  if (p === '/unfreeze') return <UnfreezeLinkPage />;
  return <AdminVerifyPage />;
};

void initI18n().finally(() => ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><Page /></React.StrictMode>,
));
