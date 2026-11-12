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

describe('Vidéos intégrées', () => {
  it('intègre Tella, Loom, YouTube, Vimeo ; tout autre hôte reste un simple lien', async () => {
    const { renderMarkdown, videoEmbedUrl } = await import('../web/src/markdown.ts');
    expect(videoEmbedUrl('https://www.tella.tv/video/training-setup-des-parametres-ghl-653p')).toBe('https://www.tella.tv/video/training-setup-des-parametres-ghl-653p/embed');
    expect(videoEmbedUrl('https://www.loom.com/share/abc123')).toBe('https://www.loom.com/embed/abc123');
    expect(videoEmbedUrl('https://youtu.be/xyz_1')).toBe('https://www.youtube-nocookie.com/embed/xyz_1');
    expect(videoEmbedUrl('https://evil.example/video/x')).toBeNull();
    expect(videoEmbedUrl('http://www.tella.tv/video/x')).toBeNull();
    expect(renderMarkdown('@[Paramètres](https://www.tella.tv/video/abc)')).toContain('<iframe src="https://www.tella.tv/video/abc/embed"');
    const other = renderMarkdown('@[x](https://evil.example/v)');
    expect(other).not.toContain('<iframe');
    expect(other).toContain('href="https://evil.example/v"');
  });
});

describe('Blocs de code et aperçu HTML', async () => {
  const { renderMarkdown } = await import('../web/src/markdown.ts');
  it('un bloc ```html devient un aperçu isolé (sandbox sans same-origin), le code reste échappé', () => {
    const html = renderMarkdown('Avant\n```html video\n<script>alert(1)</script><h1 class="x">Titre</h1>\n```\nAprès');
    expect(html).toContain('<figure class="html-preview video">');
    expect(html).toContain('sandbox="allow-scripts"');
    expect(html).not.toContain('allow-same-origin');
    expect(html).not.toContain('<script>');
    expect(html).toContain('srcdoc="&lt;script&gt;alert(1)&lt;/script&gt;&lt;h1 class=&quot;x&quot;&gt;Titre&lt;/h1&gt;"');
    expect(html).toContain('<p>Après</p>');
  });
  it('un bloc ```html sans mot-clé est une page ; un autre langage reste du code', () => {
    expect(renderMarkdown('```html\n<p>x</p>\n```')).toContain('html-preview page');
    const js = renderMarkdown('```js\nconst a = "<b>";\n```');
    expect(js).toContain('<pre class="md-code"><code>const a = &quot;&lt;b&gt;&quot;;</code></pre>');
  });
});
