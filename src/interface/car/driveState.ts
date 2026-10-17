/** Живое состояние «едет / стоит / неизвестно» для Sky Car: геолокация устройства + правила из driveLogic.ts. */
import { useEffect } from 'react';
import { create } from 'zustand';
import { initialDrive, onFix, onTick, type DriveMemory, type DriveState } from './driveLogic';

interface S { state: DriveState; speed: number | null; permission: 'unknown' | 'granted' | 'denied' | 'unsupported' }
export const useDriveState = create<S>(() => ({ state: 'unknown', speed: null, permission: 'unknown' }));

let mem: DriveMemory = initialDrive();
const publish = (speed: number | null) => useDriveState.setState((s) => (s.state === mem.state && s.speed === speed ? s : { state: mem.state, speed }));

/** Подписаться на геолокацию, пока открыт экран Car. Возвращает отписку. */
export const startDriveWatch = (): (() => void) => {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    useDriveState.setState({ permission: 'unsupported', state: 'unknown' });
    return () => {};
  }
  mem = initialDrive();
  let last: number | null = null;
  const id = navigator.geolocation.watchPosition(
    (pos) => {
      last = pos.coords.speed;
      mem = onFix(mem, pos.coords.speed, Date.now());
      useDriveState.setState({ permission: 'granted' });
      publish(last);
    },
    (err) => {
      mem = onFix(mem, null, Date.now());
      useDriveState.setState({ permission: err.code === 1 ? 'denied' : 'unknown' });
      publish(null);
    },
    { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 },
  );
  const tick = window.setInterval(() => { mem = onTick(mem, Date.now()); publish(last); }, 2000);
  return () => { navigator.geolocation.clearWatch(id); window.clearInterval(tick); mem = initialDrive(); useDriveState.setState({ state: 'unknown', speed: null }); };
};

/** Хук для экранов Car, которым нужно состояние: сам включает и выключает слежение. */
export const useDriveWatch = () => {
  useEffect(() => startDriveWatch(), []);
  return useDriveState((s) => s);
};
