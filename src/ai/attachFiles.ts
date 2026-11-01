/** Файлы как контекст запроса к Sky AI (чат и «Код»): читаются на устройстве, уходят в запрос текстом. Бинарные файлы отклоняются — для документов и картинок есть вкладки «Документ» и «Изображение». */
export interface CtxFile { name: string; text: string }
export const MAX_FILES = 12;
export const MAX_FILE = 200_000;
const looksText = (s: string) => !s.slice(0, 4000).includes('\u0000');
const fmt = (n: number) => (n < 1024 ? `${n} Б` : `${(n / 1024).toFixed(1)} КБ`);

export const readTextFiles = async (list: FileList | File[], current: CtxFile[]): Promise<{ files: CtxFile[]; errors: string[] }> => {
  const next = [...current]; const errors: string[] = [];
  for (const f of Array.from(list)) {
    if (next.length >= MAX_FILES) { errors.push(`${f.name}: не больше ${MAX_FILES} файлов`); continue; }
    if (f.size > MAX_FILE) { errors.push(`${f.name}: больше ${fmt(MAX_FILE)}`); continue; }
    let text = '';
    try { text = await f.text(); } catch { errors.push(`${f.name}: не удалось прочитать`); continue; }
    if (!looksText(text)) { errors.push(`${f.name}: это не текстовый файл`); continue; }
    if (next.some(x => x.name === f.name)) continue;
    next.push({ name: f.name, text });
  }
  return { files: next, errors };
};

export const filesPrompt = (userText: string, files: CtxFile[]) => {
  const blocks = files.map(f => `Файл ${f.name}:\n\`\`\`\n${f.text}\n\`\`\``).join('\n\n');
  return blocks ? `${userText}\n\n${blocks}` : userText;
};
