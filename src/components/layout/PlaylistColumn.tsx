import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';
import { invoke } from '@tauri-apps/api/core';
import vuMasterMuted from '../../assets/vus/master-off.png';
import vuMaster from '../../assets/vus/master.png';
import { BlockHeader } from '../BlockHeader';
import { PlaylistMusicItem, getChorusSeekMs, getIntroSeekMs, type PlaylistFilterClickPayload, type PlaylistFilterVisibility } from '../PlaylistMusicItem';
import { MusicInfo } from '../playlist/MusicInfo';
import { PlaylistCurrentBlock } from '../playlist/PlaylistCurrentBlock';
import { PlaylistLoadMoreControls } from '../playlist/PlaylistLoadMoreControls';
import { PlaylistPlaybackBar } from '../playlist/PlaylistPlaybackBar';
import type { Music, MediaCategory, PlayableItem, ScheduleMediaStartDto, SyncPlayData } from '../../types';
import type { LibMusicFiltersState } from '../../hooks/useSyncplayLibrary';
import { useMixer, INTRO_CHORUS_CHANNEL_ID } from '../../hooks/useMixer';
import { MixerStripTemplate } from '../Mixer/MixerStripTemplate';
import {
  blockMediaRecord,
  clearBlockMedia,
  formatBrazilianPlaylistDate,
  getBlockDisplayStart,
  isoDateHintFromPlaylistKey,
  legacyBool,
  removeMusicFromBlock,
} from '../../playlist/playlistBlockHelpers';
import cadeado from '../../assets/cadeado.png';
import antena from '../../assets/operacao_local.png';

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
  scrollToPlaylistMusic: (musicId: string) => void;
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
  scrollToPlaylistMusic,
}: PlaylistColumnProps) {
  const { getBusConfig, getVuLevel, setBusGain, setBusMuted } = useMixer();

  const masterConfig = getBusConfig('master');
  const masterVu = getVuLevel('master');
  const masterMutedIcon = masterConfig.muted ? vuMasterMuted : vuMaster;

  const [playlistScrolledAway, setPlaylistScrolledAway] = useState(false);
  const [jumpTargetPlaylistRowInView, setJumpTargetPlaylistRowInView] = useState(false);
  const [pendingJumpHighlight, setPendingJumpHighlight] = useState(false);

  const playlistScrollRef = useRef<HTMLDivElement>(null);

  const jumpTargetMusicId = playingId ?? scheduledMusicId;

  const onPlaylistScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setPlaylistScrolledAway(e.currentTarget.scrollTop > 8);
  }, []);

  useLayoutEffect(() => {
    if (jumpTargetPlaylistRowInView) {
      setPendingJumpHighlight(false);
    }
  }, [jumpTargetPlaylistRowInView]);

  useEffect(() => {
    const root = playlistScrollRef.current;
    const id = jumpTargetMusicId;
    if (!root || !id) {
      setJumpTargetPlaylistRowInView(false);
      return;
    }

    let observer: IntersectionObserver | undefined;
    let raf = 0;

    const observeTarget = (): void => {
      window.cancelAnimationFrame(raf);
      observer?.disconnect();
      const target = playlistItemRefs.current[id];
      if (!target) {
        raf = window.requestAnimationFrame(observeTarget);
        return;
      }
      observer = new IntersectionObserver(
        ([entry]) => {
          const ratio = entry?.intersectionRatio ?? 0;
          const hasBox = !!entry?.intersectionRect.height;
          const ok = !!(entry?.isIntersecting && (ratio > 0.01 || hasBox));
          setJumpTargetPlaylistRowInView(ok);
        },
        { root, threshold: [0, 0.02, 0.05, 0.25, 0.6, 1] },
      );
      observer.observe(target);
    };

    observeTarget();
    return () => {
      window.cancelAnimationFrame(raf);
      observer?.disconnect();
    };
  }, [jumpTargetMusicId, loading, error, data, visiblePlaylistGroups]);

  const atJumpAnchorPoint =
    pendingJumpHighlight || jumpTargetPlaylistRowInView;

  const jumpArrowFill =
    !playlistScrolledAway
      ? '#454545'
      : atJumpAnchorPoint
        ? '#353535'
        : '#ffffff';

  const onJumpToCurrentMusic = useCallback(() => {
    if (!jumpTargetMusicId) return;
    setPendingJumpHighlight(true);
    scrollToPlaylistMusic(jumpTargetMusicId);
  }, [jumpTargetMusicId, scrollToPlaylistMusic]);

  const onMasterMuteToggle = useCallback(() => {
    setBusMuted('master', !masterConfig.muted);
  }, [masterConfig.muted, setBusMuted]);

  return (
    <div
      className="relative flex min-h-0 flex-col overflow-hidden bg-[#262626] border-r border-l-4 border-[#353535]"
      style={col1Style}
    >
      <MusicInfo nowPlayingMusic={nowPlayingMusic} />
      <div
        className="h-14 shrink-0 border-b-4 border-[#353535]"
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
        <aside
          className="flex h-full min-h-0 w-[50px] shrink-0 flex-col items-stretch gap-1 overflow-x-hidden overflow-y-auto bg-[#262626] py-1"
          aria-label="Master e atalhos da playlist"
        >
          <div className="flex items-center justify-center flex-col gap-3 mb-6 mt-2">
            <svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px"
              fill="#e3e3e3">
              <path
                d="m612-292 56-56-148-148v-184h-80v216l172 172ZM480-80q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Zm0-400Zm0 320q133 0 226.5-93.5T800-480q0-133-93.5-226.5T480-800q-133 0-226.5 93.5T160-480q0 133 93.5 226.5T480-160Z" />
            </svg>
            <svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px"
              fill="#e3e3e3">
              <path
                d="M480-120q-42 0-71-29t-29-71q0-42 29-71t71-29q42 0 71 29t29 71q0 42-29 71t-71 29ZM254-346l-84-86q59-59 138.5-93.5T480-560q92 0 171.5 35T790-430l-84 84q-44-44-102-69t-124-25q-66 0-124 25t-102 69ZM84-516 0-600q92-94 215-147t265-53q142 0 265 53t215 147l-84 84q-77-77-178.5-120.5T480-680q-116 0-217.5 43.5T84-516Z" />
            </svg>
            <img src={cadeado} alt="" className="size-5" />
            <img src={antena} alt="" className="size-5" />
            <svg id="operacaoLocal" fill="#19a69e" xmlns="http://www.w3.org/2000/svg" width="35" height="30"
              viewBox="0 0 512 326">
              <path id="auto_copy" data-name="auto copy" className="cls-1"
                d="M20,0H492a20,20,0,0,1,20,20V305a20,20,0,0,1-20,20H20A20,20,0,0,1,0,305V20A20,20,0,0,1,20,0ZM158.234,234.194L123.575,89.71H93.682L59.889,234.194H88.483l5.2-24.261h28.81l5.415,24.261h30.327Zm-60.22-46.573c4.116-20.145,8.232-40.291,9.531-60.653,0.65,6.282,1.517,12.781,2.383,19.062,2.166,14.081,5.2,27.728,8.232,41.591H98.014ZM256.572,89.71H227.979v97.261c0,10.831.433,23.612-14.08,23.612-14.73,0-14.3-14.08-14.3-24.911V89.71H171.008V199.535c0,25.561,18.846,37.042,42.457,37.042,14.3,0,30.544-3.9,38.342-17.113,4.332-7.365,4.765-13.864,4.765-22.095V89.71Zm86.641,26.427V89.71H270v26.427h22.312V234.194H320.9V116.137h22.312ZM454.767,162.06c0-18.2-1.95-39.208-13-54.371-8.665-11.914-22.745-20.145-37.692-20.145-14.73,0-29.243,8.015-37.691,20.145-11.048,15.6-13,35.742-13,54.371,0,18.2,1.95,38.991,13,54.155,8.664,11.914,22.744,20.362,37.691,20.362s29.244-8.448,37.692-20.362C452.817,200.618,454.767,180.689,454.767,162.06Zm-30.327-.65c0,13.214-1.516,47.656-20.362,47.656s-20.362-34.442-20.362-47.656,1.516-47.656,20.362-47.656S424.44,148.2,424.44,161.41Z" />
            </svg>
          </div>
          <MixerStripTemplate
            meterFill
            className="min-h-0 flex-1"
            faderValue={masterConfig.gain}
            onFaderChange={(v) => setBusGain('master', v)}
            faderColor="#4caf50"
            vuLevel={masterVu}
            vuBarWidth={5}
            vuGap={1}
            muted={masterConfig.muted}
            onMuteToggle={onMasterMuteToggle}
            muteIconSrc={masterMutedIcon}
            muteButtonTitle={masterConfig.muted ? 'Unmute' : 'Mute'}
            label=""
            embed
            faderSpace={false}
          />
        </aside>
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
          <PlaylistCurrentBlock
            predictedTimeLabel={playlistCurrentBlockLine.predictedTimeLabel}
            programName={playlistCurrentBlockLine.programName}
            blockType={playlistCurrentBlockLine.blockType}
            jumpArrowFill={jumpArrowFill}
            canJumpToCurrentMusic={jumpTargetMusicId != null}
            onJumpToCurrentMusic={onJumpToCurrentMusic}
          />
          <div
            ref={playlistScrollRef}
            data-playlist-scroll
            className="scrollable-y relative flex min-h-0 flex-1 flex-col overflow-y-auto"
            onScroll={onPlaylistScroll}
          >
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
                              {musicEntries.length !== 0 && (
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
                                          onIntroSeekTo={
                                            getIntroSeekMs(music) != null
                                              ? (positionMs) => {
                                                  const q = playableItemsRef.current;
                                                  const idx = q.findIndex((i) => i.id === uniqueId);
                                                  if (idx === -1) return;
                                                  void invoke('play_index_seek_fade', {
                                                    index: idx,
                                                    positionMs,
                                                    mixerBus: INTRO_CHORUS_CHANNEL_ID,
                                                  }).catch(console.error);
                                                }
                                              : undefined
                                          }
                                          onChorusSeekTo={
                                            getChorusSeekMs(music) != null
                                              ? (positionMs) => {
                                                  const q = playableItemsRef.current;
                                                  const idx = q.findIndex((i) => i.id === uniqueId);
                                                  if (idx === -1) return;
                                                  void invoke('play_index_seek_fade', {
                                                    index: idx,
                                                    positionMs,
                                                    mixerBus: INTRO_CHORUS_CHANNEL_ID,
                                                  }).catch(console.error);
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
