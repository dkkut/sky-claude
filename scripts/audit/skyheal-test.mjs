// scripts/sky-heal.sh на подставном docker: диагностика, лестница лечения, остановка на первой помогшей ступени, --dry, защита (тома не трогаются),
// маскирование секретов, откат образов только по флагу. Запуск: node scripts/audit/skyheal-test.mjs
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, chmodSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SEC = 'JWT_SECRET=jwt-secret-for-test-0123456789\nREFRESH_TOKEN_SECRET=refresh-secret-for-test-0123456789\n';
let ok = 0, bad = 0;
const t = (n, c, x = '') => { if (c) { ok++; console.log('ok  ', n); } else { bad++; console.log('FAIL', n, x); } };
const dir = mkdtempSync(join(tmpdir(), 'skyheal-'));
const app = join(dir, 'app'), bin = join(dir, 'bin'), st = join(dir, 'state'), calls = join(dir, 'calls.log');
mkdirSync(app); mkdirSync(bin); mkdirSync(join(dir, 'src/server'), { recursive: true });
writeFileSync(join(app, 'docker-compose.yml'), 'services: {}\n'); writeFileSync(join(app, '.env'), 'API_IMAGE=sky-api:new\nWEB_IMAGE=sky-web:new\nREDIS_PASSWORD=hunter2hunter2\n'+SEC); chmodSync(join(app, '.env'), 0o600);
writeFileSync(join(dir, 'src/server/a.mjs'), 'x\n');

// Подставной docker. Состояние: файл state — сценарий. up_fixes: «compose up -d» чинит; restart_api_fixes: чинит перезапуск api; never: ничего не помогает.
writeFileSync(join(bin, 'docker'), `#!/usr/bin/env bash
S="${st}"; echo "$*" >> "${calls}"
mode="$(cat "$S/mode" 2>/dev/null || echo up_fixes)"; api="$(cat "$S/api" 2>/dev/null || echo exited)"
set_api() { echo "$1" > "$S/api"; }
case "$1" in
  info) exit 0;;
  inspect) case "$*" in *OOMKilled*) echo false;; *) echo 0;; esac; exit 0;;
  image) printf 'sky-api:new 2026-10-30\\nsky-api:old 2026-10-20\\nsky-web:new 2026-10-30\\nsky-web:old 2026-10-20\\n'; exit 0;;
  builder|container) exit 0;;
  compose)
    shift
    case "$1" in
      ps)
        if [ "$2" = "-q" ]; then echo cid-$3; exit 0; fi
        if [ "$*" = "ps -a --format {{.Service}}" ]; then printf '%s\\nredis\\napi\\nweb\\n' "$(cat "$S/dbname" 2>/dev/null || echo db)"; exit 0; fi
        printf '%s running healthy\\nredis running healthy\\n' "$(cat "$S/dbname" 2>/dev/null || echo db)"
        if [ "$api" = healthy ]; then printf 'api running healthy\\n'; else printf 'api exited \\n'; fi
        printf 'web running healthy\\n'; exit 0;;
      up) [ "$mode" = up_fixes ] && set_api healthy; [ "$mode" = rollback_fixes ] && grep -q 'API_IMAGE=sky-api:old' "${app}/.env" && set_api healthy; exit 0;;
      restart) [ "$mode" = restart_api_fixes ] && [ "$2" = api ] && set_api healthy; exit 0;;
      logs) if [ -f "$S/logs" ]; then cat "$S/logs"; else echo "api: boot failed PASSWORD=supersecret TOKEN: abc123"; fi; exit 0;;
      run) exit 0;;
      config) if [ "$2" = "--services" ]; then printf '%s\\nredis\\napi\\nweb\\n' "$(cat "$S/dbname" 2>/dev/null || echo db)"; fi; exit 0;;
      exec)
        case "$*" in
          *healthz*) [ "$api" = healthy ] && echo '{"ok":true}' || exit 1; exit 0;;
          *pg_isready*) exit 0;; *redis-cli*) echo PONG; exit 0;; *"nginx -t"*) exit 0;;
          *OPS_SECRET*) cat "$S/ops_api" 2>/dev/null; exit 0;;
          *psql*)
            case "$*" in
              *"FROM defense_ip_blocks WHERE expires_at"*) cat "$S/blocks" 2>/dev/null || echo 0;;
              *"SELECT level FROM firewall_state"*) cat "$S/level" 2>/dev/null || echo 0;;
              *"pinned_until::text"*) echo;; *"set_by,"*) echo авто;;
              *schema_migrations*) cat "$S/applied" 2>/dev/null || echo 0;;
              *pg_stat_activity*) echo "5/100";;
              *DELETE*) echo 0 > "$S/blocks";; *UPDATE*) echo 0 > "$S/level";;
              *) echo 0;;
            esac; exit 0;;
        esac; exit 0;;
    esac;;
esac
exit 0
`); chmodSync(join(bin, 'docker'), 0o755);

