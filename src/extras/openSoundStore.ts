import { create } from 'zustand';

export type SoundLicense = 'open' | 'personal';

export interface OpenTrack {
  id: string;
  title: string;
  artist: string;
  sourceUrl: string;
  coverHue: number;
  license: SoundLicense;
  ageRestricted: boolean;      // содержит нецензурные слова / отсылки к наркотическим веществам
  uploadedBy: string;
  uploaderName: string;
  plays: number;
  likes: string[];
  createdAt: string;
}

// Несколько демонстрационных открытых треков, чтобы вкладка не была пустой.
const SEED: OpenTrack[] = [
  { id:'os-1', title:'Midnight Drive',  artist:'Community Beats', sourceUrl:'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-7.mp3',  coverHue:18,  license:'open', ageRestricted:false, uploadedBy:'seed', uploaderName:'Community Beats',  plays:340, likes:[], createdAt:new Date(Date.now()-86400000*2).toISOString() },
  { id:'os-2', title:'Basement Freestyle', artist:'MC Vortex',     sourceUrl:'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-8.mp3',  coverHue:265, license:'open', ageRestricted:true,  uploadedBy:'seed', uploaderName:'MC Vortex',        plays:812, likes:[], createdAt:new Date(Date.now()-86400000*5).toISOString() },
  { id:'os-3', title:'Lo-Fi Study Loop', artist:'Rainy Desk',      sourceUrl:'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-9.mp3',  coverHue:150, license:'open', ageRestricted:false, uploadedBy:'seed', uploaderName:'Rainy Desk',       plays:1204,likes:[], createdAt:new Date(Date.now()-86400000*1).toISOString() },
];

interface OpenSoundStore {
  tracks: OpenTrack[];
  ageGateAccepted: boolean;
  acceptAgeGate: () => void;
  addTrack: (t: Omit<OpenTrack, 'id'|'plays'|'likes'|'createdAt'>) => void;
  toggleLike: (id: string, uid: string) => void;
  incrementPlays: (id: string) => void;
}

export const useOpenSoundStore = create<OpenSoundStore>((set) => ({
  tracks: SEED,
  ageGateAccepted: false,
  acceptAgeGate: () => set({ ageGateAccepted: true }),
  addTrack: (t) => set(s => ({
    tracks: [{ ...t, id: crypto.randomUUID(), plays: 0, likes: [], createdAt: new Date().toISOString() }, ...s.tracks],
  })),
  toggleLike: (id, uid) => set(s => ({
    tracks: s.tracks.map(t => t.id === id
      ? { ...t, likes: t.likes.includes(uid) ? t.likes.filter(u => u !== uid) : [...t.likes, uid] }
      : t),
  })),
  incrementPlays: (id) => set(s => ({
    tracks: s.tracks.map(t => t.id === id ? { ...t, plays: t.plays + 1 } : t),
  })),
}));
