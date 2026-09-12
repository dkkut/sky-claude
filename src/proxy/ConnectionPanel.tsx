/* ================================================================
   SKY CONNECTION  —  реальные режимы соединения
   VLESS (ws/wss), HTTP/SOCKS proxy, Network diagnostics,
   WebRTC Mesh, Cellular/Network Info API
================================================================ */
import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Globe, Satellite, Network,
  Signal, RefreshCw, Copy, Check, Plus, Trash2, AlertCircle,
  ChevronRight, Shield, Zap, HelpCircle, Paperclip,
} from 'lucide-react';
import {
  useProxyStore, parseProxyUri, STATUS_LABEL, STATUS_COLOR,
  type ProxyConfig,
} from './store';

/* ── Theme ──────────────────────────────────────────────────────── */
const C = {
  bg:'#0f0f14', l1:'#161619', l2:'#1c1c22', l3:'#232328',
  brd:'var(--border)', t1:'var(--t1)', t2:'var(--t2)', t3:'var(--t3)',
  acc:'var(--accent)', green:'var(--green)', amber:'var(--amber)', red:'var(--red)',
};

/* ── Types ──────────────────────────────────────────────────────── */
type Mode = 'vless'|'proxy'|'satellite'|'mesh'|'cellular';

const MODES: { key: Mode; label: string; icon: any; desc: string }[] = [
  { key:'vless',     label:'VLESS',         icon:Shield,    desc:'VLESS/Trojan через WebSocket+TLS' },
  { key:'proxy',     label:'HTTP/SOCKS',    icon:Globe,     desc:'Маршрут трафика через прокси-сервер' },
  { key:'satellite', label:'Спутник',       icon:Satellite, desc:'Анализ соединения, GPS, открытые данные' },
  { key:'mesh',      label:'SkyLink',       icon:Network,   desc:'WebRTC P2P — прямые соединения без сервера' },
  { key:'cellular',  label:'Сеть',          icon:Signal,    desc:'Network Information API — статус сети' },
];

/* ── Storage helpers ────────────────────────────────────────────── */
const CONN_KEY = 'sky:conn:v1';
const loadConn = () => { try { return JSON.parse(localStorage.getItem(CONN_KEY)||'{}'); } catch { return {}; } };
const saveConn = (d: Record<string,any>) => { try { localStorage.setItem(CONN_KEY, JSON.stringify({...loadConn(),...d})); } catch {} };

/* ── Toggle ─────────────────────────────────────────────────────── */
const Toggle = ({ on, onToggle }: { on:boolean; onToggle:()=>void }) => (
  <motion.button type="button" onClick={onToggle}
    className="relative h-6 w-11 rounded-full shrink-0 transition-colors"
    style={{ background: on ? C.acc : 'var(--border-m)' }}>
    <motion.div className="absolute top-1 h-4 w-4 rounded-full bg-white shadow"
      animate={{ left: on ? 22 : 2 }} transition={{ type:'spring', stiffness:500, damping:30 }}/>
  </motion.button>
);

/* ── Status dot ─────────────────────────────────────────────────── */
const Dot = ({ color }: { color: string }) => (
  <motion.div className="h-2 w-2 rounded-full shrink-0"
    style={{ background: color }}
    animate={{ boxShadow: [`0 0 0 0 ${color}44`, `0 0 0 5px ${color}00`] }}
    transition={{ duration:2, repeat:Infinity }}/>
);

