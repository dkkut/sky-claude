/* ===================================================================
   OFFLINE DB  -  IndexedDB для скачанных медиа и офлайн-сообщений
=================================================================== */

const DB_NAME    = 'sky:offline:v1';
const DB_VERSION = 1;

export type DownloadKind = 'track' | 'movie';

export interface DownloadedItem {
  id:        string;         // track/movie id
  kind:      DownloadKind;
  title:     string;
  artist?:   string;
  duration:  string;
  mimeType:  string;
  bytes:     number;
  addedAt:   string;
  coverGrad?: [string, string];
}

export interface OfflineSmsMessage {
  id:        string;
  chatId:    string;
  fromMe:    boolean;
  authorId:  string;
  text:      string;
  time:      string;
  timestamp: number;
  status:    'queued' | 'sent';
  phone?:    string;
}

let _db: IDBDatabase | null = null;

async function openDB(): Promise<IDBDatabase> {
  if (_db) return _db;
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = e => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains('media'))
        db.createObjectStore('media', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('blobs'))
        db.createObjectStore('blobs');
      if (!db.objectStoreNames.contains('sms'))
        db.createObjectStore('sms', { keyPath: 'id' });
    };
    req.onsuccess = e => { _db = (e.target as IDBOpenDBRequest).result; resolve(_db); };
    req.onerror   = () => reject(req.error);
  });
}

/* -- Media downloads ---------------------------------------------- */

export async function saveDownload(meta: DownloadedItem, blob: Blob): Promise<void> {
  const db = await openDB();
  await new Promise<void>((res, rej) => {
    const tx = db.transaction(['media', 'blobs'], 'readwrite');
    tx.objectStore('media').put(meta);
    tx.objectStore('blobs').put(blob, meta.id);
    tx.oncomplete = () => res();
    tx.onerror    = () => rej(tx.error);
  });
}

export async function saveDownloadFromDataUrl(meta: DownloadedItem, dataUrl: string): Promise<void> {
  const [header, b64] = dataUrl.split(',');
  const mime   = header.match(/:(.*?);/)?.[1] || meta.mimeType || 'audio/mpeg';
  const binary = atob(b64);
  const bytes  = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], { type: mime });
  return saveDownload(meta, blob);
}

export async function listDownloads(kind?: DownloadKind): Promise<DownloadedItem[]> {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx  = db.transaction('media', 'readonly');
    const req = tx.objectStore('media').getAll();
    req.onsuccess = () => res(kind ? (req.result as DownloadedItem[]).filter(i => i.kind === kind) : req.result as DownloadedItem[]);
    req.onerror   = () => rej(req.error);
  });
}

export async function getDownloadUrl(id: string): Promise<string | null> {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx  = db.transaction('blobs', 'readonly');
    const req = tx.objectStore('blobs').get(id);
    req.onsuccess = () => res(req.result instanceof Blob ? URL.createObjectURL(req.result) : null);
    req.onerror   = () => rej(req.error);
  });
}

export async function deleteDownload(id: string): Promise<void> {
  const db = await openDB();
  await new Promise<void>((res, rej) => {
    const tx = db.transaction(['media', 'blobs'], 'readwrite');
    tx.objectStore('media').delete(id);
    tx.objectStore('blobs').delete(id);
    tx.oncomplete = () => res();
    tx.onerror    = () => rej(tx.error);
  });
}

export async function isDownloaded(id: string): Promise<boolean> {
  const db = await openDB();
  return new Promise(res => {
    const tx  = db.transaction('media', 'readonly');
    const req = tx.objectStore('media').get(id);
    req.onsuccess = () => res(!!req.result);
    req.onerror   = () => res(false);
  });
}

/* -- Offline SMS messages ----------------------------------------- */

export async function saveOfflineMsg(msg: OfflineSmsMessage): Promise<void> {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx  = db.transaction('sms', 'readwrite');
    const req = tx.objectStore('sms').put(msg);
    req.onsuccess = () => res();
    req.onerror   = () => rej(req.error);
  });
}

export async function listOfflineMsgs(chatId: string): Promise<OfflineSmsMessage[]> {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx  = db.transaction('sms', 'readonly');
    const req = tx.objectStore('sms').getAll();
    req.onsuccess = () => res((req.result as OfflineSmsMessage[]).filter(m => m.chatId === chatId));
    req.onerror   = () => rej(req.error);
  });
}

export async function listAllOfflineMsgs(): Promise<OfflineSmsMessage[]> {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx  = db.transaction('sms', 'readonly');
    const req = tx.objectStore('sms').getAll();
    req.onsuccess = () => res(req.result as OfflineSmsMessage[]);
    req.onerror   = () => rej(req.error);
  });
}
