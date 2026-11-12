import { useEffect, useState } from 'preact/hooks';
import { extractHtmlBlocks } from '../markdown.ts';
import { Segmented } from './ui.tsx';

const DEVICES = [
  { key: 'bureau', label: 'Ordinateur', width: '100%' },
  { key: 'tablette', label: 'Tablette', width: '820px' },
  { key: 'mobile', label: 'Mobile', width: '390px' },
] as const;

/**
 * Visualiseur plein écran des pages HTML d'un livrable (landing, visuels de la VSL).
 * Même isolation que l'aperçu en ligne : iframe sandbox sans allow-same-origin (origine opaque, aucun accès à l'espace).
 */
export function HtmlViewerButtons({ md, title }: { md: string; title: string }) {
  const blocks = extractHtmlBlocks(md);
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  if (!blocks.length) return null;
  return (
    <>
      {blocks.map((b, i) => (
        <button class="btn" onClick={() => setOpenIdx(i)}>
          {b.kind === 'video' ? 'Voir les visuels de la VSL' : blocks.filter((x) => x.kind === 'page').length > 1 ? `Voir la page ${i + 1}` : 'Voir la landing'}
        </button>
      ))}
      {openIdx !== null && <HtmlViewer block={blocks[openIdx]} title={title} onClose={() => setOpenIdx(null)} />}
    </>
  );
}

function HtmlViewer({ block, title, onClose }: { block: { kind: 'video' | 'page'; src: string }; title: string; onClose: () => void }) {
  const [device, setDevice] = useState<(typeof DEVICES)[number]['key']>('bureau');
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, []);
  const width = block.kind === 'video' ? 'min(100%, calc((100vh - 110px) * 16 / 9))' : DEVICES.find((d) => d.key === device)!.width;
  return (
    <div class="html-viewer" role="dialog" aria-modal="true" aria-label={`Aperçu : ${title}`}>
      <div class="html-viewer-bar">
        <strong class="small">{title}</strong>
        {block.kind === 'page' && (
          <Segmented label="Taille d'écran" value={device} onChange={setDevice} options={DEVICES.map((d) => ({ value: d.key, label: d.label }))} />
        )}
        <button class="ghost-btn" onClick={onClose} aria-label="Fermer l'aperçu">Fermer ✕</button>
      </div>
      <div class="html-viewer-stage">
        <iframe
          class={block.kind}
          style={{ width, maxWidth: '100%' }}
          sandbox="allow-scripts"
          referrerpolicy="no-referrer"
          title={`Aperçu : ${title}`}
          srcDoc={block.src}
        />
      </div>
    </div>
  );
}
