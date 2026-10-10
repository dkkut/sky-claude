/**
 * Sky AI: голосовой режим.
 *
 * Это не отдельный ассистент и не отдельная история: голосовой ход
 * распознаётся в текст, уходит в тот же sendMessage(), что и обычная
 * печатная реплика, и попадает в тот же диалог (ai_chats/ai_messages).
 * Ответ дополнительно озвучивается — это единственное, что здесь
 * добавляется поверх обычного чата.
 *
 * Право и предел проверяются здесь же, до тяжёлой работы: голосовой
 * ход — Prime-инструмент (распознавание и синтез стоят серверу денег
 * на каждый ход, помимо самого обращения к модели). Порядок: право →
 * предел → работа.
 */
import { hasPrime } from './skyid.mjs';
import { transcribeAudio, synthesizeSpeech, sttConfigured, ttsConfigured } from './ai.mjs';
import { takeQuota, refundQuota, sendMessage } from './aichat.mjs';
import { sniffAudio } from './aitools.mjs';

export { sniffAudio };

/** Живой голосовой ход — не запись подкаста: несколько минут разговора
 * с запасом, без потолка на файл-расшифровку (aitools.mjs). */
export const MAX_VOICE_BYTES = 20 * 1024 * 1024;

const gate = async (profileId) => {
  const prime = await hasPrime(profileId);
  if (!prime) return { error: 'prime_required' };
  const quota = await takeQuota(profileId, 'voice', true);
  if (quota.error) return quota;
  return { prime: true, quota };
};

/**
 * Один голосовой ход: запись → распознанный текст → ответ модели (тот
 * же sendMessage, что и обычная реплика) → голосовой ответ.
 *
 * `audio` — уже проверенный по сигнатуре Buffer, `mime` — то, что
 * определил sniffAudio, а не то, что прислал браузер в заголовке.
 */
export const voiceTurn = async (profileId, { audio, mime, chatId, language = '' } = {}) => {
  if (!sttConfigured()) return { error: 'stt_not_configured' };

  const pass = await gate(profileId);
  if (pass.error) return pass;

  const recognized = await transcribeAudio({
    audio, mime, name: `voice.${mime.split('/')[1] ?? 'webm'}`,
    language: /^[a-z]{2}$/i.test(String(language)) ? String(language).toLowerCase() : '',
  });
  if (recognized.error) {
    await refundQuota(profileId, 'voice');
    return recognized;
  }
  if (!recognized.text.trim()) {
    await refundQuota(profileId, 'voice');
    return { error: 'stt_empty' };
  }

  /* Дальше — обычный чат: та же квота 'chat', та же история, то же
     право на диалог. Голосовой ход не даёт ничего сверх того, что дал
     бы точно такой же текст, набранный руками. */
  const result = await sendMessage(profileId, { chatId, body: recognized.text, prime: true, voice: true, assist: true });
  if (result.error) {
    await refundQuota(profileId, 'voice');
    return { ...result, recognizedText: recognized.text };
  }

  /* Озвучка — лучшее старание: если поставщик не назван или ответил
     отказом, голосовой ход всё равно возвращает текстовый ответ, просто
     без звука. Уже состоявшийся разговор не отменяют из-за того, что
     не получилось его прочитать вслух. */
  let speech = null;
  if (ttsConfigured()) {
    const synth = await synthesizeSpeech({ text: result.answer.text });
    if (!synth.error) speech = synth;
  }

  return {
    ...result,
    recognizedText: recognized.text,
    audio: speech ? speech.audio.toString('base64') : null,
    audioMime: speech?.mime ?? null,
    usage: { ...result.usage, voice: { used: pass.quota.used, limit: pass.quota.limit } },
  };
};
