/**
 * Sky для Windows — Electron-приложение с вшитым интерфейсом.
 *
 * dist/ (собранный НАТИВНЫМ режимом — npm run build:native, см.
 * .env.native) упакован прямо в установщик и отдаётся с собственной
 * привилегированной схемы app://sky вместо загрузки боевого сайта:
 * холодный старт мгновенный, обновление интерфейса требует новой сборки
 * .exe, а не только веб-деплоя (см. DEPLOY.md). Абсолютный адрес API
 * (VITE_API_ORIGIN) и явный токен вместо HttpOnly-куки — см.
 * src/core/nativeApp.ts и src/core/auth/api.ts.
 *
 * Своя схема, а не file://: у file:// в Chromium особое, неудобное для
 * CORS происхождение (null-origin для fetch), а app://sky — обычный,
 * стабильный origin, который сервер может внести в EXTRA_ORIGINS наравне
 * с https://localhost у Android.
 *
 * .cjs, а не .mjs: главный процесс Electron исторически CommonJS, и это
 * не зависит от "type": "module" в package.json — только этот файл и
 * preload.cjs остаются CommonJS, весь остальной проект как был ESM.
 */
const { app, BrowserWindow, shell, Menu, session, protocol, ipcMain, safeStorage, globalShortcut, screen } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const APP_SCHEME = 'app';
const APP_ORIGIN = `${APP_SCHEME}://sky`;
const DIST_DIR = path.join(__dirname, '..', 'dist');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
};

protocol.registerSchemesAsPrivileged([
  { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
]);

/** Отдаёт файлы из вшитого dist/ с откатом на index.html для клиентской маршрутизации. */
const serveDist = (request) => {
  const url = new URL(request.url);
  const decoded = decodeURIComponent(url.pathname);
  let filePath = path.normalize(path.join(DIST_DIR, decoded === '/' ? '' : decoded));
  // Выход за пределы dist/ через "../" в адресе невозможен: откатываемся на index.html.
  if (!filePath.startsWith(DIST_DIR)) filePath = path.join(DIST_DIR, 'index.html');
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(DIST_DIR, 'index.html');
  }
  const data = fs.readFileSync(filePath);
  const contentType = MIME_TYPES[path.extname(filePath)] ?? 'application/octet-stream';
  return new Response(data, { headers: { 'Content-Type': contentType } });
};

/**
 * Защищённое хранилище refresh-токена и пропуска беты — единственное,
 * что видит страница через preload.cjs. safeStorage шифрует значения
 * ключом ОС (Credential Manager/Keychain/libsecret); если шифрование
 * недоступно (бывает на Linux без ключевого кольца), НЕ откатываемся на
 * открытый текст — просто не сохраняем, тогда приложение честно спросит
 * вход заново вместо того, чтобы держать секрет незашифрованным на диске.
 */
const STORE_FILE = () => path.join(app.getPath('userData'), 'secure-store.json');

const readStore = () => {
  try { return JSON.parse(fs.readFileSync(STORE_FILE(), 'utf8')); } catch { return {}; }
};
const writeStore = (store) => {
  try { fs.writeFileSync(STORE_FILE(), JSON.stringify(store), { mode: 0o600 }); } catch { /* диск недоступен — не критично */ }
};

ipcMain.handle('secure-storage:get', (_event, key) => {
  if (!safeStorage.isEncryptionAvailable()) return null;
  const enc = readStore()[key];
  if (!enc) return null;
  try { return safeStorage.decryptString(Buffer.from(enc, 'base64')); } catch { return null; }
});
ipcMain.handle('secure-storage:set', (_event, key, value) => {
  if (!safeStorage.isEncryptionAvailable()) return;
  const store = readStore();
  store[key] = safeStorage.encryptString(String(value)).toString('base64');
  writeStore(store);
});
ipcMain.handle('secure-storage:remove', (_event, key) => {
  const store = readStore();
  delete store[key];
  writeStore(store);
});

