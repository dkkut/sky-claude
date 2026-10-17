/** Сайт восстановления доступа (recovery.html). Приложение Sky не запускается — только эта страница. */
import React from 'react';
import ReactDOM from 'react-dom/client';
import './styles.css';
import { initI18n } from './i18n';
import { RecoverySite } from './recovery/RecoverySite';

void initI18n().finally(() => ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><RecoverySite /></React.StrictMode>,
));
