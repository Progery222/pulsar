import { RU_DICT } from "./ru-dict";

// Рантайм-локализация вендоренной Студии: обходим текстовые узлы и атрибуты
// (title/placeholder/aria-label) и заменяем известные английские строки на
// русские из словаря. MutationObserver подхватывает динамический контент.
// Замена по nodeValue не создаёт цикла: русское значение в словаре не является
// ключом, поэтому повторный проход ничего не меняет.

const dict = new Map<string, string>();
const dictLower = new Map<string, string>();
for (const [k, v] of Object.entries(RU_DICT)) {
  dict.set(k, v);
  dictLower.set(k.toLowerCase(), v);
}

const ATTRS = ["placeholder", "title", "aria-label"];
const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "TEXTAREA", "CODE", "PRE"]);

function lookup(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  const hit = dict.get(t) ?? dictLower.get(t.toLowerCase());
  if (hit === undefined || hit === t) return null;
  return raw.replace(t, hit);
}

function translateTextNode(node: Text): void {
  const cur = node.nodeValue || "";
  const tr = lookup(cur);
  if (tr !== null && tr !== cur) node.nodeValue = tr;
}

function translateAttrs(el: Element): void {
  for (const attr of ATTRS) {
    const val = el.getAttribute(attr);
    if (!val) continue;
    const tr = lookup(val);
    if (tr !== null && tr !== val) el.setAttribute(attr, tr);
  }
}

function walk(node: Node): void {
  if (node.nodeType === Node.TEXT_NODE) {
    translateTextNode(node as Text);
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return;
  const el = node as Element;
  if (SKIP_TAGS.has(el.tagName)) return;
  translateAttrs(el);
  for (let c = node.firstChild; c; c = c.nextSibling) walk(c);
}

let started = false;

export function initRuTranslate(): void {
  if (started) return;
  started = true;

  const run = () => {
    if (!document.body) return;
    walk(document.body);

    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === "characterData") {
          if (m.target.nodeType === Node.TEXT_NODE) {
            translateTextNode(m.target as Text);
          }
        } else if (m.type === "attributes") {
          if (m.target.nodeType === Node.ELEMENT_NODE) {
            translateAttrs(m.target as Element);
          }
        } else if (m.type === "childList") {
          m.addedNodes.forEach((n) => walk(n));
        }
      }
    });

    observer.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ATTRS,
    });
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run, { once: true });
  } else {
    run();
  }
}
