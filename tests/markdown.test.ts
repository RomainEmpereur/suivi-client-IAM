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
