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
const { app, BrowserWindow, shell, Menu, session, protocol, ipcMain, safeStorage, globalShortcut, screen, Tray, nativeImage, dialog } = require('electron');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
const path = require('node:path');
const fs = require('node:fs');
const { execFile } = require('node:child_process');

let tray = null;
let quitting = false;

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

/**
 * В обычный браузер уходят только веб-ссылки и почта. Ссылка приходит из
 * чужого сообщения или рекламы, а shell.openExternal отдаёт её системе как
 * есть: file:, smb:, ms-msdt: и другие протоколы запускают программы и
 * открывают файлы — это известный путь к выполнению кода в Electron.
 */
const openExternalSafe = (raw) => {
  let u;
  try { u = new URL(String(raw)); } catch { return; }
  if (['http:', 'https:', 'mailto:', 'tel:'].includes(u.protocol)) shell.openExternal(u.toString());
};

/** Отдаёт файлы из вшитого dist/ с откатом на index.html для клиентской маршрутизации. */
const serveDist = (request) => {
  const url = new URL(request.url);
  const decoded = decodeURIComponent(url.pathname);
  let filePath = path.normalize(path.join(DIST_DIR, decoded === '/' ? '' : decoded));
  // Выход за пределы dist/ через "../" в адресе невозможен: откатываемся на index.html.
  // Сравнение с разделителем: голый startsWith(DIST_DIR) пропускал бы и
  // соседний каталог с тем же началом имени (dist-old, dist2).
  if (filePath !== DIST_DIR && !filePath.startsWith(DIST_DIR + path.sep)) filePath = path.join(DIST_DIR, 'index.html');
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

/* ── Прокси приложения (Профиль → Подключение) ──────────────────────────────────────────────
   Настоящий механизм: session.setProxy направляет через прокси весь сетевой стек окна, включая
   WebSocket и медиа. Конфиг (и пароль) лежат в том же зашифрованном хранилище, что и токен, и
   применяются при каждом запуске — до загрузки страницы. HTTP-прокси с паролем отвечает на
   событие `login`; SOCKS с паролем Chromium не умеет, такой ввод отклоняется. */
const proxycfg = require('./proxycfg.cjs');
const PROXY_KEY = 'proxy-config';
let proxyAuth = { username: '', password: '' };

const loadProxyConfig = () => {
  if (!safeStorage.isEncryptionAvailable()) return null;
  const enc = readStore()[PROXY_KEY];
  if (!enc) return null;
  try { return JSON.parse(safeStorage.decryptString(Buffer.from(enc, 'base64'))); } catch { return null; }
};
const saveProxyConfig = (cfg) => {
  if (!safeStorage.isEncryptionAvailable()) return false;
  const store = readStore();
  store[PROXY_KEY] = safeStorage.encryptString(JSON.stringify(cfg)).toString('base64');
  writeStore(store);
  return true;
};
const applyProxy = async (cfg) => {
  if (!cfg || !cfg.enabled) {
    proxyAuth = { username: '', password: '' };
    await session.defaultSession.setProxy({ mode: 'system' });
    return { active: false };
  }
  proxyAuth = { username: cfg.username || '', password: cfg.password || '' };
  await session.defaultSession.setProxy({ mode: 'fixed_servers', proxyRules: proxycfg.normalize(cfg).rules });
  await session.defaultSession.closeAllConnections();
  return { active: true };
};
app.on('login', (event, _wc, _req, authInfo, callback) => {
  if (!authInfo.isProxy || !proxyAuth.username) return; // чужие запросы авторизации не трогаем
  event.preventDefault();
  callback(proxyAuth.username, proxyAuth.password);
});
const publicProxyView = (cfg) => cfg
  ? { enabled: Boolean(cfg.enabled), type: cfg.type, host: cfg.host, port: cfg.port, username: cfg.username || '', hasPassword: Boolean(cfg.password) }
  : { enabled: false, type: 'http', host: '', port: 8080, username: '', hasPassword: false };


/* ───── Sky Launcher: установка и запуск игр ─────
   Менеджер создаётся лениво — только когда человек открыл «Лаунчер» и вызвал init: пока вкладка не использовалась, ни кода, ни таймеров нет.
   Токен приходит из окна (при каждом обновлении), адрес API — тот же, что у приложения. Допустимые методы — закрытый список. */
let launcherMgr = null; let launcherToken = '';
const LAUNCHER_METHODS = new Set(['install', 'update', 'pause', 'resume', 'cancel', 'tasks', 'installed', 'verify', 'uninstall', 'launch', 'running', 'adopt', 'setLimits', 'freeSpace']);
ipcMain.handle('launcher:init', (_e, o) => {
  if (!launcherMgr) {
    const { createManager } = require('./launcher.cjs');
    const origin = String(o && o.apiOrigin || '');
    if (!/^https:\/\/[A-Za-z0-9.-]+(:\d+)?$/.test(origin) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return { error: 'bad_origin' };
    const root = path.join(app.getPath('home'), 'Sky Games');
    launcherMgr = createManager({
      apiOrigin: origin, getToken: async () => launcherToken, root, statePath: path.join(app.getPath('userData'), 'launcher-state.json'),
      onEvent: (ev) => { for (const w of BrowserWindow.getAllWindows()) { if (!w.isDestroyed()) w.webContents.send('launcher:event', ev); } },
    });
  }
  launcherToken = String(o && o.token || launcherToken);
  return { ok: true, root: launcherMgr.config.root };
});
ipcMain.handle('launcher:token', (_e, t) => { launcherToken = String(t || ''); return true; });
ipcMain.handle('launcher:call', async (_e, method, args) => {
  if (!launcherMgr) return { error: 'not_initialized' };
  if (!LAUNCHER_METHODS.has(method)) return { error: 'bad_method' };
  try { return await launcherMgr[method](...(Array.isArray(args) ? args.slice(0, 3) : [])); } catch (err) { return { error: String(err && err.message || err).slice(0, 80) }; }
});
ipcMain.handle('launcher:pick-folder', async () => {
  const r = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'], title: 'Папка для установки игры' });
  return r.canceled || !r.filePaths[0] ? null : r.filePaths[0];
});
ipcMain.handle('launcher:shutdown', () => { if (launcherMgr) launcherMgr.stopAll(); return true; });

ipcMain.handle('proxy:get', () => ({ ok: true, cfg: publicProxyView(loadProxyConfig()), encrypted: safeStorage.isEncryptionAvailable() }));
ipcMain.handle('proxy:apply', async (_event, raw) => {
  const prev = loadProxyConfig();
  // Пустой пароль в форме = «оставить прежний» (пароль в страницу не возвращается).
  const merged = { ...raw, password: raw?.password ? raw.password : (prev && prev.host === raw?.host ? prev.password : '') };
  const n = proxycfg.normalize(merged);
  if (!n.ok) return { ok: false, error: n.error };
  if (!safeStorage.isEncryptionAvailable()) return { ok: false, error: 'no_secure_storage' };
  try {
    await applyProxy(n.cfg);
    saveProxyConfig(n.cfg);
    return { ok: true, cfg: publicProxyView(n.cfg) };
  } catch (err) { return { ok: false, error: 'apply_failed', message: String(err?.message ?? err).slice(0, 160) }; }
});
/** Доступен ли порт прокси (TCP). Сам тест «через прокси» страница делает обычным запросом к Sky. */
ipcMain.handle('proxy:reach', (_event, raw) => new Promise((resolve) => {
  const n = proxycfg.normalize({ ...raw, enabled: true });
  if (!n.ok) return resolve({ ok: false, error: n.error });
  const net = require('node:net');
  const t0 = Date.now();
  const sock = net.connect({ host: n.cfg.host, port: n.cfg.port, timeout: 6000 });
  sock.once('connect', () => { sock.destroy(); resolve({ ok: true, ms: Date.now() - t0 }); });
  sock.once('timeout', () => { sock.destroy(); resolve({ ok: false, error: 'timeout' }); });
  sock.once('error', (e) => resolve({ ok: false, error: String(e.code || 'error') }));
}));

// Один запущенный экземпляр — второй запуск просто поднимает первое окно.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  let mainWindow = null;

  // Сменная иконка: окно и трей. Картинку рисует страница (canvas), здесь только проверка и установка.
  ipcMain.handle('app:set-icon', (_e, dataUrl) => {
    try {
      if (typeof dataUrl !== 'string' || !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(dataUrl) || dataUrl.length > 600000) return { ok: false };
      const img = nativeImage.createFromDataURL(dataUrl);
      if (img.isEmpty()) return { ok: false };
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setIcon(img);
      if (tray) tray.setImage(img.resize({ width: 16, height: 16 }));
      return { ok: true };
    } catch { return { ok: false }; }
  });

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

  /* Определение запущенных игр. Включается только по настройке в Sky; читаем лишь имена процессов и сверяем с известным
     списком (electron/known-games.json). Наружу уходит ТОЛЬКО id найденной игры — список программ остаётся на компьютере. */
  const KNOWN_GAMES = require('./known-games.json');
  const EXE_TO_GAME = new Map(KNOWN_GAMES.flatMap((g) => g.exe.map((e) => [e.toLowerCase(), g.id])));
  let gameTimer = null;
  const scanGames = () => {
    const win = process.platform === 'win32';
    execFile(win ? 'tasklist' : 'ps', win ? ['/FO', 'CSV', '/NH'] : ['-A', '-o', 'comm='],
      { windowsHide: true, timeout: 8000, maxBuffer: 8 * 1024 * 1024 }, (err, out) => {
        if (err || !mainWindow || mainWindow.isDestroyed()) return;
        let found = null;
        for (const line of String(out).split(/\r?\n/)) {
          const name = (win ? (line.match(/^"([^"]+)"/)?.[1] ?? '') : path.basename(line.trim())).toLowerCase();
          if (name && EXE_TO_GAME.has(name)) { found = EXE_TO_GAME.get(name); break; }
        }
        mainWindow.webContents.send('sky:game-detected', found);
        if (tray) tray.setToolTip(found ? `Sky — играет: ${KNOWN_GAMES.find((g) => g.id === found)?.title ?? ''}` : 'Sky');
      });
  };
  ipcMain.on('sky:game-detect', (event, on) => {
    if (event.sender !== mainWindow?.webContents) return;
    if (gameTimer) { clearInterval(gameTimer); gameTimer = null; }
    if (on) { scanGames(); gameTimer = setInterval(scanGames, 30_000); }
    else if (tray) tray.setToolTip('Sky');
  });

  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
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
        // Окно свёрнуто или закрыто в трей — музыка, статус «сейчас слушает» и уведомления продолжают работать.
        backgroundThrottling: false,
      },
    });

    mainWindow.loadURL(`${APP_ORIGIN}/`);

    // Любая внешняя ссылка (реклама, ссылка в тексте, window.open) уходит
    // в обычный браузер ОС, а не открывает второе окно приложения.
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      openExternalSafe(url);
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
        openExternalSafe(url);
      }
    });

    mainWindow.on('closed', () => { mainWindow = null; });

    // Закрытие окна уводит приложение в трей, а не завершает его: так
    // оно продолжает принимать сообщения и показывает уведомления Windows,
    // пока окно закрыто. Выход — из меню значка в трее или «Файл → Выход».
    mainWindow.on('close', (event) => {
      if (process.platform === 'win32' && !quitting && tray) {
        event.preventDefault();
        mainWindow.hide();
      }
    });
  };

  const showMainWindow = () => {
    if (!mainWindow) { createWindow(); return; }
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  };

  const createTray = () => {
    if (process.platform !== 'win32' || tray) return;
    try {
      const icon = nativeImage.createFromPath(path.join(DIST_DIR, 'logo.png')).resize({ width: 16, height: 16 });
      tray = new Tray(icon);
      tray.setToolTip('Sky');
      tray.setContextMenu(Menu.buildFromTemplate([
        { label: 'Открыть Sky', click: showMainWindow },
        { type: 'separator' },
        { label: 'Выход', click: () => { quitting = true; app.quit(); } },
      ]));
      tray.on('click', showMainWindow);
    } catch (e) { console.error('[tray]', e.message); tray = null; }
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
    // Прокси из прошлого запуска — до загрузки страницы.
    { const saved = loadProxyConfig(); if (saved?.enabled && proxycfg.normalize(saved).ok) applyProxy(saved).catch((e) => console.error('[proxy]', e.message)); }
    createWindow();
    createTray();

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

  app.on('before-quit', () => { quitting = true; });

  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
  });

  app.on('window-all-closed', () => {
    // В Windows окно закрывается только при выходе (иначе оно прячется в трей).
    if (process.platform !== 'darwin' && !tray) app.quit();
  });
}