/* ================================================================
   VLESS TAB — использует существующий useProxyStore
================================================================ */
const VlessTab = () => {
  const {
    configs, status, activeId, latencyMs, bytesUp, bytesDown, error,
    connect, disconnect, ping, addConfig, removeConfig, importUri, exportUri,
  } = useProxyStore();

  const [showAdd, setShowAdd]   = useState(false);
  const [uriInput, setUriInput] = useState('');
  const [importErr, setImportErr] = useState('');
  const [form, setForm]         = useState({ name:'', address:'', port:'443', uuid:'', path:'/ws', tls:true, sni:'' });
  const [pingBusy, setPingBusy] = useState(false);
  const [copied, setCopied]     = useState<string|null>(null);

  const statusColor = STATUS_COLOR[status];

  const doImport = () => {
    const cfg = importUri(uriInput.trim());
    if (!cfg) { setImportErr('Неверный формат. Ожидается vless:// или trojan://'); return; }
    setUriInput(''); setImportErr(''); setShowAdd(false);
  };

  const doAdd = () => {
    if (!form.address || !form.uuid) return;
    addConfig({
      name: form.name || `VLESS ${form.address}`,
      protocol:'vless', uuid:form.uuid, address:form.address,
      port: parseInt(form.port)||443, path:form.path||'/',
      tls:form.tls, sni:form.sni||form.address, remark: form.name,
    });
    setForm({ name:'', address:'', port:'443', uuid:'', path:'/ws', tls:true, sni:'' });
    setShowAdd(false);
  };

  const doPing = async () => {
    if (pingBusy) return;
    setPingBusy(true);
    await ping();
    setPingBusy(false);
  };

  const copy = async (text: string, key: string) => {
    await navigator.clipboard.writeText(text).catch(()=>{});
    setCopied(key);
    setTimeout(()=>setCopied(null), 1500);
  };

  const fmtBytes = (n: number) => n > 1048576 ? `${(n/1048576).toFixed(1)} МБ` : `${(n/1024).toFixed(0)} КБ`;

  return (
    <div className="flex flex-col gap-4 overflow-y-auto pb-6" style={{scrollbarWidth:'none'}}>
      {/* Status bar */}
      <div className="flex items-center justify-between rounded-2xl px-4 py-3"
        style={{background:C.l1, border:`1px solid ${statusColor}30`}}>
        <div className="flex items-center gap-3">
          <Dot color={statusColor}/>
          <div>
            <p className="text-sm font-bold" style={{color:C.t1}}>{STATUS_LABEL[status]}</p>
            {activeId && (
              <p className="text-xs mt-0.5" style={{color:C.t3}}>
                {configs.find(c=>c.id===activeId)?.address}
                {latencyMs != null ? ` · ${latencyMs} мс` : ''}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3">
          {status === 'connected' && (
            <div className="flex gap-3 text-xs" style={{color:C.t3}}>
              <span>↑ {fmtBytes(bytesUp)}</span>
              <span>↓ {fmtBytes(bytesDown)}</span>
            </div>
          )}
          {status === 'connected' && (
            <motion.button whileTap={{scale:0.9}} type="button" onClick={doPing}
              className="grid h-8 w-8 place-items-center rounded-xl"
              style={{background:C.l2}}>
              <RefreshCw size={14} style={{color:C.t3, animation:pingBusy?'spin 1s linear infinite':''}}/>
            </motion.button>
          )}
          {(status === 'connected' || status === 'connecting') && (
            <button type="button" onClick={disconnect}
              className="rounded-xl px-3 py-1.5 text-xs font-bold"
              style={{background:'rgba(255,59,92,0.12)', color:C.red}}>
              Отключить
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-xl px-4 py-3"
          style={{background:'rgba(255,59,92,0.08)', border:'1px solid rgba(255,59,92,0.2)'}}>
          <AlertCircle size={14} style={{color:C.red, flexShrink: 0}}/>
          <p className="text-xs" style={{color:C.red}}>{error}</p>
        </div>
      )}

      {/* Configs */}
      <div className="space-y-2">
        {configs.map(cfg => {
          const isActive = cfg.id === activeId && status === 'connected';
          return (
            <div key={cfg.id} className="rounded-2xl overflow-hidden"
              style={{background:C.l1, border:`1px solid ${isActive ? C.acc+'44' : C.brd}`}}>
              <div className="flex items-center gap-3 p-4">
                <div className="grid h-9 w-9 place-items-center rounded-xl shrink-0"
                  style={{background: isActive ? `${C.acc}22` : C.l2}}>
                  <Shield size={15} style={{color: isActive ? C.acc : C.t3}}/>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate" style={{color:C.t1}}>{cfg.name}</p>
                  <p className="text-xs mt-0.5 truncate" style={{color:C.t3}}>
                    {cfg.protocol.toUpperCase()} · {cfg.address}:{cfg.port} · {cfg.tls?'TLS':'Plain'}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <motion.button whileTap={{scale:0.9}} type="button"
                    onClick={async () => { const uri = exportUri(cfg.id); await copy(uri, cfg.id); }}
                    className="grid h-7 w-7 place-items-center rounded-lg" style={{background:C.l2}}>
                    {copied===cfg.id ? <Check size={12} style={{color:C.green}}/> : <Copy size={12} style={{color:C.t3}}/>}
                  </motion.button>
                  <motion.button whileTap={{scale:0.9}} type="button"
                    onClick={()=>removeConfig(cfg.id)}
                    className="grid h-7 w-7 place-items-center rounded-lg" style={{background:'rgba(255,59,92,0.08)'}}>
                    <Trash2 size={12} style={{color:C.red}}/>
                  </motion.button>
                  <motion.button whileTap={{scale:0.9}} type="button"
                    onClick={()=> isActive ? disconnect() : connect(cfg.id)}
                    className="rounded-xl px-3 py-1.5 text-xs font-bold"
                    style={{background: isActive ? 'rgba(255,59,92,0.12)' : C.acc, color:'#fff'}}>
                    {isActive ? 'Откл.' : 'Подкл.'}
                  </motion.button>
                </div>
              </div>
            </div>
          );
        })}

        {configs.length === 0 && (
          <div className="grid place-items-center py-10" style={{color:C.t3}}>
            <Shield size={36} className="mb-3 opacity-30"/>
            <p className="text-sm">Нет конфигов. Добавьте сервер.</p>
          </div>
        )}
      </div>

      {/* Add button */}
      <motion.button whileTap={{scale:0.97}} type="button"
        onClick={()=>setShowAdd(v=>!v)}
        className="flex items-center justify-center gap-2 rounded-2xl py-3 text-sm font-semibold"
        style={{background:C.l1, border:`1px solid ${C.brd}`, color:C.t2}}>
        <Plus size={15}/> Добавить конфиг
      </motion.button>

      {/* Add form */}
      <AnimatePresence>
        {showAdd && (
          <motion.div initial={{opacity:0,y:-8}} animate={{opacity:1,y:0}} exit={{opacity:0,y:-8}}
            className="rounded-2xl p-4 space-y-3"
            style={{background:C.l1, border:`1px solid ${C.brd}`}}>
            <p className="text-sm font-bold" style={{color:C.t1}}>Импорт URI</p>
            <div className="flex gap-2">
              <input value={uriInput} onChange={e=>setUriInput(e.target.value)}
                placeholder="vless://UUID@host:port?type=ws&security=tls#Name"
                className="flex-1 rounded-xl px-3 py-2.5 text-xs outline-none font-mono"
                style={{background:C.l2, border:`1px solid ${C.brd}`, color:C.t1}}/>
              <button type="button" onClick={doImport}
                className="rounded-xl px-3 py-2.5 text-xs font-bold text-white"
                style={{background:C.acc}}>
                Импорт
              </button>
            </div>
            {importErr && <p className="text-xs" style={{color:C.red}}>{importErr}</p>}

            <div className="h-px" style={{background:C.brd}}/>
            <p className="text-sm font-bold" style={{color:C.t1}}>Ручной ввод</p>

            {[
              ['Название',    'name',    'text',   'VLESS Сервер 1', false],
              ['Адрес',       'address', 'text',   'example.com',    false],
              ['Порт',        'port',    'number', '443',            false],
              ['UUID',        'uuid',    'text',   'xxxxxxxx-xxxx-…', false],
              ['Path',        'path',    'text',   '/ws',            false],
              ['SNI',         'sni',     'text',   'example.com',    false],
            ].map(([label, key, type, ph]) => (
              <div key={key as string}>
                <p className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{color:C.t3}}>{label as string}</p>
                <input type={type as string} value={(form as any)[key as string]}
                  onChange={e=>setForm(f=>({...f,[key as string]:e.target.value}))}
                  placeholder={ph as string}
                  className="w-full rounded-xl px-3 py-2.5 text-sm outline-none"
                  style={{background:C.l2, border:`1px solid ${C.brd}`, color:C.t1}}/>
              </div>
            ))}
            <div className="flex items-center justify-between">
              <p className="text-sm" style={{color:C.t2}}>TLS / Шифрование</p>
              <Toggle on={form.tls} onToggle={()=>setForm(f=>({...f,tls:!f.tls}))}/>
            </div>
            <button type="button" onClick={doAdd}
              className="w-full rounded-xl py-2.5 text-sm font-bold text-white"
              style={{background:C.acc, opacity:(!form.address||!form.uuid)?0.4:1}}>
              Добавить
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

/* ================================================================
   HTTP / SOCKS PROXY TAB
   Хранит конфиг, патчит глобальный fetch приложения
================================================================ */

// Глобальный патч fetch — реальный механизм
const _origFetch = window.fetch.bind(window);

interface ProxyHttpCfg {
  enabled:  boolean;
  type:     'http'|'socks5'|'socks4';
  host:     string;
  port:     string;
  username: string;
  password: string;
}

const applyHttpProxy = (cfg: ProxyHttpCfg) => {
  if (!cfg.enabled || !cfg.host || !cfg.port) {
    // Restore original
    (window as any).fetch = _origFetch;
    return;
  }
  // Route all app fetches through our backend proxy endpoint
  // Backend at /api/proxy?url=... forwards request through configured proxy
  const proxyBase = `/api/proxy?_host=${encodeURIComponent(cfg.host)}&_port=${cfg.port}&_type=${cfg.type}&_url=`;
  (window as any).fetch = (input: RequestInfo|URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : (input as Request).url ?? String(input);
    // Only proxy external requests; keep internal /api calls direct
    if (url.startsWith('/') || url.includes(window.location.host)) {
      return _origFetch(input, init);
    }
    return _origFetch(proxyBase + encodeURIComponent(url), init);
  };
};

const PROXY_HTTP_KEY = 'sky:proxy:http:v1';
// В localStorage может лежать пустой объект или конфиг от старой версии,
// поэтому результат частичный — недостающие поля добирают дефолты на месте вызова.
const loadHttpProxy = (): Partial<ProxyHttpCfg> => {
  try { return JSON.parse(localStorage.getItem(PROXY_HTTP_KEY)||'{}'); } catch { return {}; }
};
const saveHttpProxy = (c: ProxyHttpCfg) => {
  try { localStorage.setItem(PROXY_HTTP_KEY, JSON.stringify(c)); } catch {}
};

const ProxyHttpTab = () => {
  const [cfg, setCfg] = useState<ProxyHttpCfg>(() => ({
    enabled:false, type:'http', host:'', port:'8080', username:'', password:'',
    ...loadHttpProxy(),
  }));
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string|null>(null);

  const upd = (patch: Partial<ProxyHttpCfg>) => {
    const next = { ...cfg, ...patch };
    setCfg(next);
    saveHttpProxy(next);
    applyHttpProxy(next);
  };

  // Apply on mount
  useEffect(()=>{ applyHttpProxy(cfg); }, []);

  const test = async () => {
    if (!cfg.host || !cfg.port) { setTestResult('Введите адрес и порт'); return; }
    setTesting(true); setTestResult(null);
    try {
      const t0 = Date.now();
      // Test connectivity to the proxy host
      const r = await _origFetch(`/api/proxy-test?host=${encodeURIComponent(cfg.host)}&port=${cfg.port}&type=${cfg.type}`, {
        method:'GET', signal: AbortSignal.timeout(8000),
      });
      const data = await r.json().catch(()=>({ok:false}));
      const ms = Date.now()-t0;
      setTestResult(data.ok ? `Прокси доступен · ${ms} мс` : `Не отвечает: ${data.error||'нет ответа'}`);
    } catch (e: any) {
      setTestResult(`Не отвечает: ${e.message||'таймаут'}`);
    }
    setTesting(false);
  };

  const fields: [string, keyof ProxyHttpCfg, string, string][] = [
    ['Адрес прокси', 'host',     'text',   '127.0.0.1 или proxy.example.com'],
    ['Порт',         'port',     'number', '8080'],
    ['Логин',        'username', 'text',   '(необязательно)'],
    ['Пароль',       'password', 'password','(необязательно)'],
  ];

  return (
    <div className="space-y-4 overflow-y-auto pb-6" style={{scrollbarWidth:'none'}}>
      {/* Enable toggle */}
      <div className="flex items-center justify-between rounded-2xl px-4 py-3.5"
        style={{background:C.l1, border:`1px solid ${cfg.enabled ? C.acc+'44' : C.brd}`}}>
        <div className="flex items-center gap-3">
          <Dot color={cfg.enabled ? C.green : C.t3}/>
          <div>
            <p className="text-sm font-bold" style={{color:C.t1}}>
              {cfg.enabled ? `${cfg.type.toUpperCase()} прокси включён` : 'Прокси отключён'}
            </p>
            {cfg.enabled && cfg.host && (
              <p className="text-xs mt-0.5" style={{color:C.t3}}>{cfg.host}:{cfg.port}</p>
            )}
          </div>
        </div>
        <Toggle on={cfg.enabled} onToggle={()=>upd({enabled:!cfg.enabled})}/>
      </div>

      {/* Type */}
      <div className="rounded-2xl p-4 space-y-3" style={{background:C.l1, border:`1px solid ${C.brd}`}}>
        <p className="text-xs font-bold uppercase tracking-wider" style={{color:C.t3}}>Тип прокси</p>
        <div className="flex gap-2">
          {(['http','socks5','socks4'] as const).map(t=>(
            <button key={t} type="button" onClick={()=>upd({type:t})}
              className="flex-1 rounded-xl py-2 text-xs font-bold uppercase"
              style={{background:cfg.type===t?C.acc:C.l2, color:cfg.type===t?'#fff':C.t3}}>
              {t}
            </button>
          ))}
        </div>

        {fields.map(([label, key, type, ph]) => (
          <div key={key}>
            <p className="text-[10px] font-bold uppercase tracking-wider mb-1.5" style={{color:C.t3}}>{label}</p>
            <input type={type} value={cfg[key] as string}
              onChange={e=>upd({[key]:e.target.value} as any)}
              placeholder={ph}
              className="w-full rounded-xl px-3 py-2.5 text-sm outline-none"
              style={{background:C.l2, border:`1px solid ${C.brd}`, color:C.t1}}/>
          </div>
        ))}

        <button type="button" onClick={test}
          className="w-full rounded-xl py-2.5 text-sm font-bold"
          style={{background:C.l2, color:testing?C.t3:C.t2, border:`1px solid ${C.brd}`}}>
          {testing ? 'Проверяем...' : 'Проверить соединение'}
        </button>
        {testResult && (
          <p className="text-xs font-semibold text-center"
            style={{color: testResult.startsWith('Прокси доступен') ? C.green : C.red}}>
            {testResult}
          </p>
        )}
      </div>

      <div className="rounded-xl px-4 py-3" style={{background:C.l1, border:`1px solid ${C.brd}`}}>
        <p className="text-xs" style={{color:C.t3}}>
          Все внешние запросы приложения будут направлены через прокси-сервер.
          Внутренние запросы к Sky API проксироваться не будут.
        </p>
      </div>
    </div>
  );
};

/* ================================================================
   SATELLITE / NETWORK DIAGNOSTICS TAB
   Реальные замеры: RTT, пропускная способность, маршруты
================================================================ */

const TEST_ENDPOINTS = [
  { name:'Cloudflare',  url:'https://cloudflare.com/cdn-cgi/trace' },
  { name:'Google',      url:'https://www.google.com/generate_204' },
  { name:'Sky Server',  url:'/api/health' },
];

interface PingResult { name: string; ms: number|null; ok: boolean; }
interface SpeedResult { mbps: number; bytes: number; ms: number; }

const SatelliteTab = () => {
  const [pinging,   setPinging]   = useState(false);
  const [pings,     setPings]     = useState<PingResult[]>([]);
  const [speed,     setSpeed]     = useState<SpeedResult|null>(null);
  const [testing,   setTesting]   = useState(false);
  const [netInfo,   setNetInfo]   = useState<Record<string,any>>({});
  const abortRef = useRef<AbortController|null>(null);

  // Read Network Information API
  useEffect(()=>{
    const nav = navigator as any;
    const conn = nav.connection || nav.mozConnection || nav.webkitConnection;
    if (conn) {
      const read = () => setNetInfo({
        type:          conn.type          ?? 'unknown',
        effectiveType: conn.effectiveType ?? 'unknown',
        downlink:      conn.downlink      ?? null,
        rtt:           conn.rtt           ?? null,
        saveData:      conn.saveData      ?? false,
      });
      read();
      conn.addEventListener('change', read);
      return () => conn.removeEventListener('change', read);
    }
  }, []);

  const runPing = async () => {
    setPinging(true);
    const results: PingResult[] = [];
    for (const ep of TEST_ENDPOINTS) {
      try {
        const t0 = performance.now();
        await fetch(ep.url, { method:'HEAD', cache:'no-store', signal:AbortSignal.timeout(5000) });
        results.push({ name:ep.name, ms:Math.round(performance.now()-t0), ok:true });
      } catch {
        results.push({ name:ep.name, ms:null, ok:false });
      }
    }
    setPings(results);
    setPinging(false);
  };

  const runSpeed = async () => {
    setTesting(true);
    abortRef.current = new AbortController();
    try {
      // Download ~1MB from Cloudflare Speed Test (CORS-enabled public endpoint)
      const t0 = performance.now();
      const r  = await fetch('https://speed.cloudflare.com/__down?bytes=1000000', {
        cache:'no-store', signal: abortRef.current.signal,
      });
      const buf = await r.arrayBuffer();
      const ms  = performance.now() - t0;
      const mbps = (buf.byteLength * 8) / (ms * 1000); // Mbps
      setSpeed({ mbps: Math.round(mbps*10)/10, bytes: buf.byteLength, ms: Math.round(ms) });
    } catch(e:any) {
      if (e.name !== 'AbortError')
        setSpeed({ mbps:0, bytes:0, ms:0 });
    }
    setTesting(false);
  };

  const qualityColor = (ms: number|null) =>
    ms==null ? C.t3 : ms < 80 ? C.green : ms < 200 ? C.amber : C.red;

  const qualityLabel = (ms: number|null) =>
    ms==null ? '—' : ms < 80 ? 'Отлично' : ms < 200 ? 'Норма' : 'Высокая задержка';

  return (
    <div className="space-y-4 overflow-y-auto pb-6" style={{scrollbarWidth:'none'}}>
      {/* Network Info */}
      {Object.keys(netInfo).length > 0 && (
        <div className="rounded-2xl p-4" style={{background:C.l1, border:`1px solid ${C.brd}`}}>
          <p className="text-xs font-bold uppercase tracking-wider mb-3" style={{color:C.t3}}>
            Network Information API
          </p>
          <div className="grid grid-cols-2 gap-2">
            {[
              ['Тип сети',    netInfo.type],
              ['Эффективный', netInfo.effectiveType],
              ['Скорость',    netInfo.downlink != null ? `${netInfo.downlink} Мбит/с` : '—'],
              ['RTT',         netInfo.rtt      != null ? `${netInfo.rtt} мс` : '—'],
              ['Экономия',    netInfo.saveData ? 'Вкл' : '—'],
            ].map(([k,v]) => (
              <div key={k} className="rounded-xl px-3 py-2" style={{background:C.l2}}>
                <p className="text-[10px] font-bold uppercase" style={{color:C.t3}}>{k}</p>
                <p className="text-sm font-bold mt-0.5" style={{color:C.t1}}>{v}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Ping */}
      <div className="rounded-2xl p-4 space-y-3" style={{background:C.l1, border:`1px solid ${C.brd}`}}>
        <div className="flex items-center justify-between">
          <p className="text-xs font-bold uppercase tracking-wider" style={{color:C.t3}}>Пинг / Задержка</p>
          <motion.button whileTap={{scale:0.9}} type="button" onClick={runPing}
            className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold"
            style={{background:C.l2, color:C.t2}}>
            <RefreshCw size={12} style={{animation:pinging?'spin 1s linear infinite':''}}/>
            {pinging ? 'Проверяем...' : 'Проверить'}
          </motion.button>
        </div>
        {pings.map(p=>(
          <div key={p.name} className="flex items-center gap-3">
            <Dot color={p.ok ? C.green : C.red}/>
            <p className="flex-1 text-sm" style={{color:C.t2}}>{p.name}</p>
            <p className="text-sm font-bold" style={{color:qualityColor(p.ms)}}>
              {p.ms != null ? `${p.ms} мс` : 'Таймаут'}
            </p>
            <p className="text-xs w-24 text-right" style={{color:C.t3}}>{qualityLabel(p.ms)}</p>
          </div>
        ))}
        {pings.length === 0 && (
          <p className="text-xs text-center py-4" style={{color:C.t3}}>Нажмите «Проверить» для замера</p>
        )}
      </div>

      {/* Speed test */}
      <div className="rounded-2xl p-4 space-y-3" style={{background:C.l1, border:`1px solid ${C.brd}`}}>
        <div className="flex items-center justify-between">
          <p className="text-xs font-bold uppercase tracking-wider" style={{color:C.t3}}>Скорость загрузки</p>
          <div className="flex gap-2">
            {testing && (
              <button type="button" onClick={()=>abortRef.current?.abort()}
                className="rounded-xl px-3 py-1.5 text-xs" style={{color:C.red}}>
                Стоп
              </button>
            )}
            <motion.button whileTap={{scale:0.9}} type="button" onClick={runSpeed} disabled={testing}
              className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold"
              style={{background:C.l2, color:testing?C.t3:C.t2}}>
              <Zap size={12}/>
              {testing ? 'Тест...' : 'Запустить'}
            </motion.button>
          </div>
        </div>
        {testing && (
          <div className="rounded-xl overflow-hidden h-1.5" style={{background:C.l2}}>
            <motion.div className="h-full rounded-full"
              style={{background:C.acc}}
              animate={{width:['0%','100%']}} transition={{duration:8, ease:'linear'}}/>
          </div>
        )}
        {speed && !testing && (
          <div className="grid grid-cols-3 gap-2 text-center">
            {[
              ['Скорость', `${speed.mbps} Мбит/с`, speed.mbps>10?C.green:speed.mbps>2?C.amber:C.red],
              ['Данные',   `${(speed.bytes/1024/1024).toFixed(1)} МБ`, C.t2],
              ['Время',    `${speed.ms} мс`, C.t2],
            ].map(([k,v,c])=>(
              <div key={k as string} className="rounded-xl px-2 py-2" style={{background:C.l2}}>
                <p className="text-xs font-bold" style={{color:c as string}}>{v as string}</p>
                <p className="text-[9px] mt-0.5" style={{color:C.t3}}>{k as string}</p>
              </div>
            ))}
          </div>
        )}
        <p className="text-[10px]" style={{color:C.t3}}>
          Тест использует Cloudflare Speed Test endpoint (1 МБ). Данные не логируются.
        </p>
      </div>
    </div>
  );
};

/* ================================================================
   MESH / WebRTC P2P TAB
   Реальный RTCPeerConnection через существующий WS сервер
================================================================ */

interface Peer { id: string; label: string; dc: RTCDataChannel|null; state: string; msgs: string[]; }

const MeshTab = () => {
  const [myId]       = useState(()=>'sky-'+Math.random().toString(36).slice(2,8));
  const [peers,      setPeers]      = useState<Peer[]>([]);
  const [wsConn,     setWsConn]     = useState<WebSocket|null>(null);
  const [wsState,    setWsState]    = useState<'disconnected'|'connecting'|'connected'>('disconnected');
  const [msgInput,   setMsgInput]   = useState('');
  const [activePeer, setActivePeer] = useState<string|null>(null);
  const pcsRef = useRef<Map<string,RTCPeerConnection>>(new Map());
  const wsRef  = useRef<WebSocket|null>(null);

  const WS_URL = (window.location.protocol==='https:'?'wss://':'ws://') + window.location.host;
  const ICE = [{ urls:'stun:stun.l.google.com:19302' }, { urls:'stun:stun1.l.google.com:19302' }];

  const signal = useCallback((to: string, payload: any) => {
    wsRef.current?.send(JSON.stringify({ type:'mesh-signal', to, from:myId, payload }));
  }, [myId]);

  const createPC = useCallback((peerId: string, initiator: boolean): RTCPeerConnection => {
    const pc = new RTCPeerConnection({ iceServers: ICE });
    pcsRef.current.set(peerId, pc);

    pc.onicecandidate = e => { if(e.candidate) signal(peerId, { ice: e.candidate }); };
    pc.onconnectionstatechange = () => {
      setPeers(prev=>prev.map(p=>p.id===peerId?{...p,state:pc.connectionState}:p));
    };

    if (initiator) {
      const dc = pc.createDataChannel('sky-mesh');
      setupDC(peerId, dc);
      pc.createOffer().then(o=>pc.setLocalDescription(o)).then(()=>{
        signal(peerId, { sdp: pc.localDescription });
      });
    } else {
      pc.ondatachannel = e => setupDC(peerId, e.channel);
    }
    return pc;
  }, [signal]);

  const setupDC = (peerId: string, dc: RTCDataChannel) => {
    dc.onopen  = () => setPeers(prev=>prev.map(p=>p.id===peerId?{...p,dc,state:'connected'}:p));
    dc.onclose = () => setPeers(prev=>prev.map(p=>p.id===peerId?{...p,dc:null,state:'closed'}:p));
    dc.onmessage = e => setPeers(prev=>prev.map(p=>p.id===peerId
      ?{...p,msgs:[...p.msgs,`${peerId.slice(-4)}: ${e.data}`]}:p));
  };

  const connect = () => {
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;
    setWsState('connecting');

    ws.onopen = () => {
      setWsConn(ws);
      setWsState('connected');
      ws.send(JSON.stringify({ type:'mesh-join', id:myId }));
    };
    ws.onclose = () => { setWsConn(null); setWsState('disconnected'); };
    ws.onmessage = async (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.type === 'mesh-peers') {
        // New list of available peers
        const incoming: string[] = msg.peers.filter((id:string)=>id!==myId);
        incoming.forEach(pid => {
          if (!pcsRef.current.has(pid)) {
            setPeers(prev=>[...prev.filter(p=>p.id!==pid), {id:pid,label:pid.slice(-6),dc:null,state:'new',msgs:[]}]);
            createPC(pid, true);
          }
        });
      }
      if (msg.type === 'mesh-signal' && msg.from !== myId) {
        let pc = pcsRef.current.get(msg.from);
        if (!pc) {
          setPeers(prev=>[...prev.filter(p=>p.id!==msg.from), {id:msg.from,label:msg.from.slice(-6),dc:null,state:'new',msgs:[]}]);
          pc = createPC(msg.from, false);
        }
        const {sdp, ice} = msg.payload;
        if (sdp) {
          await pc.setRemoteDescription(new RTCSessionDescription(sdp));
          if (sdp.type === 'offer') {
            const ans = await pc.createAnswer();
            await pc.setLocalDescription(ans);
            signal(msg.from, { sdp: pc.localDescription });
          }
        }
        if (ice) await pc.addIceCandidate(new RTCIceCandidate(ice));
      }
    };
  };

  const disconnect = () => {
    pcsRef.current.forEach(pc=>pc.close());
    pcsRef.current.clear();
    wsRef.current?.close();
    setPeers([]);
    setActivePeer(null);
  };

  const sendMsg = () => {
    if (!msgInput.trim() || !activePeer) return;
    const peer = peers.find(p=>p.id===activePeer);
    if (peer?.dc?.readyState==='open') {
      peer.dc.send(msgInput.trim());
      setPeers(prev=>prev.map(p=>p.id===activePeer?{...p,msgs:[...p.msgs,`Вы: ${msgInput.trim()}`]}:p));
      setMsgInput('');
    }
  };

  useEffect(()=>()=>disconnect(), []);

  const stateColor: Record<string,string> = {
    new:'#6b7280', connecting:C.amber, connected:C.green,
    disconnected:C.t3, failed:C.red, closed:C.t3,
  };

  return (
    <div className="space-y-4 overflow-y-auto pb-6" style={{scrollbarWidth:'none'}}>
      {/* Control */}
      <div className="flex items-center gap-3 rounded-2xl px-4 py-3"
        style={{background:C.l1, border:`1px solid ${wsState==='connected'?C.acc+'44':C.brd}`}}>
        <Dot color={wsState==='connected'?C.green:wsState==='connecting'?C.amber:C.t3}/>
        <div className="flex-1">
          <p className="text-sm font-bold" style={{color:C.t1}}>
            {wsState==='connected'?'Mesh активен':'WebRTC Mesh'}
          </p>
          <p className="text-xs mt-0.5 font-mono" style={{color:C.t3}}>ID: {myId}</p>
        </div>
        <button type="button"
          onClick={wsState==='connected' ? disconnect : connect}
          className="rounded-xl px-4 py-2 text-sm font-bold"
          style={{background: wsState==='connected'?'rgba(255,59,92,0.12)':C.acc,
            color: wsState==='connected'?C.red:'#fff'}}>
          {wsState==='connected'?'Отключить':'Подключиться'}
        </button>
      </div>

      {/* Peers */}
      {peers.length > 0 && (
        <div className="rounded-2xl overflow-hidden" style={{background:C.l1,border:`1px solid ${C.brd}`}}>
          <p className="text-[10px] font-bold uppercase tracking-wider px-4 py-2.5" style={{color:C.t3}}>
            Пиры в сети ({peers.length})
          </p>
          {peers.map(p=>(
            <div key={p.id}
              className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-white/5"
              style={{borderTop:`1px solid ${C.brd}`}}
              onClick={()=>setActivePeer(p.id===activePeer?null:p.id)}>
              <Dot color={stateColor[p.state]??C.t3}/>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-mono" style={{color:C.t1}}>{p.id}</p>
                <p className="text-xs capitalize" style={{color:stateColor[p.state]??C.t3}}>{p.state}</p>
              </div>
              <ChevronRight size={14} style={{color:C.t3, transform:activePeer===p.id?'rotate(90deg)':''}}/>
            </div>
          ))}
        </div>
      )}

      {/* Chat */}
      {activePeer && (()=>{
        const peer = peers.find(p=>p.id===activePeer);
        const canSend = peer?.dc?.readyState==='open';
        return (
          <div className="rounded-2xl overflow-hidden" style={{background:C.l1,border:`1px solid ${C.brd}`}}>
            <div className="flex items-center justify-between px-4 py-2.5" style={{borderBottom:`1px solid ${C.brd}`}}>
              <p className="text-xs font-bold" style={{color:C.t3}}>P2P · {activePeer.slice(-6)}</p>
              {!canSend && <p className="text-xs" style={{color:C.amber}}>Соединение устанавливается...</p>}
            </div>
            <div className="min-h-[80px] max-h-40 overflow-y-auto px-4 py-3 space-y-1.5" style={{scrollbarWidth:'none'}}>
              {peer?.msgs.map((m,i)=>(
                <p key={i} className="text-xs" style={{color:C.t2}}>{m}</p>
              ))}
              {!peer?.msgs.length && (
                <p className="text-xs text-center py-4" style={{color:C.t3}}>Пустой чат. Отправьте сообщение.</p>
              )}
            </div>
            <div className="flex gap-2 px-4 py-3" style={{borderTop:`1px solid ${C.brd}`}}>
              <input value={msgInput} onChange={e=>setMsgInput(e.target.value)}
                onKeyDown={e=>e.key==='Enter'&&sendMsg()}
                placeholder="Сообщение через DataChannel..."
                className="flex-1 rounded-xl px-3 py-2 text-xs outline-none"
                style={{background:C.l2,border:`1px solid ${C.brd}`,color:C.t1}}/>
              <button type="button" onClick={sendMsg} disabled={!canSend||!msgInput.trim()}
                className="rounded-xl px-3 py-2 text-xs font-bold text-white disabled:opacity-30"
                style={{background:C.acc}}>
                ↑
              </button>
            </div>
          </div>
        );
      })()}

      {wsState!=='connected' && (
        <div className="rounded-xl px-4 py-3" style={{background:C.l1,border:`1px solid ${C.brd}`}}>
          <p className="text-xs" style={{color:C.t3}}>
            WebRTC DataChannel — прямые P2P соединения между браузерами через STUN серверы Google.
            Сигналинг идёт через WebSocket сервер Sky.
          </p>
        </div>
      )}
    </div>
  );
};

/* ================================================================
   CELLULAR / NETWORK INFO TAB
   Navigator.connection API — реальные данные браузера
================================================================ */

const CellularTab = () => {
  const [info,     setInfo]    = useState<Record<string,any>>({});
  const [online,   setOnline]  = useState(navigator.onLine);
  const [history,  setHistory] = useState<{t:number;type:string;rtt:number|null}[]>([]);
  const [saveData, setSaveData] = useState(false);

  useEffect(()=>{
    const nav = navigator as any;
    const conn = nav.connection || nav.mozConnection || nav.webkitConnection;

    const read = () => {
      if (!conn) {
        setInfo({ supported: false });
        return;
      }
      const snap = {
        type:          conn.type          ?? 'unknown',
        effectiveType: conn.effectiveType ?? 'unknown',
        downlink:      conn.downlink      ?? null,
        downlinkMax:   conn.downlinkMax   ?? null,
        rtt:           conn.rtt           ?? null,
        saveData:      conn.saveData      ?? false,
        supported:     true,
      };
      setInfo(snap);
      setSaveData(snap.saveData);
      setHistory(prev=>[{t:Date.now(),type:snap.effectiveType,rtt:snap.rtt},...prev].slice(0,20));
    };

    read();
    if (conn) conn.addEventListener('change', read);

    const onOnline  = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener('online',  onOnline);
    window.addEventListener('offline', onOffline);

    return () => {
      if (conn) conn.removeEventListener('change', read);
      window.removeEventListener('online',  onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  const qualityMap: Record<string,{color:string;bars:number;label:string}> = {
    'slow-2g':{ color:C.red,   bars:1, label:'Очень слабый' },
    '2g':      { color:C.red,   bars:1, label:'Слабый' },
    '3g':      { color:C.amber, bars:2, label:'Средний' },
    '4g':      { color:C.green, bars:4, label:'Отличный' },
    'unknown': { color:C.t3,   bars:0, label:'Нет данных' },
  };
  const q = qualityMap[info.effectiveType ?? 'unknown'] ?? qualityMap.unknown;

  const SignalBars = ({ bars }: { bars: number }) => (
    <div className="flex items-end gap-0.5 h-6">
      {[1,2,3,4].map(i=>(
        <div key={i} className="w-2 rounded-t"
          style={{height:`${i*25}%`, background: i<=bars ? q.color : C.l2, minHeight:4}}/>
      ))}
    </div>
  );

  return (
    <div className="space-y-4 overflow-y-auto pb-6" style={{scrollbarWidth:'none'}}>
      {/* Status */}
      <div className="rounded-2xl p-4" style={{background:C.l1, border:`1px solid ${online?C.acc+'33':C.red+'33'}`}}>
        <div className="flex items-center gap-4">
          <SignalBars bars={q.bars}/>
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <Dot color={online?C.green:C.red}/>
              <p className="text-sm font-bold" style={{color:C.t1}}>
                {online ? 'В сети' : 'Нет связи'}
              </p>
              <span className="text-xs px-2 py-0.5 rounded-full font-bold uppercase"
                style={{background:`${q.color}20`, color:q.color}}>
                {info.effectiveType ?? '—'}
              </span>
            </div>
            <p className="text-xs" style={{color:C.t3}}>{q.label}</p>
          </div>
        </div>
      </div>

      {!info.supported ? (
        <div className="rounded-xl px-4 py-4 text-center" style={{background:C.l1,border:`1px solid ${C.brd}`}}>
          <p className="text-sm" style={{color:C.t3}}>
            Network Information API не поддерживается в этом браузере.
            Доступно в Chrome/Edge/Android WebView.
          </p>
        </div>
      ) : (
        <>
          {/* Details */}
          <div className="rounded-2xl p-4" style={{background:C.l1,border:`1px solid ${C.brd}`}}>
            <p className="text-xs font-bold uppercase tracking-wider mb-3" style={{color:C.t3}}>Параметры соединения</p>
            <div className="space-y-3">
              {[
                ['Тип физич.', info.type       ?? '—'],
                ['Eff. тип',   info.effectiveType ?? '—'],
                ['Скорость ↓', info.downlink    != null ? `${info.downlink} Мбит/с` : '—'],
                ['Макс ↓',     info.downlinkMax != null ? `${info.downlinkMax} Мбит/с` : '—'],
                ['RTT',        info.rtt         != null ? `${info.rtt} мс` : '—'],
              ].map(([k,v])=>(
                <div key={k} className="flex items-center justify-between">
                  <p className="text-sm" style={{color:C.t3}}>{k}</p>
                  <p className="text-sm font-bold font-mono" style={{color:C.t1}}>{v}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Save Data */}
          <div className="flex items-center justify-between rounded-2xl px-4 py-3"
            style={{background:C.l1,border:`1px solid ${C.brd}`}}>
            <div>
              <p className="text-sm font-semibold" style={{color:C.t1}}>Экономия трафика</p>
              <p className="text-xs mt-0.5" style={{color:C.t3}}>
                {saveData ? 'Пользователь включил экономию данных' : 'Режим не активен'}
              </p>
            </div>
            <Toggle on={saveData} onToggle={()=>{}}/>
          </div>

          {/* History */}
          {history.length > 1 && (
            <div className="rounded-2xl p-4" style={{background:C.l1,border:`1px solid ${C.brd}`}}>
              <p className="text-xs font-bold uppercase tracking-wider mb-3" style={{color:C.t3}}>
                История изменений ({history.length})
              </p>
              <div className="space-y-1.5 max-h-36 overflow-y-auto" style={{scrollbarWidth:'none'}}>
                {history.map((h,i)=>(
                  <div key={i} className="flex items-center gap-3">
                    <p className="text-[10px] font-mono w-16 shrink-0" style={{color:C.t3}}>
                      {new Date(h.t).toLocaleTimeString('ru',{hour:'2-digit',minute:'2-digit',second:'2-digit'})}
                    </p>
                    <span className="text-[10px] font-bold px-1.5 rounded"
                      style={{background:`${(qualityMap[h.type]??qualityMap.unknown).color}20`,
                        color:(qualityMap[h.type]??qualityMap.unknown).color}}>
                      {h.type}
                    </span>
                    {h.rtt != null && <p className="text-[10px]" style={{color:C.t3}}>{h.rtt} мс</p>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};


/* ================================================================
   SKYLINK TAB — WebRTC P2P Mesh + File Transfer (PC)
================================================================ */
const SkyLinkTabPC = () => {
  const [myId]          = useState(() => {
    try {
      const s = JSON.parse(localStorage.getItem('sky:skylink:v1')||'{}');
      if (s.myId) return s.myId;
    } catch {}
    const id = 'sky-' + Math.random().toString(36).slice(2,10);
    try { localStorage.setItem('sky:skylink:v1', JSON.stringify({myId:id})); } catch {}
    return id;
  });
  const [peers,   setPeers]   = useState<{id:string;dc:RTCDataChannel|null;state:string;msgs:{from:string;text:string;t:number}[]}[]>([]);
  const [wsState, setWS]      = useState<'disconnected'|'connecting'|'connected'>('disconnected');
  const [activePeer, setAP]   = useState<string|null>(null);
  const [input,   setInput]   = useState('');
  const [xferLog, setXL]      = useState<any[]>([]);
  const wsRef  = useRef<WebSocket|null>(null);
  const pcsRef = useRef<Map<string,RTCPeerConnection>>(new Map());
  const fileRef = useRef<HTMLInputElement>(null);

  const ICE = [{urls:'stun:stun.l.google.com:19302'},{urls:'stun:stun1.l.google.com:19302'},{urls:'stun:stun.cloudflare.com:3478'}];

  const signal = (to:string, payload:any) =>
    wsRef.current?.readyState===1 && wsRef.current.send(JSON.stringify({type:'mesh-signal',to,from:myId,payload}));

  const setupDC = (pid:string, dc:RTCDataChannel) => {
    dc.binaryType = 'arraybuffer';
    dc.onopen  = () => setPeers(p=>p.map(x=>x.id===pid?{...x,dc,state:'connected'}:x));
    dc.onclose = () => setPeers(p=>p.map(x=>x.id===pid?{...x,dc:null,state:'closed'}:x));
    dc.onmessage = (e:MessageEvent) => {
      if (e.data instanceof ArrayBuffer) {
        const url = URL.createObjectURL(new Blob([e.data]));
        setXL(l=>[...l,{type:'recv_file',from:pid,url,size:e.data.byteLength,t:Date.now()}]);
      } else {
        try {
          const msg = JSON.parse(e.data);
          if (msg.type==='text') setPeers(p=>p.map(x=>x.id===pid?{...x,msgs:[...(x.msgs||[]),{from:pid,text:msg.text,t:Date.now()}]}:x));
          if (msg.type==='file_meta') setXL(l=>[...l,{type:'recv_meta',from:pid,name:msg.name,size:msg.size,t:Date.now()}]);
        } catch {}
      }
    };
  };

  const createPC = (pid:string, init:boolean):RTCPeerConnection => {
    const pc = new RTCPeerConnection({iceServers:ICE});
    pcsRef.current.set(pid,pc);
    pc.onicecandidate = (e:RTCPeerConnectionIceEvent) => { if(e.candidate) signal(pid,{ice:e.candidate}); };
    pc.onconnectionstatechange = () => setPeers(p=>p.map(x=>x.id===pid?{...x,state:pc.connectionState}:x));
    if (init) {
      const dc = pc.createDataChannel('sky-link',{ordered:true});
      setupDC(pid,dc);
      pc.createOffer().then(o=>pc.setLocalDescription(o)).then(()=>signal(pid,{sdp:pc.localDescription}));
    } else pc.ondatachannel = (e:RTCDataChannelEvent) => setupDC(pid,e.channel);
    return pc;
  };

  const connect = () => {
    const WS_URL = (window.location.protocol==='https:'?'wss://':'ws://')+window.location.host;
    const ws = new WebSocket(WS_URL);
    wsRef.current=ws; setWS('connecting');
    ws.onopen = () => { setWS('connected'); ws.send(JSON.stringify({type:'mesh-join',id:myId})); };
    ws.onclose = () => { setWS('disconnected'); pcsRef.current.forEach(p=>p.close()); pcsRef.current.clear(); setPeers([]); setAP(null); };
    ws.onmessage = async (ev:MessageEvent) => {
      const msg = JSON.parse(ev.data);
      if (msg.type==='mesh-peers') {
        const inc:string[] = msg.peers.filter((id:string)=>id!==myId);
        inc.forEach(pid=>{
          if(!pcsRef.current.has(pid)){
            setPeers(p=>[...p.filter(x=>x.id!==pid),{id:pid,dc:null,state:'new',msgs:[]}]);
            createPC(pid,true);
          }
        });
      }
      if (msg.type==='mesh-signal'&&msg.from!==myId) {
        let pc = pcsRef.current.get(msg.from);
        if (!pc) { setPeers(p=>[...p.filter(x=>x.id!==msg.from),{id:msg.from,dc:null,state:'new',msgs:[]}]); pc=createPC(msg.from,false); }
        const {sdp,ice}=msg.payload;
        if(sdp){await pc.setRemoteDescription(new RTCSessionDescription(sdp));if(sdp.type==='offer'){const ans=await pc.createAnswer();await pc.setLocalDescription(ans);signal(msg.from,{sdp:pc.localDescription});}}
        if(ice) await pc.addIceCandidate(new RTCIceCandidate(ice));
      }
    };
  };

  const disconnect = () => { pcsRef.current.forEach(p=>p.close()); pcsRef.current.clear(); wsRef.current?.close(); setPeers([]); setAP(null); };

  const sendText = () => {
    if(!input.trim()||!activePeer) return;
    const peer = peers.find(p=>p.id===activePeer);
    if(peer?.dc?.readyState==='open'){
      peer.dc.send(JSON.stringify({type:'text',text:input.trim()}));
      setPeers(p=>p.map(x=>x.id===activePeer?{...x,msgs:[...(x.msgs||[]),{from:'me',text:input.trim(),t:Date.now()}]}:x));
      setInput('');
    }
  };

  const sendFile = async (file:File) => {
    if(!activePeer) return;
    const peer = peers.find(p=>p.id===activePeer);
    if(!peer?.dc||peer.dc.readyState!=='open') return;
    peer.dc.send(JSON.stringify({type:'file_meta',name:file.name,size:file.size}));
    const buf = await file.arrayBuffer();
    const CHUNK=16384;
    for(let off=0;off<buf.byteLength;off+=CHUNK) peer.dc.send(buf.slice(off,off+CHUNK));
    setXL(l=>[...l,{type:'sent_file',to:activePeer,name:file.name,size:file.size,t:Date.now()}]);
  };

  useEffect(()=>()=>disconnect(),[]);

  const ST_COLOR:Record<string,string>={new:'#6b7280',connecting:'var(--amber)',connected:'var(--green)',disconnected:'rgba(255,255,255,0.2)',failed:'var(--red)',closed:'rgba(255,255,255,0.15)'};
  const fmtSz=(n:number)=>n>1048576?(n/1048576).toFixed(1)+' МБ':(n/1024).toFixed(0)+' КБ';
  const fmtTs=(t:number)=>new Date(t).toLocaleTimeString('ru',{hour:'2-digit',minute:'2-digit'});
  const ap = peers.find(p=>p.id===activePeer);
  const canSend = ap?.dc?.readyState==='open';

  return (
    <div className="flex flex-col gap-3 overflow-y-auto pb-6 h-full" style={{scrollbarWidth:'none'}}>
      {/* Node card */}
      <div className="rounded-2xl p-4" style={{background:'linear-gradient(135deg,rgba(79,110,247,0.08),rgba(79,110,247,0.02))',border:`1px solid ${wsState==='connected'?'rgba(79,110,247,0.3)':'var(--border)'}`}}>
        <div className="flex items-center gap-3 mb-3">
          <div className="grid h-10 w-10 place-items-center rounded-xl text-xl shrink-0"
            style={{background:'linear-gradient(135deg,var(--accent),#8b5cf6)'}}><Network size={18} style={{color:'#fff'}}/></div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold" style={{color:'var(--t1)'}}>SkyLink Node</p>
            <p className="text-[10px] font-mono truncate" style={{color:'var(--t3)'}}>{myId}</p>
          </div>
          <div className="flex items-center gap-1.5 rounded-full px-3 py-1.5"
            style={{background:wsState==='connected'?'rgba(0,220,90,0.08)':'var(--bg-l2)'}}>
            <div className="h-2 w-2 rounded-full"
              style={{background:wsState==='connected'?'var(--green)':wsState==='connecting'?'var(--amber)':'var(--border)'}}/>
            <p className="text-[11px] font-semibold" style={{color:wsState==='connected'?'var(--green)':'var(--t3)'}}>
              {wsState==='connected'?'Активен':wsState==='connecting'?'Соединение...':'Оффлайн'}
            </p>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {[['Пиров',String(peers.length),'var(--accent)'],['Подкл.',String(peers.filter(p=>p.state==='connected').length),'var(--green)'],['Режим','Hybrid','var(--amber)']].map(([l,v,c])=>(
            <div key={l} className="rounded-xl px-3 py-2 text-center" style={{background:'var(--bg-l2)'}}>
              <p className="text-sm font-bold" style={{color:c}}>{v}</p>
              <p className="text-[9px] mt-0.5" style={{color:'var(--t3)'}}>{l}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Connect */}
      <motion.button whileTap={{scale:0.97}} type="button"
        onClick={wsState==='connected'?disconnect:connect}
        className="w-full rounded-2xl py-3 text-sm font-bold"
        style={{background:wsState==='connected'?'rgba(255,59,92,0.1)':'var(--accent)',
          color:wsState==='connected'?'var(--red)':'#fff',
          border:wsState==='connected'?'1px solid rgba(255,59,92,0.2)':'none'}}>
        {wsState==='connected'?'Отключиться от SkyLink':'Подключиться к SkyLink'}
      </motion.button>

      {/* Peers */}
      {peers.length>0&&(
        <div className="space-y-2">
          <p className="text-[10px] font-bold uppercase tracking-widest" style={{color:'var(--t3)'}}>Устройства</p>
          {peers.map(p=>(
            <div key={p.id} onClick={()=>setAP(p.id===activePeer?null:p.id)}
              className="flex items-center gap-3 rounded-2xl px-4 py-3 cursor-pointer"
              style={{background:p.id===activePeer?'rgba(79,110,247,0.08)':'var(--bg-l2)',
                border:`1px solid ${p.id===activePeer?'rgba(79,110,247,0.25)':'var(--border)'}`}}>
              <div className="h-2 w-2 rounded-full shrink-0" style={{background:ST_COLOR[p.state]||'#6b7280'}}/>
              <p className="flex-1 text-xs font-mono truncate" style={{color:'var(--t1)'}}>{p.id}</p>
              <p className="text-xs capitalize" style={{color:ST_COLOR[p.state]||'var(--t3)'}}>{p.state}</p>
            </div>
          ))}
        </div>
      )}

      {/* Chat */}
      {ap&&(
        <div className="rounded-2xl overflow-hidden flex flex-col" style={{background:'var(--bg-l2)',border:'1px solid var(--border)',minHeight:240}}>
          <div className="flex items-center justify-between px-4 py-3" style={{borderBottom:'1px solid var(--border)'}}>
            <div>
              <p className="text-sm font-bold" style={{color:'var(--t1)'}}>P2P · {activePeer!.slice(-8)}</p>
              <p className="text-[10px]" style={{color:canSend?'var(--green)':'var(--t3)'}}>{canSend?'DataChannel открыт':'Канал не установлен'}</p>
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={()=>fileRef.current?.click()} disabled={!canSend}
                className="rounded-xl px-3 py-1.5 text-xs font-semibold disabled:opacity-30"
                style={{background:'var(--accent-bg)',color:'var(--accent)',border:'1px solid rgba(79,110,247,0.2)'}}>
                <Paperclip size={13} className="inline mr-1"/>Файл
              </button>
              <input ref={fileRef} type="file" className="hidden"
                onChange={e=>{const f=e.target.files?.[0];if(f){sendFile(f);e.target.value='';}}}/>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-2 min-h-[100px]" style={{scrollbarWidth:'none'}}>
            {(ap.msgs||[]).length===0&&xferLog.filter(x=>x.from===activePeer||x.to===activePeer).length===0&&(
              <p className="text-xs text-center m-auto" style={{color:'var(--t3)'}}>Прямой P2P канал без посредников</p>
            )}
            {(ap.msgs||[]).map((m,i)=>(
              <div key={i} className={`flex ${m.from==='me'?'justify-end':'justify-start'}`}>
                <div className="max-w-[78%] rounded-2xl px-3 py-2 text-sm"
                  style={{background:m.from==='me'?'var(--accent)':'var(--bg-l3)',color:'var(--t1)',
                    borderBottomRightRadius:m.from==='me'?2:16,borderBottomLeftRadius:m.from==='me'?16:2}}>
                  <p>{m.text}</p>
                  <p className="text-[9px] mt-0.5 text-right opacity-50">{fmtTs(m.t)}</p>
                </div>
              </div>
            ))}
            {xferLog.filter(x=>x.from===activePeer||x.to===activePeer).map((x,i)=>(
              <div key={'xf'+i} className={`flex ${x.type==='sent_file'?'justify-end':'justify-start'}`}>
                <div className="rounded-2xl px-3 py-2" style={{background:'var(--bg-l3)',border:'1px solid var(--border)'}}>
                  <p className="text-xs font-bold" style={{color:'var(--t2)'}}>{x.type==='sent_file'?'Отправлен':'Получен'}</p>
                  {x.name&&<p className="text-xs mt-0.5" style={{color:'var(--t1)'}}>{x.name}</p>}
                  {x.url&&<a href={x.url} download="received" className="text-[11px]" style={{color:'var(--accent)'}}>Скачать ({fmtSz(x.size||0)})</a>}
                </div>
              </div>
            ))}
          </div>
          <div className="flex gap-2 px-4 py-3" style={{borderTop:'1px solid var(--border)'}}>
            <input value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>e.key==='Enter'&&sendText()}
              placeholder={canSend?'P2P сообщение...':'Ожидание соединения...'}
              disabled={!canSend}
              className="flex-1 rounded-xl px-3 py-2 text-sm outline-none"
              style={{background:'var(--bg-l3)',border:'1px solid var(--border)',color:'var(--t1)'}}/>
            <motion.button whileTap={{scale:0.9}} type="button" onClick={sendText} disabled={!canSend||!input.trim()}
              className="grid h-9 w-9 place-items-center rounded-xl disabled:opacity-30"
              style={{background:'var(--accent)'}}>
              <span className="text-white text-base">↑</span>
            </motion.button>
          </div>
        </div>
      )}

      {wsState!=='connected'&&(
        <div className="rounded-2xl px-4 py-3" style={{background:'var(--bg-l2)',border:'1px solid var(--border)'}}>
          <p className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{color:'var(--t3)'}}>Технологии</p>
          {['WebRTC DataChannel — прямое P2P без серверов','STUN (Google, Cloudflare) — NAT traversal','Сигналинг через Sky WS — только для handshake','Передача файлов chunked 16KB ArrayBuffer','Работает через WiFi, 4G, спутниковый интернет'].map((t,i)=>(
            <div key={i} className="flex gap-2 mb-1">
              <p className="text-[10px] shrink-0" style={{color:'var(--accent)'}}>→</p>
              <p className="text-[11px] leading-relaxed" style={{color:'var(--t3)'}}>{t}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

/* ================================================================
   SATELLITE TAB (PC) — network analysis + open data
================================================================ */
const SatelliteTabPC = () => {
  const [netInfo,    setNI]   = useState<Record<string,any>>({});
  const [gpsPos,     setGps]  = useState<{lat:string;lon:string;acc:number;alt:string|null}|null>(null);
  const [gpsErr,     setGE]   = useState<string|null>(null);
  const [wx,         setWx]   = useState<Record<string,any>|null>(null);
  const [wxLoad,     setWxL]  = useState(false);
  const [tle,        setTle]  = useState<Record<string,any>|null>(null);
  const [tleLoad,    setTleL] = useState(false);
  const [rtt,        setRtt]  = useState<{avg:number|null;min:number|null;max:number|null}|null>(null);
  const [rttBusy,    setRttB] = useState(false);

  useEffect(()=>{
    const nav = navigator as any;
    const conn = nav.connection||nav.mozConnection||nav.webkitConnection;
    if(!conn){setNI({supported:false});return;}
    const read=()=>setNI({supported:true,type:conn.type??'—',effectiveType:conn.effectiveType??'—',downlink:conn.downlink??null,rtt:conn.rtt??null,saveData:conn.saveData??false});
    read(); conn.addEventListener('change',read);
    return()=>conn.removeEventListener('change',read);
  },[]);

  const satStatus = () => {
    if (!netInfo.supported) return {c:'var(--t3)',t:'Network API не поддерживается',Icon:HelpCircle};
    const rttV = netInfo.rtt as number|null;
    if (rttV == null) return {c:'var(--t3)',t:'RTT данные недоступны',Icon:HelpCircle};
    if (rttV > 500) return {c:'var(--accent)',t:'Возможен геостационарный спутник (RTT > 500мс)',Icon:Satellite};
    if (rttV > 100) return {c:'var(--amber)',t:'Возможен LEO-спутник (Starlink и др.)',Icon:Satellite};
    return {c:'var(--green)',t:'Обычное наземное соединение',Icon:Globe};
  };

  const getGPS = ()=>{
    setGE(null);
    navigator.geolocation?.getCurrentPosition(
      p=>setGps({lat:p.coords.latitude.toFixed(4),lon:p.coords.longitude.toFixed(4),acc:Math.round(p.coords.accuracy),alt:p.coords.altitude?p.coords.altitude.toFixed(0):null}),
      e=>setGE(e.message),{enableHighAccuracy:true,timeout:10000}
    );
  };

  const fetchWX = async ()=>{
    if(!gpsPos){setGE('Сначала получите GPS');return;}
    setWxL(true);
    try{
      const r=await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${gpsPos.lat}&longitude=${gpsPos.lon}&current=temperature_2m,wind_speed_10m,weather_code,cloud_cover,precipitation&wind_speed_unit=ms&timezone=auto`,{cache:'no-store'});
      const d=await r.json();const c=d.current;
      setWx({temp:c.temperature_2m,wind:c.wind_speed_10m,cloud:c.cloud_cover,code:c.weather_code,precip:c.precipitation});
    }catch(e:any){setWx({error:e.message});}
    setWxL(false);
  };

  const fetchTLE = async ()=>{
    setTleL(true);
    try{
      const r=await fetch('https://celestrak.org/satcat/tle.php?CATNR=25544',{cache:'no-store',signal:AbortSignal.timeout(8000)});
      const text=await r.text();const lines=text.trim().split('\n');
      setTle({name:lines[0]?.trim(),tle1:lines[1]?.trim(),tle2:lines[2]?.trim()});
    }catch(e:any){setTle({error:String(e.message)});}
    setTleL(false);
  };

  const runRTT = async ()=>{
    setRttB(true);
    const res:number[]=[];
    for(let i=0;i<5;i++){try{const t0=performance.now();await fetch('/api/health',{cache:'no-store',signal:AbortSignal.timeout(5000)});res.push(Math.round(performance.now()-t0));}catch{}}
    const avg=res.length?Math.round(res.reduce((a,b)=>a+b,0)/res.length):null;
    setRtt({avg,min:res.length?Math.min(...res):null,max:res.length?Math.max(...res):null});
    setRttB(false);
  };

  const WX_CODES:Record<number,string>={0:'Ясно',1:'Ясно',2:'Переменная облачность',3:'Пасмурно',45:'Туман',51:'Морось',61:'Дождь',71:'Снег',80:'Ливень',95:'Гроза'};
  const sl = satStatus();

  return (
    <div className="overflow-y-auto flex flex-col gap-3 pb-6 h-full" style={{scrollbarWidth:'none'}}>
      {/* Detection */}
      <div className="rounded-2xl p-4" style={{background:`${sl.c}10`,border:`1px solid ${sl.c}25`}}>
        <div className="flex items-center gap-3 mb-3">
          <sl.Icon size={22} style={{color:sl.c}}/>
          <div>
            <p className="text-sm font-bold" style={{color:'var(--t1)'}}>Анализ соединения</p>
            <p className="text-xs mt-0.5" style={{color:sl.c}}>{sl.t}</p>
          </div>
        </div>
        {netInfo.supported&&(
          <div className="grid grid-cols-2 gap-2">
            {[['Тип',netInfo.type],['Eff.',netInfo.effectiveType],['RTT',netInfo.rtt!=null?netInfo.rtt+'мс':'—'],['Скорость',netInfo.downlink!=null?netInfo.downlink+' Мбит/с':'—']].map(([k,v])=>(
              <div key={k as string} className="rounded-xl px-3 py-2" style={{background:'var(--bg-l2)'}}>
                <p className="text-[9px] uppercase tracking-wider mb-1" style={{color:'var(--t3)'}}>{k as string}</p>
                <p className="text-sm font-bold font-mono" style={{color:'var(--t1)'}}>{v as string}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* RTT test */}
      <div className="rounded-2xl p-4" style={{background:'var(--bg-l2)',border:'1px solid var(--border)'}}>
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-bold" style={{color:'var(--t1)'}}>Тест задержки (5 замеров)</p>
          <motion.button whileTap={{scale:0.9}} type="button" onClick={runRTT}
            className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold"
            style={{background:'var(--accent-bg)',color:'var(--accent)'}}>
            <Zap size={11}/>{rttBusy?'Тест...':'Запустить'}
          </motion.button>
        </div>
        {rtt&&<div className="grid grid-cols-3 gap-2">
          {[['Среднее',rtt.avg!=null?rtt.avg+'мс':'—'],['Мин',rtt.min!=null?rtt.min+'мс':'—'],['Макс',rtt.max!=null?rtt.max+'мс':'—']].map(([k,v])=>(
            <div key={k as string} className="rounded-xl px-3 py-2 text-center" style={{background:'var(--bg-l3)'}}>
              <p className="text-sm font-bold" style={{color:'var(--t1)'}}>{v as string}</p>
              <p className="text-[9px] mt-0.5" style={{color:'var(--t3)'}}>{k as string}</p>
            </div>
          ))}
        </div>}
        {rtt?.avg!=null&&<p className="text-xs mt-2" style={{color:'var(--t3)'}}>{rtt.avg>500?'Геостационарный спутник':rtt.avg>100?'Возможно LEO / Starlink':'Наземное соединение'}</p>}
      </div>

      {/* GPS + Weather */}
      <div className="rounded-2xl p-4" style={{background:'var(--bg-l2)',border:'1px solid var(--border)'}}>
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-bold" style={{color:'var(--t1)'}}>GPS + Погода (Open-Meteo)</p>
          <div className="flex gap-2">
            {!gpsPos&&<button type="button" onClick={getGPS} className="rounded-xl px-3 py-1.5 text-xs font-semibold" style={{background:'rgba(0,220,90,0.1)',color:'var(--green)',border:'1px solid rgba(0,220,90,0.2)'}}>GPS</button>}
            {gpsPos&&<button type="button" onClick={fetchWX} className="rounded-xl px-3 py-1.5 text-xs font-semibold" style={{background:'var(--accent-bg)',color:'var(--accent)',border:'1px solid rgba(79,110,247,0.2)'}}>{wxLoad?'Загрузка...':'Погода'}</button>}
          </div>
        </div>
        {gpsErr&&<p className="text-xs mb-2" style={{color:'var(--red)'}}>{gpsErr}</p>}
        {gpsPos&&<div className="grid grid-cols-2 gap-2 mb-3">
          {[['Широта',gpsPos.lat+'°'],['Долгота',gpsPos.lon+'°'],['Точность',gpsPos.acc+'м'],['Высота',gpsPos.alt?gpsPos.alt+'м':'—']].map(([k,v])=>(
            <div key={k as string} className="rounded-xl px-3 py-2" style={{background:'var(--bg-l3)'}}>
              <p className="text-[9px] uppercase tracking-wider mb-1" style={{color:'var(--t3)'}}>{k as string}</p>
              <p className="text-sm font-bold font-mono" style={{color:'var(--t1)'}}>{v as string}</p>
            </div>
          ))}
        </div>}
        {wx&&!wx.error&&<div className="grid grid-cols-2 gap-2">
          {[['Погода',WX_CODES[wx.code]||'—'],['Температура',wx.temp+'°C'],['Ветер',wx.wind+' м/с'],['Облачность',wx.cloud+'%']].map(([k,v])=>(
            <div key={k as string} className="rounded-xl px-3 py-2" style={{background:'var(--bg-l3)'}}>
              <p className="text-[9px] uppercase tracking-wider mb-1" style={{color:'var(--t3)'}}>{k as string}</p>
              <p className="text-sm font-semibold" style={{color:'var(--t1)'}}>{v as string}</p>
            </div>
          ))}
        </div>}
        {wx?.error&&<p className="text-xs" style={{color:'var(--red)'}}>{wx.error}</p>}
      </div>

      {/* Celestrak TLE */}
      <div className="rounded-2xl p-4" style={{background:'var(--bg-l2)',border:'1px solid var(--border)'}}>
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-sm font-bold" style={{color:'var(--t1)'}}>МКС — TLE орбитальные данные</p>
            <p className="text-[10px]" style={{color:'var(--t3)'}}>Celestrak.org · открытая база</p>
          </div>
          <motion.button whileTap={{scale:0.9}} type="button" onClick={fetchTLE}
            className="rounded-xl px-3 py-1.5 text-xs font-semibold"
            style={{background:'rgba(167,139,250,0.1)',color:'#a78bfa',border:'1px solid rgba(167,139,250,0.2)'}}>
            {tleLoad?'Загрузка...':'Загрузить TLE'}
          </motion.button>
        </div>
        {tle&&!tle.error&&(
          <div className="rounded-xl p-3" style={{background:'var(--bg-l3)'}}>
            {tle.name&&<p className="text-sm font-bold mb-2" style={{color:'#a78bfa'}}>{tle.name}</p>}
            {tle.tle1&&<p className="text-[9px] font-mono break-all leading-relaxed" style={{color:'var(--t3)'}}>{tle.tle1}</p>}
            {tle.tle2&&<p className="text-[9px] font-mono break-all leading-relaxed mt-1" style={{color:'var(--t3)'}}>{tle.tle2}</p>}
          </div>
        )}
        {tle?.error&&<p className="text-xs" style={{color:'var(--red)'}}>{tle.error}</p>}
      </div>

      <div className="rounded-xl px-4 py-3" style={{background:'var(--bg-l2)',border:'1px solid var(--border)'}}>
        <p className="text-xs leading-relaxed" style={{color:'var(--t3)'}}>
          Sky не подключается к спутникам напрямую. Если у вас есть спутниковый интернет (Starlink и др.),
          приложение работает через него как обычно. Раздел показывает характеристики вашего соединения
          и загружает открытые спутниковые данные.
        </p>
      </div>
    </div>
  );
};


/* ================================================================
   ROOT COMPONENT
================================================================ */
export const ConnectionPanel = () => {
  const [mode, setMode] = useState<Mode>('vless');
  const { status, activeId } = useProxyStore();

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 pt-5 pb-3 shrink-0">
        <div>
          <h2 className="text-base font-bold" style={{color:C.t1}}>Подключение</h2>
          <p className="text-xs mt-0.5" style={{color:C.t3}}>Реальные сетевые протоколы</p>
        </div>
        {activeId && (
          <div className="flex items-center gap-1.5 rounded-full px-3 py-1"
            style={{background:'rgba(0,220,90,0.08)',border:'1px solid rgba(0,220,90,0.2)'}}>
            <Dot color={STATUS_COLOR[status]}/>
            <p className="text-[11px] font-bold" style={{color:C.green}}>VLESS активен</p>
          </div>
        )}
      </div>

      {/* Mode selector */}
      <div className="flex gap-1.5 px-5 pb-3 overflow-x-auto shrink-0" style={{scrollbarWidth:'none'}}>
        {MODES.map(({key, label, icon:Icon})=>(
          <motion.button key={key} whileTap={{scale:0.94}} type="button"
            onClick={()=>setMode(key)}
            className="flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold transition-all"
            style={{
              background: mode===key ? C.acc : C.l1,
              color:      mode===key ? '#fff' : C.t3,
              border:`1px solid ${mode===key ? 'transparent' : C.brd}`,
            }}>
            <Icon size={12}/>
            {label}
          </motion.button>
        ))}
      </div>

      {/* Mode description */}
      <p className="px-5 pb-3 text-xs shrink-0" style={{color:C.t3}}>
        {MODES.find(m=>m.key===mode)?.desc}
      </p>

      <div className="h-px mx-5 shrink-0" style={{background:C.brd}}/>

      {/* Tab content */}
      <div className="flex-1 overflow-hidden px-5 pt-4">
        <AnimatePresence mode="wait">
          <motion.div key={mode} className="h-full"
            initial={{opacity:0,x:8}} animate={{opacity:1,x:0}} exit={{opacity:0,x:-8}}
            transition={{duration:0.12}}>
            {mode==='vless'     && <VlessTab/>}
            {mode==='proxy'     && <ProxyHttpTab/>}
            {mode==='satellite' && <SatelliteTabPC/>}
            {mode==='mesh'      && <SkyLinkTabPC/>}
            {mode==='cellular'  && <CellularTab/>}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
};
