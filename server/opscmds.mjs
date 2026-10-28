/**
 * Sky Ops — ЗАКРЫТЫЙ список заданий для сервера. Один модуль и для API (проверка ввода, каталог для панели),
 * и для агента на хосте (ops/agent.mjs: из описания собирает команды). Произвольной оболочки здесь нет и быть не должно:
 * кто получит доступ к панели, не должен получить root на сервере. Ввод человека — только значения из выбора и числа в границах;
 * в командную строку он попадает отдельными аргументами (без bash -c), поэтому подставить в неё лишнее нельзя.
 * Модуль не импортирует ничего, кроме встроенного: агент работает на хосте без зависимостей проекта.
 */

export const SERVICES = ['api', 'web', 'db', 'redis', 'certbot'];
export const LOG_FILES = {
  watchdog: '/var/log/sky-watchdog.log',
  control: '/var/log/sky-control.log',
  backup: '/var/log/sky-backup.log',
  ops: '/var/log/sky-ops.log',
};
const ERR_RE = 'error|exception|fatal|unhandled|econn|eacces|denied|blocked|err_|failed|timeout|panic|killed|oom';

const P = {
  service: { name: 'service', label: 'Служба', type: 'select', options: SERVICES, def: 'api' },
  lines: { name: 'lines', label: 'Строк', type: 'number', min: 20, max: 2000, def: 200 },
  filter: { name: 'filter', label: 'Искать (необязательно)', type: 'text', max: 60 },
  minutes: { name: 'minutes', label: 'За сколько минут', type: 'number', min: 5, max: 1440, def: 120 },
  file: { name: 'file', label: 'Журнал', type: 'select', options: Object.keys(LOG_FILES), def: 'watchdog' },
};

/**
 * group: read (только чтение, без подтверждения) | fix (меняет состояние) | deploy | build.
 * mutating: нужен код подтверждения и одно такое задание за раз.
 * steps(ctx, p): описание шагов для агента (агент знает типы run | tail | say | repair).
 */
