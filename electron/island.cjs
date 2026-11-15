/**
 * Sky Island для Windows — отдельное окно-капсула поверх остальных (как Quick Actions, но другое назначение):
 * компактная форма вверху экрана, раскрывается в панель с запуском приложений, музыкой, погодой, уведомлениями
 * и сведениями о системе.
 *
 * Что здесь настоящее, а чего нет (честно):
 *  • CPU/RAM — из os; GPU — только если установлен nvidia-smi (иначе «нет данных»);
 *  • Wi-Fi — `netsh wlan show interfaces` (имя сети, уровень); Bluetooth и «VPN» включать из Sky нельзя —
 *    кнопки открывают настройки Windows; про VPN сообщаем лишь, что найден сетевой адаптер подобного вида;
 *  • «Запущенные приложения» — окна с заголовком (PowerShell Get-Process), читается только пока открыта страница «Система»;
 *  • питание — спящий режим / перезагрузка / выключение (со срочным подтверждением в окне и отменой `shutdown /a`);
 *  • рабочие столы Windows программно не переключаются — такого API нет.
 *
 * Фоновая нагрузка: сама капсула — один скрытый до первого показа процесс; таймер «5 минут после сворачивания» — ОДИН
 * setTimeout (повторно не заводится, пока идёт или сработал); опрос системы идёт только пока открыта страница «Система».
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');

const COMPACT = { w: 280, h: 52 };
const EXPANDED = { w: 700, h: 500 };
const MINIMIZE_DELAY_MS = 5 * 60 * 1000;
const DEFAULT_ACCEL = 'CommandOrControl+Alt+I';

const SETTINGS_URIS = { wifi: 'ms-settings:network-wifi', bluetooth: 'ms-settings:bluetooth', vpn: 'ms-settings:network-vpn', sound: 'ms-settings:sound', display: 'ms-settings:display', power: 'ms-settings:powersleep' };
const WIDGET_KEYS = new Set(['weather', 'music', 'notifications', 'resources', 'quick', 'ai', 'wallet']);
const MODULE_KEYS = new Set(['home', 'music', 'movies', 'tv', 'podcasts', 'books', 'ai', 'messages', 'market', 'go']);

module.exports = function setupIsland(ctx) {
  const { app, BrowserWindow, screen, ipcMain, globalShortcut, shell, dialog, APP_ORIGIN, getMainWindow, preloadPath } = ctx;
  const cfgPath = path.join(app.getPath('userData'), 'island.json');
  let win = null;
  let expanded = false;
  let timer = null;
  let accelOk = false;

  /* ── Настройки ─────────────────────────────────────────── */
  const DEFAULTS = { enabled: true, timerEnabled: true, accel: DEFAULT_ACCEL, apps: [] };
  let cfg = { ...DEFAULTS };
  try { cfg = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(cfgPath, 'utf8')) }; } catch { /* первый запуск */ }
  if (!Array.isArray(cfg.apps)) cfg.apps = [];
  const saveCfg = () => { try { fs.writeFileSync(cfgPath, JSON.stringify(cfg), { mode: 0o600 }); } catch { /* не критично */ } };
  const publicCfg = () => ({ enabled: cfg.enabled, timerEnabled: cfg.timerEnabled, accel: cfg.accel, accelOk, apps: cfg.apps.map((a) => ({ id: a.id, name: a.name })) });

  const fromIsland = (e) => Boolean(win && !win.isDestroyed() && e.sender === win.webContents);
  const fromMain = (e) => { const m = getMainWindow(); return Boolean(m && !m.isDestroyed() && e.sender === m.webContents); };

  /* ── Окно ──────────────────────────────────────────────── */
  const place = (size) => {
    if (!win || win.isDestroyed()) return;
    const d = screen.getPrimaryDisplay().workArea;
    win.setBounds({ x: Math.round(d.x + (d.width - size.w) / 2), y: d.y + 8, width: size.w, height: size.h });
  };
  /** Размер меняем без прыжка: окно остаётся по центру там, где его оставил человек (после перетаскивания). */
  const resize = (size) => {
    if (!win || win.isDestroyed()) return;
    const b = win.getBounds();
    const cx = b.x + b.width / 2;
    const d = screen.getDisplayMatching(b).workArea;
    const x = Math.min(Math.max(Math.round(cx - size.w / 2), d.x), d.x + d.width - size.w);
    win.setBounds({ x, y: Math.max(b.y, d.y), width: size.w, height: size.h });
  };

  const ensureWindow = () => {
    if (win && !win.isDestroyed()) return win;
    win = new BrowserWindow({
      width: COMPACT.w, height: COMPACT.h, show: false, frame: false, transparent: true, resizable: false, movable: true,
      alwaysOnTop: true, skipTaskbar: true, hasShadow: false, focusable: true, backgroundColor: '#00000000',
      webPreferences: { preload: preloadPath, contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: true },
    });
    win.setAlwaysOnTop(true, 'screen-saver');
    win.loadURL(`${APP_ORIGIN}/?island=1`);
    place(COMPACT);
    // Клик мимо закрывает раскрытую панель (капсула остаётся) — как в Atoll.
    win.on('blur', () => { if (expanded) setExpanded(false, true); });
    win.on('closed', () => { win = null; expanded = false; });
    return win;
  };

  const sendState = () => { if (win && !win.isDestroyed()) win.webContents.send('island:expanded', expanded); };
  const setExpanded = (on, fromBlur = false) => {
    if (!cfg.enabled) return;
    ensureWindow();
    expanded = Boolean(on);
    resize(expanded ? EXPANDED : COMPACT);
    if (!win.isVisible()) win.showInactive();
    if (expanded && !fromBlur) win.focus();
    sendState();
  };

  const toggle = () => {
    if (!cfg.enabled) return;
    ensureWindow();
    if (!win.isVisible()) { setExpanded(true); return; }
    setExpanded(!expanded);
  };

  /* ── Таймер «приложение свёрнуто 5 минут» ──────────────── */
  const cancelTimer = () => { if (timer) { clearTimeout(timer); timer = null; } };
  const armTimer = () => {
    // Один таймер на всё: повторное сворачивание, пока он идёт, ничего не заводит.
    if (timer || !cfg.enabled || !cfg.timerEnabled) return;
    timer = setTimeout(() => {
      timer = null;
      const m = getMainWindow();
      const away = !m || m.isDestroyed() || m.isMinimized() || !m.isVisible();
      if (away) setExpanded(true);   // вернулись раньше — таймер уже снят, лишнего окна нет
    }, MINIMIZE_DELAY_MS);
  };
  const watchMain = (m) => {
    if (!m || m.__islandWatched) return;
    m.__islandWatched = true;
    m.on('minimize', armTimer);
    m.on('hide', armTimer);
    for (const ev of ['restore', 'show', 'focus']) m.on(ev, () => { cancelTimer(); if (win && !win.isDestroyed() && expanded) setExpanded(false, true); });
    m.on('closed', cancelTimer);
  };

  /* ── Сочетание клавиш ──────────────────────────────────── */
  const applyAccel = (accel) => {
    try { if (cfg.accel) globalShortcut.unregister(cfg.accel); } catch { /* нечего снимать */ }
    accelOk = false;
    if (!accel) return false;
    try { accelOk = globalShortcut.register(accel, toggle); } catch { accelOk = false; }
    return accelOk;
  };
  const validAccel = (a) => typeof a === 'string' && a.length > 2 && a.length < 60 && /^[A-Za-z0-9+]+$/.test(a) && /(Control|Ctrl|Alt|Shift|Super|Command|Cmd)/i.test(a);

  /* ── Системные сведения ────────────────────────────────── */
  let lastCpu = null;
  const cpuNow = () => {
    const cpus = os.cpus(); let idle = 0; let total = 0;
    for (const c of cpus) { for (const k of Object.keys(c.times)) total += c.times[k]; idle += c.times.idle; }
    const cur = { idle, total }; const prev = lastCpu; lastCpu = cur;
    if (!prev || cur.total === prev.total) return null;
    return Math.max(0, Math.min(100, Math.round((1 - (cur.idle - prev.idle) / (cur.total - prev.total)) * 100)));
  };
  let gpuProbe = null; // null — не пробовали, false — нет nvidia-smi
  const gpuNow = () => new Promise((res) => {
    if (gpuProbe === false) { res(null); return; }
    execFile('nvidia-smi', ['--query-gpu=utilization.gpu', '--format=csv,noheader,nounits'], { windowsHide: true, timeout: 2500 }, (err, out) => {
      if (err) { gpuProbe = false; res(null); return; }
      gpuProbe = true; const n = parseInt(String(out).trim().split(/\r?\n/)[0], 10); res(Number.isFinite(n) ? n : null);
    });
  });
  const wifiNow = () => new Promise((res) => {
    if (process.platform !== 'win32') { res(null); return; }
    execFile('netsh', ['wlan', 'show', 'interfaces'], { windowsHide: true, timeout: 3000 }, (err, out) => {
      if (err) { res(null); return; }
      const txt = String(out); const field = (k) => (txt.match(new RegExp(`^\\s*${k}\\s*:\\s*(.+)$`, 'mi')) || [])[1]?.trim();
      const state = field('State|Состояние'); const ssid = field('SSID'); const sig = field('Signal|Сигнал');
      res({ connected: /connected|подключено/i.test(state || '') && !/disconnected|отключено/i.test(state || ''), ssid: ssid || null, signal: sig ? parseInt(sig, 10) : null });
    });
  });
  const vpnNow = () => {
    const names = Object.keys(os.networkInterfaces());
    const hit = names.find((n) => /vpn|wireguard|wg\d|tun\d|tap|openvpn|zerotier|tailscale|ppp|wintun/i.test(n));
    return hit ? { adapter: hit } : null;
  };

  const stats = async () => {
    const [gpu, wifi] = await Promise.all([gpuNow(), wifiNow()]);
    const total = os.totalmem(); const free = os.freemem();
    return { cpu: cpuNow(), gpu, ramUsedGb: +((total - free) / 1073741824).toFixed(1), ramTotalGb: +(total / 1073741824).toFixed(1), wifi, vpn: vpnNow() };
  };

  const processes = () => new Promise((res) => {
    if (process.platform !== 'win32') { res([]); return; }
    const ps = 'Get-Process | Where-Object { $_.MainWindowTitle } | Sort-Object WorkingSet64 -Descending | Select-Object -First 12 Name,Id,WorkingSet64 | ConvertTo-Json -Compress';
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { windowsHide: true, timeout: 6000, maxBuffer: 1024 * 1024 }, (err, out) => {
      if (err) { res([]); return; }
      try {
        const j = JSON.parse(String(out).trim() || '[]'); const arr = Array.isArray(j) ? j : [j];
        res(arr.map((p) => ({ name: String(p.Name || '').slice(0, 60), pid: Number(p.Id) || 0, ramMb: Math.round((Number(p.WorkingSet64) || 0) / 1048576) })));
      } catch { res([]); }
    });
  });

  /* ── Приложения для запуска ────────────────────────────── */
  const appById = (id) => cfg.apps.find((a) => a.id === id);

  /* ── IPC ───────────────────────────────────────────────── */
  ipcMain.handle('island:get-config', (e) => (fromIsland(e) || fromMain(e) ? publicCfg() : null));
  ipcMain.handle('island:set-config', (e, patch) => {
    if (!fromMain(e) && !fromIsland(e)) return null;
    const p = patch && typeof patch === 'object' ? patch : {};
    if (typeof p.enabled === 'boolean') { cfg.enabled = p.enabled; if (!cfg.enabled) { cancelTimer(); expanded = false; if (win && !win.isDestroyed()) win.hide(); } }
    if (typeof p.timerEnabled === 'boolean') { cfg.timerEnabled = p.timerEnabled; if (!cfg.timerEnabled) cancelTimer(); }
    if (typeof p.accel === 'string') {
      const a = p.accel.trim();
      if (a === '') { applyAccel(''); cfg.accel = ''; }
      else if (validAccel(a)) { const old = cfg.accel; if (applyAccel(a)) cfg.accel = a; else { cfg.accel = old; applyAccel(old); } }
    }
    saveCfg();
    return publicCfg();
  });
  ipcMain.handle('island:app-icons', async (e) => {
    if (!fromIsland(e)) return {};
    const out = {};
    for (const a of cfg.apps) { try { out[a.id] = (await app.getFileIcon(a.path, { size: 'normal' })).toDataURL(); } catch { /* без значка */ } }
    return out;
  });
  ipcMain.handle('island:add-app', async (e) => {
    if (!fromIsland(e) || cfg.apps.length >= 16) return publicCfg();
    // Диалог выбора: пока он открыт, капсула не должна закрываться по blur.
    win.removeAllListeners('blur');
    const r = await dialog.showOpenDialog(win, { title: 'Выберите программу', properties: ['openFile'], filters: [{ name: 'Программы и ярлыки', extensions: ['exe', 'lnk', 'bat', 'cmd'] }] });
    win.on('blur', () => { if (expanded) setExpanded(false, true); });
    if (!r.canceled && r.filePaths[0]) {
      const p = r.filePaths[0];
      if (!cfg.apps.some((a) => a.path === p)) { cfg.apps.push({ id: crypto.randomBytes(6).toString('hex'), name: path.basename(p).replace(/\.[^.]+$/, '').slice(0, 40), path: p }); saveCfg(); }
    }
    return publicCfg();
  });
  ipcMain.handle('island:remove-app', (e, id) => { if (!fromIsland(e)) return null; cfg.apps = cfg.apps.filter((a) => a.id !== id); saveCfg(); return publicCfg(); });
  ipcMain.handle('island:launch', async (e, id) => {
    if (!fromIsland(e)) return { ok: false };
    const a = appById(String(id)); if (!a) return { ok: false };
    const err = await shell.openPath(a.path);   // пустая строка — успех
    if (!err) setExpanded(false);
    return { ok: !err };
  });
  ipcMain.handle('island:open-settings', (e, which) => { if (!fromIsland(e)) return false; const uri = SETTINGS_URIS[String(which)]; if (!uri) return false; void shell.openExternal(uri); return true; });
  ipcMain.handle('island:stats', (e) => (fromIsland(e) || fromMain(e) ? stats() : null));
  ipcMain.handle('island:processes', (e) => (fromIsland(e) ? processes() : []));
  ipcMain.handle('island:power', (e, action) => new Promise((res) => {
    if (!fromIsland(e) || process.platform !== 'win32') { res({ ok: false }); return; }
    // Закрытый список; выключение и перезагрузка — с отсрочкой 30 с и отменой, а не мгновенно.
    const run = (file, args) => execFile(file, args, { windowsHide: true, timeout: 5000 }, (err) => res({ ok: !err }));
    if (action === 'shutdown') run('shutdown', ['/s', '/t', '30']);
    else if (action === 'restart') run('shutdown', ['/r', '/t', '30']);
    else if (action === 'cancel') run('shutdown', ['/a']);
    else if (action === 'sleep') run('rundll32.exe', ['powrprof.dll,SetSuspendState', '0,1,0']);
    else res({ ok: false });
  }));
  ipcMain.on('island:set-expanded', (e, on) => { if (fromIsland(e)) setExpanded(Boolean(on), !on); });
  ipcMain.on('island:hide', (e) => { if (fromIsland(e) && win && !win.isDestroyed()) { expanded = false; win.hide(); } });
  ipcMain.on('island:dock', (e) => { if (fromIsland(e)) place(expanded ? EXPANDED : COMPACT); });
  ipcMain.on('island:focus-main', (e) => { if (!fromIsland(e)) return; const m = getMainWindow(); if (m) { if (m.isMinimized()) m.restore(); m.show(); m.focus(); } });
  ipcMain.on('island:cmd', (e, cmd) => {
    if (!fromIsland(e)) return;
    const m = getMainWindow(); if (!m || m.isDestroyed()) return;
    let ok = cmd === 'lock';
    if (typeof cmd === 'string' && cmd.startsWith('module:') && MODULE_KEYS.has(cmd.slice(7))) ok = true;
    if (typeof cmd === 'string' && cmd.startsWith('widget:') && WIDGET_KEYS.has(cmd.slice(7))) ok = true;
    if (!ok) return;
    if (cmd !== 'lock') { if (m.isMinimized()) m.restore(); m.show(); m.focus(); }
    m.webContents.send('sky:island-cmd', cmd);
  });

  return {
    window: () => (win && !win.isDestroyed() ? win : null),
    start() {
      watchMain(getMainWindow());
      applyAccel(cfg.accel);
      // Капсула появляется только по сочетанию, по таймеру или командой — без постоянного окна на экране.
    },
    watchMain,
    toggle,
    stop() { cancelTimer(); try { if (cfg.accel) globalShortcut.unregister(cfg.accel); } catch { /* уже снят */ } },
  };
};
