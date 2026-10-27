import { apiCall } from '@/core/auth/api';

export type WidgetSize = 'compact' | 'standard' | 'wide';
export interface WidgetDef { id: string; type: string; size: WidgetSize; cfg: Record<string, unknown> }
export interface HomeLayout { v: 1; widgets: WidgetDef[]; density: 'cozy' | 'normal' | 'dense'; surface: 'glass' | 'solid' | 'clear'; accent: string | null }
export interface LayoutRow { id: string; name: string; active: boolean; layout: HomeLayout; updatedAt: string }
export interface RegistryItem { type: string; cat: string; sizes: WidgetSize[] }
export interface HomeState { layouts: LayoutRow[]; registry: RegistryItem[]; limits: { widgets: number; layouts: number; custom: number } }

export type WaveKind = 'music' | 'film' | 'video' | 'podcast' | 'book';
export interface WaveItem { kind: WaveKind; id: string; title: string; sub: string; reason?: string; progress?: number; authorKey?: string }
export interface Shelf { id: string; title: string; personal: boolean; fallback?: boolean; editorial?: boolean; reason?: string; items: WaveItem[] }
export interface WaveState { shelves: Shelf[]; editorial: Shelf[]; hidden: string[]; order: string[]; personalize: boolean; prime: boolean; signals: number }

const j = (b: unknown) => JSON.stringify(b);
export const apiHome = async () => { const r = await apiCall<HomeState>('/api/media/home'); return r.ok ? r.data ?? null : null; };
export const apiLayoutCreate = (b: { name?: string; copyOf?: string; layout?: HomeLayout }) => apiCall<{ layout: LayoutRow; error?: string }>('/api/media/home/layouts', { method: 'POST', body: j(b) });
export const apiLayoutSave = (id: string, b: { name?: string; layout?: HomeLayout }) => apiCall<{ layout: LayoutRow }>(`/api/media/home/layouts/${id}`, { method: 'PUT', body: j(b) });
export const apiLayoutActivate = (id: string) => apiCall(`/api/media/home/layouts/${id}/activate`, { method: 'POST', body: '{}' });
export const apiLayoutDelete = (id: string) => apiCall(`/api/media/home/layouts/${id}`, { method: 'DELETE' });

export const apiWave = async (shelf?: string) => { const r = await apiCall<WaveState>(`/api/media/wave${shelf ? `?shelf=${shelf}` : ''}`); return r.ok ? r.data ?? null : null; };
export const apiWaveFeedback = (b: { kind: WaveKind; itemId: string; signal: 'more' | 'less' | 'hide' | 'mute_author'; authorKey?: string }) => apiCall('/api/media/wave/feedback', { method: 'POST', body: j(b) });
export const apiWaveClear = () => apiCall('/api/media/wave/feedback', { method: 'DELETE' });
export const apiWavePrefs = (b: { hidden?: string[]; order?: string[]; personalize?: boolean }) => apiCall('/api/media/wave/prefs', { method: 'PUT', body: j(b) });
export const apiWaveWhy = async (shelf: string, kind: string, id: string) => {
  const r = await apiCall<{ reason: string; personal: boolean; fallback: boolean; signals: number }>(`/api/media/wave/why?shelf=${shelf}&kind=${kind}&id=${encodeURIComponent(id)}`);
  return r.ok ? r.data ?? null : null;
};
export const apiWaveAdmin = async () => { const r = await apiCall<{ config: { disabled: string[]; editorial: unknown[] }; diagnostics: { days: number; shelves: { shelf: string; built: number; empty: number; errors: number; avg_ms: number }[] } }>('/api/admin/wave'); return r.ok ? r.data ?? null : null; };
export const apiWaveAdminSave = (b: { disabled?: string[]; editorial?: unknown[] }) => apiCall('/api/admin/wave', { method: 'PUT', body: j(b) });
