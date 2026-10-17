/**
 * Контекст запроса: какая сессия его прислала.
 *
 * Нужен шлюзу входа в админку (admingate.mjs): право администратора спрашивается
 * в десятках мест через can()/rightsOf(), и ни одно из них не знает, с какого устройства
 * пришёл вопрос. Контекст живёт через await (как язык в lang.mjs), поэтому единственная
 * проверка в admin.mjs закрывает панель везде сразу, а не там, где о ней вспомнили.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import crypto from 'node:crypto';

const als = new AsyncLocalStorage();

export const runWithSession = (sid, fn, slot = 1) => als.run({ sid: sid ? String(sid) : null, slot: slot === 2 || slot === 3 ? slot : 1, profile: undefined, requestId: crypto.randomBytes(6).toString('hex') }, fn);
/** Корреляционный идентификатор запроса — попадает в журналы, чтобы связать события одного запроса. */
export const getRequestContext = () => ({ requestId: als.getStore()?.requestId ?? '' });
export const currentSession = () => als.getStore() ?? null;
