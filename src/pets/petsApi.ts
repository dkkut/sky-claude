/* ===============================================================
   SKY PETS — разговор с сервером (server/pets.mjs).

   Владение питомцем/скином, опыт, деньги за скин — всё решает только
   сервер. Этот файл только зовёт ручки.
=============================================================== */
import { apiCall } from '@/core/auth/api';

export type PetState = 'idle' | 'happy' | 'hungry' | 'sleeping';
export type Rarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary' | 'mythic';

export interface Pet {
  id: string;
  type: string;
  name: string;
  level: number;
  experience: number;
  activeSkinId: string | null;
  state: PetState;
  createdAt: string;
  ownedSkinIds: string[];
}

export interface PetSkin {
  id: string;
  petType: string;
  name: string;
  description: string;
  rarity: Rarity;
  price: number;
  previewUrl?: string;
  modelUrl?: string;
  animations: string[];
  effects: string[];
  status?: 'active' | 'retired';
  owned?: boolean;
}

export const apiPetsMeta = async (): Promise<{ petTypes: string[]; rarities: string[] }> => {
  const r = await apiCall<{ petTypes: string[]; rarities: string[] }>('/api/pets/meta');
  return r.ok && r.data ? r.data : { petTypes: [], rarities: [] };
};

export const apiPetsMe = async (wantedType?: string): Promise<Pet | null> => {
  const q = wantedType ? `?type=${encodeURIComponent(wantedType)}` : '';
  const r = await apiCall<{ pet: Pet }>(`/api/pets/me${q}`);
  return r.ok ? r.data?.pet ?? null : null;
};

export const apiPetsRename = async (name: string) => {
  const r = await apiCall<{ pet: Pet }>('/api/pets/me/rename', { method: 'POST', body: JSON.stringify({ name }) });
  return r.ok ? { ok: true as const, pet: r.data?.pet as Pet } : { ok: false as const, error: r.error };
};

export const apiPetsChangeType = async (type: string) => {
  const r = await apiCall<{ pet: Pet }>('/api/pets/me/type', { method: 'POST', body: JSON.stringify({ type }) });
  return r.ok ? { ok: true as const, pet: r.data?.pet as Pet } : { ok: false as const, error: r.error };
};

export const apiPetsInteract = async (action: 'feed' | 'play') => {
  const r = await apiCall<{ pet: Pet }>('/api/pets/me/interact', { method: 'POST', body: JSON.stringify({ action }) });
  return r.ok ? { ok: true as const, pet: r.data?.pet as Pet } : { ok: false as const, error: r.error };
};

export const apiPetsSetSkin = async (skinId: string) => {
  const r = await apiCall<{ pet: Pet }>('/api/pets/me/skin', { method: 'POST', body: JSON.stringify({ skinId }) });
  return r.ok ? { ok: true as const, pet: r.data?.pet as Pet } : { ok: false as const, error: r.error };
};

export const apiPetsMarket = async (opts: { q?: string; rarity?: string; petType?: string } = {}): Promise<PetSkin[]> => {
  const p = new URLSearchParams();
  if (opts.q) p.set('q', opts.q);
  if (opts.rarity) p.set('rarity', opts.rarity);
  if (opts.petType) p.set('petType', opts.petType);
  const r = await apiCall<{ items: PetSkin[] }>(`/api/pets/market?${p.toString()}`);
  return r.ok ? r.data?.items ?? [] : [];
};

export const apiPetsGetSkin = async (skinId: string): Promise<PetSkin | null> => {
  const r = await apiCall<{ skin: PetSkin }>(`/api/pets/market/${encodeURIComponent(skinId)}`);
  return r.ok ? r.data?.skin ?? null : null;
};

export const apiPetsBuySkin = async (skinId: string) => {
  const r = await apiCall<{ ok: true; skinId: string }>(`/api/pets/market/${encodeURIComponent(skinId)}/buy`, { method: 'POST' });
  return r.ok ? { ok: true as const } : { ok: false as const, error: r.error };
};

/* ─── Админка каталога ──────────────────────────────────────────── */

export const apiPetsAdminList = async (): Promise<PetSkin[]> => {
  const r = await apiCall<{ items: PetSkin[] }>('/api/pets/admin/skins');
  return r.ok ? r.data?.items ?? [] : [];
};

export const apiPetsAdminCreate = async (input: {
  petType: string; name: string; description?: string; rarity: string; price: number;
  previewMediaId?: string; previewMime?: string; modelMediaId?: string; modelMime?: string;
}) => {
  const r = await apiCall<{ id: string }>('/api/pets/admin/skins', { method: 'POST', body: JSON.stringify(input) });
  return r.ok ? { ok: true as const, id: r.data?.id as string } : { ok: false as const, error: r.error };
};

export const apiPetsAdminRetire = async (skinId: string) => {
  const r = await apiCall(`/api/pets/admin/skins/${encodeURIComponent(skinId)}/retire`, { method: 'POST' });
  return r.ok;
};

export interface UploadedPetMedia { mediaId: string; mime: string; bytes: number }
export const apiPetsAdminUpload = async (file: File, kind: 'image' | 'model'): Promise<UploadedPetMedia | null> => {
  const r = await apiCall<UploadedPetMedia>(`/api/pets/admin/media?kind=${kind}`, {
    method: 'POST', body: file, headers: { 'Content-Type': file.type || 'application/octet-stream' },
  });
  return r.ok ? r.data ?? null : null;
};
