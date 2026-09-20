/**
 * Sky для Windows — Electron-обёртка боевого сайта.
 *
 * Окно открывает тот же боевой адрес (SKY_ORIGIN), что и веб и Android:
 * все относительные вызовы (/api/..., /ws) в src/core/auth/api.ts и
 * в мессенджере продолжают работать без изменений, а обновление сайта
 * не требует пересборки .exe.
 *
 * .cjs, а не .mjs: главный процесс Electron исторически CommonJS, и это
 * не зависит от "type": "module" в package.json — только этот файл и
 * preload.cjs остаются CommonJS, весь остальной проект как был ESM.
 */
const { app, BrowserWindow, shell, Menu, session } = require('electron');
const path = require('node:path');

const SKY_ORIGIN = process.env.SKY_ORIGIN || 'https://web.skymessenger.online';
const SKY_HOST = new URL(SKY_ORIGIN).host;

// Один запущенный экземпляр — второй запуск просто поднимает первое окно.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  let mainWindow = null;

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
        // Ничего своего не подмешиваем — это просто окно на боевой сайт,
        // а не гибридное приложение со своим JS-мостом.
        spellcheck: true,
      },
    });

    mainWindow.loadURL(SKY_ORIGIN);

    // Ссылки и window.open (например, «Перейти →» у рекламы, external
    // links) открываются в обычном браузере ОС, а не новым окном
    // Electron — это не создаёт второй такой же сайт внутри приложения.
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      shell.openExternal(url);
      return { action: 'deny' };
    });

    // Переход по ссылке внутри окна разрешён только на тот же домен.
    // Любой другой адрес (реклама, внешняя ссылка в тексте) уходит в
    // обычный браузер — иначе один клик подменял бы всё приложение
    // чужим сайтом.
    mainWindow.webContents.on('will-navigate', (event, url) => {
      let target;
      try { target = new URL(url); } catch { event.preventDefault(); return; }
      if (target.host !== SKY_HOST) {
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
    // Content-Security-Policy на уровне процесса не задаём — её ставит
    // сам сайт (см. server/http.mjs); здесь только запрет открывать
    // произвольные окна помимо основного (см. setWindowOpenHandler выше).
    session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
      // Камера/микрофон нужны «Вместе» и звонкам в мессенджере — остальное отклоняем.
      callback(['media', 'notifications', 'clipboard-sanitized-write'].includes(permission));
    });

    buildMenu();
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
