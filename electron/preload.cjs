/**
 * Мост в главный процесс — единственное, что видит страница помимо
 * обычного DOM. Ничего от Node напрямую не отдаём (sandbox: true в
 * main.cjs): только три узкие функции для защищённого хранилища
 * refresh-токена и пропуска беты (см. src/core/nativeApp.ts), сами они
 * реализованы в main.cjs через safeStorage — шифрование на уровне ОС,
 * страница до него не дотянется.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('sky', {
  secureStorage: {
    get:    (key) => ipcRenderer.invoke('secure-storage:get', key),
    set:    (key, value) => ipcRenderer.invoke('secure-storage:set', key, value),
    remove: (key) => ipcRenderer.invoke('secure-storage:remove', key),
  },
});
