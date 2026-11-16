/**
 * Sky Games: проверка конфигураций и построение ЗАКРЫТОЙ спецификации запуска игрового сервера. Чистый модуль без обращений к БД и сети:
 * им пользуются и API (проверка ввода), и агент на игровом хосте (сборка команды). Принципы изоляции, которые здесь зашиты:
 *  • сервер — контейнер под отдельным системным пользователем (uid из диапазона 20000+, свой для каждого сервера), без привилегий, с `--cap-drop ALL`, `no-new-privileges`, файловая система только для чтения;
 *  • жёсткие лимиты CPU, памяти (swap запрещён), числа процессов; диск — квота, которую проверяет агент (при превышении сервер останавливается);
 *  • сеть — отдельный мост `skygames`, наружу публикуется один порт сервера; никакого `--network host`, `--privileged`, docker.sock и чужих каталогов;
 *  • в контейнер попадают ТОЛЬКО проверенные поля конфигурации из белого списка (никаких произвольных переменных, команд, jar-файлов, модов и плагинов).
 * GTA: запуск не автоматизирован — поддерживается только подготовка (хост, порт, лимиты, каталоги, копии). Совместимость с модификациями и платформами не заявляется.
 */
export const KINDS = { minecraft: 'Minecraft', gta: 'GTA' };
export const MC_TYPES = ['VANILLA', 'PAPER', 'PURPUR', 'FABRIC'];            // типы, которые поддерживает образ itzg/minecraft-server и которые проверены по его документации
export const GTA_PLATFORMS = ['fivem', 'ragemp', 'altv'];                    // метки для учёта; запускать Sky их не умеет
export const PORT_RANGE = [25565, 25999];
export const UID_BASE = 20000;
export const NETWORK = 'skygames';
export const BASE_DIR = '/srv/skygames';
const LIM = { cpu: [0.25, 16], ramMb: [512, 65536], diskMb: [1024, 1_048_576], players: [1, 500] };
const err = (error, field) => ({ error, ...(field ? { field } : {}) });
const clean = (v, n) => Array.from(String(v ?? '')).filter((c) => c.charCodeAt(0) > 31).join('').trim().slice(0, n);

export const cleanLimits = (raw = {}) => {
  const out = {};
  for (const [k, [lo, hi]] of Object.entries(LIM)) {
    const n = Number(raw?.[k]); if (!Number.isFinite(n) || n < lo || n > hi) return err('bad_limit', k);
    out[k] = k === 'cpu' ? Math.round(n * 100) / 100 : Math.trunc(n);
  }
  if (out.ramMb < 1024 && true) { /* минимум для Java-сервера задан границей 512, предупреждение даёт панель */ }
  return { limits: out };
};