// Один запущенный экземпляр — второй запуск просто поднимает первое окно.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  let mainWindow = null;

  /**
   * Quick Actions — плавающее окно по глобальному хоткею (работает даже
   * когда основное окно свёрнуто или не в фокусе).
   *
   * Архитектурное решение: overlay НЕ поднимает свой звук. Музыка —
   * это ЕДИНЫЙ <audio> в основном окне (PlayerEngine, см. src/player/),
   * а второй рендер-процесс Electron — это отдельный JS-контекст: если
   * бы overlay тоже смонтировал плеер, играли бы два звука разом.
   * Поэтому overlay — пульт: он только показывает состояние и шлёт
   * команды, основное окно — единственное, кто на самом деле нажимает
   * play/pause на настоящем <audio>. Мессенджер и Sky AI звука не
   * держат, поэтому у overlay в них собственные, независимые вызовы к
   * серверу — ретранслировать их через основное окно незачем.
   */
  const QUICK_ACTIONS_SHORTCUT = 'CommandOrControl+Shift+Space';
  let quickActionsWindow = null;

  const createQuickActionsWindow = () => {
    const win = new BrowserWindow({
      width: 380,
      height: 600,
      show: false,
      frame: false,
      resizable: false,
      movable: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      backgroundColor: '#0e0e11',
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    win.setAlwaysOnTop(true, 'screen-saver');
    win.loadURL(`${APP_ORIGIN}/?quickActions=1`);
    // Клик мимо — то же самое, что и Escape: окно прячется, а не
    // закрывается, чтобы не терять его состояние (пересоздавать этот
    // независимый рендер-процесс на каждый вызов — заметная задержка).
    win.on('blur', () => win.hide());
    win.on('closed', () => { quickActionsWindow = null; });
    return win;
  };

  const positionNearCursor = (win) => {
    const cursor = screen.getCursorScreenPoint();
    const display = screen.getDisplayNearestPoint(cursor);
    const { x: wx, y: wy, width: ww, height: wh } = display.workArea;
    const [winW, winH] = win.getSize();
    const x = Math.min(Math.max(cursor.x - Math.floor(winW / 2), wx + 8), wx + ww - winW - 8);
    const y = Math.min(Math.max(cursor.y + 16, wy + 8), wy + wh - winH - 8);
    win.setPosition(Math.round(x), Math.round(y));
  };

  const toggleQuickActions = () => {
    if (!quickActionsWindow || quickActionsWindow.isDestroyed()) {
      quickActionsWindow = createQuickActionsWindow();
    }
    if (quickActionsWindow.isVisible()) {
      quickActionsWindow.hide();
      return;
    }
    // Перезагрузка перед каждым показом, а не один раз при создании:
    // overlay мог провисеть скрытым долго, а за это время в основном
    // окне могли войти в другой аккаунт или выйти вовсе — без
    // перезагрузки он молча показывал бы состояние чужой, уже
    // закончившейся сессии.
    quickActionsWindow.webContents.reload();
    positionNearCursor(quickActionsWindow);
    quickActionsWindow.show();
    quickActionsWindow.focus();
  };

  ipcMain.on('quick-actions:hide', () => { quickActionsWindow?.hide(); });

  // «Открыть в Sky» на карточке фильма/подкаста в overlay: у видео и
  // так нет места в узкой панели overlay, поэтому просто поднимаем
  // основное окно поверх — открыть сам фильм человек уже сам, из
  // обычного интерфейса Sky Film/Podcasts.
  ipcMain.on('quick-actions:focus-main', () => {
    quickActionsWindow?.hide();
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  /**
   * Состояние и команды плеера гоняются между окнами через главный
   * процесс, а не напрямую (у BrowserWindow нет способа достучаться до
   * JS другого окна) — направление решает не переданный из renderer
   * флаг (ему верить нельзя), а то, ЧЕЙ webContents прислал событие.
   */
  let lastPlayerState = null;
  ipcMain.on('sky:player-state', (event, state) => {
    if (event.sender !== mainWindow?.webContents) return; // только из основного окна
    lastPlayerState = state;
    if (quickActionsWindow && !quickActionsWindow.isDestroyed()) {
      quickActionsWindow.webContents.send('sky:player-state', state);
    }
  });
  ipcMain.on('sky:player-state:request', (event) => {
    if (lastPlayerState) event.sender.send('sky:player-state', lastPlayerState);
  });
  ipcMain.on('sky:player-command', (event, cmd) => {
    if (event.sender !== quickActionsWindow?.webContents) return; // только из overlay
    mainWindow?.webContents.send('sky:player-command', cmd);
  });

  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  const createWindow = () => {
    mainWindow = new BrowserWindow({
      width: 1280,
      height: 820,
      minWidth: 720,
      minHeight: 480,
      backgroundColor: '#0e0e11', // var(--bg) — тот же тёмный космос, что в вебе
      title: 'Sky',
      icon: path.join(__dirname, '..', 'build-resources', 'icon.png'),
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: true,
      },
    });

    mainWindow.loadURL(`${APP_ORIGIN}/`);

    // Любая внешняя ссылка (реклама, ссылка в тексте, window.open) уходит
    // в обычный браузер ОС, а не открывает второе окно приложения.
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      shell.openExternal(url);
      return { action: 'deny' };
    });

    // Переход внутри окна разрешён только на собственную схему app://sky
    // (внутренняя навигация/перезагрузка). Любой http(s)-адрес — реклама,
    // внешняя ссылка в тексте — уходит в обычный браузер: приложение
    // больше никогда не переходит на боевой сайт само, оно его не грузит.
    mainWindow.webContents.on('will-navigate', (event, url) => {
      let target;
      try { target = new URL(url); } catch { event.preventDefault(); return; }
      if (target.protocol !== `${APP_SCHEME}:`) {
        event.preventDefault();
        shell.openExternal(url);
      }
    });

    mainWindow.on('closed', () => { mainWindow = null; });
  };

  const buildMenu = () => {
    const isMac = process.platform === 'darwin';
    const template = [
      ...(isMac ? [{ role: 'appMenu' }] : []),
      {
        label: 'Файл',
        submenu: [
          { label: 'Обновить', accelerator: 'CmdOrCtrl+R', click: () => mainWindow?.reload() },
          { type: 'separator' },
          { role: 'quit', label: 'Выход' },
        ],
      },
      {
        label: 'Правка',
        submenu: [
          { role: 'undo', label: 'Отменить' },
          { role: 'redo', label: 'Повторить' },
          { type: 'separator' },
          { role: 'cut', label: 'Вырезать' },
          { role: 'copy', label: 'Копировать' },
          { role: 'paste', label: 'Вставить' },
          { role: 'selectAll', label: 'Выделить всё' },
        ],
      },
      {
        label: 'Вид',
        submenu: [
          { role: 'resetZoom', label: 'Обычный размер' },
          { role: 'zoomIn', label: 'Увеличить' },
          { role: 'zoomOut', label: 'Уменьшить' },
          { type: 'separator' },
          { role: 'togglefullscreen', label: 'Во весь экран' },
          ...(process.env.NODE_ENV === 'development'
            ? [{ role: 'toggleDevTools', label: 'Инструменты разработчика' }]
            : []),
        ],
      },
      { role: 'windowMenu', label: 'Окно' },
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  };

  app.whenReady().then(() => {
    protocol.handle(APP_SCHEME, serveDist);

    // Content-Security-Policy на уровне процесса не задаём — её ставит
    // сам сайт (см. server/http.mjs); здесь только запрет открывать
    // произвольные окна помимо основного (см. setWindowOpenHandler выше).
    session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
      // Камера/микрофон нужны «Вместе» и звонкам в мессенджере — остальное отклоняем.
      callback(['media', 'notifications', 'clipboard-sanitized-write'].includes(permission));
    });

    buildMenu();
    createWindow();

    // Регистрация может не удаться, если сочетание уже занято другим
    // приложением — тогда просто не заводим глобальный хоткей вместо
    // падения всего процесса; окно Quick Actions всё равно останется
    // доступно (в будущем) через другой путь вызова.
    const registered = globalShortcut.register(QUICK_ACTIONS_SHORTCUT, toggleQuickActions);
    if (!registered) {
      console.error(`[Quick Actions] не удалось зарегистрировать ${QUICK_ACTIONS_SHORTCUT} — сочетание уже занято`);
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
