import { create } from 'zustand';

export interface ContentItem {
  id:string; type:'music'|'video'|'podcast'|'file';
  title:string; subtitle?:string; duration?:string;
  coverGrad:[string,string]; coverUrl?:string;
  addedAt:string; progress?:number; isFavorite:boolean; sourceId?:string;
}
interface MonetizationState {
  library:ContentItem[];
  addToLibrary:(item:Omit<ContentItem,'id'|'addedAt'|'isFavorite'>)=>void;
  toggleFavorite:(id:string)=>void;
  removeFromLib:(id:string)=>void;
  updateProgress:(id:string,progress:number)=>void;
}
const lsGet=(k:string,d:any)=>{try{const r=localStorage.getItem(k);return r?JSON.parse(r):d;}catch{return d;}};
const lsSet=(k:string,v:any)=>{try{localStorage.setItem(k,JSON.stringify(v));}catch{}};
const SEED_LIBRARY:ContentItem[]=[
  {id:'l1',type:'music',title:'Neon Drive',subtitle:'DJ Skyline',duration:'3:42',coverGrad:['#6366f1','#8b5cf6'],addedAt:new Date(Date.now()-3600000).toISOString(),progress:.38,isFavorite:true},
  {id:'l2',type:'video',title:'Sky Conference',subtitle:'Tech · 24 мин',duration:'24:10',coverGrad:['#0ea5e9','#2563eb'],addedAt:new Date(Date.now()-7200000).toISOString(),progress:.62,isFavorite:false},
  {id:'l3',type:'podcast',title:'Sky Talk EP.12',subtitle:'Дизайн и код',duration:'48:30',coverGrad:['#f59e0b','#ef4444'],addedAt:new Date(Date.now()-86400000).toISOString(),progress:0,isFavorite:true},
  {id:'l4',type:'music',title:'Midnight Stars',subtitle:'Luna Nova',duration:'4:15',coverGrad:['#ec4899','#8b5cf6'],addedAt:new Date(Date.now()-86400000*2).toISOString(),progress:1,isFavorite:true},
  {id:'l5',type:'video',title:'Как устроен Sky',subtitle:'Документальное · 18 мин',duration:'18:00',coverGrad:['#10b981','#059669'],addedAt:new Date(Date.now()-86400000*3).toISOString(),progress:.1,isFavorite:false},
  {id:'l6',type:'file',title:'Контракт Q2.pdf',subtitle:'3.2 МБ · PDF',coverGrad:['#64748b','#475569'],addedAt:new Date(Date.now()-86400000*4).toISOString(),isFavorite:false},
  {id:'l7',type:'podcast',title:'Dev Weekly #88',subtitle:'Веб-разработка',duration:'62:00',coverGrad:['#0284c7','#0ea5e9'],addedAt:new Date(Date.now()-86400000*5).toISOString(),progress:.25,isFavorite:false},
  {id:'l8',type:'music',title:'Cosmo Garden',subtitle:'Void Wolf',duration:'5:01',coverGrad:['#7c3aed','#4f46e5'],addedAt:new Date(Date.now()-86400000*6).toISOString(),progress:.77,isFavorite:true},
];
export const useMonetizationStore=create<MonetizationState>((set,get)=>({
  library:lsGet('sky:lib:v1',SEED_LIBRARY),
  addToLibrary:(item)=>{const n=[{...item,id:`l-${Date.now()}`,addedAt:new Date().toISOString(),isFavorite:false},...get().library];lsSet('sky:lib:v1',n);set({library:n});},
  toggleFavorite:(id)=>{const n=get().library.map(x=>x.id===id?{...x,isFavorite:!x.isFavorite}:x);lsSet('sky:lib:v1',n);set({library:n});},
  removeFromLib:(id)=>{const n=get().library.filter(x=>x.id!==id);lsSet('sky:lib:v1',n);set({library:n});},
  updateProgress:(id,progress)=>{const n=get().library.map(x=>x.id===id?{...x,progress}:x);lsSet('sky:lib:v1',n);set({library:n});},
}));
