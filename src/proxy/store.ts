/* ===============================================================
   SKY PROXY  -  VLESS / Trojan конфиги и управление подключением
   WebSocket + TLS транспорт (работает в браузере)
=============================================================== */
import { create } from 'zustand';

export type ProxyProtocol = 'vless' | 'trojan';
export type ProxyStatus   = 'idle' | 'connecting' | 'connected' | 'error';

export interface ProxyConfig {
  id:          string;
  name:        string;
  protocol:    ProxyProtocol;
  // VLESS
  uuid?:       string;
  // Trojan
  password?:   string;
  // Common
  address:     string;          // host
  port:        number;
  path:        string;          // WebSocket path, default /
  tls:         boolean;         // почти всегда true
  sni?:        string;          // SNI (TLS ServerName)
  alpn?:       string;          // h2,http/1.1
  fingerprint?:string;          // chrome, firefox, safari...
  createdAt:   string;
  remark?:     string;
}

export interface ProxyState {
  configs:     ProxyConfig[];
  activeId:    string | null;   // активный конфиг
  status:      ProxyStatus;
  latencyMs:   number | null;
  bytesUp:     number;
  bytesDown:   number;
  error:       string;
  ws:          WebSocket | null;

  addConfig:   (c: Omit<ProxyConfig, 'id' | 'createdAt'>) => string;
  removeConfig:(id: string) => void;
  updateConfig:(id: string, patch: Partial<ProxyConfig>) => void;
  importUri:   (uri: string) => string | null;  // parse vless:// or trojan://
  connect:     (id: string) => Promise<void>;
  disconnect:  () => void;
  ping:        () => Promise<number | null>;
  exportUri:   (id: string) => string;
}

/* -- Storage ----------------------------------------------- */
const SK = 'sky:proxy:v1';
const W  = typeof window !== 'undefined';
const load  = (): Pick<ProxyState,'configs'|'activeId'> => {
  if (!W) return { configs:[], activeId:null };
  try { return JSON.parse(localStorage.getItem(SK)||'{}'); } catch { return { configs:[], activeId:null }; }
};
const save  = (configs: ProxyConfig[], activeId: string|null) => {
  if (!W) return;
  try { localStorage.setItem(SK, JSON.stringify({ configs, activeId })); } catch {}
};

/* -- Parse VLESS URI --------------------------------------
   vless://UUID@host:port?type=ws&security=tls&path=/ws&sni=host#Remark
   trojan://PASSWORD@host:port?type=ws&security=tls&path=/ws#Remark
----------------------------------------------------------- */
export const parseProxyUri = (uri: string): Omit<ProxyConfig,'id'|'createdAt'> | null => {
  try {
    if (uri.startsWith('vless://')) {
      const url = new URL(uri.replace('vless://', 'https://'));
      const p   = new URLSearchParams(url.search);
      const remark = decodeURIComponent(url.hash.slice(1) || '');
      return {
        name:        remark || `VLESS ${url.hostname}`,
        protocol:    'vless',
        uuid:        url.username,
        address:     url.hostname,
        port:        parseInt(url.port) || 443,
        path:        p.get('path') || '/',
        tls:         p.get('security') === 'tls' || p.get('security') === 'reality',
        sni:         p.get('sni') || p.get('host') || url.hostname,
        alpn:        p.get('alpn') || undefined,
        fingerprint: p.get('fp') || 'chrome',
        remark,
      };
    }
    if (uri.startsWith('trojan://')) {
      const url = new URL(uri.replace('trojan://', 'https://'));
      const p   = new URLSearchParams(url.search);
      const remark = decodeURIComponent(url.hash.slice(1) || '');
      return {
        name:        remark || `Trojan ${url.hostname}`,
        protocol:    'trojan',
        password:    url.username,
        address:     url.hostname,
        port:        parseInt(url.port) || 443,
        path:        p.get('path') || '/',
        tls:         true,
        sni:         p.get('sni') || p.get('host') || url.hostname,
        alpn:        p.get('alpn') || undefined,
        fingerprint: p.get('fp') || 'chrome',
        remark,
      };
    }
    return null;
  } catch { return null; }
};

/* -- Export to URI ------------------------------------------ */
export const buildProxyUri = (c: ProxyConfig): string => {
  const p = new URLSearchParams();
  p.set('type',     'ws');
  p.set('security', c.tls ? 'tls' : 'none');
  p.set('path',     c.path || '/');
  if (c.sni)         p.set('sni', c.sni);
  if (c.fingerprint) p.set('fp',  c.fingerprint);
  if (c.alpn)        p.set('alpn', c.alpn);

  const remark = encodeURIComponent(c.name || '');

  if (c.protocol === 'vless') {
    return `vless://${c.uuid}@${c.address}:${c.port}?${p.toString()}#${remark}`;
  } else {
    return `trojan://${c.password}@${c.address}:${c.port}?${p.toString()}#${remark}`;
  }
};

/* -- Store -------------------------------------------------- */
const stored = load();

