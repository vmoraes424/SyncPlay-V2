import type { CSSProperties, Dispatch, MutableRefObject, SetStateAction } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { BlockHeader } from '../BlockHeader';
import { PlaylistMusicItem, type PlaylistFilterClickPayload, type PlaylistFilterVisibility } from '../PlaylistMusicItem';
import { MusicInfo } from '../playlist/MusicInfo';
import { PlaylistCurrentBlock } from '../playlist/PlaylistCurrentBlock';
import { PlaylistLoadMoreControls } from '../playlist/PlaylistLoadMoreControls';
import { PlaylistPlaybackBar } from '../playlist/PlaylistPlaybackBar';
import type { Music, MediaCategory, PlayableItem, ScheduleMediaStartDto, SyncPlayData } from '../../types';
import type { LibMusicFiltersState } from '../../hooks/useSyncplayLibrary';
import {
  blockMediaRecord,
  clearBlockMedia,
  formatBrazilianPlaylistDate,
  getBlockDisplayStart,
  isoDateHintFromPlaylistKey,
  legacyBool,
  removeMusicFromBlock,
} from '../../playlist/playlistBlockHelpers';

export type PlaylistVisibleGroup = {
  plKey: string;
  pl: SyncPlayData['playlists'][string];
  blocks: Array<[string, SyncPlayData['playlists'][string]['blocks'][string]]>;
};

export interface PlaylistColumnProps {
  col1Style: CSSProperties;
  nowPlayingMusic: Music | null;
  currentTime: number;
  duration: number;
  playingId: string | null;
  scheduledMusicId: string | null;
  isPlaying: boolean;
  playlistCurrentBlockLine: {
    predictedTimeLabel: string | null;
    programName: string | null;
    blockType: string | null;
  };
  loading: boolean;
  error: string;
  data: SyncPlayData | null;
  visiblePlaylistGroups: PlaylistVisibleGroup[];
  playlistBaseDate: string;
  playlistBlockHideDisabled: Record<string, boolean>;
  setPlaylistBlockHideDisabled: Dispatch<SetStateAction<Record<string, boolean>>>;
  playlistBlockExpanded: Record<string, boolean>;
  setPlaylistBlockExpanded: Dispatch<SetStateAction<Record<string, boolean>>>;
  setData: Dispatch<SetStateAction<SyncPlayData | null>>;
  autoMixOverrides: Record<string, number>;
  playlistFilterVis: PlaylistFilterVisibility;
  libraryYearDecade: boolean;
  showNameMusicFiles: boolean;
  showNameCommercialFiles: boolean;
  showNameMediaFiles: boolean;
  libMusicFilterIds: LibMusicFiltersState;
  applyPlaylistFilterClick: (p: PlaylistFilterClickPayload) => void;
  searchQuery: string;
  mediaCategory: MediaCategory;
  directoryValue: string;
  scheduleStarts: Record<string, ScheduleMediaStartDto>;
  trashHighlightPlaylistId: string | null;
  setTrashHighlightPlaylistId: Dispatch<SetStateAction<string | null>>;
  backgroundIds: string[];
  backgroundDurations: Record<string, number>;
  backgroundPositions: Record<string, number>;
  togglePlay: (uniqueId: string) => void | Promise<void>;
  handleSeek: (e: React.ChangeEvent<HTMLInputElement>) => void | Promise<void>;
  playableItemsRef: MutableRefObject<PlayableItem[]>;
  playlistItemRefs: MutableRefObject<Record<string, HTMLDivElement | null>>;
  playlistHasMoreTail: boolean;
  playlistAppendingDay: boolean;
  playlistAppendError: string;
  loadNextPlaylistBlock: () => void | Promise<void>;
  loadAllPlaylistBlocksUntilEnd: () => void | Promise<void>;
}

