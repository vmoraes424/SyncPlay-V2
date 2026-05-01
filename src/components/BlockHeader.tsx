interface BlockHeaderProps {
  blockKey: string;
  blockType: string;
  startLabel?: string;
}

export function BlockHeader({ blockKey, blockType, startLabel }: BlockHeaderProps) {
  const isMusical = blockType === 'musical';
  const accent = isMusical ? '#f5a834' : '#258ad0';

  return (
    <header className="playlist-block-header">
      <h3
        className="playlist-block-heading shrink-0 text-[0.78rem] font-semibold uppercase tracking-[0.14em]"
        style={{ color: accent }}
      >
        Bloco {blockKey}
      </h3>
      <span
        className={`text-[0.62rem] uppercase tracking-[0.08em] px-2 py-0.5 rounded-full font-bold shrink-0 block-type type-${blockType}`}
      >
        {blockType}
      </span>
      {startLabel && (
        <span className="playlist-block-start-time" title="Horário previsto do bloco">
          {startLabel}
        </span>
      )}
    </header>
  );
}