export const COMMANDS = {
  status: { label: 'Состояние служб (docker compose ps)', group: 'read', params: [], steps: () => [{ type: 'run', cwd: 'app', argv: ['docker', 'compose', 'ps', '-a'] }] },
  logs: {
    label: 'Журнал службы', group: 'read', params: [P.service, P.lines, P.filter],
    steps: (c, p) => [{ type: 'run', cwd: 'app', argv: ['docker', 'compose', 'logs', '--no-color', '--tail', String(p.lines), p.service], filter: p.filter ? { contains: p.filter } : undefined }],
  },
  errors: {
    label: 'Ошибки в журнале API за последнее время', group: 'read', params: [{ ...P.lines, def: 2000, label: 'Просмотреть строк' }],
    steps: (c, p) => [{ type: 'run', cwd: 'app', argv: ['docker', 'compose', 'logs', '--no-color', '--tail', String(p.lines), 'api'], filter: { regex: ERR_RE, last: 150 } }],
  },
  web_errors: {
    label: 'Ошибки в журнале nginx (web)', group: 'read', params: [{ ...P.lines, def: 1000, label: 'Просмотреть строк' }],
    steps: (c, p) => [{ type: 'run', cwd: 'app', argv: ['docker', 'compose', 'logs', '--no-color', '--tail', String(p.lines), 'web'], filter: { regex: '\\[(error|crit|alert|emerg)\\]| 50[0-9] ', last: 150 } }],
  },
  healthz: {
    label: 'Отвечает ли API (healthz)', group: 'read', params: [],
    steps: () => [{ type: 'run', cwd: 'app', timeout: 30, argv: ['docker', 'compose', 'exec', '-T', 'api', 'node', '-e', "fetch('http://127.0.0.1:8080/healthz').then(async r=>console.log('HTTP',r.status,(await r.text()).slice(0,200))).catch(e=>{console.log('нет ответа:',e.message);process.exit(1)})"] }],
  },
  disk: { label: 'Диск и память', group: 'read', params: [], steps: () => [
    { type: 'run', argv: ['df', '-h', '/', '/opt'] }, { type: 'run', argv: ['free', '-m'] }, { type: 'run', argv: ['uptime'] }, { type: 'run', argv: ['docker', 'system', 'df'] },
  ] },
  nginx_test: { label: 'Проверка конфигурации nginx', group: 'read', params: [], steps: () => [{ type: 'run', cwd: 'app', argv: ['docker', 'compose', 'exec', '-T', 'web', 'nginx', '-t'] }] },
  version: { label: 'Какая версия выложена', group: 'read', params: [], steps: () => [
    { type: 'run', cwd: 'src', argv: ['git', 'log', '-3', '--format=%h %ad %s', '--date=iso'] },
    { type: 'run', cwd: 'src', argv: ['git', 'status', '--short', '-b'] },
    { type: 'run', cwd: 'app', argv: ['docker', 'compose', 'images'] },
  ] },
  ssh: { label: 'SSH: служба, порты, журнал', group: 'read', params: [P.minutes], steps: (c, p) => [
    { type: 'run', argv: ['systemctl', 'is-active', 'ssh', 'sshd'], okCodes: [0, 1, 3, 4] },
    { type: 'run', argv: ['ss', '-tlnp'], filter: { contains: 'sshd' } },
    { type: 'run', argv: ['journalctl', '-u', 'ssh', '-u', 'sshd', '--since', `-${p.minutes} min`, '--no-pager', '-n', '80'], okCodes: [0, 1] },
    { type: 'run', argv: ['journalctl', '-t', 'sky-ssh-gate', '--since', `-${p.minutes} min`, '--no-pager', '-n', '60'], okCodes: [0, 1] },
  ] },
  firewall: { label: 'Файрвол и баны', group: 'read', params: [], steps: () => [
    { type: 'run', argv: ['ufw', 'status', 'verbose'], okCodes: [0, 1] }, { type: 'run', argv: ['fail2ban-client', 'status', 'sshd'], okCodes: [0, 1, 127] },
  ] },
  defense_blocks: {
    label: 'Блокировки адресов самозащитой', group: 'read', params: [],
    steps: () => [{ type: 'run', cwd: 'app', argv: ['docker', 'compose', 'exec', '-T', 'db', 'psql', '-U', 'sky', '-c', 'SELECT ip_mask, reason, expires_at FROM defense_ip_blocks WHERE expires_at > now() ORDER BY expires_at DESC LIMIT 50;'] }],
  },
  host_log: { label: 'Журнал службы хоста (watchdog, control, копии)', group: 'read', params: [P.file, { ...P.lines, def: 100 }], steps: (c, p) => [{ type: 'tail', file: LOG_FILES[p.file], n: p.lines }] },
  build_tools: { label: 'Всё ли готово для сборки приложений', group: 'read', params: [], steps: () => [{ type: 'run', cwd: 'src', argv: ['bash', 'scripts/setup-build-tools.sh', '--check'], okCodes: [0, 1, 2] }] },

  restart: {
    label: 'Перезапустить службу', group: 'fix', mutating: true, timeoutSec: 300,
    params: [{ name: 'service', label: 'Что перезапустить', type: 'select', options: ['api', 'web', 'api+web'], def: 'api' }],
    steps: (c, p) => [{ type: 'run', cwd: 'app', timeout: 240, argv: ['docker', 'compose', 'restart', ...(p.service === 'api+web' ? ['api', 'web'] : [p.service])] }, { type: 'run', cwd: 'app', argv: ['docker', 'compose', 'ps'] }],
  },
  repair: {
    label: 'Починить всё', group: 'fix', mutating: true, timeoutSec: 900,
    params: [{ name: 'clearBlocks', label: 'Снять блокировки адресов самозащитой', type: 'bool', def: true }],
    steps: () => [{ type: 'repair' }],
  },
  deploy: {
    label: 'Деплой (забрать из репозитория, собрать, перезапустить)', group: 'deploy', mutating: true, timeoutSec: 3600,
    params: [{ name: 'skipPull', label: 'Не делать git pull (собрать то, что уже лежит)', type: 'bool', def: false }],
    steps: (c, p) => [{ type: 'run', cwd: 'src', timeout: 3600, env: { SRC_DIR: c.src, APP_DIR: c.app, ...(p.skipPull ? { SKIP_PULL: '1' } : {}) }, argv: ['bash', '-c', 'umask 022; exec bash "$1"', '_', `${c.src}/scripts/deploy-local.sh`] }],
  },
  build_apps: {
    label: 'Пересобрать приложения (.apk / .exe)', group: 'build', mutating: true, timeoutSec: 6000,
    params: [
      { name: 'target', label: 'Что собрать', type: 'select', options: ['apk', 'exe', 'all'], def: 'all' },
      { name: 'force', label: 'Собрать заново, даже если ничего не менялось', type: 'bool', def: false },
    ],
    steps: (c, p) => [
      { type: 'run', cwd: 'src', timeout: 6000, env: p.force ? { FORCE_BUILD: '1' } : {}, argv: ['bash', 'scripts/build-apps.sh', p.target], okCodes: [0] },
      { type: 'run', argv: ['ls', '-la', '/opt/sky/apps'], okCodes: [0, 2] },
    ],
  },
};

