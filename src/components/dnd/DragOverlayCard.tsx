import type { DragItemData } from '../../types/dnd';

export function DragOverlayCard({ item }: { item: DragItemData | null }) {
  if (!item) return null;

  const title =
    item.metadata?.title ??
    item.metadata?.path ??
    item.sourceId;

  const zoneLabel =
    item.sourceZone === 'ACERVO' ? 'Acervo' :
      item.sourceZone === 'COMANDOS' ? 'Comando' :
        item.sourceZone === 'PLAYLIST' ? 'Playlist' :
          'Botoneira';

  return (
    <div
      className="pointer-events-none flex max-w-[min(360px,calc(100vw-48px))] items-center gap-2 rounded-md border border-[#454545] bg-[#1a1a1a] px-3 py-2 shadow-xl ring-1 ring-black/40"
      style={{ cursor: 'grabbing' }}
    >
      <span className="shrink-0 rounded bg-white/10 px-1.5 py-0.5 text-[0.62rem] font-semibold uppercase tracking-wide text-slate-400">
        {zoneLabel}
      </span>
      <span className="min-w-0 flex-1 truncate text-[0.84rem] text-white/95">
        {String(title)}
      </span>
    </div>
  );
}