export const cleanConfig = (kind, raw = {}) => {
  if (kind === 'minecraft') {
    const type = String(raw.type ?? 'PAPER').toUpperCase(); if (!MC_TYPES.includes(type)) return err('bad_config', 'type');
    const version = String(raw.version ?? 'LATEST'); if (!/^(LATEST|\d{1,2}\.\d{1,2}(\.\d{1,2})?)$/.test(version)) return err('bad_config', 'version');
    if (raw.eulaAccepted !== true) return err('eula_required', 'eulaAccepted');       // принять лицензионное соглашение Minecraft должен человек, а не Sky за него
    const maxPlayers = Math.trunc(Number(raw.maxPlayers ?? 20)); if (!(maxPlayers >= 1 && maxPlayers <= 500)) return err('bad_config', 'maxPlayers');
    const difficulty = String(raw.difficulty ?? 'normal'); if (!['peaceful', 'easy', 'normal', 'hard'].includes(difficulty)) return err('bad_config', 'difficulty');
    const gamemode = String(raw.gamemode ?? 'survival'); if (!['survival', 'creative', 'adventure', 'spectator'].includes(gamemode)) return err('bad_config', 'gamemode');
    const view = Math.trunc(Number(raw.viewDistance ?? 10)); if (!(view >= 3 && view <= 32)) return err('bad_config', 'viewDistance');
    return { config: { type, version, eulaAccepted: true, maxPlayers, difficulty, gamemode, viewDistance: view, motd: clean(raw.motd, 59).replace(/[\\"$`]/g, ''), onlineMode: raw.onlineMode !== false, whitelist: raw.whitelist === true } };
  }
  if (kind === 'gta') {
    const platform = String(raw.platform ?? ''); if (!GTA_PLATFORMS.includes(platform)) return err('bad_config', 'platform');
    return { config: { platform, notes: clean(raw.notes, 500) } };                    // только учёт: что именно и на каких условиях запускать, решает владелец отдельно
  }
  return err('bad_kind', 'kind');
};

export const uidOf = (serial) => UID_BASE + Number(serial);
export const dirOf = (id) => `${BASE_DIR}/${id}`;
export const containerOf = (id) => `sky-gs-${id}`;

/** Спецификация запуска: массив аргументов docker (БЕЗ оболочки) + что агент должен подготовить. Для GTA запуск не поддерживается. */
export const buildLaunchSpec = (srv, { image = 'itzg/minecraft-server' } = {}) => {
  if (srv.kind !== 'minecraft') return err('launch_not_supported');
  if (!/^[a-z0-9][a-z0-9./_-]{1,100}(:[A-Za-z0-9._-]{1,60})?$/.test(image)) return err('bad_image');
  if (!/^gs-[0-9a-f-]{36}$/.test(srv.id)) return err('bad_id');
  const port = Number(srv.port); if (!(port >= PORT_RANGE[0] && port <= PORT_RANGE[1])) return err('bad_port');
  const l = srv.limits; if (!l || !(l.cpu > 0) || !(l.ramMb >= 512)) return err('bad_limit');
  const c = srv.config;
  const heap = Math.max(256, Math.floor(l.ramMb * 0.75));                              // остальное — запас под память самой JVM и системы
  const uid = uidOf(srv.serial);
  const env = {
    EULA: 'TRUE', TYPE: c.type, VERSION: c.version, MEMORY: `${heap}M`, MAX_PLAYERS: String(c.maxPlayers), DIFFICULTY: c.difficulty, MODE: c.gamemode,
    VIEW_DISTANCE: String(c.viewDistance), ONLINE_MODE: c.onlineMode ? 'TRUE' : 'FALSE', ENFORCE_WHITELIST: c.whitelist ? 'TRUE' : 'FALSE', MOTD: c.motd, UID: String(uid), GID: String(uid),
  };
  const args = ['run', '-d', '--name', containerOf(srv.id), '--restart', 'no', '--user', `${uid}:${uid}`,
    '--cpus', String(l.cpu), '--memory', `${l.ramMb}m`, '--memory-swap', `${l.ramMb}m`, '--pids-limit', '512', '--ulimit', 'nofile=4096:4096',
    '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--read-only', '--tmpfs', '/tmp:rw,noexec,nosuid,size=256m',
    '--network', NETWORK, '-p', `${port}:25565/tcp`, '-v', `${dirOf(srv.id)}/data:/data`, '--label', `sky.server=${srv.id}`, '--label', `sky.disk_mb=${l.diskMb}`, '--log-driver', 'json-file', '--log-opt', 'max-size=10m', '--log-opt', 'max-file=3'];
  for (const [k, v] of Object.entries(env)) args.push('-e', `${k}=${v}`);
  args.push(image);
  return { spec: { args, uid, dir: dirOf(srv.id), diskMb: l.diskMb, container: containerOf(srv.id), network: NETWORK } };
};

/** Страховка: ничего из запрещённого в итоговой команде быть не должно (проверяют и тест, и агент перед запуском). */
export const assertSafeArgs = (args) => {
  if (!Array.isArray(args) || args[0] !== 'run') return false;
  const bad = new Set(['--privileged', '--pid', '--ipc', '--uts', '--cap-add', '--device', '--userns', '--net', '--volumes-from', '--cgroup-parent', '--group-add', '--sysctl', '--add-host', '--dns', '--env-file', '--mount', '--entrypoint']);
  for (let i = 1; i < args.length; i++) {
    const a = String(args[i]); const next = String(args[i + 1] ?? '');
    if (bad.has(a) || a.startsWith('--privileged=') || a.includes('docker.sock')) return false;
    if (a === '--network' && next !== NETWORK) return false;
    if (a === '--security-opt' && next !== 'no-new-privileges') return false;
    if (a === '-v' && (!next.startsWith(`${BASE_DIR}/`) || next.includes('..') || next.split(':').length !== 2)) return false;
    if (a === '-p' && !/^\d{5}:25565\/tcp$/.test(next)) return false;
  }
  return args.includes('--cap-drop') && args[args.indexOf('--cap-drop') + 1] === 'ALL' && args.includes('--read-only') && args.includes('--memory') && args.includes('--cpus') && args.includes('--user') && args.includes('--pids-limit');
};
