import { convertFileSrc } from "@tauri-apps/api/core";

import type { Music } from "../../types";

interface MusicInfoProps {
  nowPlayingMusic: Music | null;
}

function splitArtistTitle(text: string): { artist: string | null; track: string } {
  const idx = text.indexOf(" - ");
  if (idx === -1) return { artist: null, track: text };
  const artist = text.slice(0, idx).trim();
  const track = text.slice(idx + 3).trim();
  return { artist: artist || null, track: track || text };
}

function resolveCoverSrc(cover: string | undefined): string | undefined {
  if (!cover?.trim()) return undefined;
  const c = cover.trim();
  if (/^https?:\/\//i.test(c) || c.startsWith("data:") || c.startsWith("blob:")) return c;
  return convertFileSrc(c);
}

export function MusicInfo({ nowPlayingMusic }: MusicInfoProps) {
  return (
    <div className="flex h-[50px] shrink-0 items-center gap-2 border-b border-white/10 px-2">
      {nowPlayingMusic ? (
        <>
          <div className="relative h-[42px] w-[42px] shrink-0 overflow-hidden rounded bg-white/5">
            {(() => {
              const coverSrc = resolveCoverSrc(nowPlayingMusic.cover);
              return coverSrc ? (
                <img src={coverSrc} alt="" className="h-full w-full object-cover" />
              ) : null;
            })()}
          </div>
          <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5 leading-tight">
            {(() => {
              const rawTitle = nowPlayingMusic.text || `Mídia: ${nowPlayingMusic.type ?? ""}`;
              const { artist, track } = splitArtistTitle(rawTitle);
              return (
                <>
                  <span
                    className={[
                      "truncate text-[0.72rem] font-bold",
                      artist ? "text-white" : "text-slate-500",
                    ].join(" ")}
                    title={artist || undefined}
                  >
                    {artist || null}
                  </span>
                  <span className="truncate text-[0.78rem] font-semibold text-white/90" title={track}>
                    {track}
                  </span>
                </>
              );
            })()}
          </div>
        </>
      ) : (
        <div className="flex w-full items-center justify-center text-[0.72rem] text-slate-500">
          Nenhuma faixa em reprodução
        </div>
      )}
    </div>
  );
}
