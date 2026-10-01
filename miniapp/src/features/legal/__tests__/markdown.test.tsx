/**
 * Randatorul de markdown al documentelor legale: subsetul acceptat și, mai ales,
 * siguranța — niciun HTML injectat, nicio legătură `javascript:`.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { isSafeHref, Markdown, parseInline, parseMarkdown } from '../Markdown';

const SAMPLE = `# Politica de confidențialitate

Versiunea 1.0 · text
continuat pe rândul următor.

## 1. Cine suntem

- **Operator:** [de completat]
- Contact: [support@flrt.md](mailto:support@flrt.md)
- Autoritate: [datepersonale.md](https://www.datepersonale.md)

### Detalii

Un <script>alert(1)</script> rămâne text.`;

describe('parseMarkdown', () => {
  it('recunoaște titluri, paragrafe și liste', () => {
    const blocks = parseMarkdown(SAMPLE);
    expect(blocks.map((b) => b.type)).toEqual([
      'heading',
      'paragraph',
      'heading',
      'list',
      'heading',
      'paragraph',
    ]);
    const para = blocks[1];
    expect(para?.type === 'paragraph' && para.children[0]).toEqual({
      type: 'text',
      text: 'Versiunea 1.0 · text continuat pe rândul următor.',
    });
  });

  it('acceptă doar http(s) și mailto', () => {
    expect(isSafeHref('https://a.md')).toBe(true);
    expect(isSafeHref('mailto:a@b.c')).toBe(true);
    expect(isSafeHref('javascript:alert(1)')).toBe(false);
    expect(isSafeHref('data:text/html,x')).toBe(false);
  });

  it('o legătură javascript: devine text simplu', () => {
    expect(parseInline('[apasă](javascript:alert(1))')).toEqual([
      { type: 'text', text: 'apasă' },
      { type: 'text', text: ')' },
    ]);
  });
});

describe('<Markdown>', () => {
  it('randează structura, bold, legături și marcajele „de completat"', () => {
    const { container } = render(<Markdown source={SAMPLE} />);

    expect(screen.getByRole('heading', { name: 'Politica de confidențialitate' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '1. Cine suntem' })).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(screen.getByText('Operator:').tagName).toBe('STRONG');
    expect(screen.getByRole('link', { name: 'support@flrt.md' })).toHaveAttribute(
      'href',
      'mailto:support@flrt.md',
    );
    const ext = screen.getByRole('link', { name: 'datepersonale.md' });
    expect(ext).toHaveAttribute('href', 'https://www.datepersonale.md');
    expect(ext).toHaveAttribute('rel', 'noopener noreferrer');
    expect(container.querySelector('mark.legal-todo')?.textContent).toBe('[de completat]');
    // HTML-ul din text rămâne TEXT, nu element.
    expect(container.querySelector('script')).toBeNull();
    expect(screen.getByText(/<script>alert\(1\)<\/script>/)).toBeInTheDocument();
  });

  it('nu randează nicio legătură javascript:', () => {
    const { container } = render(<Markdown source="[x](javascript:alert(1))" />);
    expect(container.querySelector('a')).toBeNull();
  });
});
