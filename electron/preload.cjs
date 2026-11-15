/**
 * Мост в главный процесс — единственное, что видит страница помимо
 * обычного DOM. Ничего от Node напрямую не отдаём (sandbox: true в
 * main.cjs): только узкие функции для защищённого хранилища
 * refresh-токена/пропуска беты (см. src/core/nativeApp.ts) и для моста
 * Quick Actions между основным окном и overlay (см.
 * src/interface/quickactions/) — сами они реализованы в main.cjs.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('sky', {
  secureStorage: {
    get:    (key) => ipcRenderer.invoke('secure-storage:get', key),
    set:    (key, value) => ipcRenderer.invoke('secure-storage:set', key, value),
    remove: (key) => ipcRenderer.invoke('secure-storage:remove', key),
  },
  proxy: {
    get:   () => ipcRenderer.invoke('proxy:get'),
    apply: (cfg) => ipcRenderer.invoke('proxy:apply', cfg),
    reach: (cfg) => ipcRenderer.invoke('proxy:reach', cfg),
  },
  setAppIcon: (dataUrl) => ipcRenderer.invoke('app:set-icon', dataUrl),
  lock: (on) => ipcRenderer.invoke('lock:set', Boolean(on)),
  launcher: {
    init: (opts) => ipcRenderer.invoke('launcher:init', opts),
    setToken: (t) => ipcRenderer.invoke('launcher:token', t),
    call: (method, ...args) => ipcRenderer.invoke('launcher:call', method, args),
    pickFolder: () => ipcRenderer.invoke('launcher:pick-folder'),
    pauseAll: () => ipcRenderer.invoke('launcher:shutdown'),
    onEvent: (fn) => { const l = (_e, ev) => fn(ev); ipcRenderer.on('launcher:event', l); return () => ipcRenderer.removeListener('launcher:event', l); },
  },
  gameDetect: {
    set: (on) => ipcRenderer.send('sky:game-detect', Boolean(on)),
    onDetected: (fn) => {
      const listener = (_event, id) => fn(typeof id === 'string' ? id : null);
      ipcRenderer.on('sky:game-detected', listener);
      return () => ipcRenderer.removeListener('sky:game-detected', listener);
    },
  },
  island: {
    getConfig: () => ipcRenderer.invoke('island:get-config'),
    setConfig: (patch) => ipcRenderer.invoke('island:set-config', patch),
    appIcons: () => ipcRenderer.invoke('island:app-icons'),
    addApp: () => ipcRenderer.invoke('island:add-app'),
    removeApp: (id) => ipcRenderer.invoke('island:remove-app', id),
    launch: (id) => ipcRenderer.invoke('island:launch', id),
    openSettings: (which) => ipcRenderer.invoke('island:open-settings', which),
    stats: () => ipcRenderer.invoke('island:stats'),
    processes: () => ipcRenderer.invoke('island:processes'),
    power: (action) => ipcRenderer.invoke('island:power', action),
    setExpanded: (on) => ipcRenderer.send('island:set-expanded', Boolean(on)),
    hide: () => ipcRenderer.send('island:hide'),
    dock: () => ipcRenderer.send('island:dock'),
    focusMain: () => ipcRenderer.send('island:focus-main'),
    command: (cmd) => ipcRenderer.send('island:cmd', cmd),
    onExpanded: (fn) => { const l = (_e, v) => fn(Boolean(v)); ipcRenderer.on('island:expanded', l); return () => ipcRenderer.removeListener('island:expanded', l); },
    /** Основное окно: команды с острова («lock», «module:music»). */
    onCommand: (fn) => { const l = (_e, c) => fn(c); ipcRenderer.on('sky:island-cmd', l); return () => ipcRenderer.removeListener('sky:island-cmd', l); },
  },
  quickActions: {
    hide: () => ipcRenderer.send('quick-actions:hide'),
    focusMain: () => ipcRenderer.send('quick-actions:focus-main'),
    /** Основное окно зовёт при каждом изменении состояния плеера. */
    sendPlayerState: (state) => ipcRenderer.send('sky:player-state', state),
    /** Overlay зовёт один раз при открытии — получить состояние сразу, не дожидаясь следующего изменения. */
    requestPlayerState: () => ipcRenderer.send('sky:player-state:request'),
    onPlayerState: (fn) => {
      const listener = (_event, state) => fn(state);
      ipcRenderer.on('sky:player-state', listener);
      return () => ipcRenderer.removeListener('sky:player-state', listener);
    },
    /** Overlay зовёт, чтобы основное окно выполнило команду на настоящем плеере. */
    sendPlayerCommand: (cmd) => ipcRenderer.send('sky:player-command', cmd),
    onPlayerCommand: (fn) => {
      const listener = (_event, cmd) => fn(cmd);
      ipcRenderer.on('sky:player-command', listener);
      return () => ipcRenderer.removeListener('sky:player-command', listener);
    },
  },
});