export function PlaylistColumn({
  col1Style,
  nowPlayingMusic,
  currentTime,
  duration,
  playingId,
  scheduledMusicId,
  isPlaying,
  playlistCurrentBlockLine,
  loading,
  error,
  data,
  visiblePlaylistGroups,
  playlistBaseDate,
  playlistBlockHideDisabled,
  setPlaylistBlockHideDisabled,
  playlistBlockExpanded,
  setPlaylistBlockExpanded,
  setData,
  autoMixOverrides,
  playlistFilterVis,
  libraryYearDecade,
  showNameMusicFiles,
  showNameCommercialFiles,
  showNameMediaFiles,
  libMusicFilterIds,
  applyPlaylistFilterClick,
  searchQuery,
  mediaCategory,
  directoryValue,
  scheduleStarts,
  trashHighlightPlaylistId,
  setTrashHighlightPlaylistId,
  backgroundIds,
  backgroundDurations,
  backgroundPositions,
  togglePlay,
  handleSeek,
  playableItemsRef,
  playlistItemRefs,
  playlistHasMoreTail,
  playlistAppendingDay,
  playlistAppendError,
  loadNextPlaylistBlock,
  loadAllPlaylistBlocksUntilEnd,
}: PlaylistColumnProps) {
  return (
    <div
      className="relative flex min-h-0 flex-col overflow-hidden bg-[#262626] border-r border-[#353535]"
      style={col1Style}
    >
      <MusicInfo nowPlayingMusic={nowPlayingMusic} />
      <div
        className="h-14 shrink-0 border-b border-[#353535]"
        aria-hidden
      />
      <PlaylistPlaybackBar
        currentTime={currentTime}
        duration={duration}
        hasCurrentTrack={playingId != null}
        isPlaying={isPlaying}
        onStop={() => invoke("pause_audio").catch(console.error)}
        onTogglePlayPause={async () => {
          if (!playingId) return;
          try {
            if (isPlaying) await invoke("pause_audio");
            else await invoke("resume_audio");
          } catch (e) {
            console.error(e);
          }
        }}
        onNext={() => invoke("skip_with_fade").catch(console.error)}
      />
      <div className="flex h-full min-h-0 w-full min-w-0">
        <div
          className="h-full min-w-3 shrink basis-12"
          aria-hidden
        />
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
          <PlaylistCurrentBlock
            predictedTimeLabel={playlistCurrentBlockLine.predictedTimeLabel}
            programName={playlistCurrentBlockLine.programName}
            blockType={playlistCurrentBlockLine.blockType}
          />
          <div className="scrollable-y relative flex min-h-0 flex-1 flex-col overflow-y-auto">
            {loading && <p className="text-center p-8 text-slate-400">Carregando lista...</p>}
            {error && <div className="text-center p-8 text-red-300">{error}</div>}

            {!loading && !error && data && (
              <div className="w-full">
                {visiblePlaylistGroups.map(({ plKey, pl, blocks }) => (
                  <div key={plKey}>
                    {blocks.map(([blockKey, block]) => {
                      const musicEntries = Object.entries(blockMediaRecord(block));
                      const blockDisplayStart = getBlockDisplayStart(block.start, musicEntries);
                      const blockUiKey = `${plKey}::${blockKey}`;
                      const anchor = playingId ?? scheduledMusicId;
                      const isCurrentBlock = Boolean(
                        anchor && anchor.startsWith(`${plKey}-${blockKey}-`)
                      );
                      const programKey = (pl.program || '').trim() || plKey;
                      const dateIso = isoDateHintFromPlaylistKey(plKey, playlistBaseDate);
                      const dateTextBr = formatBrazilianPlaylistDate(dateIso);
                      const scheduleBlockSec =
                        typeof block.duration === 'number' && Number.isFinite(block.duration)
                          ? block.duration
                          : typeof block.size === 'number' && Number.isFinite(block.size)
                            ? block.size
                            : null;
                      const durMs = block.duration_real_total_ms;
                      const fromRealTotalSec =
                        typeof durMs === 'number' && Number.isFinite(durMs) && durMs > 0
                          ? durMs / 1000
                          : null;
                      const headerDurationSeconds =
                        fromRealTotalSec ??
                        (scheduleBlockSec !== null && scheduleBlockSec > 0 ? scheduleBlockSec : null);
                      const hasFixedTime =
                        block.start_alias != null && String(block.start_alias).trim() !== '';
                      const dataHideDisabled = playlistBlockHideDisabled[blockUiKey] === true;
                      const blockExpanded = playlistBlockExpanded[blockUiKey] !== false;
                      return (
                        <section
                          key={`${plKey}-${blockKey}`}
                          data-playlist={plKey}
                          data-pkey={programKey}
                          data-bkey={blockKey}
                          data-hide-disabled={dataHideDisabled ? 'true' : 'false'}
                          className={[
                            'playlist-block',
                            block.type === 'musical'
                              ? 'playlist-block--musical'
                              : 'playlist-block--commercial',
                            hasFixedTime ? 'playlist-block--fixed' : '',
                          ]
                            .filter(Boolean)
                            .join(' ')}
                        >
                          <BlockHeader
                            playlistKey={plKey}
                            programKey={programKey}
                            blockKey={blockKey}
                            dateText={dateTextBr}
                            isCommercialBlock={block.type !== 'musical'}
                            startTimeSeconds={blockDisplayStart}
                            durationSeconds={headerDurationSeconds}
                            hasFixedTime={hasFixedTime}
                            isCurrentBlock={isCurrentBlock}
                            dataHideDisabled={dataHideDisabled}
                            onToggleHideDisabled={() => {
                              setPlaylistBlockHideDisabled((prev) => ({
                                ...prev,
                                [blockUiKey]: !prev[blockUiKey],
                              }));
                            }}
                            onClearBlock={() => {
                              setData((prev) => {
                                if (!prev) return prev;
                                return clearBlockMedia(prev, plKey, blockKey) ?? prev;
                              });
                            }}
                            expanded={blockExpanded}
                            onToggleExpanded={() => {
                              setPlaylistBlockExpanded((prev) => {
                                const isExp = prev[blockUiKey] !== false;
                                return { ...prev, [blockUiKey]: !isExp };
                              });
                            }}
                          />
                          {blockExpanded ? (
                          <div className="playlist-block-body">
                            {musicEntries.length === 0 ? (
                              <div className="px-2 py-1">
                                <div className="rounded-xl border border-dashed border-[#353535] mx-1 px-3 py-6 text-center">
                                  <p className="m-0 text-[0.78rem] text-slate-500 italic">
                                    Nenhuma mídia neste bloco
                                  </p>
                                </div>
                              </div>
                            ) : (
                              <>
                                {musicEntries.map(([musicKey, music]) => {
                                  const uniqueId = `${plKey}-${blockKey}-${musicKey}`;
                                  const isCurrentlyPlaying = playingId === uniqueId;
                                  const isBackgroundPlaying = backgroundIds.includes(uniqueId);
                                  const scheduleStart = scheduleStarts[uniqueId];
                                  const isDisabled = legacyBool(music.disabled) ||
                                    legacyBool(music.discarded) ||
                                    legacyBool(music.manualDiscard ?? music.manual_discard) ||
                                    scheduleStart?.active === false;
                                  return (
                                    <div
                                      key={musicKey}
                                      ref={(node) => {
                                        if (node) playlistItemRefs.current[uniqueId] = node;
                                        else delete playlistItemRefs.current[uniqueId];
                                      }}
                                      data-playlist-music-id={uniqueId}
                                    >
                                        <PlaylistMusicItem
                                          music={music}
                                          itemUniqueId={uniqueId}
                                          overrideMixEndMs={autoMixOverrides[uniqueId]}
                                          filterVisibility={playlistFilterVis}
                                          libraryYearDecade={libraryYearDecade}
                                          showMusicFileName={showNameMusicFiles}
                                          showCommercialFileName={showNameCommercialFiles}
                                          showMediaFileName={showNameMediaFiles}
                                          libMusicFilterIds={libMusicFilterIds}
                                          playlistSidebarFilterHighlight={{
                                            searchQuery,
                                            mediaCategory,
                                            directoryValue,
                                          }}
                                          onPlaylistFilterClick={applyPlaylistFilterClick}
                                          startLabel={scheduleStart?.startLabel}
                                          isCurrentlyPlaying={isCurrentlyPlaying}
                                          isBackgroundPlaying={isBackgroundPlaying}
                                          isScheduledUpcoming={scheduledMusicId === uniqueId && !isCurrentlyPlaying && !isBackgroundPlaying}
                                          isDisabled={isDisabled}
                                          isPlaying={isPlaying}
                                          currentTime={currentTime}
                                          duration={isBackgroundPlaying && backgroundDurations[uniqueId] ? backgroundDurations[uniqueId] / 1000 : duration}
                                          backgroundPosition={backgroundPositions[uniqueId] ?? 0}
                                          onPlay={() => togglePlay(uniqueId)}
                                          onSeek={handleSeek}
                                          showTrashSkipIcon={trashHighlightPlaylistId === uniqueId}
                                          onPlaylistItemSelect={() =>
                                            setTrashHighlightPlaylistId((prev) =>
                                              prev === uniqueId ? null : uniqueId
                                            )
                                          }
                                          onTrashRemove={
                                            trashHighlightPlaylistId === uniqueId
                                              ? () => {
                                                setTrashHighlightPlaylistId(null);
                                                setData((prev) => {
                                                  if (!prev) return prev;
                                                  return (
                                                    removeMusicFromBlock(prev, plKey, blockKey, musicKey) ??
                                                    prev
                                                  );
                                                });
                                              }
                                              : undefined
                                          }
                                          onSkipNextFromRow={() => {
                                            const q = playableItemsRef.current;
                                            const idx = q.findIndex((i) => i.id === uniqueId);
                                            if (idx === -1) return;
                                            invoke("play_index", { index: idx + 1 }).catch(console.error);
                                          }}
                                        />
                                    </div>
                                  );
                                })}
                              </>
                            )}
                          </div>
                          ) : null}
                          <div className="playlist-block-footer" />
                        </section>
                      );
                    })}
                  </div>
                ))}
                <PlaylistLoadMoreControls
                  hasMoreTail={playlistHasMoreTail}
                  isLoading={playlistAppendingDay}
                  onLoadNext={loadNextPlaylistBlock}
                  onLoadAll={loadAllPlaylistBlocksUntilEnd}
                />
                {playlistAppendError && (
                  <div className="px-3 pb-3 text-[0.78rem] text-red-300">
                    {playlistAppendError}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
