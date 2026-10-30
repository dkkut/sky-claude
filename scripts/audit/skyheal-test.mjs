// scripts/sky-heal.sh на подставном docker: диагностика, лестница лечения, остановка на первой помогшей ступени, --dry, защита (тома не трогаются),
// маскирование секретов, откат образов только по флагу. Запуск: node scripts/audit/skyheal-test.mjs
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, chmodSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let ok = 0, bad = 0;
const t = (n, c, x = '') => { if (c) { ok++; console.log('ok  ', n); } else { bad++; console.log('FAIL', n, x); } };
const dir = mkdtempSync(join(tmpdir(), 'skyheal-'));
const app = join(dir, 'app'), bin = join(dir, 'bin'), st = join(dir, 'state'), calls = join(dir, 'calls.log');
mkdirSync(app); mkdirSync(bin); mkdirSync(join(dir, 'src/server'), { recursive: true });
writeFileSync(join(app, 'docker-compose.yml'), 'services: {}\n'); writeFileSync(join(app, '.env'), 'API_IMAGE=sky-api:new\nWEB_IMAGE=sky-web:new\nREDIS_PASSWORD=hunter2hunter2\n'); chmodSync(join(app, '.env'), 0o600);
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
        printf 'db running healthy\\nredis running healthy\\n'
        if [ "$api" = healthy ]; then printf 'api running healthy\\n'; else printf 'api exited \\n'; fi
        printf 'web running healthy\\n'; exit 0;;
      up) [ "$mode" = up_fixes ] && set_api healthy; [ "$mode" = rollback_fixes ] && grep -q 'API_IMAGE=sky-api:old' "${app}/.env" && set_api healthy; exit 0;;
      restart) [ "$mode" = restart_api_fixes ] && [ "$2" = api ] && set_api healthy; exit 0;;
      logs) echo "api: boot failed PASSWORD=supersecret TOKEN: abc123"; exit 0;;
      exec)
        case "$*" in
          *healthz*) [ "$api" = healthy ] && echo '{"ok":true}' || exit 1; exit 0;;
          *pg_isready*) exit 0;; *redis-cli*) echo PONG; exit 0;; *"nginx -t"*) exit 0;; *psql*) echo 0; exit 0;;
        esac; exit 0;;
    esac;;
esac
exit 0
`); chmodSync(join(bin, 'docker'), 0o755);

const run = (mode, args) => { writeFileSync(join(dir, 'state_dummy'), ''); mkdirSync(st, { recursive: true }); writeFileSync(join(st, 'mode'), mode); writeFileSync(join(st, 'api'), 'exited'); writeFileSync(calls, '');
  const r = spawnSync('bash', ['scripts/sky-heal.sh', ...args], { env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, APP_DIR: app, SRC_DIR: join(dir, 'src'), SKY_HEAL_LOG: join(dir, 'heal.log'), SKY_HEAL_LOCK: join(dir, 'lock'), WAIT_SEC: '6' }, encoding: 'utf8', timeout: 120000 });
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
writeFileSync(join(app, '.env'), 'API_IMAGE=sky-api:new\nWEB_IMAGE=sky-web:new\n'); chmodSync(join(app, '.env'), 0o600);

r = run('never', ['--fix', '--yes', '--dry']);
t('--dry: показывает шаги и ничего не выполняет', r.out.includes('[dry]') && !/compose up|compose restart/.test(r.calls), r.calls);

chmodSync(join(app, '.env'), 0o644);
r = run('up_fixes', ['--check']);
t('права .env 644 замечены', r.out.includes('.env: права 644'));
r = run('up_fixes', ['--fix', '--yes']);
t('лечение исправило права .env', (readFileSync(join(app, '.env')) && (require_stat() === '600')), '');
function require_stat() { return (spawnSync('stat', ['-c', '%a', join(app, '.env')], { encoding: 'utf8' }).stdout || '').trim(); }

console.log(`\n${ok} ok, ${bad} fail`); process.exit(bad ? 1 : 0);
