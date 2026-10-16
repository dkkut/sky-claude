#!/usr/bin/env bash
# ============================================================
#  Секреты платёжного партнёра SkyKassa — в .env (на сервер, не в браузер).
#
#      cd /opt/sky-src && bash scripts/set-skykassa-partner.sh <id>      # внести/заменить секреты партнёра
#      bash scripts/set-skykassa-partner.sh --check                      # что внесено (без значений)
#
#  <id> — тот же латинский идентификатор, что вы завели в админке (вкладка SkyKassa → Партнёры).
#  Спрашивает «секрет подписи» и «номер магазина» скрыто, пишет в SKYKASSA_PARTNERS_JSON (.env → 600),
#  не печатает значения. Партнёр считается подключённым, только когда есть и адрес API (в админке),
#  и секрет с номером магазина (здесь). Применить: bash scripts/deploy-local.sh.
# ============================================================
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .env ] || { echo "Здесь нет .env — запускайте из каталога приложения (где docker-compose.yml)."; exit 1; }
command -v python3 >/dev/null || { echo "Нужен python3."; exit 1; }

case "${1:-}" in
  ""|-h|--help) sed -n 2,13p "$0"; exit 0 ;;
  --check)
    python3 - <<'PY'
import json,re
raw=''
for l in open('.env'):
    if l.startswith('SKYKASSA_PARTNERS_JSON='): raw=l.split('=',1)[1].strip()
raw=raw.strip("'\"")
try: d=json.loads(raw) if raw else {}
except Exception: print('  ✖ SKYKASSA_PARTNERS_JSON: не читается как JSON'); raise SystemExit(1)
if not d: print('  ✖ партнёры не внесены')
for k,v in d.items(): print(f"  ✔ {k}: секрет {'задан' if len(v.get('secret',''))>=16 else 'КОРОТКИЙ/нет'}, номер магазина {'задан' if v.get('merchant') else 'нет'}")
PY
    exit 0 ;;
esac

ID="$1"
[[ "$ID" =~ ^[a-z][a-z0-9_-]{1,30}$ ]] || { echo "Идентификатор: латиница, цифры, _ и -, начинается с буквы (как в админке)."; exit 1; }
read -r -s -p "Секрет подписи партнёра $ID (не короче 16 знаков): " SECRET; echo
[ "${#SECRET}" -ge 16 ] || { echo "Секрет слишком короткий."; exit 1; }
read -r -p "Номер магазина (merchant) у партнёра: " MERCHANT
[ -n "$MERCHANT" ] || { echo "Номер магазина пуст."; exit 1; }

SKY_ID="$ID" SKY_SECRET="$SECRET" SKY_MERCHANT="$MERCHANT" python3 - <<'PY'
import json,os,tempfile,stat
lines=open('.env').read().split('\n')
cur={}
for l in lines:
    if l.startswith('SKYKASSA_PARTNERS_JSON='):
        raw=l.split('=',1)[1].strip().strip("'\"")
        try: cur=json.loads(raw) if raw else {}
        except Exception: cur={}
cur[os.environ['SKY_ID']]={'secret':os.environ['SKY_SECRET'],'merchant':os.environ['SKY_MERCHANT']}
new="SKYKASSA_PARTNERS_JSON='"+json.dumps(cur,ensure_ascii=False,separators=(',',':'))+"'"
out=[];done=False
for l in lines:
    if l.startswith('SKYKASSA_PARTNERS_JSON='):
        if not done: out.append(new); done=True
    else: out.append(l)
if not done:
    while out and out[-1]=='': out.pop()
    out.append(new); out.append('')
fd,tmp=tempfile.mkstemp(prefix='.env.',dir='.')
os.write(fd,'\n'.join(out).encode()); os.close(fd); os.chmod(tmp,0o600); os.replace(tmp,'.env')
PY
echo "Готово: секреты партнёра $ID внесены в .env (значения не показаны)."
echo "Применить: bash scripts/deploy-local.sh   ·   Проверить связь: админка → SkyKassa → Партнёры → «Проверить связь»."
