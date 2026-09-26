/* ===========================================================
   PC Quick Actions — пульт со стороны OVERLAY-окна.

   Overlay не держит своего плеера: он только получает состояние из
   основного окна (через главный процесс, см. electron/main.cjs) и
   шлёт туда команды. Реальный <audio> — там, единственный.
=========================================================== */
import { useEffect, useState } from 'react';
import type { SkyPlayerState, SkyPlayerCommand } from '@/core/nativeApp';

const EMPTY: SkyPlayerState = { kind: null, title: '', author: '', isPlaying: false, currentTime: 0, duration: 0 };

export const useRemotePlayer = () => {
  const [state, setState] = useState<SkyPlayerState>(EMPTY);

  useEffect(() => {
    const off = window.sky!.quickActions.onPlayerState(setState);
    window.sky!.quickActions.requestPlayerState();
    return off;
  }, []);

  const send = (cmd: SkyPlayerCommand) => window.sky!.quickActions.sendPlayerCommand(cmd);

  return {
    state,
    toggle: () => send({ type: 'toggle' }),
    next: () => send({ type: 'next' }),
    prev: () => send({ type: 'prev' }),
    skip: (deltaSec: number) => send({ type: 'skip', deltaSec }),
  };
};