/** Команда по имени. Только собственные ключи: «constructor», «__proto__» командами не считаются. */
export const getCommand = (kind) => (typeof kind === 'string' && Object.hasOwn(COMMANDS, kind) ? COMMANDS[kind] : null);

export const GROUPS = { read: 'Диагностика', fix: 'Починка', deploy: 'Деплой', build: 'Сборка приложений' };

const intIn = (v, min, max, def) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : def; };

/** Приводит ввод к допустимому виду. Лишние ключи отбрасываются, значения вне границ — подтягиваются или отклоняются. */
export const cleanJob = (kind, raw) => {
  const cmd = getCommand(typeof kind === 'string' ? kind : '');
  if (!cmd) return { error: 'unknown_command' };
  const src = raw && typeof raw === 'object' ? raw : {};
  const params = {};
  for (const spec of cmd.params) {
    const v = src[spec.name];
    if (spec.type === 'select') {
      const val = v === undefined || v === '' ? spec.def : String(v);
      if (!spec.options.includes(val)) return { error: 'bad_param', field: spec.name };
      params[spec.name] = val;
    } else if (spec.type === 'number') params[spec.name] = intIn(v ?? spec.def, spec.min, spec.max, spec.def);
    else if (spec.type === 'bool') params[spec.name] = v === undefined ? Boolean(spec.def) : v === true || v === 'true' || v === 1;
    else if (spec.type === 'text') {
      const t = String(v ?? '').trim();
      if (t.length > spec.max) return { error: 'bad_param', field: spec.name };
      if (t && !/^[\p{L}\p{N} _.:/@=-]+$/u.test(t)) return { error: 'bad_param', field: spec.name };
      params[spec.name] = t;
    }
  }
  return { kind: String(kind), params, mutating: Boolean(cmd.mutating), timeoutSec: cmd.timeoutSec ?? 120 };
};

/** Каталог для панели: без функций. */
export const catalog = () => Object.entries(COMMANDS).map(([id, c]) => ({ id, label: c.label, group: c.group, mutating: Boolean(c.mutating), params: c.params }));

/** Вырезает из вывода то, что похоже на секрет: вывод видят все с правом `server_ops`. */
export const scrubText = (t) => String(t ?? '')
  .replace(/(postgres(?:ql)?|redis|mongodb|amqp):\/\/[^\s'"]+/gi, '$1://***')
  .replace(/\b(sk-[A-Za-z0-9_-]{16,}|AKIA[0-9A-Z]{12,}|gh[pousr]_[A-Za-z0-9]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{20,})\b/g, '***')
  .replace(/\b(Bearer)\s+[A-Za-z0-9._~+/=-]{12,}/gi, '$1 ***')
  .replace(/\bSK[AD][0-9A-Za-z-]{16,}\b/g, '***')
  .replace(/\b((?:[A-Z][A-Z0-9_]*)?(?:SECRET|TOKEN|PASSWORD|PASS|API_KEY|PRIVATE_KEY|ACCESS_KEY|ENCRYPTION_KEY)[A-Z0-9_]*)\s*[=:]\s*\S+/g, '$1=***')
  .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, '***');
