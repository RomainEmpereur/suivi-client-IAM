/**
 * Rendu markdown minimal et sûr pour les livrables (titres, gras, italique, listes, tableaux, citations, liens https,
 * blocs de code ; un bloc ```html s'affiche en aperçu isolé).
 * Tout le texte est échappé AVANT la mise en forme : aucun HTML du contenu n'est interprété.
 */
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function inline(raw: string): string {
  let s = esc(raw);
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
  s = s.replace(/!\[([^\]]*)\]\((https:\/\/[^\s)]+)\)/g, '<img src="$2" alt="$1" loading="lazy" />');
  s = s.replace(/\[([^\]]+)\]\((https:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  return s;
}

/** Lecteurs vidéo autorisés (liste fermée) : l'adresse publique est convertie en adresse d'intégration. */
export function videoEmbedUrl(url: string): string | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  if (u.protocol !== 'https:') return null;
  const host = u.hostname.replace(/^www\./, '');
  const seg = u.pathname.split('/').filter(Boolean);
  const safe = (x: string | undefined) => (x && /^[\w-]+$/.test(x) ? x : null);
  if (host === 'tella.tv' && seg[0] === 'video' && safe(seg[1])) return `https://www.tella.tv/video/${seg[1]}/embed`;
  if (host === 'loom.com' && (seg[0] === 'share' || seg[0] === 'embed') && safe(seg[1])) return `https://www.loom.com/embed/${seg[1]}`;
  if (host === 'youtube.com' && seg[0] === 'watch' && safe(u.searchParams.get('v') ?? undefined)) return `https://www.youtube-nocookie.com/embed/${u.searchParams.get('v')}`;
  if (host === 'youtu.be' && safe(seg[0])) return `https://www.youtube-nocookie.com/embed/${seg[0]}`;
  if (host === 'vimeo.com' && /^\d+$/.test(seg[0] ?? '')) return `https://player.vimeo.com/video/${seg[0]}`;
  return null;
}

/**
 * Aperçu d'une page HTML livrée (landing, visuels de la VSL) : iframe isolée (sandbox sans allow-same-origin :
 * origine opaque, aucun accès à l'espace, à ses cookies ni à son API), code source dépliable en dessous.
 * « video » = lecteur 16:9 ; sinon page à faire défiler.
 */
function htmlPreview(src: string, kind: 'video' | 'page'): string {
  const label = kind === 'video' ? 'Aperçu des visuels (lecteur 16:9)' : 'Aperçu de la page';
  return `<figure class="html-preview ${kind}"><figcaption>${label}</figcaption>`
    + `<iframe sandbox="allow-scripts" referrerpolicy="no-referrer" loading="lazy" title="${label}" srcdoc="${esc(src)}"></iframe>`
    + `<details><summary>Code HTML (${src.length.toLocaleString('fr-FR')} caractères)</summary><pre class="md-code"><code>${esc(src)}</code></pre></details></figure>`;
}

const cells = (line: string) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());

export function renderMarkdown(md: string): string {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) { const n = Math.min(h[1].length + 1, 6); out.push(`<h${n}>${inline(h[2])}</h${n}>`); i++; continue; }
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { out.push('<hr />'); i++; continue; }
    const fence = line.match(/^\s*```\s*([\w-]*)\s*([\w-]*)\s*$/);
    if (fence) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) { code.push(lines[i]); i++; }
      i++; // fermeture
      const src = code.join('\n');
      if (fence[1].toLowerCase() === 'html') out.push(htmlPreview(src, fence[2].toLowerCase() === 'video' ? 'video' : 'page'));
      else out.push(`<pre class="md-code"><code>${esc(src)}</code></pre>`);
      continue;
    }
    const vid = line.trim().match(/^@\[([^\]]*)\]\((https:\/\/[^\s)]+)\)$/);
    if (vid) {
      const src = videoEmbedUrl(vid[2]);
      out.push(src
        ? `<div class="video"><iframe src="${esc(src)}" title="${esc(vid[1] || 'Vidéo')}" loading="lazy" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe></div>`
        : `<p><a href="${esc(vid[2])}" target="_blank" rel="noopener noreferrer">${esc(vid[1] || vid[2])}</a></p>`);
      i++; continue;
    }
    if (line.trim().startsWith('|') && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      const head = cells(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) { rows.push(cells(lines[i])); i++; }
      out.push(`<div class="md-table"><table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${
        rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }
    if (/^\s*>/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) { buf.push(lines[i].replace(/^\s*>\s?/, '')); i++; }
      out.push(`<blockquote>${buf.map(inline).join('<br />')}</blockquote>`);
      continue;
    }
    const ul = /^\s*[-*•]\s+/;
    const ol = /^\s*\d+[.)]\s+/;
    if (ul.test(line) || ol.test(line)) {
      const re = ul.test(line) ? ul : ol;
      const tag = re === ul ? 'ul' : 'ol';
      const items: string[] = [];
      while (i < lines.length && re.test(lines[i])) { items.push(`<li>${inline(lines[i].replace(re, ''))}</li>`); i++; }
      out.push(`<${tag}>${items.join('')}</${tag}>`);
      continue;
    }
    const buf: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,6})\s/.test(lines[i]) && !/^\s*```/.test(lines[i]) && !/^\s*([-*•]|\d+[.)])\s+/.test(lines[i])
      && !lines[i].trim().startsWith('|') && !/^\s*>/.test(lines[i]) && !/^\s*(-{3,}|\*{3,})\s*$/.test(lines[i])) {
      buf.push(lines[i]); i++;
    }
    out.push(`<p>${buf.map(inline).join('<br />')}</p>`);
  }
  return out.join('\n');
}
