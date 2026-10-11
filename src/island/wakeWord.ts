/* Фраза-активатор — отдельный чистый модуль, чтобы её можно было проверять тестом. */
/** «привет скай», «эй скай», «hey sky» — с запятой и без. */
export const WAKE_RE = /(^|[\s,.!?])(привет|приветик|эй|слушай|окей|окэй|ok|okay|hey|hi|hello)[\s,.!?-]*(ск[аэе]й|sky|ску)(?![а-яёa-z])/i;
export const isWakePhrase = (text: string) => WAKE_RE.test(text.trim());
