/**
 * Настройки WebRTC для звонков, трансляций и голосовых комнат: STUN и (если настроен) TURN.
 * Без TURN соединение «человек ↔ человек» не устанавливается при симметричном NAT и в большинстве мобильных сетей — звонки и
 * трансляции «не подключаются». TURN-сервер (coturn) ставится отдельно: scripts/setup-turn.sh. Креденшалы выдаются ВРЕМЕННЫЕ
 * (REST-схема coturn: логин `срок:профиль`, пароль — HMAC-SHA1 от логина общим секретом), постоянного пароля в браузере нет.
 *  TURN_URLS     — через запятую: turn:host:3478?transport=udp, turns:host:5349?transport=tcp
 *  TURN_SECRET   — общий секрет coturn (static-auth-secret); ИЛИ TURN_USER + TURN_PASS (постоянная пара, хуже)
 *  RTC_STUN_URLS — свои STUN (через запятую); по умолчанию публичные Google
 *  RTC_TTL_SEC   — срок временных учётных данных (по умолчанию 12 ч)
 */
import crypto from 'node:crypto';

const list = (v) => String(v ?? '').split(',').map((x) => x.trim()).filter(Boolean);
const TTL = Math.max(600, Math.min(86_400, Number(process.env.RTC_TTL_SEC) || 12 * 3600));

export const iceConfig = (profileId) => {
  const stun = list(process.env.RTC_STUN_URLS);
  const servers = [{ urls: stun.length ? stun : ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
  const turn = list(process.env.TURN_URLS);
  let relay = false;
  if (turn.length) {
    const secret = process.env.TURN_SECRET;
    if (secret) {
      const username = `${Math.floor(Date.now() / 1000) + TTL}:${String(profileId ?? 'anon').slice(0, 60)}`;
      servers.push({ urls: turn, username, credential: crypto.createHmac('sha1', secret).update(username).digest('base64') });
      relay = true;
    } else if (process.env.TURN_USER && process.env.TURN_PASS) {
      servers.push({ urls: turn, username: process.env.TURN_USER, credential: process.env.TURN_PASS });
      relay = true;
    }
  }
  return { iceServers: servers, relay, ttl: TTL };
};
