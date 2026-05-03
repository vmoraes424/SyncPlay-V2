interface PlaylistLoadMoreControlsProps {
  hasMoreTail: boolean;
  isLoading?: boolean;
  onLoadNext: () => void;
  onLoadAll: () => void;
}

export function PlaylistLoadMoreControls({
  hasMoreTail,
  isLoading = false,
  onLoadNext,
  onLoadAll,
}: PlaylistLoadMoreControlsProps) {
  return (
    <div className="flex flex-wrap gap-2 px-3 py-3 border-t border-[#353535] mt-1">
      <button
        type="button"
        className="flex-1 min-w-[140px] rounded-lg border border-[#353535] bg-white/5 px-3 py-2 text-[0.8rem] text-white/90 hover:bg-white/10 transition-colors disabled:cursor-wait disabled:opacity-60 disabled:hover:bg-white/5"
        onClick={onLoadNext}
        disabled={isLoading}
      >
        {isLoading ? "Carregando..." : hasMoreTail ? "Carregar o próximo bloco" : "Carregar o próximo dia"}
      </button>
      <button
        type="button"
        className="flex-1 min-w-[140px] rounded-lg border border-emerald-500/35 bg-emerald-600/15 px-3 py-2 text-[0.8rem] text-emerald-100 hover:bg-emerald-600/25 transition-colors disabled:cursor-wait disabled:opacity-60 disabled:hover:bg-emerald-600/15"
        onClick={onLoadAll}
        disabled={isLoading}
      >
        {isLoading ? "Carregando..." : hasMoreTail ? "Carregar todos" : "Carregar o próximo dia inteiro"}
      </button>
    </div>
  );
}
