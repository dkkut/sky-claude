/* ===============================================================
   SKY PROXY UI  -  управление VLESS / Trojan подключениями
=============================================================== */
import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Shield, Plus, Trash2, Check, X, Copy, ChevronRight,
  Wifi, WifiOff, RefreshCw, AlertCircle, ChevronLeft, QrCode,
} from 'lucide-react';
import {
  useProxyStore, STATUS_LABEL, STATUS_COLOR,
  parseProxyUri, type ProxyProtocol, type ProxyConfig,
} from './store';

const C = {
  bg:'#0f0f14', l1:'#161619', l2:'#1c1c22',
  border:'var(--border)', b2:'var(--border-m)',
  t1:'var(--t1)', t2:'var(--t2)', t3:'var(--t3)',
  accent:'var(--accent)', green:'var(--green)', amber:'var(--amber)', red:'var(--red)',
};

/* -- Toggle ----------------------------------------------- */
const Toggle = ({ on, onToggle }: { on:boolean; onToggle:()=>void }) => (
  <motion.button type="button" onClick={onToggle}
    className="relative h-6 w-11 rounded-full shrink-0 transition-colors"
    style={{ background: on ? C.accent : 'var(--border-m)' }}>
    <motion.div className="absolute top-1 h-4 w-4 rounded-full bg-white shadow"
      animate={{ left: on ? 22 : 2 }} transition={{ type:'spring', stiffness:500, damping:30 }}/>
  </motion.button>
);

