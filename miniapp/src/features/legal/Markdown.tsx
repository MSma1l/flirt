/**
 * Un randator MINIM și SIGUR pentru textele legale servite de backend.
 *
 * Subsetul acceptat (exact cel în care sunt scrise documentele):
 *   `# `, `## `, `### ` titluri; paragrafe separate de rânduri goale (rândurile
 *   consecutive se unesc cu spațiu); liste `- ` pe un singur nivel; `**bold**`;
 *   legături `[text](https://…)` sau `[text](mailto:…)`.
 *
 * DE CE NU O BIBLIOTECĂ ȘI NU `dangerouslySetInnerHTML`: textul vine de pe server
 * și se poate schimba fără un build nou. Construim direct elemente React, deci
 * orice HTML din text rămâne text. Legăturile acceptă DOAR `http(s):` și
 * `mailto:` — un `javascript:` devine text simplu.
 *
 * Marcajele „de completat" (`[de completat]` etc., puse de backend când un câmp
 * din configurare lipsește) sunt evidențiate discret, ca să sară în ochi.
 */
import type { MouseEvent, ReactNode } from 'react';

import { getWebApp } from '@/telegram/bridge';

export type Inline =
  | { type: 'text'; text: string }
  | { type: 'bold'; children: Inline[] }
  | { type: 'link'; href: string; children: Inline[] }
  | { type: 'todo'; text: string };

export type Block =
  | { type: 'heading'; level: 1 | 2 | 3; children: Inline[] }
  | { type: 'paragraph'; children: Inline[] }
  | { type: 'list'; items: Inline[][] };

/** Doar adrese web criptate/obișnuite și e-mail. Restul (javascript:, data:…) e refuzat. */
export function isSafeHref(href: string): boolean {
  return /^(https?:\/\/|mailto:)/i.test(href.trim());
}

const LINK_RE = /\[([^\]\n]+)\]\(([^)\s]+)\)/;
const BOLD_RE = /\*\*([^*]+)\*\*/;
const TODO_RE = /\[[^\]\n]{2,60}\](?!\()/;

/** Textul simplu, cu marcajele „[de completat]" scoase în evidență. */
function parseTodo(text: string): Inline[] {
  const out: Inline[] = [];
  let rest = text;
  while (rest) {
    const m = TODO_RE.exec(rest);
    if (!m) {
      out.push({ type: 'text', text: rest });
      break;
    }
    if (m.index > 0) out.push({ type: 'text', text: rest.slice(0, m.index) });
    out.push({ type: 'todo', text: m[0] });
    rest = rest.slice(m.index + m[0].length);
  }
  return out;
}

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let rest = text;
  while (rest) {
    const link = LINK_RE.exec(rest);
    const bold = BOLD_RE.exec(rest);
    const next =
      link && (!bold || link.index <= bold.index)
        ? { kind: 'link' as const, m: link }
        : bold
          ? { kind: 'bold' as const, m: bold }
          : null;
    if (!next) {
      out.push(...parseTodo(rest));
      break;
    }
    const { m } = next;
    if (m.index > 0) out.push(...parseTodo(rest.slice(0, m.index)));
    if (next.kind === 'bold') {
      out.push({ type: 'bold', children: parseInline(m[1] ?? '') });
    } else {
      const label = m[1] ?? '';
      const href = (m[2] ?? '').trim();
      if (isSafeHref(href)) {
        out.push({ type: 'link', href, children: parseInline(label) });
      } else {
        // Legătură nesigură: păstrăm doar eticheta, ca text.
        out.push({ type: 'text', text: label });
      }
    }
    rest = rest.slice(m.index + m[0].length);
  }
  return out;
}

export function parseMarkdown(source: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let list: string[] | null = null;

  const flushParagraph = () => {
    if (paragraph.length) {
      blocks.push({ type: 'paragraph', children: parseInline(paragraph.join(' ')) });
      paragraph = [];
    }
  };
  const flushList = () => {
    if (list && list.length) {
      blocks.push({ type: 'list', items: list.map((item) => parseInline(item)) });
    }
    list = null;
  };

  for (const raw of source.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim();
    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      flushParagraph();
      flushList();
      const level = (heading[1] ?? '#').length as 1 | 2 | 3;
      blocks.push({ type: 'heading', level, children: parseInline(heading[2] ?? '') });
      continue;
    }
    const bullet = /^[-*]\s+(.*)$/.exec(line);
    if (bullet) {
      flushParagraph();
      if (!list) list = [];
      list.push(bullet[1] ?? '');
      continue;
    }
    if (list) {
      // Continuarea unui element de listă pe rândul următor.
      const current = list as string[];
      current[current.length - 1] = `${current[current.length - 1] ?? ''} ${line}`;
      continue;
    }
    paragraph.push(line);
  }
  flushParagraph();
  flushList();
  return blocks;
}

/** Deschide o adresă web prin Telegram (în afara Mini App-ului), dacă se poate. */
function onLinkClick(event: MouseEvent<HTMLAnchorElement>, href: string) {
  if (!/^https?:/i.test(href)) return; // `mailto:` îl lasă pe seama sistemului
  const app = getWebApp();
  if (app && typeof app.openLink === 'function') {
    try {
      app.openLink(href);
      event.preventDefault();
    } catch {
      /* lăsăm legătura obișnuită să funcționeze */
    }
  }
}

function renderInline(nodes: Inline[], keyPrefix: string): ReactNode[] {
  return nodes.map((node, i) => {
    const key = `${keyPrefix}-${i}`;
    switch (node.type) {
      case 'text':
        return node.text;
      case 'todo':
        return (
          <mark key={key} className="legal-todo">
            {node.text}
          </mark>
        );
      case 'bold':
        return <strong key={key}>{renderInline(node.children, key)}</strong>;
      case 'link':
        return (
          <a
            key={key}
            href={node.href}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => onLinkClick(e, node.href)}
          >
            {renderInline(node.children, key)}
          </a>
        );
      default:
        return null;
    }
  });
}

export function Markdown({ source, className }: { source: string; className?: string }) {
  const blocks = parseMarkdown(source);
  return (
    <div className={className ?? 'legal-markdown'}>
      {blocks.map((block, i) => {
        const key = `b${i}`;
        if (block.type === 'heading') {
          const children = renderInline(block.children, key);
          if (block.level === 1) return <h2 key={key} className="legal-markdown__h1">{children}</h2>;
          if (block.level === 2) return <h3 key={key} className="legal-markdown__h2">{children}</h3>;
          return <h4 key={key} className="legal-markdown__h3">{children}</h4>;
        }
        if (block.type === 'list') {
          return (
            <ul key={key} className="legal-markdown__list">
              {block.items.map((item, j) => (
                <li key={`${key}-${j}`}>{renderInline(item, `${key}-${j}`)}</li>
              ))}
            </ul>
          );
        }
        return (
          <p key={key} className="legal-markdown__p">
            {renderInline(block.children, key)}
          </p>
        );
      })}
    </div>
  );
}

export default Markdown;
