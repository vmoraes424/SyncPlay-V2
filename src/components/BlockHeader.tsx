interface BlockHeaderProps {
  blockType: string;
  startLabel?: string;
}

const BLOCK_TYPE_LABEL: Record<string, string> = {
  musical: 'MUSICAL',
  commercial: 'COMERCIAL',
};

export function BlockHeader({ blockType, startLabel }: BlockHeaderProps) {
  const isMusical = blockType === 'musical';
  const accent = isMusical ? '#f5a834' : '#258ad0';

  return (
    <header className="playlist-block-header">
      <h3
        className="playlist-block-heading shrink-0 text-[0.78rem] font-semibold uppercase tracking-[0.14em]"
        style={{ color: accent }}
      >
        Bloco {BLOCK_TYPE_LABEL[blockType]}
      </h3>
      {startLabel && (
        <span className="playlist-block-start-time" title="Horário previsto do bloco">
          {startLabel}
        </span>
      )}
    </header>
  );
}