writeFileSync(join(bin, 'systemctl'), `#!/usr/bin/env bash
echo "systemctl $*" >> "${calls}"
case "$1" in cat) exit 0;; is-active) exit 0;; esac; exit 0
`); chmodSync(join(bin, 'systemctl'), 0o755);
writeFileSync(join(bin, 'journalctl'), `#!/usr/bin/env bash
cat "${st}/journal" 2>/dev/null; exit 0
`); chmodSync(join(bin, 'journalctl'), 0o755);
const run = (mode, args, opts = {}) => { writeFileSync(join(dir, 'state_dummy'), ''); mkdirSync(st, { recursive: true }); for (const f of ['dbname', 'logs', 'blocks', 'level', 'applied', 'ops_api']) rmSync(join(st, f), { force: true }); writeFileSync(join(st, 'mode'), mode); writeFileSync(join(st, 'api'), opts.api ?? 'exited'); for (const [k, v] of Object.entries(opts.state ?? {})) writeFileSync(join(st, k), v); writeFileSync(calls, '');
  const r = spawnSync('bash', ['scripts/sky-heal.sh', ...args], { env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, APP_DIR: app, SRC_DIR: join(dir, 'src'), SKY_HEAL_LOG: join(dir, 'heal.log'), SKY_HEAL_LOCK: join(dir, 'lock'), WAIT_SEC: '6', ...(opts.env ?? {}) }, encoding: 'utf8', timeout: 120000 });
  return { rc: r.status, out: (r.stdout || '') + (r.stderr || ''), calls: readFileSync(calls, 'utf8') }; };

let r = run('up_fixes', ['--check']);
t('диагностика видит упавший api и возвращает 1', r.rc === 1 && r.out.includes('api: состояние «exited»'), r.out.slice(0, 300));
t('диагностика ничего не чинит (ни up, ни restart)', !/compose up|compose restart/.test(r.calls));
t('диагностика печатает ✔ для здоровых db/redis', r.out.includes('✔ db: работает') && r.out.includes('✔ Redis отвечает'));

r = run('up_fixes', ['--fix', '--yes']);
t('лечение: up -d помогло, код 0', r.rc === 0 && r.out.includes('ГОТОВО'), r.out.slice(-300));
t('лечение остановилось на первой ступени (без перезапусков)', /compose up -d/.test(r.calls) && !/compose restart/.test(r.calls));

r = run('restart_api_fixes', ['--fix', '--yes']);
t('лечение: перезапуск api помог на второй ступени', r.rc === 0 && /compose restart api/.test(r.calls) && !/compose restart db/.test(r.calls), r.calls);

r = run('never', ['--fix', '--yes']);
t('лечение: ничего не помогло — код 1 и список ручных шагов', r.rc === 1 && r.out.includes('Что осталось') && r.out.includes('Ступень 3'), r.out.slice(-400));
t('тома и база не трогаются (нет down/rm/volume)', !/compose down|volume rm|compose rm|system prune/.test(r.calls), r.calls);
t('без --rollback образы не меняются', readFileSync(join(app, '.env'), 'utf8').includes('API_IMAGE=sky-api:new') && r.out.includes('--rollback'));
t('секреты в журнале контейнера замаскированы', !r.out.includes('supersecret') && !r.out.includes('abc123') && r.out.includes('***'), r.out.slice(-300));

r = run('rollback_fixes', ['--fix', '--yes', '--rollback']);
t('--rollback: прежние образы подставлены, помогло', r.rc === 0 && readFileSync(join(app, '.env'), 'utf8').includes('API_IMAGE=sky-api:old') && existsSync(join(app, '.env.heal-backup')), r.out.slice(-300));
t('--rollback: пароль Redis в .env не тронут', readFileSync(join(app, '.env'), 'utf8').includes('REDIS_PASSWORD=hunter2hunter2'));
writeFileSync(join(app, '.env'), 'API_IMAGE=sky-api:new\nWEB_IMAGE=sky-web:new\n'+SEC); chmodSync(join(app, '.env'), 0o600);

r = run('never', ['--fix', '--yes', '--dry']);
t('--dry: показывает шаги и ничего не выполняет', r.out.includes('[dry]') && !/compose up|compose restart/.test(r.calls), r.calls);

chmodSync(join(app, '.env'), 0o644);
r = run('up_fixes', ['--check']);
t('права .env 644 замечены', r.out.includes('.env: права 644'));
r = run('up_fixes', ['--fix', '--yes']);
t('лечение исправило права .env', (readFileSync(join(app, '.env')) && (require_stat() === '600')), '');
function require_stat() { return (spawnSync('stat', ['-c', '%a', join(app, '.env')], { encoding: 'utf8' }).stdout || '').trim(); }

