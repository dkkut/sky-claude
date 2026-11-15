/** Этот рендер-процесс Electron открыт как окно Sky Island (electron/island.cjs грузит app://sky/?island=1). */
export const isIslandWindow = (): boolean => {
  if (typeof window === 'undefined') return false;
  try { return new URLSearchParams(window.location.search).get('island') === '1'; } catch { return false; }
};
