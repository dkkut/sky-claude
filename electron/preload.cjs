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
  gameDetect: {
    set: (on) => ipcRenderer.send('sky:game-detect', Boolean(on)),
    onDetected: (fn) => {
      const listener = (_event, id) => fn(typeof id === 'string' ? id : null);
      ipcRenderer.on('sky:game-detected', listener);
      return () => ipcRenderer.removeListener('sky:game-detected', listener);
    },
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