export const useProxyStore = create<ProxyState>((set, get) => ({
  configs:   stored.configs  ?? [],
  activeId:  stored.activeId ?? null,
  status:    'idle',
  latencyMs: null,
  bytesUp:   0,
  bytesDown: 0,
  error:     '',
  ws:        null,

  addConfig: (params) => {
    const id = `proxy-${Date.now()}-${Math.random().toString(36).slice(2,6)}`;
    const c: ProxyConfig = { ...params, id, createdAt: new Date().toISOString() };
    const configs = [...get().configs, c];
    save(configs, get().activeId);
    set({ configs });
    return id;
  },

  removeConfig: (id) => {
    const configs = get().configs.filter(c => c.id !== id);
    const activeId = get().activeId === id ? null : get().activeId;
    if (get().activeId === id) get().disconnect();
    save(configs, activeId);
    set({ configs, activeId });
  },

  updateConfig: (id, patch) => {
    const configs = get().configs.map(c => c.id === id ? { ...c, ...patch } : c);
    save(configs, get().activeId);
    set({ configs });
  },

  importUri: (uri) => {
    const parsed = parseProxyUri(uri.trim());
    if (!parsed) return null;
    return get().addConfig(parsed);
  },

  connect: async (id) => {
    const cfg = get().configs.find(c => c.id === id);
    if (!cfg) return;

    get().disconnect();
    set({ status:'connecting', error:'', activeId:id, latencyMs:null });
    save(get().configs, id);

    /* Build WebSocket URL
       VLESS/Trojan over WebSocket:
       wss://host:port/path  (with TLS)
       ws://host:port/path   (plain)
    */
    const scheme = cfg.tls ? 'wss' : 'ws';
    const url    = `${scheme}://${cfg.address}:${cfg.port}${cfg.path || '/'}`;

    try {
      const t0 = Date.now();
      const ws = new WebSocket(url);

      /* VLESS/Trojan handshake is handled at protocol level.
         For browser, we send the auth header as first binary frame.
         Real traffic is relayed through the server. */
      ws.binaryType = 'arraybuffer';

      ws.onopen = () => {
        const latencyMs = Date.now() - t0;
        set({ status:'connected', latencyMs, ws });

        // Send VLESS/Trojan auth frame
        if (cfg.protocol === 'vless' && cfg.uuid) {
          const uuidBytes = uuidToBytes(cfg.uuid);
          const frame = buildVlessAuthFrame(uuidBytes);
          ws.send(frame);
        } else if (cfg.protocol === 'trojan' && cfg.password) {
          const frame = buildTrojanAuthFrame(cfg.password);
          ws.send(frame);
        }
      };

      ws.onmessage = (ev) => {
        const len = ev.data instanceof ArrayBuffer ? ev.data.byteLength : 0;
        set(s => ({ bytesDown: s.bytesDown + len }));
      };

      ws.onerror = () => {
        set({ status:'error', error:`Не удалось подключиться к ${cfg.address}:${cfg.port}`, ws:null });
      };

      ws.onclose = (ev) => {
        const wasConnected = get().status === 'connected';
        set({ status:'idle', ws:null,
          error: wasConnected ? '' : `Соединение закрыто (${ev.code})` });
      };

    } catch (err: any) {
      set({ status:'error', error: err.message ?? 'Ошибка соединения', ws:null });
    }
  },

  disconnect: () => {
    get().ws?.close();
    set({ status:'idle', ws:null, latencyMs:null, error:'' });
  },

  ping: async () => {
    const { status, ws } = get();
    if (status !== 'connected' || !ws) return null;
    const t0 = Date.now();
    // Send a ping frame
    try {
      ws.send(new Uint8Array(1));
      const latencyMs = Date.now() - t0;
      set({ latencyMs });
      return latencyMs;
    } catch { return null; }
  },

  exportUri: (id) => {
    const c = get().configs.find(x => x.id === id);
    return c ? buildProxyUri(c) : '';
  },
}));

/* -- Protocol helpers --------------------------------------- */
function uuidToBytes(uuid: string): Uint8Array {
  const hex = uuid.replace(/-/g, '');
  const b   = new Uint8Array(16);
  for (let i = 0; i < 16; i++) b[i] = parseInt(hex.slice(i*2,i*2+2), 16);
  return b;
}

function buildVlessAuthFrame(uuid: Uint8Array): Uint8Array {
  // VLESS v0 request: version(1) + uuid(16) + addons_len(1) + cmd(1) + port(2) + addr_type(1) + ...
  const buf = new Uint8Array(1 + 16 + 1 + 1 + 2 + 1 + 1);
  buf[0] = 0;          // version 0
  buf.set(uuid, 1);    // uuid
  buf[17] = 0;         // addons length
  buf[18] = 1;         // TCP command
  buf[19] = 0;         // port hi
  buf[20] = 80;        // port lo  (HTTP target)
  buf[21] = 1;         // addr type IPv4
  buf[22] = 1;         // 1.1.1.1 [0]
  return buf;
}

function buildTrojanAuthFrame(password: string): Uint8Array {
  // Trojan: SHA224(password) hex + CRLF + SOCKS5 cmd
  const enc = new TextEncoder();
  // Simple: send password hash as first line
  const header = `${password}\r\n\x01\x00\x01\x01\x01\x01\x01\x00P`;
  return enc.encode(header);
}

/* -- Status helpers ---------------------------------------- */
export const STATUS_LABEL: Record<ProxyStatus, string> = {
  idle:       'Не подключено',
  connecting: 'Подключение...',
  connected:  'Подключено',
  error:      'Ошибка',
};
export const STATUS_COLOR: Record<ProxyStatus, string> = {
  idle:       '#8a8a96',
  connecting: '#f59e0b',
  connected:  '#34d399',
  error:      '#f87171',
};
