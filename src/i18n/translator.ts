/* ===============================================================
   SKY i18n — перевод страницы «на месте».

   Вместо правки сотен экранов один наблюдатель за DOM: каждый
   текстовый узел и видимые атрибуты (placeholder, title, aria-label,
   alt) с русским текстом заменяются по словарю. Работает сразу после
   коммита React и до отрисовки кадра, так что русский не мелькает.

   Что не переводится:
     · всё внутри [translate="no"] / .notranslate — пользовательский
       текст (сообщения, посты, имена): его язык не наш;
     · <script>, <style>, <textarea>, <code>, <pre>, поля ввода;
     · строки, которых нет в словаре (имена, названия, числа).

   React эти правки переживает: мы меняем nodeValue на месте и ничего
   не оборачиваем, как это делает браузерный переводчик.
=============================================================== */
import { Engine, CY } from './engine';

const ATTRS = ['placeholder', 'title', 'aria-label', 'alt', 'label'];
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'CODE', 'PRE', 'NOSCRIPT', 'TITLE', 'OPTION_VALUE']);
const NO_TR = '[translate="no"],.notranslate,[contenteditable="true"],[contenteditable=""]';

let engine: Engine | null = null;
let observer: MutationObserver | null = null;

/** Что мы сами записали в узел/атрибут — чтобы не реагировать на свои же правки. */
const wroteText = new WeakMap<Node, string>();
const wroteAttr = new WeakMap<Element, Record<string, string>>();

const skippedParent = (el: Element | null): boolean => {
  if (!el) return true;
  if (SKIP_TAGS.has(el.tagName)) return true;
  return el.closest(NO_TR) !== null;
};

const doText = (node: Text) => {
  const v = node.nodeValue;
  if (!v || !CY.test(v)) return;
  if (wroteText.get(node) === v) return;
  const parent = node.parentElement;
  if (skippedParent(parent)) return;
  const t = engine!.translate(v);
  if (t !== null && t !== v) { node.nodeValue = t; wroteText.set(node, t); }
};

const doAttrs = (el: Element, only?: string | null) => {
  if (el.closest(NO_TR)) return;
  const names = only ? [only] : ATTRS;
  for (const a of names) {
    const v = el.getAttribute(a);
    if (!v || !CY.test(v)) continue;
    if (wroteAttr.get(el)?.[a] === v) continue;
    const t = engine!.translate(v);
    if (t !== null && t !== v) {
      el.setAttribute(a, t);
      const rec = wroteAttr.get(el) ?? {};
      rec[a] = t;
      wroteAttr.set(el, rec);
    }
  }
  // кнопки-инпуты: подпись лежит в value
  if (!only && el instanceof HTMLInputElement && /^(button|submit|reset)$/.test(el.type)) {
    const v = el.value;
    if (v && CY.test(v)) { const t = engine!.translate(v); if (t) el.value = t; }
  }
};

const walk = (root: Node) => {
  if (root.nodeType === 3) { doText(root as Text); return; }
  if (root.nodeType !== 1) return;
  const el = root as Element;
  if (el.hasAttribute('translate') && el.getAttribute('translate') === 'no') return;
  doAttrs(el);
  // textarea, code и т.п.: содержимое не трогаем, но placeholder/aria-label — наши
  if (SKIP_TAGS.has(el.tagName)) return;
  const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
    acceptNode: (n) => {
      if (n.nodeType === 1) {
        const e = n as Element;
        if (e.getAttribute('translate') === 'no' || e.classList.contains('notranslate')) {
          return NodeFilter.FILTER_REJECT;
        }
        doAttrs(e);
        // содержимое <textarea>/<code>/<script> не трогаем, атрибуты — переведены выше
        return SKIP_TAGS.has(e.tagName) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  for (let n = tw.nextNode(); n; n = tw.nextNode()) doText(n as Text);
};

const onMutations = (records: MutationRecord[]) => {
  for (const r of records) {
    if (r.type === 'childList') r.addedNodes.forEach(walk);
    else if (r.type === 'characterData') { if (r.target.nodeType === 3) doText(r.target as Text); }
    else if (r.type === 'attributes') doAttrs(r.target as Element, r.attributeName);
  }
};

const translateTitle = () => {
  if (CY.test(document.title)) {
    const t = engine!.translate(document.title);
    if (t) document.title = t;
  }
};

export const translate = (text: string): string => engine?.translate(text) ?? text;

export const format = (ruTemplate: string, args: (string | number)[]): string =>
  engine ? engine.format(ruTemplate, args) : ruTemplate.replace(/\{(\d+)\}/g, (_, i) => String(args[Number(i)] ?? ''));

export const startTranslator = (dict: Record<string, string>) => {
  if (observer) return;
  engine = new Engine(dict);

  walk(document.body);
  translateTitle();

  observer = new MutationObserver(onMutations);
  observer.observe(document.body, {
    childList: true, subtree: true, characterData: true,
    attributes: true, attributeFilter: ATTRS,
  });
  const title = document.querySelector('title');
  if (title) new MutationObserver(translateTitle).observe(title, { childList: true, characterData: true, subtree: true });

  /* Диалоги браузера и текст на canvas — не DOM, патчим входы. */
  const w = window as unknown as Record<string, unknown>;
  for (const name of ['alert', 'confirm', 'prompt'] as const) {
    const orig = (window[name] as (...a: unknown[]) => unknown).bind(window);
    w[name] = (msg?: unknown, ...rest: unknown[]) => orig(typeof msg === 'string' ? translate(msg) : msg, ...rest);
  }
  const proto = CanvasRenderingContext2D.prototype;
  for (const name of ['fillText', 'strokeText'] as const) {
    const orig = proto[name];
    proto[name] = function patched(this: CanvasRenderingContext2D, text: string, ...rest: [number, number, number?]) {
      return orig.call(this, typeof text === 'string' && CY.test(text) ? translate(text) : text, ...rest);
    } as typeof proto.fillText;
  }
};
