import { useCallback, useMemo } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Square, X } from "lucide-react";
import iconUrl from "../assets/icon.png";

/** Pixels²: só inicia arrasto nativo após mover o mouse — evita sabotar duplo-clique maximizar no Windows */
const MOVE_THRESH_SQ = 5 * 5;

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function TitleBar() {
  const tauri = isTauriRuntime();
  const appWindow = useMemo(
    () => (tauri ? getCurrentWindow() : null),
    [tauri]
  );

  const onDragRegionMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!appWindow || e.button !== 0) return;

      let started = false;
      const startX = e.clientX;
      const startY = e.clientY;

      const cleanup = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };

      const onMove = (ev: MouseEvent) => {
        if (started) return;
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        if (dx * dx + dy * dy < MOVE_THRESH_SQ) return;
        started = true;
        cleanup();
        void appWindow.startDragging();
      };

      const onUp = () => {
        cleanup();
      };

      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [appWindow]
  );

  const onDragRegionDoubleClick = useCallback(
    (ev: React.MouseEvent) => {
      if (!appWindow) return;
      ev.preventDefault();
      void appWindow.toggleMaximize();
    },
    [appWindow]
  );

  return (
    <header className="relative z-50 flex h-7 w-full shrink-0 select-none items-stretch border-b border-[#353535] bg-[#1e1e1e]">
      <div
        className="relative z-0 min-h-0 min-w-0 flex-1 cursor-default"
        onMouseDown={tauri ? onDragRegionMouseDown : undefined}
        onDoubleClick={tauri ? onDragRegionDoubleClick : undefined}
      />

      <div className="pointer-events-none absolute top-1/2 left-1/2 z-1 flex -translate-x-1/2 -translate-y-1/2 items-center gap-1">
        <img
          src={iconUrl}
          alt=""
          className="pointer-events-none h-5 w-5 shrink-0 object-contain"
          draggable={false}
        />
        <span className="text-[#e8e8e8] text-[10px] font-bold">
          SyncPlay
        </span>
      </div>

      {tauri && appWindow && (
        <div className="relative z-2 flex h-full shrink-0">
          <button
            type="button"
            className="flex h-full w-11 items-center justify-center text-neutral-300 hover:bg-white/10"
            title="Minimizar"
            onClick={() => void appWindow.minimize()}
          >
            <Minus className="h-4 w-4" strokeWidth={2.25} />
          </button>
          <button
            type="button"
            className="flex h-full w-11 items-center justify-center text-neutral-300 hover:bg-white/10"
            onClick={() => void appWindow.toggleMaximize()}
          >
            <Square className="h-3.5 w-3.5" strokeWidth={2.25} />
          </button>
          <button
            type="button"
            className="flex h-full w-11 items-center justify-center text-neutral-300 hover:bg-[#c42b1c]"
            title="Fechar"
            onClick={() => void appWindow.close()}
          >
            <X className="h-4 w-4" strokeWidth={2.25} />
          </button>
        </div>
      )}
    </header>
  );
}
