/** Основное окно Sky (Windows): принимает команды с острова — «lock» (экран блокировки) и «module:<раздел>». */
import { useEffect } from 'react';
import { isElectron } from '@/core/nativeApp';
import { runShortcut } from '@/shortcuts/shortcuts';
import { useLockScreen } from './lockStore';
import { isIslandWindow } from '@/interface/island/useIslandWindow';

export const IslandCommandBridge = () => {
  useEffect(() => {
    if (!isElectron() || isIslandWindow()) return undefined;
    return window.sky?.island?.onCommand((cmd) => {
      if (cmd === 'lock') useLockScreen.getState().show();
      else if (cmd.startsWith('module:')) runShortcut(cmd);
    });
  }, []);
  return null;
};
