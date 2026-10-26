/* ===============================================================
   ЛЕНИВЫЕ МОДУЛИ

   Тяжёлые экраны грузятся отдельными чанками. Объявления собраны в
   одном месте намеренно: если хотя бы одна оболочка (десктоп, мобайл,
   ТВ) импортирует модуль статически, Rollup не вынесет его в отдельный
   чанк и разделение бандла перестанет работать.

   Модули экспортируются по имени, поэтому .then() приводит их к форме
   { default }, которую ждёт React.lazy.
=============================================================== */
import React from 'react';
import { lazyChunk } from './lazyChunk';

export const ExtrasModule   = lazyChunk(() => import('@/extras/ExtrasModule').then(m => ({ default: m.ExtrasModule })));
export const LibraryModule  = lazyChunk(() => import('@/library/LibraryModule').then(m => ({ default: m.LibraryModule })));
export const BusinessStudio = lazyChunk(() => import('@/library/BusinessStudio').then(m => ({ default: m.BusinessStudio })));
export const BusinessModule = lazyChunk(() => import('@/business/BusinessModule').then(m => ({ default: m.BusinessModule })));
export const BloomModule    = lazyChunk(() => import('@/bloom/BloomModule').then(m => ({ default: m.BloomModule })));
export const ProfileModule  = lazyChunk(() => import('@/profile/ProfileModule').then(m => ({ default: m.ProfileModule })));
export const StoriesModule  = lazyChunk(() => import('@/stories/StoriesModule').then(m => ({ default: m.StoriesModule })));
export const GamingModule   = lazyChunk(() => import('@/gaming/GamingModule').then(m => ({ default: m.GamingModule })));
export const SkyVideo       = lazyChunk(() => import('@/extras/SkyVideo').then(m => ({ default: m.SkyVideo })));

/** Заглушка на время подгрузки чанка модуля. */
export const ModuleFallback = () => (
  <div className="h-full w-full grid place-items-center">
    <div className="h-8 w-8 rounded-full border-2 animate-spin"
      style={{ borderColor: 'var(--border)', borderTopColor: 'var(--accent)' }} />
  </div>
);
