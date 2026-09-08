/**
 * Показ документов, написанных в markdown.
 *
 * Своя разметка, а не библиотека, по двум причинам. Первая: документы
 * пишем мы сами и знаем, что в них встречается — заголовки, списки,
 * жирный текст, разделители. Вторая важнее: разметка собирается в
 * элементы React, а не подставляется как HTML. Через dangerouslySetInnerHTML
 * документ, который однажды придёт со стороны, стал бы дырой.
 */
import type { ReactNode } from 'react';

/** `**жирный**` и `` `моноширинный` `` внутри строки. */
const inline = (text: string, keyPrefix: string): ReactNode[] => {
  const out: ReactNode[] = [];
  const re = /\*\*(.+?)\*\*|`(.+?)`/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1] !== undefined) {
      out.push(<b key={`${keyPrefix}-b${i}`} style={{ color: 'var(--t1)' }}>{m[1]}</b>);
    } else {
      out.push(
        <code key={`${keyPrefix}-c${i}`} className="rounded px-1 py-0.5 text-[0.92em]"
          style={{ background: 'var(--bg-l3)', color: 'var(--t2)' }}>{m[2]}</code>,
      );
    }
    last = m.index + m[0].length;
    i += 1;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
};

const H = {
  1: 'text-lg font-bold',
  2: 'text-base font-bold',
  3: 'text-sm font-bold',
} as const;

export const Markdown = ({ text }: { text: string }) => {
  const lines = text.split('\n');
  const blocks: ReactNode[] = [];

  // Список копится до первой строки другого вида: иначе каждый пункт
  // стал бы отдельным списком и отступы поехали бы.
  let bullets: string[] = [];
  let numbers: string[] = [];
  let code: string[] | null = null;
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    const key = `p${blocks.length}`;
    blocks.push(
      <p key={key} className="text-[13px] leading-relaxed" style={{ color: 'var(--t2)' }}>
        {inline(paragraph.join(' '), key)}
      </p>,
    );
    paragraph = [];
  };
  const flushBullets = () => {
    if (!bullets.length) return;
    const key = `ul${blocks.length}`;
    blocks.push(
      <ul key={key} className="space-y-1 pl-1">
        {bullets.map((b, i) => (
          <li key={i} className="flex gap-2 text-[13px] leading-relaxed" style={{ color: 'var(--t2)' }}>
            <span style={{ color: 'var(--accent)' }}>•</span>
            <span className="flex-1">{inline(b, `${key}-${i}`)}</span>
          </li>
        ))}
      </ul>,
    );
    bullets = [];
  };
  const flushNumbers = () => {
    if (!numbers.length) return;
    const key = `ol${blocks.length}`;
    blocks.push(
      <ol key={key} className="space-y-1 pl-1">
        {numbers.map((b, i) => (
          <li key={i} className="flex gap-2 text-[13px] leading-relaxed" style={{ color: 'var(--t2)' }}>
            <span className="tabular-nums" style={{ color: 'var(--accent)' }}>{i + 1}.</span>
            <span className="flex-1">{inline(b, `${key}-${i}`)}</span>
          </li>
        ))}
      </ol>,
    );
    numbers = [];
  };
  const flushAll = () => { flushParagraph(); flushBullets(); flushNumbers(); };

  for (const raw of lines) {
    const line = raw.trimEnd();

    // Блок кода идёт как есть, до закрывающей тройной кавычки.
    if (line.trimStart().startsWith('```')) {
      if (code === null) { flushAll(); code = []; }
      else {
        blocks.push(
          <pre key={`pre${blocks.length}`} className="overflow-x-auto rounded-xl px-3 py-2.5 text-[11px] leading-relaxed"
            style={{ background: 'var(--bg-l2)', color: 'var(--t2)', border: '1px solid var(--border)' }}>
            {code.join('\n')}
          </pre>,
        );
        code = null;
      }
      continue;
    }
    if (code !== null) { code.push(raw); continue; }

    if (!line.trim()) { flushAll(); continue; }

    if (/^---+$/.test(line.trim())) {
      flushAll();
      blocks.push(<div key={`hr${blocks.length}`} className="h-px my-1" style={{ background: 'var(--border)' }} />);
      continue;
    }

    const head = /^(#{1,3})\s+(.*)$/.exec(line);
    if (head) {
      flushAll();
      const level = head[1].length as 1 | 2 | 3;
      const key = `h${blocks.length}`;
      blocks.push(
        <p key={key} className={`${H[level]} ${level === 1 ? 'mt-1' : 'mt-3'}`} style={{ color: 'var(--t1)' }}>
          {inline(head[2], key)}
        </p>,
      );
      continue;
    }

    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    if (bullet) { flushParagraph(); flushNumbers(); bullets.push(bullet[1]); continue; }

    const number = /^\s*\d+\.\s+(.*)$/.exec(line);
    if (number) { flushParagraph(); flushBullets(); numbers.push(number[1]); continue; }

    flushBullets(); flushNumbers();
    paragraph.push(line.trim());
  }
  flushAll();
  if (code?.length) {
    blocks.push(
      <pre key="pre-tail" className="overflow-x-auto rounded-xl px-3 py-2.5 text-[11px]"
        style={{ background: 'var(--bg-l2)', color: 'var(--t2)' }}>{code.join('\n')}</pre>,
    );
  }

  return <div className="space-y-2">{blocks}</div>;
};
