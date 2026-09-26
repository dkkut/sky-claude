/* ===========================================================
   PC Quick Actions — определение, что этот рендер-процесс Electron
   открыт как overlay-окно (electron/main.cjs грузит
   app://sky/?quickActions=1), а не основное окно приложения.
=========================================================== */
export const isQuickActionsWindow = (): boolean => {
  if (typeof window === 'undefined') return false;
  try {
    return new URLSearchParams(window.location.search).get('quickActions') === '1';
  } catch {
    return false;
  }
};
