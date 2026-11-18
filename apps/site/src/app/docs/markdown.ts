import { Marked, type Tokens } from 'marked';
import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import json from 'highlight.js/lib/languages/json';
import plaintext from 'highlight.js/lib/languages/plaintext';
import typescript from 'highlight.js/lib/languages/typescript';
import yaml from 'highlight.js/lib/languages/yaml';
import { REPO_BLOB } from '../site';

hljs.registerLanguage('bash', bash);
hljs.registerLanguage('json', json);
hljs.registerLanguage('text', plaintext);
hljs.registerLanguage('ts', typescript);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('yaml', yaml);

export interface TocEntry {
  id: string;
  text: string;
}

export interface RenderedDoc {
  html: string;
  title: string;
  toc: TocEntry[];
}

/** GitHub-compatible heading slug, so `#anchor` links work both on GitHub and on the site. */
export const slugify = (text: string) =>
  text
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s/g, '-');

const escapeHtml = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/**
 * Link rules: `jira.md#x` → site route `docs/jira#x`; other relative repo paths → GitHub;
 * absolute URLs open in a new tab; `#anchors` stay in-page.
 */
function rewriteHref(href: string): { href: string; external: boolean } {
  if (/^https?:\/\//.test(href)) return { href, external: true };
  if (href.startsWith('#')) return { href, external: false };
  const guide = href.match(/^(?:\.\/)?([\w-]+)\.md(#.*)?$/);
  if (guide) return { href: `docs/${guide[1]}${guide[2] ?? ''}`, external: false };
  const path = href.replace(/^(\.\.\/)+/, '');
  return {
    href: `${REPO_BLOB}/${href.startsWith('../') ? path : `docs/guide/${path}`}`,
    external: true,
  };
}

export function renderMarkdown(source: string): RenderedDoc {
  const marked = new Marked({ gfm: true });
  marked.use({
    renderer: {
      heading(token: Tokens.Heading) {
        const inner = this.parser.parseInline(token.tokens);
        if (token.depth === 1) return `<h1>${inner}</h1>`;
        const id = slugify(token.text);
        return `<h${token.depth} id="${id}"><a class="anchor" href="#${id}" aria-hidden="true">#</a>${inner}</h${token.depth}>`;
      },
      code(token: Tokens.Code) {
        const lang = (token.lang ?? '').trim().split(/\s/)[0];
        const known = !!lang && !!hljs.getLanguage(lang);
        const body = known
          ? hljs.highlight(token.text, { language: lang }).value
          : escapeHtml(token.text);
        const label =
          lang && lang !== 'text' ? `<span class="code-lang">${escapeHtml(lang)}</span>` : '';
        return `<div class="code-block not-prose">${label}<pre><code class="hljs">${body}</code></pre></div>`;
      },
      link(token: Tokens.Link) {
        const { href, external } = rewriteHref(token.href);
        const inner = this.parser.parseInline(token.tokens);
        const target = external ? ' target="_blank" rel="noopener"' : '';
        return `<a href="${escapeHtml(href)}"${target}>${inner}</a>`;
      },
    },
  });

  const tokens = marked.lexer(source);
  const headings = tokens.filter((t): t is Tokens.Heading => t.type === 'heading');
  const title = headings.find((h) => h.depth === 1)?.text ?? 'Cadence docs';
  const toc = headings
    .filter((h) => h.depth === 2)
    .map((h) => ({ id: slugify(h.text), text: h.text.replace(/[*`_]/g, '') }));
  return { html: marked.parser(tokens), title, toc };
}