/* -- Config Card ------------------------------------------ */
const ConfigCard = ({ cfg, onEdit }: { cfg:ProxyConfig; onEdit:()=>void }) => {
  const { activeId, status, latencyMs, connect, disconnect, ping, removeConfig, exportUri } = useProxyStore();
  const isActive  = cfg.id === activeId;
  const sc        = isActive ? STATUS_COLOR[status] : C.t3;
  const [copied, setCopied] = useState(false);
  const [pinging, setPinging] = useState(false);
  const [delConf, setDelConf] = useState(false);

  const handleConnect = async () => {
    if (isActive && status === 'connected') { disconnect(); return; }
    await connect(cfg.id);
  };

  const handlePing = async () => {
    if (!isActive || status !== 'connected') return;
    setPinging(true);
    await ping();
    setPinging(false);
  };

  const handleCopy = async () => {
    const uri = exportUri(cfg.id);
    await navigator.clipboard.writeText(uri).catch(()=>{});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="rounded-2xl overflow-hidden"
      style={{ background:C.l1, border:`1.5px solid ${isActive?sc+'50':C.border}`,
        boxShadow: isActive&&status==='connected' ? `0 0 0 3px ${C.green}18` : 'none' }}>
      {/* Status bar */}
      {isActive && <div className="h-0.5" style={{ background:sc }}/>}

      <div className="p-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-2 mb-3">
          <div className="flex items-center gap-2.5">
            <div className="grid h-9 w-9 place-items-center rounded-xl text-base shrink-0"
              style={{ background: cfg.protocol==='vless' ? 'rgba(79,110,247,0.15)' : 'rgba(168,85,247,0.15)' }}>
              {cfg.protocol === 'vless' ? '⚡' : '🔒'}
            </div>
            <div>
              <p className="text-sm font-bold truncate" style={{ color:C.t1, maxWidth:140 }}>
                {cfg.name}
              </p>
              <p className="text-[10px] font-semibold uppercase tracking-wider"
                style={{ color: cfg.protocol==='vless' ? C.accent : '#a855f7' }}>
                {cfg.protocol.toUpperCase()}
              </p>
            </div>
          </div>
          {/* Status */}
          <div className="flex items-center gap-1.5 shrink-0">
            {isActive && (
              <motion.div className="h-2 w-2 rounded-full"
                style={{ background:sc }}
                animate={status==='connecting'?{opacity:[1,0.3,1]}:{}}
                transition={{ duration:1, repeat:Infinity }}/>
            )}
            <span className="text-[10px] font-semibold" style={{ color:sc }}>
              {isActive ? STATUS_LABEL[status] : 'Не активен'}
            </span>
          </div>
        </div>

        {/* Connection info */}
        <div className="rounded-xl px-3 py-2.5 mb-3"
          style={{ background:C.l2, border:`1px solid ${C.border}` }}>
          <div className="flex items-center justify-between text-[11px]">
            <span style={{ color:C.t3 }}>Сервер</span>
            <span className="font-mono font-semibold truncate ml-2" style={{ color:C.t1 }}>
              {cfg.address}:{cfg.port}
            </span>
          </div>
          <div className="flex items-center justify-between text-[11px] mt-1">
            <span style={{ color:C.t3 }}>Путь</span>
            <span className="font-mono" style={{ color:C.t2 }}>{cfg.path || '/'}</span>
          </div>
          <div className="flex items-center justify-between text-[11px] mt-1">
            <span style={{ color:C.t3 }}>TLS</span>
            <span style={{ color: cfg.tls ? C.green : C.amber }}>
              {cfg.tls ? '✓ Включён' : '✗ Выключен'}
            </span>
          </div>
          {isActive && latencyMs !== null && status === 'connected' && (
            <div className="flex items-center justify-between text-[11px] mt-1">
              <span style={{ color:C.t3 }}>Задержка</span>
              <span className="font-mono font-bold"
                style={{ color: latencyMs < 100 ? C.green : latencyMs < 300 ? C.amber : C.red }}>
                {latencyMs} мс
              </span>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          {/* Connect/Disconnect */}
          <motion.button whileTap={{ scale:.95 }} type="button" onClick={handleConnect}
            className="flex-1 flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-xs font-bold transition-all"
            style={{
              background: isActive && status==='connected'
                ? 'rgba(248,113,113,0.12)'
                : isActive && status==='connecting'
                  ? 'rgba(245,158,11,0.12)'
                  : `${C.accent}15`,
              color: isActive && status==='connected' ? C.red
                   : isActive && status==='connecting' ? C.amber
                   : C.accent,
              border: `1px solid ${isActive&&status==='connected'?C.red+'30':isActive&&status==='connecting'?C.amber+'30':C.accent+'30'}`,
            }}>
            {isActive && status==='connected'
              ? <><WifiOff size={13}/> Отключить</>
              : isActive && status==='connecting'
                ? <><RefreshCw size={13} className="animate-spin"/> Подключение...</>
                : <><Wifi size={13}/> Подключить</>}
          </motion.button>

          {/* Ping */}
          {isActive && status==='connected' && (
            <button type="button" onClick={handlePing} disabled={pinging}
              className="grid h-9 w-9 place-items-center rounded-xl hover:bg-white/5 shrink-0"
              title="Пинг">
              <RefreshCw size={14} style={{ color:C.t3 }} className={pinging?'animate-spin':''}/>
            </button>
          )}

          {/* Copy URI */}
          <button type="button" onClick={handleCopy}
            className="grid h-9 w-9 place-items-center rounded-xl hover:bg-white/5 shrink-0"
            title="Скопировать URI">
            {copied ? <Check size={14} style={{ color:C.green }}/> : <Copy size={14} style={{ color:C.t3 }}/>}
          </button>

          {/* Delete */}
          {delConf ? (
            <div className="flex gap-1">
              <button type="button" onClick={() => removeConfig(cfg.id)}
                className="grid h-9 w-9 place-items-center rounded-xl"
                style={{ background:'rgba(248,113,113,0.15)' }}>
                <Check size={13} style={{ color:C.red }}/>
              </button>
              <button type="button" onClick={() => setDelConf(false)}
                className="grid h-9 w-9 place-items-center rounded-xl hover:bg-white/5">
                <X size={13} style={{ color:C.t3 }}/>
              </button>
            </div>
          ) : (
            <button type="button" onClick={() => setDelConf(true)}
              className="grid h-9 w-9 place-items-center rounded-xl hover:bg-white/5 shrink-0">
              <Trash2 size={13} style={{ color:C.t3 }}/>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

/* -- Add Config Form -------------------------------------- */
const PROTOCOLS: ProxyProtocol[] = ['vless','trojan'];

const AddConfigForm = ({ onDone }: { onDone: () => void }) => {
  const { addConfig, importUri } = useProxyStore();
  const [mode,     setMode]     = useState<'uri'|'manual'>('uri');
  const [uri,      setUri]      = useState('');
  const [protocol, setProtocol] = useState<ProxyProtocol>('vless');
  const [name,     setName]     = useState('');
  const [address,  setAddress]  = useState('');
  const [port,     setPort]     = useState('443');
  const [uuid,     setUuid]     = useState('');
  const [password, setPassword] = useState('');
  const [path,     setPath]     = useState('/');
  const [sni,      setSni]      = useState('');
  const [tls,      setTls]      = useState(true);
  const [err,      setErr]      = useState('');

  const handleUri = () => {
    setErr('');
    const id = importUri(uri.trim());
    if (id) { onDone(); return; }
    setErr('Неверный формат. Используйте vless:// или trojan://');
  };

  const handleManual = () => {
    setErr('');
    if (!address.trim() || !port) { setErr('Укажите сервер и порт'); return; }
    if (protocol==='vless' && !uuid.trim()) { setErr('Укажите UUID'); return; }
    if (protocol==='trojan' && !password.trim()) { setErr('Укажите пароль'); return; }
    addConfig({
      name:     name.trim() || `${protocol.toUpperCase()} ${address}`,
      protocol, address:address.trim(), port:parseInt(port)||443,
      path:     path||'/', tls, sni:sni.trim()||address.trim(),
      uuid:     uuid.trim()||undefined,
      password: password.trim()||undefined,
      fingerprint: 'chrome',
    });
    onDone();
  };

  const iSty = { background:C.l2, border:`1px solid ${C.border}`, color:C.t1 };

  return (
    <div className="space-y-4">
      {/* Mode tabs */}
      <div className="flex rounded-xl overflow-hidden" style={{ border:`1px solid ${C.border}` }}>
        {(['uri','manual'] as const).map((m,i) => (
          <button key={m} type="button" onClick={() => { setMode(m); setErr(''); }}
            className="flex-1 py-2.5 text-xs font-bold transition-all"
            style={{ background:mode===m?C.accent:'transparent',
              color:mode===m?'#fff':C.t3,
              borderRight:i===0?`1px solid ${C.border}`:'none' }}>
            {m==='uri' ? '🔗 Вставить URI' : '⚙️ Вручную'}
          </button>
        ))}
      </div>

      {mode === 'uri' ? (
        <div className="space-y-3">
          <div>
            <label className="text-[10px] font-bold uppercase tracking-wider block mb-1.5" style={{ color:C.t3 }}>
              VLESS или Trojan URI
            </label>
            <textarea value={uri} onChange={e=>setUri(e.target.value)} rows={4}
              placeholder="vless://uuid@host:443?type=ws&security=tls&path=/ws#Название&#10;trojan://password@host:443?type=ws&security=tls#Название"
              className="w-full rounded-2xl px-4 py-3 text-xs font-mono outline-none resize-none"
              style={iSty}/>
          </div>
          <div className="rounded-xl px-3 py-2.5 text-[10px] leading-relaxed"
            style={{ background:`${C.accent}08`, border:`1px solid ${C.accent}20`, color:C.t3 }}>
            💡 Поддерживаются URI-ссылки из Xray, V2RayN, NekoRay. Импортируйте из вашей панели управления.
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {/* Protocol */}
          <div>
            <label className="text-[10px] font-bold uppercase tracking-wider block mb-1.5" style={{ color:C.t3 }}>Протокол</label>
            <div className="flex rounded-xl overflow-hidden" style={{ border:`1px solid ${C.border}` }}>
              {PROTOCOLS.map((p,i) => (
                <button key={p} type="button" onClick={()=>setProtocol(p)}
                  className="flex-1 py-2 text-xs font-bold"
                  style={{ background:protocol===p?C.accent:'transparent', color:protocol===p?'#fff':C.t3,
                    borderRight:i===0?`1px solid ${C.border}`:'none' }}>
                  {p === 'vless' ? '⚡ VLESS' : '🔒 Trojan'}
                </button>
              ))}
            </div>
          </div>

          {/* Credentials */}
          <div className="grid grid-cols-1 gap-2">
            <input value={name} onChange={e=>setName(e.target.value)}
              placeholder="Название (необязательно)"
              className="w-full rounded-xl px-3 py-2.5 text-sm outline-none" style={iSty}/>
            {protocol==='vless'
              ? <input value={uuid} onChange={e=>setUuid(e.target.value)}
                  placeholder="UUID (xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)"
                  className="w-full rounded-xl px-3 py-2.5 text-xs font-mono outline-none" style={iSty}/>
              : <input value={password} onChange={e=>setPassword(e.target.value)}
                  placeholder="Пароль" type="password"
                  className="w-full rounded-xl px-3 py-2.5 text-sm outline-none" style={iSty}/>
            }
          </div>

          {/* Server */}
          <div className="flex gap-2">
            <input value={address} onChange={e=>setAddress(e.target.value)}
              placeholder="Адрес сервера" className="flex-1 rounded-xl px-3 py-2.5 text-sm outline-none" style={iSty}/>
            <input value={port} onChange={e=>setPort(e.target.value)}
              placeholder="Порт" type="number" className="w-20 rounded-xl px-3 py-2.5 text-sm outline-none" style={iSty}/>
          </div>

          {/* Path + SNI */}
          <div className="flex gap-2">
            <input value={path} onChange={e=>setPath(e.target.value)}
              placeholder="WS Path" className="flex-1 rounded-xl px-3 py-2.5 text-sm font-mono outline-none" style={iSty}/>
            <input value={sni} onChange={e=>setSni(e.target.value)}
              placeholder="SNI" className="flex-1 rounded-xl px-3 py-2.5 text-sm outline-none" style={iSty}/>
          </div>

          {/* TLS toggle */}
          <div className="flex items-center justify-between px-1">
            <div>
              <p className="text-sm font-semibold" style={{ color:C.t1 }}>TLS</p>
              <p className="text-[10px]" style={{ color:C.t3 }}>Рекомендуется для безопасности</p>
            </div>
            <Toggle on={tls} onToggle={() => setTls(v => !v)}/>
          </div>
        </div>
      )}

      {err && (
        <div className="flex items-center gap-2 rounded-xl px-3 py-2.5"
          style={{ background:'rgba(248,113,113,0.08)', border:'1px solid rgba(248,113,113,0.2)' }}>
          <AlertCircle size={13} style={{ color:C.red }}/>
          <p className="text-xs" style={{ color:C.red }}>{err}</p>
        </div>
      )}

      <motion.button whileTap={{ scale:.97 }} type="button"
        onClick={mode==='uri' ? handleUri : handleManual}
        className="w-full rounded-2xl py-3.5 text-sm font-bold text-white"
        style={{ background:`linear-gradient(135deg,${C.accent},#818cf8)`, boxShadow:`0 6px 24px ${C.accent}40` }}>
        {mode==='uri' ? '📥 Импортировать' : '✅ Добавить конфиг'}
      </motion.button>
    </div>
  );
};

/* === MAIN PROXY PANEL ==================================== */
export const ProxyPanel = () => {
  const { configs, activeId, status, latencyMs, bytesUp, bytesDown, error } = useProxyStore();
  const [view, setView] = useState<'list'|'add'>('list');

  const activeCfg = configs.find(c => c.id === activeId);

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ background:C.bg }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-4 pb-3 shrink-0">
        {view === 'add' ? (
          <>
            <button type="button" onClick={() => setView('list')}
              className="flex items-center gap-1.5 text-sm font-semibold" style={{ color:C.accent }}>
              <ChevronLeft size={16}/> Назад
            </button>
            <p className="text-sm font-bold" style={{ color:C.t1 }}>Добавить конфиг</p>
            <div className="w-16"/>
          </>
        ) : (
          <>
            <div className="flex items-center gap-2.5">
              <div className="grid h-9 w-9 place-items-center rounded-xl"
                style={{ background:`${C.accent}18`, border:`1px solid ${C.accent}30` }}>
                <Shield size={17} style={{ color:C.accent }}/>
              </div>
              <div>
                <p className="text-sm font-bold" style={{ color:C.t1 }}>Sky Proxy</p>
                <p className="text-[10px]" style={{ color:C.t3 }}>VLESS · Trojan · WS+TLS</p>
              </div>
            </div>
            <motion.button whileTap={{ scale:.94 }} type="button" onClick={() => setView('add')}
              className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold"
              style={{ background:C.accent, color:'#fff' }}>
              <Plus size={13}/> Добавить
            </motion.button>
          </>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-3" style={{ scrollbarWidth:'none' }}>

        {view === 'add' ? (
          <AddConfigForm onDone={() => setView('list')}/>
        ) : (
          <>
            {/* Global status */}
            {activeCfg && (
              <div className="rounded-2xl p-4"
                style={{ background:C.l1, border:`1.5px solid ${STATUS_COLOR[status]}30` }}>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-bold uppercase tracking-wider" style={{ color:C.t3 }}>
                    Статус подключения
                  </p>
                  <div className="flex items-center gap-1.5">
                    <motion.div className="h-2.5 w-2.5 rounded-full"
                      style={{ background:STATUS_COLOR[status] }}
                      animate={status==='connecting'?{opacity:[1,0.2,1]}:status==='connected'?{scale:[1,1.2,1]}:{}}
                      transition={{ duration:1.2, repeat:Infinity }}/>
                    <span className="text-xs font-semibold" style={{ color:STATUS_COLOR[status] }}>
                      {STATUS_LABEL[status]}
                    </span>
                  </div>
                </div>
                <p className="text-sm font-bold text-white">{activeCfg.name}</p>
                <p className="text-[10px] font-mono mt-0.5" style={{ color:C.t3 }}>
                  {activeCfg.address}:{activeCfg.port} · {activeCfg.protocol.toUpperCase()}
                </p>
                {latencyMs !== null && status==='connected' && (
                  <div className="flex gap-4 mt-2 text-[10px]">
                    <span style={{ color:C.t3 }}>Пинг: <span className="font-bold"
                      style={{ color:latencyMs<100?C.green:latencyMs<300?C.amber:C.red }}>
                      {latencyMs} мс</span>
                    </span>
                  </div>
                )}
                {error && (
                  <p className="text-[10px] mt-1.5" style={{ color:C.red }}>⚠️ {error}</p>
                )}
              </div>
            )}

            {/* Config list */}
            {configs.length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-12">
                <div className="grid h-16 w-16 place-items-center rounded-3xl text-3xl"
                  style={{ background:C.l1, border:`1px solid ${C.border}` }}>🔒</div>
                <div className="text-center">
                  <p className="text-base font-bold" style={{ color:C.t1 }}>Нет конфигураций</p>
                  <p className="text-sm mt-1" style={{ color:C.t2 }}>
                    Добавьте VLESS или Trojan конфиг для безопасного соединения
                  </p>
                </div>
                <div className="rounded-2xl px-4 py-3 max-w-xs"
                  style={{ background:`${C.accent}08`, border:`1px solid ${C.accent}20` }}>
                  <p className="text-[11px] leading-relaxed text-center" style={{ color:C.t3 }}>
                    Поддерживаются VLESS и Trojan через WebSocket + TLS транспорт. Вставьте URI из Xray/V2RayN/NekoRay.
                  </p>
                </div>
              </div>
            ) : (
              configs.map(cfg => <ConfigCard key={cfg.id} cfg={cfg} onEdit={() => {}}/>)
            )}

            {/* Info block */}
            <div className="rounded-2xl px-4 py-3"
              style={{ background:'rgba(255,255,255,0.02)', border:`1px solid ${C.border}` }}>
              <p className="text-[10px] leading-relaxed" style={{ color:C.t3 }}>
                🔐 Соединение устанавливается через WebSocket + TLS. UUID/пароль хранятся локально и не передаются на сервера Sky.
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
