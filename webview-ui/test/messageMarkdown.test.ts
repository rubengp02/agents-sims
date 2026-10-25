import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { MessageMarkdown } from '../src/components/MessageMarkdown.js';

const render = (text: string) =>
  renderToStaticMarkup(createElement(MessageMarkdown, { children: text }));

describe('conversation Markdown', () => {
  it('renders emphasis, lists and tables while preserving literal code', () => {
    const html = render(
      '**Propósito** y *funcionalidades*.\n\n- Una función\n\n`**literal**`\n\n```txt\n*código*\n```\n\n| Capa | Función |\n| --- | --- |\n| core | Contratos |',
    );
    expect(html).toContain('<strong>Propósito</strong>');
    expect(html).toContain('<em>funcionalidades</em>');
    expect(html).toContain('<li>Una función</li>');
    expect(html).toContain('<code>**literal**</code>');
    expect(html).toContain('*código*');
    expect(html).not.toContain('<em>código</em>');
    expect(html).toContain('<table>');
  });
  it('does not execute raw HTML, unsafe links or load model-supplied images', () => {
    const html = render(
      '<script>alert(1)</script>\n\n[enlace](javascript:alert%281%29)\n\n![Imagen](https://example.invalid/tracker.png)',
    );
    expect(html).not.toContain('<script');
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('<img');
    expect(html).toContain('Imagen');
  });
});
