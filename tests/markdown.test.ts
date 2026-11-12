import { describe, expect, it } from 'vitest';
import { renderMarkdown } from '../web/src/markdown.ts';

describe('Rendu des livrables', () => {
  it('met en forme titres, listes, tableaux et liens https', () => {
    const html = renderMarkdown('# Titre\n\nUn **mot** et *un autre*.\n\n- a\n- b\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n[site](https://x.fr)');
    expect(html).toContain('<h2>Titre</h2>');
    expect(html).toContain('<strong>mot</strong>');
    expect(html).toContain('<em>un autre</em>');
    expect(html).toContain('<ul><li>a</li><li>b</li></ul>');
    expect(html).toContain('<th>A</th>');
    expect(html).toContain('<td>2</td>');
    expect(html).toContain('href="https://x.fr"');
  });
  it("n'interprète aucun HTML ni lien dangereux du contenu", () => {
    const html = renderMarkdown('<img src=x onerror=alert(1)> [x](javascript:alert(1)) <script>alert(1)</script>');
    expect(html).not.toMatch(/<img|<script|href="javascript/);
    expect(html).toContain('&lt;script&gt;');
  });
});