/* ───────── Новая диагностика причин и лечение ───────── */
const healthy = { api: 'healthy' };
const SECRET = 'opssecret-0123456789abcdefABCDEF';
const opsEnv = join(dir, 'sky-ops.env');

r = run('up_fixes', ['--check'], { ...healthy, state: { dbname: 'postgres', blocks: '0', level: '0' } });
t('служба БД называется postgres — определяется сама', r.out.includes('✔ postgres: работает') && !r.out.includes('служба db не найдена'), r.out.slice(0, 400));
t('запросы к базе идут в службу postgres, а не db', /exec -T postgres psql/.test(r.calls) && !/exec -T db psql/.test(r.calls), r.calls.slice(0, 300));
t('здоровая система: известных причин в журналах нет', r.out.includes('известных причин сбоя нет'));

r = run('up_fixes', ['--check'], { ...healthy, state: { blocks: '12', level: '3' } });
t('блокировки самозащиты и уровень файрвола 3 замечены', r.out.includes('самозащита держит 12 блокировок') && r.out.includes('файрвол Sky на уровне 3'), r.out.slice(0, 600));
t('диагностика сама ничего не удаляет', !/DELETE|UPDATE/.test(r.calls));

r = run('up_fixes', ['--fix', '--yes'], { ...healthy, state: { blocks: '12', level: '3' } });
t('--fix: снимает только «подбор путей», файрвол без --unlock не трогает', /DELETE FROM defense_ip_blocks WHERE reason ILIKE/.test(r.calls) && !/UPDATE firewall_state/.test(r.calls) && r.out.includes('--unlock'), r.calls.slice(-400));
r = run('up_fixes', ['--fix', '--yes', '--unlock'], { ...healthy, state: { blocks: '12', level: '3' } });
t('--fix --unlock: снимает все блокировки и сбрасывает уровень', /DELETE FROM defense_ip_blocks"?\s*$/m.test(r.calls) || /DELETE FROM defense_ip_blocks(?! WHERE)/.test(r.calls), r.calls.slice(-500));
t('--unlock: уровень файрвола сброшен на 0', /UPDATE firewall_state SET level=0/.test(r.calls));

r = run('up_fixes', ['--check'], { ...healthy, state: { logs: "Error: EACCES: permission denied, open '/app/server/x.mjs'\n" } });
t('журнал: EACCES → причина «нет прав на файлы» с подсказкой', r.out.includes('нет прав на файлы приложения') && r.out.includes('heal выдаст права'), r.out.slice(0, 500));
r = run('up_fixes', ['--check'], { ...healthy, state: { logs: 'FATAL:  password authentication failed for user "sky"\n' } });
t('журнал: пароль БД → причина названа, лечится вручную', r.out.includes('пароль БД в .env не совпадает') && r.out.includes('POSTGRES_PASSWORD'));
r = run('up_fixes', ['--check'], { ...healthy, state: { logs: '[db] не применены миграции (3): 224_x.sql, 225_y.sql…\n' } });
t('журнал: не применены миграции → причина', r.out.includes('схема базы отстаёт от кода'));
r = run('up_fixes', ['--fix', '--yes'], { ...healthy, state: { logs: '[db] не применены миграции (3): 224_x.sql…\n' } });
t('--fix: миграции применяются одноразовым запуском образа api', /compose run --rm --no-deps api node scripts\/migrate\.mjs/.test(r.calls), r.calls.slice(-400));
t('миграции: тома и база не удаляются', !/compose down|volume rm|DROP /.test(r.calls));
r = run('up_fixes', ['--check'], { ...healthy, state: { logs: '[email:smtp] connect ETIMEDOUT 1.2.3.4:465 PASSWORD=zzz\n' } });
t('журнал: сбой почты распознан, пароль замаскирован', r.out.includes('почтовый сервер отказывает') && !r.out.includes('PASSWORD=zzz'), r.out.slice(0, 600));

// Sky Ops: секрет есть у агента, нет в .env и контейнере
writeFileSync(opsEnv, `OPS_SECRET=${SECRET}\n`); chmodSync(opsEnv, 0o600);
r = run('up_fixes', ['--check'], { ...healthy, env: { SKY_OPS_ENV: opsEnv } });
t('Sky Ops: секрет только у агента — причина названа (404 ops_disabled)', r.out.includes('секрет только у агента') && r.out.includes('--fix-env'), r.out.slice(0, 600));
t('Sky Ops: значение секрета нигде не напечатано', !r.out.includes(SECRET));
r = run('up_fixes', ['--fix', '--yes'], { ...healthy, env: { SKY_OPS_ENV: opsEnv } });
t('без --fix-env .env не правится', !readFileSync(join(app, '.env'), 'utf8').includes('OPS_SECRET=') && r.out.includes('--fix-env'));
r = run('up_fixes', ['--fix', '--yes', '--fix-env', '--dry'], { ...healthy, env: { SKY_OPS_ENV: opsEnv } });
t('--dry --fix-env: секрет не печатается и .env не меняется', !r.out.includes(SECRET) && !readFileSync(join(app, '.env'), 'utf8').includes('OPS_SECRET='), r.out.slice(-300));
r = run('up_fixes', ['--fix', '--yes', '--fix-env'], { ...healthy, env: { SKY_OPS_ENV: opsEnv } });
const envAfter = readFileSync(join(app, '.env'), 'utf8');
t('--fix --fix-env: секрет перенесён в .env, остальное цело, права 600', envAfter.includes(`OPS_SECRET=${SECRET}`) && envAfter.includes('API_IMAGE=sky-api:new') && require_stat() === '600');
t('--fix --fix-env: api пересоздан, чтобы получить секрет', /compose up -d --force-recreate api/.test(r.calls), r.calls.slice(-300));
t('--fix --fix-env: вывод не содержит секрет', !r.out.includes(SECRET));
writeFileSync(join(app, '.env'), 'API_IMAGE=sky-api:new\nWEB_IMAGE=sky-web:new\n'+SEC); chmodSync(join(app, '.env'), 0o600);

// секрет в .env есть, а контейнер создан до этого
writeFileSync(join(app, '.env'), `API_IMAGE=sky-api:new\nWEB_IMAGE=sky-web:new\n${SEC}OPS_SECRET=${SECRET}\n`); chmodSync(join(app, '.env'), 0o600);
r = run('up_fixes', ['--fix', '--yes'], { ...healthy, env: { SKY_OPS_ENV: opsEnv } });
t('Sky Ops: секрет в .env есть, контейнер без него → api пересоздаётся', r.out.includes('создан до записи секрета') && /compose up -d --force-recreate api/.test(r.calls), r.out.slice(0, 500));
r = run('up_fixes', ['--check'], { ...healthy, state: { ops_api: SECRET }, env: { SKY_OPS_ENV: opsEnv } });
t('Sky Ops: секреты совпадают — зелёное', r.out.includes('секрет агента и API совпадают'));
writeFileSync(join(app, '.env'), 'API_IMAGE=sky-api:new\nWEB_IMAGE=sky-web:new\n'+SEC); chmodSync(join(app, '.env'), 0o600);

// почта
r = run('up_fixes', ['--check'], { ...healthy });
t('почта: EMAIL_MODE=log замечен, но не ломает итог «здоров»', r.out.includes('почта не настроена') && r.rc === 0, `${r.rc} ${r.out.slice(0, 300)}`);

// --open-ssh: проверка ввода и сухой прогон (файл в /etc не пишется)
r = run('up_fixes', ['--open-ssh', 'abc']);
t('--open-ssh: нечисловое значение отклоняется', r.rc === 64);
r = run('up_fixes', ['--open-ssh', '30', '--dry']);
t('--open-ssh --dry: ничего не пишет', r.rc === 0 && r.out.includes('[dry]') && !existsSync('/etc/sky-ssh-gate.off.heal-test'));
r = run('up_fixes', ['--open-ssh', '999']);
t('--open-ssh: больше 240 минут отклоняется', r.rc === 64 || r.rc === 77);

// --report: файл создан, секретов нет
writeFileSync(join(app, '.env'), `API_IMAGE=sky-api:new\nWEB_IMAGE=sky-web:new\nJWT_SECRET=jwtsecretvalue-xxxxxxxxxxxxxxxx\nREFRESH_TOKEN_SECRET=refresh-secret-for-test-0123456789\n`); chmodSync(join(app, '.env'), 0o600);
r = run('up_fixes', ['--check', '--report'], { ...healthy });
const rep = (r.out.match(/Отчёт: (\S+)/) || [])[1];
t('--report: файл отчёта создан (права 600)', Boolean(rep) && existsSync(rep) && (spawnSync('stat', ['-c', '%a', rep], { encoding: 'utf8' }).stdout || '').trim() === '600', r.out.slice(-200));
const repText = rep && existsSync(rep) ? readFileSync(rep, 'utf8') : '';
t('--report: значения секретов нет, только «задано/ПУСТО»', !repText.includes('jwtsecretvalue') && /JWT_SECRET=задано/.test(repText) && /OPS_SECRET=ПУСТО/.test(repText), repText.slice(0, 400));
t('--report: журналы служб приложены', repText.includes('## logs api'));
writeFileSync(join(app, '.env'), 'API_IMAGE=sky-api:new\nWEB_IMAGE=sky-web:new\n'+SEC); chmodSync(join(app, '.env'), 0o600);


console.log(`\n${ok} ok, ${bad} fail`); process.exit(bad ? 1 : 0);
