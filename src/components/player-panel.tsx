"use client";

// [Spoken Page Enhanced v1.3.15] CUSTOM MAINTAINER NOTES
// -----------------------------------------------------
// This file is the Enhanced variant of the matching Spoken Page player source.
// Major custom areas: fullscreen read-along stage, per-book cover placement,
// background/pattern appearance, audio visualizer, bookmarks, personal list UX,
// and safer fullscreen control layering. Keep these changes when syncing from upstream.
// Useful source check during maintenance/build debugging:
//   Select-String -Path .\src\components\player-panel.tsx -Pattern "isFullscreenCoverEditing|setIsFullscreenCoverEditing|toggleFullscreenCoverEditing" -Context 3,3
//   The fullscreen visual preference map is per-book and synced through the account preferences API.
//   [Enhanced v1.3.15] Fullscreen appearance is edited through one compact draggable
//   tabbed menu; the menu includes cover, background, visualizer, and subtitle settings.
//   [Enhanced v1.3.15] Close player remains a transport button immediately left of Fullscreen.
//   [Enhanced v1.3.15] Visual artwork layers are pointer-transparent except for the actual
//   editable cover frame, preventing invisible click shields over transport controls.
// [Enhanced v1.3.15] The project displays the original-compatible base version as v1.3.0,
// with the visible product label "Spoken Page Enhanced v1.3.15".

import { ChangeEvent, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent, type PointerEvent, type WheelEvent } from "react";
import {
  AudioTrack,
  Chapter,
  LibraryFile,
  LibraryItemExpanded,
  PlaybackSession,
  SubtitleCue,
} from "@/lib/types";
import { playbackFinished } from "@/lib/listening-status";
import { progressSaveFailure, progressRetryDelay } from "@/lib/progress-save-feedback";
import { publishProgress } from "@/lib/progress-client";
import { parseSubtitle } from "@/lib/srt";
import { formatSleepTimer, useSleepTimer, type SleepTimerSelection } from "@/components/use-sleep-timer";

type PlayerPanelProps = {
  item: LibraryItemExpanded | null;
  onItemRefresh: (itemId: string) => Promise<LibraryItemExpanded | null>;
  focusMode?: boolean;
  onHide?: (() => void) | null;
  onInlineFullscreenChange?: ((isActive: boolean) => void) | null;
  openToken?: number;
  preferenceScope?: string;
  variant?: "full" | "dock";
};

type TrackLoadRequest = {
  requestId: number;
  autoplay: boolean;
  time: number;
  track: AudioTrack;
};

type FullscreenDocument = Document & {
  webkitExitFullscreen?: () => Promise<void> | void;
  webkitFullscreenElement?: Element | null;
};

type FullscreenPanelElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};

type WakeLockSentinelLike = {
  released?: boolean;
  release: () => Promise<void>;
  addEventListener?: (type: "release", listener: EventListener) => void;
  removeEventListener?: (type: "release", listener: EventListener) => void;
};

type NavigatorWithWakeLock = Navigator & {
  wakeLock?: {
    request?: (type: "screen") => Promise<WakeLockSentinelLike>;
  };
};

const AUTO_SYNC_INTERVAL_MS = 20000;
const AUTO_SYNC_MIN_PROGRESS_SECONDS = 5;
const STATUS_MESSAGE_DURATION_MS = 5000;
const FULLSCREEN_CONTROLS_IDLE_MS = 2500;
const TIME_DISPLAY_MODE_STORAGE_KEY = "spoken-page-time-display-mode";
const PLAYER_PREFERENCES_STORAGE_KEY = "spoken-page-player-preferences";
const BOOK_SUBTITLE_PREFERENCES_STORAGE_KEY = "spoken-page-book-subtitle-preferences";
const FULLSCREEN_COVER_STORAGE_KEY = "spoken-page-fullscreen-cover-v2";
const BOOKMARKS_STORAGE_KEY = "spoken-page-bookmarks";
const PLAY_INTERRUPTED_PATTERNS = [
  "the play() request was interrupted",
  "interrupted by a call to pause()",
  "the fetching process for the media resource was aborted",
];

type SubtitleScale = "standard" | "large" | "x-large";
type SubtitleLineHeight = "tight" | "standard" | "relaxed";
type SubtitlePosition = "center" | "raised" | "lower-third";
type SubtitleContrast = "solid" | "soft" | "glow";
type SubtitleTextColor = "white" | "yellow" | "gold" | "orange" | "red" | "pink" | "blue" | "cyan" | "green" | "black";
type SubtitleBackground = "none" | "black" | "white" | "dark-gray" | "yellow" | "gold" | "red" | "blue" | "navy";
type FullscreenBackgroundPattern = "none" | "dots" | "grid" | "diagonal" | "stripes" | "crosshatch" | "radial";
type VisualizerStyle = "off" | "bars" | "waveform" | "wave-bars" | "pulse";

type FullscreenBackgroundColor =
  | "black"
  | "near-black"
  | "charcoal"
  | "dark-gray"
  | "gray"
  | "slate"
  | "silver"
  | "white"
  | "navy"
  | "blue"
  | "teal"
  | "green"
  | "purple"
  | "red"
  | "brown"
  | "orange"
  | "yellow"
  | "pink"
  | "magenta"
  | "violet"
  | "cyan"
  | "lime";
type FullscreenAutoHide = 1500 | 2500 | 4000 | 6000;

type PlayerPreferences = {
  playbackRate: number;
  volume: number;
  subtitleScale: SubtitleScale;
  subtitleLineHeight: SubtitleLineHeight;
  subtitlePosition: SubtitlePosition;
  subtitleContrast: SubtitleContrast;
  subtitleTextColor: SubtitleTextColor;
  subtitleBackground: SubtitleBackground;
  fullscreenAutoHideMs: FullscreenAutoHide;
};

type BookSubtitlePreference = { offset: number; serverFileId: string };

type FullscreenCoverPreference = {
  visible: boolean;
  useSharedDefault: boolean;
  applyToAll: boolean;
  appearanceGeneration: number;
  customizedAtGeneration: number;
  scale: number;
  x: number;
  y: number;
  opacity: number;
  backdropOpacity: number;
  backdropBlur: number;
  backgroundColor: FullscreenBackgroundColor;
  backgroundPattern: FullscreenBackgroundPattern;
  backgroundPatternOpacity: number;
  visualizerEnabled: boolean;
  visualizerStyle: VisualizerStyle;
  visualizerScale: number;
  visualizerX: number;
  visualizerY: number;
  visualizerOpacity: number;
  visualizerColor: FullscreenBackgroundColor;
  visualizerGlow: number;
  visualizerSensitivity: number;
  visualizerSmoothing: number;
  visualizerLocked: boolean;
  // [Enhanced v1.0] Fullscreen subtitle-display choices are also remembered per book.
  subtitleScale: SubtitleScale;
  subtitleLineHeight: SubtitleLineHeight;
  subtitlePosition: SubtitlePosition;
  subtitleContrast: SubtitleContrast;
  subtitleTextColor: SubtitleTextColor;
  subtitleBackground: SubtitleBackground;
};

type PlayerBookmark = {
  id: string;
  time: number;
  chapterTitle: string | null;
  createdAt: number;
};

const FULLSCREEN_BACKGROUND_COLORS: Record<FullscreenBackgroundColor, string> = {
  black: "#000000",
  "near-black": "#08090c",
  charcoal: "#15171b",
  "dark-gray": "#24272c",
  gray: "#3a3e44",
  slate: "#4f5864",
  silver: "#737a83",
  white: "#f1f1f1",
  navy: "#0b1730",
  blue: "#12375f",
  teal: "#103b3d",
  green: "#12351f",
  purple: "#2d1740",
  red: "#48161c",
  brown: "#3b2618",
  orange: "#4a250d",
  yellow: "#4a430a",
  pink: "#48152f",
  magenta: "#3f0d3c",
  violet: "#24124f",
  cyan: "#0b3f49",
  lime: "#30420d",
};

const FULLSCREEN_BACKGROUND_PATTERNS: Record<FullscreenBackgroundPattern, string> = {
  none: "none",
  dots: "radial-gradient(circle, rgba(255,255,255,0.16) 1px, transparent 1.5px)",
  grid: "linear-gradient(rgba(255,255,255,0.10) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.10) 1px, transparent 1px)",
  diagonal: "repeating-linear-gradient(135deg, rgba(255,255,255,0.09) 0 2px, transparent 2px 14px)",
  stripes: "repeating-linear-gradient(90deg, rgba(255,255,255,0.08) 0 2px, transparent 2px 18px)",
  crosshatch: "repeating-linear-gradient(45deg, rgba(255,255,255,0.07) 0 1px, transparent 1px 12px), repeating-linear-gradient(-45deg, rgba(255,255,255,0.07) 0 1px, transparent 1px 12px)",
  radial: "radial-gradient(circle at center, rgba(255,255,255,0.15), transparent 62%)",
};

function scopedPlayerStorageKey(base: string, scope: string) {
  return `${base}:${encodeURIComponent(scope)}`;
}

// [Spoken Page Enhanced v1.3.15] Shared appearance is stored once as __global__.
// Individual books keep their own appearance only after they are customized.
// This avoids looping through every book when applying an all-books look.
const FULLSCREEN_VISUAL_GLOBAL_ID = "__global__";
const FULLSCREEN_APPEARANCE_STORAGE_KEY = "spoken-page-fullscreen-appearance-v3";

function sharedFullscreenStorageKey(scope: string) {
  return scopedPlayerStorageKey(FULLSCREEN_APPEARANCE_STORAGE_KEY, scope);
}

const DEFAULT_ORIGINAL_FULLSCREEN_COVER_PREFERENCE: FullscreenCoverPreference = {
  visible: true,
  useSharedDefault: true,
  applyToAll: false,
  appearanceGeneration: 0,
  customizedAtGeneration: 0,
  scale: 0.60,
  x: 0,
  y: -16,
  opacity: 0.96,
  backdropOpacity: 0,
  backdropBlur: 1,
  backgroundColor: "black",
  backgroundPattern: "none",
  backgroundPatternOpacity: 0,
  visualizerEnabled: false,
  visualizerStyle: "off",
  visualizerScale: 0.72,
  visualizerX: 0,
  visualizerY: 8,
  visualizerOpacity: 0.5,
  visualizerColor: "orange",
  visualizerGlow: 0,
  visualizerSensitivity: 1,
  visualizerSmoothing: 0.72,
  visualizerLocked: true,
  subtitleScale: "standard",
  subtitleLineHeight: "standard",
  subtitlePosition: "lower-third",
  subtitleContrast: "solid",
  subtitleTextColor: "white",
  subtitleBackground: "none",
};

const DEFAULT_ENHANCED_FULLSCREEN_COVER_PREFERENCE: FullscreenCoverPreference = {
  ...DEFAULT_ORIGINAL_FULLSCREEN_COVER_PREFERENCE,
  applyToAll: false,
  appearanceGeneration: 0,
  customizedAtGeneration: 0,
  backgroundPatternOpacity: 0.10,
  visualizerEnabled: true,
  visualizerStyle: "bars",
  visualizerScale: 0.62,
  visualizerY: 18,
  visualizerOpacity: 0.72,
  visualizerColor: "orange",
  visualizerGlow: 10,
  subtitleScale: "large",
};

function readBookSubtitlePreference(bookId: string, scope: string): BookSubtitlePreference {
  try {
    const all = JSON.parse(window.localStorage.getItem(scopedPlayerStorageKey(BOOK_SUBTITLE_PREFERENCES_STORAGE_KEY, scope)) ?? "{}") as Record<
      string,
      Partial<BookSubtitlePreference>
    >;
    const value = all[bookId];
    return {
      offset: Number.isFinite(Number(value?.offset)) ? Math.min(8, Math.max(-8, Number(value?.offset))) : 0,
      serverFileId: typeof value?.serverFileId === "string" ? value.serverFileId : "",
    };
  } catch {
    return { offset: 0, serverFileId: "" };
  }
}

function writeBookSubtitlePreference(bookId: string, value: BookSubtitlePreference, scope: string) {
  try {
    const storageKey = scopedPlayerStorageKey(BOOK_SUBTITLE_PREFERENCES_STORAGE_KEY, scope);
    const all = JSON.parse(window.localStorage.getItem(storageKey) ?? "{}") as Record<
      string,
      BookSubtitlePreference
    >;
    all[bookId] = value;
    window.localStorage.setItem(storageKey, JSON.stringify(all));
  } catch {
    // Storage can be unavailable in private browsing; playback should continue.
  }
}

function readAllBookSubtitlePreferences(scope: string) {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(scopedPlayerStorageKey(BOOK_SUBTITLE_PREFERENCES_STORAGE_KEY, scope)) ?? "{}") as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, BookSubtitlePreference>)
      : {};
  } catch {
    return {};
  }
}

function readGlobalSubtitleAppearance(scope: string) {
  try {
    const raw = window.localStorage.getItem(scopedPlayerStorageKey(PLAYER_PREFERENCES_STORAGE_KEY, scope));
    const parsed = raw ? JSON.parse(raw) as Partial<PlayerPreferences> : {};
    return {
      subtitleScale: parsed.subtitleScale === "large" || parsed.subtitleScale === "x-large" ? parsed.subtitleScale : "standard" as SubtitleScale,
      subtitleLineHeight: parsed.subtitleLineHeight === "tight" || parsed.subtitleLineHeight === "relaxed" ? parsed.subtitleLineHeight : "standard" as SubtitleLineHeight,
      subtitlePosition: parsed.subtitlePosition === "raised" || parsed.subtitlePosition === "lower-third" ? parsed.subtitlePosition : "center" as SubtitlePosition,
      subtitleContrast: parsed.subtitleContrast === "soft" || parsed.subtitleContrast === "glow" ? parsed.subtitleContrast : "solid" as SubtitleContrast,
      subtitleTextColor: typeof parsed.subtitleTextColor === "string" && ["white","yellow","gold","orange","red","pink","blue","cyan","green","black"].includes(parsed.subtitleTextColor) ? parsed.subtitleTextColor as SubtitleTextColor : "white" as SubtitleTextColor,
      subtitleBackground: typeof parsed.subtitleBackground === "string" && ["none","black","white","dark-gray","yellow","gold","red","blue","navy"].includes(parsed.subtitleBackground) ? parsed.subtitleBackground as SubtitleBackground : "none" as SubtitleBackground,
    };
  } catch {
    return {
      subtitleScale: "standard" as SubtitleScale,
      subtitleLineHeight: "standard" as SubtitleLineHeight,
      subtitlePosition: "center" as SubtitlePosition,
      subtitleContrast: "solid" as SubtitleContrast,
      subtitleTextColor: "white" as SubtitleTextColor,
      subtitleBackground: "none" as SubtitleBackground,
    };
  }
}

function parseFullscreenCoverPreferenceValue(raw: unknown, fallback: FullscreenCoverPreference): FullscreenCoverPreference {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fallback;
  const parsed = raw as Partial<FullscreenCoverPreference>;
  const hasExplicitSharedSetting = Object.prototype.hasOwnProperty.call(parsed, "useSharedDefault");
  const legacyDefault =
    !hasExplicitSharedSetting &&
    Number(parsed.scale) === 0.82 &&
    Number(parsed.x) === 0 &&
    Number(parsed.y) === 0 &&
    Number(parsed.backdropOpacity) === 0.03;
  const previousEnhancedDefault =
    !hasExplicitSharedSetting &&
    Number(parsed.scale) === 0.60 &&
    Number(parsed.x) === 0 &&
    Number(parsed.y) === -16 &&
    String(parsed.backgroundColor ?? "black") === "black" &&
    String(parsed.backgroundPattern ?? "none") === "none" &&
    parsed.visualizerEnabled !== true &&
    String(parsed.visualizerStyle ?? "bars") === "bars" &&
    Number(parsed.visualizerY) === 26;
  const useSharedDefault = hasExplicitSharedSetting
    ? parsed.useSharedDefault !== false
    : legacyDefault || previousEnhancedDefault;
  return {
    ...fallback,
    visible: parsed.visible !== false,
    useSharedDefault,
    applyToAll: parsed.applyToAll === true,
    appearanceGeneration: Number.isFinite(Number(parsed.appearanceGeneration)) ? Number(parsed.appearanceGeneration) : fallback.appearanceGeneration,
    customizedAtGeneration: Number.isFinite(Number(parsed.customizedAtGeneration)) ? Number(parsed.customizedAtGeneration) : fallback.customizedAtGeneration,
    scale: Number.isFinite(Number(parsed.scale)) ? Math.min(1.35, Math.max(0.45, Number(parsed.scale))) : fallback.scale,
    x: Number.isFinite(Number(parsed.x)) ? Math.min(40, Math.max(-40, Number(parsed.x))) : fallback.x,
    y: Number.isFinite(Number(parsed.y)) ? Math.min(40, Math.max(-40, Number(parsed.y))) : fallback.y,
    opacity: Number.isFinite(Number(parsed.opacity)) ? Math.min(1, Math.max(0.1, Number(parsed.opacity))) : fallback.opacity,
    backdropOpacity: Number.isFinite(Number(parsed.backdropOpacity)) ? Math.min(0.4, Math.max(0, Number(parsed.backdropOpacity))) : fallback.backdropOpacity,
    backdropBlur: Number.isFinite(Number(parsed.backdropBlur)) ? Math.min(8, Math.max(0, Number(parsed.backdropBlur))) : fallback.backdropBlur,
    backgroundColor: typeof parsed.backgroundColor === "string" && Object.prototype.hasOwnProperty.call(FULLSCREEN_BACKGROUND_COLORS, parsed.backgroundColor) ? parsed.backgroundColor as FullscreenBackgroundColor : fallback.backgroundColor,
    backgroundPattern: typeof parsed.backgroundPattern === "string" && Object.prototype.hasOwnProperty.call(FULLSCREEN_BACKGROUND_PATTERNS, parsed.backgroundPattern) ? parsed.backgroundPattern as FullscreenBackgroundPattern : fallback.backgroundPattern,
    backgroundPatternOpacity: Number.isFinite(Number(parsed.backgroundPatternOpacity)) ? Math.min(0.6, Math.max(0, Number(parsed.backgroundPatternOpacity))) : fallback.backgroundPatternOpacity,
    visualizerEnabled: parsed.visualizerEnabled === true,
    visualizerStyle: parsed.visualizerStyle === "bars" || parsed.visualizerStyle === "waveform" || parsed.visualizerStyle === "wave-bars" || parsed.visualizerStyle === "pulse" || parsed.visualizerStyle === "off" ? parsed.visualizerStyle : fallback.visualizerStyle,
    visualizerScale: Number.isFinite(Number(parsed.visualizerScale)) ? Math.min(1.4, Math.max(0.35, Number(parsed.visualizerScale))) : fallback.visualizerScale,
    visualizerX: Number.isFinite(Number(parsed.visualizerX)) ? Math.min(40, Math.max(-40, Number(parsed.visualizerX))) : fallback.visualizerX,
    visualizerY: Number.isFinite(Number(parsed.visualizerY)) ? Math.min(40, Math.max(-40, Number(parsed.visualizerY))) : fallback.visualizerY,
    visualizerOpacity: Number.isFinite(Number(parsed.visualizerOpacity)) ? Math.min(1, Math.max(0, Number(parsed.visualizerOpacity))) : fallback.visualizerOpacity,
    visualizerColor: typeof parsed.visualizerColor === "string" && Object.prototype.hasOwnProperty.call(FULLSCREEN_BACKGROUND_COLORS, parsed.visualizerColor) ? parsed.visualizerColor as FullscreenBackgroundColor : fallback.visualizerColor,
    visualizerGlow: Number.isFinite(Number(parsed.visualizerGlow)) ? Math.min(32, Math.max(0, Number(parsed.visualizerGlow))) : fallback.visualizerGlow,
    visualizerSensitivity: Number.isFinite(Number(parsed.visualizerSensitivity)) ? Math.min(2, Math.max(0.2, Number(parsed.visualizerSensitivity))) : fallback.visualizerSensitivity,
    visualizerSmoothing: Number.isFinite(Number(parsed.visualizerSmoothing)) ? Math.min(0.95, Math.max(0.05, Number(parsed.visualizerSmoothing))) : fallback.visualizerSmoothing,
    visualizerLocked: parsed.visualizerLocked !== false,
    subtitleScale: parsed.subtitleScale === "large" || parsed.subtitleScale === "x-large" ? parsed.subtitleScale : fallback.subtitleScale,
    subtitleLineHeight: parsed.subtitleLineHeight === "tight" || parsed.subtitleLineHeight === "relaxed" ? parsed.subtitleLineHeight : fallback.subtitleLineHeight,
    subtitlePosition: parsed.subtitlePosition === "center" || parsed.subtitlePosition === "raised" || parsed.subtitlePosition === "lower-third" ? parsed.subtitlePosition : fallback.subtitlePosition,
    subtitleContrast: parsed.subtitleContrast === "solid" || parsed.subtitleContrast === "soft" || parsed.subtitleContrast === "glow" ? parsed.subtitleContrast : fallback.subtitleContrast,
    subtitleTextColor: typeof parsed.subtitleTextColor === "string" && ["white","yellow","gold","orange","red","pink","blue","cyan","green","black"].includes(parsed.subtitleTextColor) ? parsed.subtitleTextColor as SubtitleTextColor : fallback.subtitleTextColor,
    subtitleBackground: typeof parsed.subtitleBackground === "string" && ["none","black","white","dark-gray","yellow","gold","red","blue","navy"].includes(parsed.subtitleBackground) ? parsed.subtitleBackground as SubtitleBackground : fallback.subtitleBackground,
  };
}

function readSharedFullscreenAppearance(scope: string): FullscreenCoverPreference {
  try {
    const raw = window.localStorage.getItem(sharedFullscreenStorageKey(scope));
    if (raw) return parseFullscreenCoverPreferenceValue(JSON.parse(raw), DEFAULT_ENHANCED_FULLSCREEN_COVER_PREFERENCE);
  } catch {
    // Fall through to the Enhanced default.
  }
  return { ...DEFAULT_ENHANCED_FULLSCREEN_COVER_PREFERENCE };
}

function readFullscreenCoverPreference(scope: string, bookId: string): FullscreenCoverPreference {
  const shared = readSharedFullscreenAppearance(scope);
  try {
    const raw = window.localStorage.getItem(scopedPlayerStorageKey(FULLSCREEN_COVER_STORAGE_KEY, `${scope}:${bookId}`));
    if (!raw) return { ...shared, useSharedDefault: true, applyToAll: false };
    const parsed = JSON.parse(raw) as Partial<FullscreenCoverPreference>;
    if (parsed.useSharedDefault !== false) return { ...shared, useSharedDefault: true };
    if (shared.applyToAll && Number(parsed.customizedAtGeneration ?? 0) < shared.appearanceGeneration) return { ...shared, useSharedDefault: true };
    return parseFullscreenCoverPreferenceValue(parsed, shared);
  } catch {
    return { ...shared, useSharedDefault: true, applyToAll: false };
  }
}

function writeFullscreenCoverPreference(scope: string, bookId: string, value: FullscreenCoverPreference) {
  try {
    window.localStorage.setItem(
      scopedPlayerStorageKey(FULLSCREEN_COVER_STORAGE_KEY, `${scope}:${bookId}`),
      JSON.stringify(value),
    );
  } catch {
    // Storage can be unavailable in private browsing; playback should continue.
  }
}

function scopedBookmarkStorageKey(scope: string, bookId: string) {
  return scopedPlayerStorageKey(BOOKMARKS_STORAGE_KEY, `${scope}:${bookId}`);
}

function readBookmarks(scope: string, bookId: string): PlayerBookmark[] {
  try {
    const raw = window.localStorage.getItem(scopedBookmarkStorageKey(scope, bookId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((value): value is Partial<PlayerBookmark> => Boolean(value) && typeof value === "object")
      .map((value) => ({
        id: typeof value.id === "string" && value.id ? value.id : `${Date.now()}-${Math.random()}`,
        time: Number(value.time),
        chapterTitle: typeof value.chapterTitle === "string" ? value.chapterTitle : null,
        createdAt: Number(value.createdAt) || Date.now(),
      }))
      .filter((value) => Number.isFinite(value.time) && value.time >= 0)
      .sort((a, b) => a.time - b.time);
  } catch {
    return [];
  }
}

function writeBookmarks(scope: string, bookId: string, bookmarks: PlayerBookmark[]) {
  try {
    window.localStorage.setItem(scopedBookmarkStorageKey(scope, bookId), JSON.stringify(bookmarks));
  } catch {
    // Storage can be unavailable in private browsing; playback should continue.
  }
}

const DEFAULT_PLAYER_PREFERENCES: PlayerPreferences = {
  playbackRate: 1,
  volume: 1,
  subtitleScale: "large",
  subtitleLineHeight: "standard",
  subtitlePosition: "center",
  subtitleContrast: "solid",
  subtitleTextColor: "white",
  subtitleBackground: "none",
  fullscreenAutoHideMs: FULLSCREEN_CONTROLS_IDLE_MS,
};

// [ENHANCED v1.1.1] Keep one typed source of truth for the complete per-book
// fullscreen appearance object. This prevents future additions to
// FullscreenCoverPreference from being omitted from the initial state.
const DEFAULT_FULLSCREEN_COVER_PREFERENCE: FullscreenCoverPreference = DEFAULT_ENHANCED_FULLSCREEN_COVER_PREFERENCE;


function normalizeExt(value: string | undefined) {
  return (value ?? "").trim().toLowerCase().replace(/^\./, "");
}

function getLibraryFileLabel(file: LibraryFile) {
  return (
    file.metadata?.filename ??
    file.metadata?.relPath ??
    file.metadata?.path ??
    `Subtitle ${String(file.ino)}`
  );
}

function listSubtitleFiles(item: LibraryItemExpanded | null) {
  if (!item?.libraryFiles?.length) {
    return [];
  }

  return item.libraryFiles.filter((file) => {
    const extension = normalizeExt(file.metadata?.ext);
    const filename = getLibraryFileLabel(file).toLowerCase();
    return extension === "srt" || extension === "vtt" || filename.endsWith(".srt") || filename.endsWith(".vtt");
  });
}

function getTrackSignature(track: AudioTrack) {
  return `${track.index}:${track.startOffset}:${track.duration}:${track.contentUrl}`;
}

function resolveTimelineDuration(item: LibraryItemExpanded | null, tracks: AudioTrack[]) {
  if (item?.media.duration && item.media.duration > 0) {
    return item.media.duration;
  }

  return tracks.reduce((longest, track) => Math.max(longest, track.startOffset + track.duration), 0);
}

function clampTime(time: number, duration: number) {
  if (!Number.isFinite(time)) {
    return 0;
  }

  if (duration <= 0) {
    return Math.max(0, time);
  }

  return Math.min(Math.max(0, time), duration);
}

function getTrackIndexAtTime(tracks: AudioTrack[], time: number) {
  if (!tracks.length) {
    return -1;
  }

  const clamped = Math.max(0, time);

  for (let index = 0; index < tracks.length; index += 1) {
    const track = tracks[index];
    const trackEnd = track.startOffset + track.duration;

    if (clamped >= track.startOffset && clamped < trackEnd) {
      return index;
    }
  }

  if (clamped >= tracks[tracks.length - 1].startOffset) {
    return tracks.length - 1;
  }

  return 0;
}

function getTrackAtTime(tracks: AudioTrack[], time: number) {
  const index = getTrackIndexAtTime(tracks, time);
  return index >= 0 ? tracks[index] ?? null : null;
}

function getChapterAtTime(chapters: Chapter[] | undefined, time: number) {
  if (!chapters?.length) {
    return null;
  }

  for (const chapter of chapters) {
    if (time >= chapter.start && time < chapter.end) {
      return chapter;
    }
  }

  if (time >= chapters[chapters.length - 1].start) {
    return chapters[chapters.length - 1];
  }

  return chapters[0];
}

function getChapterIndexAtTime(chapters: Chapter[] | undefined, time: number) {
  if (!chapters?.length) {
    return -1;
  }

  for (let index = 0; index < chapters.length; index += 1) {
    const chapter = chapters[index];

    if (time >= chapter.start && time < chapter.end) {
      return index;
    }
  }

  if (time >= chapters[chapters.length - 1].start) {
    return chapters.length - 1;
  }

  return 0;
}

function getSubtitleCueAtTime(cues: SubtitleCue[], time: number) {
  for (const cue of cues) {
    if (time >= cue.start && time <= cue.end) {
      return cue;
    }
  }

  return null;
}

function clampVolume(value: number) {
  if (!Number.isFinite(value)) {
    return DEFAULT_PLAYER_PREFERENCES.volume;
  }

  return Math.min(Math.max(value, 0), 1);
}

function normalizePlaybackRate(value: number) {
  return [0.8, 1, 1.15, 1.25, 1.4, 1.5, 1.75, 2].includes(value) ? value : 1;
}

function normalizeFullscreenAutoHide(value: number): FullscreenAutoHide {
  return ([1500, 2500, 4000, 6000] as const).includes(value as FullscreenAutoHide)
    ? (value as FullscreenAutoHide)
    : FULLSCREEN_CONTROLS_IDLE_MS;
}

function parseStoredPreferences(rawValue: string | null): PlayerPreferences {
  if (!rawValue) {
    return DEFAULT_PLAYER_PREFERENCES;
  }

  try {
    const parsed = JSON.parse(rawValue) as Partial<PlayerPreferences>;

    return {
      playbackRate: normalizePlaybackRate(Number(parsed.playbackRate)),
      volume: clampVolume(Number(parsed.volume)),
      subtitleScale:
        parsed.subtitleScale === "standard" || parsed.subtitleScale === "large" || parsed.subtitleScale === "x-large"
          ? parsed.subtitleScale
          : DEFAULT_PLAYER_PREFERENCES.subtitleScale,
      subtitleLineHeight:
        parsed.subtitleLineHeight === "tight" ||
        parsed.subtitleLineHeight === "standard" ||
        parsed.subtitleLineHeight === "relaxed"
          ? parsed.subtitleLineHeight
          : DEFAULT_PLAYER_PREFERENCES.subtitleLineHeight,
      subtitlePosition:
        parsed.subtitlePosition === "center" ||
        parsed.subtitlePosition === "raised" ||
        parsed.subtitlePosition === "lower-third"
          ? parsed.subtitlePosition
          : DEFAULT_PLAYER_PREFERENCES.subtitlePosition,
      subtitleContrast:
        parsed.subtitleContrast === "solid" || parsed.subtitleContrast === "soft" || parsed.subtitleContrast === "glow"
          ? parsed.subtitleContrast
          : DEFAULT_PLAYER_PREFERENCES.subtitleContrast,
      subtitleTextColor:
        parsed.subtitleTextColor === "white" ||
        parsed.subtitleTextColor === "yellow" ||
        parsed.subtitleTextColor === "gold" ||
        parsed.subtitleTextColor === "orange" ||
        parsed.subtitleTextColor === "red" ||
        parsed.subtitleTextColor === "pink" ||
        parsed.subtitleTextColor === "blue" ||
        parsed.subtitleTextColor === "cyan" ||
        parsed.subtitleTextColor === "green" ||
        parsed.subtitleTextColor === "black"
          ? parsed.subtitleTextColor
          : DEFAULT_PLAYER_PREFERENCES.subtitleTextColor,
      subtitleBackground:
        parsed.subtitleBackground === "none" ||
        parsed.subtitleBackground === "black" ||
        parsed.subtitleBackground === "white" ||
        parsed.subtitleBackground === "dark-gray" ||
        parsed.subtitleBackground === "yellow" ||
        parsed.subtitleBackground === "gold" ||
        parsed.subtitleBackground === "red" ||
        parsed.subtitleBackground === "blue" ||
        parsed.subtitleBackground === "navy"
          ? parsed.subtitleBackground
          : DEFAULT_PLAYER_PREFERENCES.subtitleBackground,
      fullscreenAutoHideMs: normalizeFullscreenAutoHide(Number(parsed.fullscreenAutoHideMs)),
    };
  } catch {
    return DEFAULT_PLAYER_PREFERENCES;
  }
}

function balanceSubtitleText(text: string) {
  const trimmed = text.trim();

  if (!trimmed || trimmed.includes("\n")) {
    return trimmed;
  }

  const words = trimmed.split(/\s+/).filter(Boolean);

  if (words.length < 7 || trimmed.length < 42) {
    return trimmed;
  }

  const totalCharacters = words.reduce((sum, word) => sum + word.length, 0);
  const target = totalCharacters / 2;
  let bestIndex = -1;
  let running = 0;
  let bestDifference = Number.POSITIVE_INFINITY;

  for (let index = 0; index < words.length - 1; index += 1) {
    running += words[index].length;
    const difference = Math.abs(target - running);

    if (difference < bestDifference) {
      bestDifference = difference;
      bestIndex = index;
    }

    running += 1;
  }

  if (bestIndex <= 0) {
    return trimmed;
  }

  const firstLine = words.slice(0, bestIndex + 1).join(" ");
  const secondLine = words.slice(bestIndex + 1).join(" ");

  return secondLine ? `${firstLine}\n${secondLine}` : trimmed;
}

function formatTime(totalSeconds: number) {
  if (!Number.isFinite(totalSeconds)) {
    return "0:00";
  }

  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatChapterLabel(title: string | undefined) {
  if (!title) {
    return null;
  }

  const match = title.match(/(\d+)/);

  if (!match) {
    return title.trim() || null;
  }

  return `Chapter ${Number(match[1])}`;
}

function getChapterTitle(chapter: Chapter, index: number) {
  const trimmed = chapter.title.trim();
  return trimmed || `Chapter ${index + 1}`;
}

function useEventCallback<Args extends unknown[], ReturnValue>(
  callback: (...args: Args) => ReturnValue,
) {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  const stableCallbackRef = useRef((...args: Args) => callbackRef.current(...args));
  return stableCallbackRef.current;
}

export function PlayerPanel({
  item,
  onItemRefresh,
  focusMode = false,
  onHide = null,
  onInlineFullscreenChange = null,
  openToken = 0,
  preferenceScope = "anonymous",
  variant = "full",
}: PlayerPanelProps) {
  const panelRef = useRef<HTMLElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const subtitleUploadRef = useRef<HTMLInputElement | null>(null);
  const itemRef = useRef<LibraryItemExpanded | null>(item);
  const previousItemRef = useRef<LibraryItemExpanded | null>(null);
  const sessionRef = useRef<PlaybackSession | null>(null);
  const currentTimeRef = useRef(0);
  const completionReachedRef = useRef(false);
  const totalDurationRef = useRef(0);
  const tracksRef = useRef<AudioTrack[]>([]);
  const isPlayingRef = useRef(false);
  const playbackRateRef = useRef(1);
  const loadedTrackSignatureRef = useRef("");
  const pendingLocalTimeRef = useRef(0);
  const pendingAutoplayRef = useRef(false);
  const listenedSecondsRef = useRef(0);
  const listenWindowStartRef = useRef<number | null>(null);
  const trackRequestIdRef = useRef(0);
  const checkpointSequenceRef = useRef(0);
  const checkpointQueueRef = useRef<Promise<void>>(Promise.resolve());
  const failedCheckpointRef = useRef<{ itemId: string; sessionId: string; mode: "sync" | "close" } | null>(null);
  const saveFailuresRef = useRef(0);
  const lastSyncedTimeRef = useRef(0);
  const lastAutoRefreshTokenRef = useRef(0);
  const wakeLockRef = useRef<WakeLockSentinelLike | null>(null);
  const wakeLockReleaseListenerRef = useRef<EventListener | null>(null);
  const fullscreenFallbackStatusShownRef = useRef(false);
  const fullscreenControlsTimeoutRef = useRef<number | null>(null);
  const fullscreenCoverDragRef = useRef<{ pointerId: number; startX: number; startY: number; originX: number; originY: number } | null>(null);
  const fullscreenCoverPreferenceLoadedRef = useRef(false);
  const playerPreferencesDirtyRef = useRef(false);
  const subtitlePreferencesDirtyRef = useRef(false);

  const [session, setSession] = useState<PlaybackSession | null>(null);
  const [trackLoadRequest, setTrackLoadRequest] = useState<TrackLoadRequest | null>(null);
  const [currentTime, setCurrentTime] = useState(item?.userMediaProgress?.currentTime ?? 0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(DEFAULT_PLAYER_PREFERENCES.playbackRate);
  const [volume, setVolume] = useState(DEFAULT_PLAYER_PREFERENCES.volume);
  const [timeDisplayMode, setTimeDisplayMode] = useState<"elapsed" | "remaining">("elapsed");
  const [busyAction, setBusyAction] = useState<"starting" | "syncing" | "refreshing" | null>(null);
  const [playerStatus, setPlayerStatus] = useState<string | null>(null);
  const [playerError, setPlayerError] = useState<string | null>(null);
  const [progressSaveNotice, setProgressSaveNotice] = useState<{ state: "saving" | "saved" | "failed"; message: string; retryable: boolean } | null>(null);
  const [subtitleCues, setSubtitleCues] = useState<SubtitleCue[]>([]);
  const [subtitleSourceLabel, setSubtitleSourceLabel] = useState("No subtitle file loaded");
  const [subtitleStatus, setSubtitleStatus] = useState<string | null>(null);
  const [subtitleError, setSubtitleError] = useState<string | null>(null);
  const [subtitleOffset, setSubtitleOffset] = useState(0);
  const [selectedServerSubtitleId, setSelectedServerSubtitleId] = useState("");
  const [subtitlePreferenceItemId, setSubtitlePreferenceItemId] = useState<string | null>(null);
  const [hasPlaybackStarted, setHasPlaybackStarted] = useState(false);
  const [isBrowserFullscreen, setIsBrowserFullscreen] = useState(false);
  const [isInlineFullscreen, setIsInlineFullscreen] = useState(false);
  const [isOptionsOpen, setIsOptionsOpen] = useState(false);
  const [isChapterListOpen, setIsChapterListOpen] = useState(false);
  const [isFullscreenControlsVisible, setIsFullscreenControlsVisible] = useState(true);
  const [isSubtitleDisplayOptionsOpen, setIsSubtitleDisplayOptionsOpen] = useState(false);
  const [isShortcutHelpOpen, setIsShortcutHelpOpen] = useState(false);
  const [subtitleScale, setSubtitleScale] = useState<SubtitleScale>(DEFAULT_PLAYER_PREFERENCES.subtitleScale);
  const [subtitleLineHeight, setSubtitleLineHeight] = useState<SubtitleLineHeight>(
    DEFAULT_PLAYER_PREFERENCES.subtitleLineHeight,
  );
  const [subtitlePosition, setSubtitlePosition] = useState<SubtitlePosition>(
    DEFAULT_PLAYER_PREFERENCES.subtitlePosition,
  );
  const [subtitleContrast, setSubtitleContrast] = useState<SubtitleContrast>(
    DEFAULT_PLAYER_PREFERENCES.subtitleContrast,
  );
  const [subtitleTextColor, setSubtitleTextColor] = useState<SubtitleTextColor>(
    DEFAULT_PLAYER_PREFERENCES.subtitleTextColor,
  );
  const [subtitleBackground, setSubtitleBackground] = useState<SubtitleBackground>(
    DEFAULT_PLAYER_PREFERENCES.subtitleBackground,
  );
  const [fullscreenAutoHideMs, setFullscreenAutoHideMs] = useState<FullscreenAutoHide>(
    DEFAULT_PLAYER_PREFERENCES.fullscreenAutoHideMs,
  );
  const [fullscreenCover, setFullscreenCover] = useState<FullscreenCoverPreference>(DEFAULT_FULLSCREEN_COVER_PREFERENCE);
  const [isFullscreenCoverEditing, setIsFullscreenCoverEditing] = useState(false);
  const [isFullscreenAppearanceOpen, setIsFullscreenAppearanceOpen] = useState(false);
  const [isTransportCollapsed, setIsTransportCollapsed] = useState(false);
  const [activeLayoutPreset, setActiveLayoutPreset] = useState<"enhanced" | "cinema" | "minimal" | "custom">("enhanced");
  const [fullscreenAppearanceTab, setFullscreenAppearanceTab] = useState<"cover" | "background" | "visualizer" | "subtitles">("cover");
  const [fullscreenAppearancePosition, setFullscreenAppearancePosition] = useState({ x: 59, y: 2 });
  const fullscreenAppearanceDragRef = useRef<{ pointerId: number; startX: number; startY: number; originX: number; originY: number } | null>(null);
  const visualizerDragRef = useRef<{ pointerId: number; startX: number; startY: number; originX: number; originY: number } | null>(null);
  const fullscreenVisualServerLoadedRef = useRef(false);
  const fullscreenVisualMapRef = useRef<Record<string, FullscreenCoverPreference>>({});
  const fullscreenVisualSaveTimerRef = useRef<number | null>(null);
  const fullscreenVisualSavePromiseRef = useRef(Promise.resolve());
  const visualizerCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const mediaSourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const visualizerFrameRef = useRef<number | null>(null);
  const [bookmarks, setBookmarks] = useState<PlayerBookmark[]>([]);
  const [isBookmarksOpen, setIsBookmarksOpen] = useState(false);
  const [hasLoadedPreferences, setHasLoadedPreferences] = useState(false);
  const [subtitlePreferencesRevision, setSubtitlePreferencesRevision] = useState(0);
  const [hasLoadedSubtitlePreferences, setHasLoadedSubtitlePreferences] = useState(false);


  const serverSubtitleFiles = useMemo(() => listSubtitleFiles(item), [item]);
  const chapters = item?.media.chapters ?? [];
  const tracks = useMemo(
    () => (session?.audioTracks?.length ? session.audioTracks : item?.media.tracks ?? []),
    [item, session],
  );
  const totalDuration = useMemo(() => resolveTimelineDuration(item, tracks), [item, tracks]);
  const activeTrack = useMemo(() => getTrackAtTime(tracks, currentTime), [tracks, currentTime]);
  const activeChapter = useMemo(
    () => getChapterAtTime(item?.media.chapters, currentTime),
    [item?.media.chapters, currentTime],
  );
  const sleepTimer = useSleepTimer(item?.id, currentTime, activeChapter?.end, () => {
    audioRef.current?.pause();
    setIsPlaying(false);
    setPlayerStatus("Sleep timer finished. Playback paused.");
  });
  const activeSubtitle = useMemo(
    () => getSubtitleCueAtTime(subtitleCues, currentTime + subtitleOffset),
    [currentTime, subtitleCues, subtitleOffset],
  );
  const activeSubtitleText = useMemo(
    () => balanceSubtitleText(activeSubtitle?.text ?? ""),
    [activeSubtitle?.text],
  );
  const activeChapterIndex = useMemo(
    () => getChapterIndexAtTime(chapters, currentTime),
    [chapters, currentTime],
  );
  const progressValue = totalDuration > 0 ? Math.min(currentTime / totalDuration, 1) : 0;
  const isDock = variant === "dock";
  const hasActiveSession = Boolean(session?.id);
  const hasLoadedSubtitles = subtitleCues.length > 0;
  const isFullscreen = isBrowserFullscreen || isInlineFullscreen;

  useEffect(() => {
    if (!isFullscreen || !isFullscreenAppearanceOpen) return;
    const clampMenuToViewport = () => {
      const stage = panelRef.current?.getBoundingClientRect();
      const menu = panelRef.current?.querySelector<HTMLElement>(".fullscreen-appearance-panel")?.getBoundingClientRect();
      if (!stage || !menu) return;
      const menuWidthPct = (menu.width / Math.max(stage.width, 1)) * 100;
      const menuHeightPct = (menu.height / Math.max(stage.height, 1)) * 100;
      setFullscreenAppearancePosition((current) => ({
        x: Math.min(100 - menuWidthPct - 1, Math.max(1, current.x)),
        y: Math.min(100 - menuHeightPct - 1, Math.max(1, current.y)),
      }));
    };
    const frame = window.requestAnimationFrame(clampMenuToViewport);
    window.addEventListener("resize", clampMenuToViewport);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", clampMenuToViewport);
    };
  }, [isFullscreen, isFullscreenAppearanceOpen]);
  const shouldShowLyricsStage = !isDock || focusMode || isFullscreen || hasPlaybackStarted;
  const fullscreenStageStyle = useMemo(() => ({
    backgroundColor: FULLSCREEN_BACKGROUND_COLORS[fullscreenCover.backgroundColor],
  }), [fullscreenCover.backgroundColor]);
  const shouldShowLoadedSubtitlePrompt = hasLoadedSubtitles && !hasPlaybackStarted;
  const shouldKeepScreenAwake = isPlaying;
  const shouldShowFullscreenControls =
    !isFullscreen ||
    isFullscreenControlsVisible ||
    !isPlaying ||
    isChapterListOpen ||
    isSubtitleDisplayOptionsOpen ||
    isFullscreenAppearanceOpen ||
    isTransportCollapsed;
  const chapterLabel = useMemo(() => formatChapterLabel(activeChapter?.title), [activeChapter?.title]);
  const hasPreviousChapter = activeChapterIndex > 0;
  const hasNextChapter = activeChapterIndex >= 0 && activeChapterIndex < chapters.length - 1;
  const subtitleStageStyle = useMemo(
    () =>
      ({
        "--subtitle-font-scale":
          subtitleScale === "standard" ? "1" : subtitleScale === "large" ? "1.18" : "1.34",
        "--subtitle-line-height":
          subtitleLineHeight === "tight" ? "1.18" : subtitleLineHeight === "standard" ? "1.28" : "1.42",
      }) as CSSProperties,
    [subtitleLineHeight, subtitleScale],
  );

  useEffect(() => {
    itemRef.current = item;
  }, [item]);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    currentTimeRef.current = currentTime;
  }, [currentTime]);

  useEffect(() => {
    totalDurationRef.current = totalDuration;
  }, [totalDuration]);

  useEffect(() => {
    tracksRef.current = tracks;
  }, [tracks]);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    playbackRateRef.current = playbackRate;
  }, [playbackRate]);

  useEffect(() => {
    const savedMode = window.localStorage.getItem(scopedPlayerStorageKey(TIME_DISPLAY_MODE_STORAGE_KEY, preferenceScope));
    setTimeDisplayMode(savedMode === "remaining" ? "remaining" : "elapsed");
  }, [preferenceScope]);

  useEffect(() => {
    if (!item?.id) {
      setBookmarks([]);
      setIsBookmarksOpen(false);
      setIsFullscreenCoverEditing(false);
      return;
    }

    setBookmarks(readBookmarks(preferenceScope, item.id));
    setIsBookmarksOpen(false);
    fullscreenCoverPreferenceLoadedRef.current = false;
    const storedAppearance = readFullscreenCoverPreference(preferenceScope, item.id);
    setFullscreenCover(storedAppearance);
    setIsTransportCollapsed(false);
    setActiveLayoutPreset(storedAppearance.useSharedDefault ? "enhanced" : "custom");
    setSubtitleScale(storedAppearance.subtitleScale);
    setSubtitleLineHeight(storedAppearance.subtitleLineHeight);
    setSubtitlePosition(storedAppearance.subtitlePosition);
    setSubtitleContrast(storedAppearance.subtitleContrast);
    setSubtitleTextColor(storedAppearance.subtitleTextColor);
    setSubtitleBackground(storedAppearance.subtitleBackground);
    fullscreenCoverPreferenceLoadedRef.current = true;
  }, [item?.id, preferenceScope]);

  useEffect(() => {
    if (!fullscreenCover.useSharedDefault && item?.id) {
      const generation = readSharedFullscreenAppearance(preferenceScope).appearanceGeneration;
      if (fullscreenCover.customizedAtGeneration !== generation) {
        setFullscreenCover((current) => ({ ...current, customizedAtGeneration: generation }));
      }
    }
  }, [fullscreenCover.customizedAtGeneration, fullscreenCover.useSharedDefault, item?.id, preferenceScope]);

  useEffect(() => {
    if (!fullscreenCoverPreferenceLoadedRef.current || !item?.id) return;
    const appearance: FullscreenCoverPreference = {
      ...fullscreenCover,
      subtitleScale,
      subtitleLineHeight,
      subtitlePosition,
      subtitleContrast,
      subtitleTextColor,
      subtitleBackground,
    };
    writeFullscreenCoverPreference(preferenceScope, item.id, appearance);
    if (!fullscreenVisualServerLoadedRef.current) return;
    fullscreenVisualMapRef.current[item.id] = appearance;
    fullscreenVisualMapRef.current[FULLSCREEN_VISUAL_GLOBAL_ID] = readSharedFullscreenAppearance(preferenceScope);
    if (fullscreenVisualSaveTimerRef.current !== null) window.clearTimeout(fullscreenVisualSaveTimerRef.current);
    fullscreenVisualSaveTimerRef.current = window.setTimeout(() => {
      fullscreenVisualSaveTimerRef.current = null;
      const payload = JSON.parse(JSON.stringify(fullscreenVisualMapRef.current));
      fullscreenVisualSavePromiseRef.current = fullscreenVisualSavePromiseRef.current
        .catch(() => undefined)
        .then(async () => {
          try {
            const response = await fetch("/api/preferences/fullscreen-visuals", {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ value: payload }),
            });
            if (!response.ok) throw new Error("Unable to sync fullscreen visual preferences.");
          } catch { /* Local settings remain available when account sync is unavailable. */ }
        });
    }, 500);
  }, [fullscreenCover, item?.id, preferenceScope, subtitleBackground, subtitleContrast, subtitleLineHeight, subtitlePosition, subtitleScale, subtitleTextColor]);

  useEffect(() => {
    fullscreenVisualServerLoadedRef.current = false;
    fullscreenVisualMapRef.current = {};
    if (!preferenceScope) return;
    void (async () => {
      try {
        const response = await fetch("/api/preferences/fullscreen-visuals", { cache: "no-store" });
        if (response.ok) {
          const payload = (await response.json()) as { value?: unknown };
          if (payload.value && typeof payload.value === "object" && !Array.isArray(payload.value)) {
            for (const [key, raw] of Object.entries(payload.value as Record<string, unknown>)) {
              if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
              const parsed = parseFullscreenCoverPreferenceValue(raw, key === FULLSCREEN_VISUAL_GLOBAL_ID ? DEFAULT_ENHANCED_FULLSCREEN_COVER_PREFERENCE : readSharedFullscreenAppearance(preferenceScope));
              fullscreenVisualMapRef.current[key] = parsed;
              if (key === FULLSCREEN_VISUAL_GLOBAL_ID) {
                window.localStorage.setItem(sharedFullscreenStorageKey(preferenceScope), JSON.stringify(parsed));
              } else {
                window.localStorage.setItem(scopedPlayerStorageKey(FULLSCREEN_COVER_STORAGE_KEY, `${preferenceScope}:${key}`), JSON.stringify(parsed));
              }
            }
          }
        }
      } catch {
        // Local preferences remain usable if account preference retrieval fails.
      } finally {
        fullscreenVisualServerLoadedRef.current = true;
        if (item?.id) {
          const storedAppearance = readFullscreenCoverPreference(preferenceScope, item.id);
          setFullscreenCover(storedAppearance);
          setSubtitleScale(storedAppearance.subtitleScale);
          setSubtitleLineHeight(storedAppearance.subtitleLineHeight);
          setSubtitlePosition(storedAppearance.subtitlePosition);
          setSubtitleContrast(storedAppearance.subtitleContrast);
          setSubtitleTextColor(storedAppearance.subtitleTextColor);
          setSubtitleBackground(storedAppearance.subtitleBackground);
        }
      }
    })();
  }, [item?.id, preferenceScope]);

  useEffect(() => {
    const AudioContextCtor = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    const audio = audioRef.current;
    if (!AudioContextCtor || !audio || mediaSourceRef.current) return;
    try {
      const context = new AudioContextCtor();
      const analyser = context.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.72;
      const source = context.createMediaElementSource(audio);
      source.connect(analyser);
      analyser.connect(context.destination);
      audioContextRef.current = context;
      analyserRef.current = analyser;
      mediaSourceRef.current = source;
    } catch {
      // Visualizer enhancement is optional; normal playback must continue if Web Audio is unavailable.
    }
    return () => {
      if (visualizerFrameRef.current !== null) cancelAnimationFrame(visualizerFrameRef.current);
      visualizerFrameRef.current = null;
      analyserRef.current = null;
      mediaSourceRef.current = null;
      const context = audioContextRef.current;
      audioContextRef.current = null;
      if (context) void context.close().catch(() => undefined);
    };
  }, []);

  useEffect(() => {
    const canvas = visualizerCanvasRef.current;
    const analyser = analyserRef.current;
    if (!canvas || !analyser || !isFullscreen || !fullscreenCover.visualizerEnabled || fullscreenCover.visualizerStyle === "off") {
      if (visualizerFrameRef.current !== null) cancelAnimationFrame(visualizerFrameRef.current);
      visualizerFrameRef.current = null;
      return;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const frequency = new Uint8Array(analyser.frequencyBinCount);
    const time = new Uint8Array(analyser.fftSize);
    const draw = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.max(window.devicePixelRatio || 1, 1);
      const width = Math.max(1, Math.floor(rect.width * dpr));
      const height = Math.max(1, Math.floor(rect.height * dpr));
      if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
      ctx.clearRect(0, 0, width, height);
      analyser.smoothingTimeConstant = fullscreenCover.visualizerSmoothing;
      analyser.getByteFrequencyData(frequency);
      analyser.getByteTimeDomainData(time);
      const color = FULLSCREEN_BACKGROUND_COLORS[fullscreenCover.visualizerColor];
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = Math.max(1.5, 2.5 * dpr);
      ctx.shadowColor = color;
      ctx.shadowBlur = fullscreenCover.visualizerGlow * dpr;
      const sens = fullscreenCover.visualizerSensitivity;
      const sx = width * (0.5 + fullscreenCover.visualizerX / 100);
      const sy = height * (0.5 + fullscreenCover.visualizerY / 100);
      const vw = Math.min(width * 0.8, width * fullscreenCover.visualizerScale);
      const base = sy;
      if (fullscreenCover.visualizerStyle === "bars" || fullscreenCover.visualizerStyle === "wave-bars") {
        const count = 56;
        const barWidth = vw / count;
        for (let i = 0; i < count; i += 1) {
          const value = Math.min(1, (frequency[Math.floor(i * frequency.length / count)] / 255) * sens);
          const barHeight = Math.max(2 * dpr, value * height * 0.28);
          ctx.fillRect(sx - vw / 2 + i * barWidth, base - barHeight, Math.max(1, barWidth - 2 * dpr), barHeight);
        }
      }
      if (fullscreenCover.visualizerStyle === "waveform" || fullscreenCover.visualizerStyle === "wave-bars") {
        ctx.beginPath();
        const waveW = vw;
        for (let i = 0; i < time.length; i += 4) {
          const x = sx - waveW / 2 + (i / (time.length - 1)) * waveW;
          const y = sy + (time[i] - 128) / 128 * height * 0.16 * sens;
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      if (fullscreenCover.visualizerStyle === "pulse") {
        let sum = 0;
        for (let i = 0; i < frequency.length; i += 8) sum += frequency[i];
        const avg = (sum / Math.max(1, Math.ceil(frequency.length / 8))) / 255;
        const radius = Math.min(width, height) * (0.08 + Math.min(0.12, avg * 0.18 * sens));
        ctx.beginPath();
        ctx.arc(sx, sy, radius, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.shadowBlur = 0;
      visualizerFrameRef.current = requestAnimationFrame(draw);
    };
    visualizerFrameRef.current = requestAnimationFrame(draw);
    return () => { if (visualizerFrameRef.current !== null) cancelAnimationFrame(visualizerFrameRef.current); visualizerFrameRef.current = null; };
  }, [fullscreenCover, isFullscreen]);

  useEffect(() => {
    setHasLoadedPreferences(false);
    const storedPreferences = parseStoredPreferences(
      window.localStorage.getItem(scopedPlayerStorageKey(PLAYER_PREFERENCES_STORAGE_KEY, preferenceScope)),
    );

    setPlaybackRate(storedPreferences.playbackRate);
    setVolume(storedPreferences.volume);
    setSubtitleScale(storedPreferences.subtitleScale);
    setSubtitleLineHeight(storedPreferences.subtitleLineHeight);
    setSubtitlePosition(storedPreferences.subtitlePosition);
    setSubtitleContrast(storedPreferences.subtitleContrast);
    setSubtitleTextColor(storedPreferences.subtitleTextColor);
    setSubtitleBackground(storedPreferences.subtitleBackground);
    setFullscreenAutoHideMs(storedPreferences.fullscreenAutoHideMs);
    const loadServerPreferences = async () => {
      try {
        const response = await fetch("/api/preferences/player", { cache: "no-store" });
        if (response.ok) {
          const payload = (await response.json()) as { value?: unknown };
          if (payload.value) {
            const serverPreferences = parseStoredPreferences(JSON.stringify(payload.value));
            setPlaybackRate(serverPreferences.playbackRate);
            setVolume(serverPreferences.volume);
            setSubtitleScale(serverPreferences.subtitleScale);
            setSubtitleLineHeight(serverPreferences.subtitleLineHeight);
            setSubtitlePosition(serverPreferences.subtitlePosition);
            setSubtitleContrast(serverPreferences.subtitleContrast);
            setSubtitleTextColor(serverPreferences.subtitleTextColor);
            setSubtitleBackground(serverPreferences.subtitleBackground);
            setFullscreenAutoHideMs(serverPreferences.fullscreenAutoHideMs);
          }
        }
      } finally {
        setHasLoadedPreferences(true);
      }
    };
    void loadServerPreferences();
  }, [preferenceScope]);

  useEffect(() => {
    setHasLoadedSubtitlePreferences(false);
    const loadServerSubtitlePreferences = async () => {
      try {
        const response = await fetch("/api/preferences/subtitles", { cache: "no-store" });
        if (response.ok) {
          const payload = (await response.json()) as { value?: unknown };
          if (payload.value && typeof payload.value === "object" && !Array.isArray(payload.value)) {
            const merged = { ...readAllBookSubtitlePreferences(preferenceScope), ...(payload.value as object) };
            window.localStorage.setItem(scopedPlayerStorageKey(BOOK_SUBTITLE_PREFERENCES_STORAGE_KEY, preferenceScope), JSON.stringify(merged));
            setSubtitlePreferencesRevision((value) => value + 1);
          }
        }
      } finally {
        setHasLoadedSubtitlePreferences(true);
      }
    };
    void loadServerSubtitlePreferences();
  }, [preferenceScope]);

  useEffect(() => {
    window.localStorage.setItem(scopedPlayerStorageKey(TIME_DISPLAY_MODE_STORAGE_KEY, preferenceScope), timeDisplayMode);
  }, [preferenceScope, timeDisplayMode]);

  useEffect(() => {
    if (!hasLoadedPreferences) {
      return;
    }

    const preferences = {
      playbackRate,
      volume,
      subtitleScale,
      subtitleLineHeight,
      subtitlePosition,
      subtitleContrast,
      subtitleTextColor,
      subtitleBackground,
      fullscreenAutoHideMs,
    } satisfies PlayerPreferences;
    window.localStorage.setItem(
      scopedPlayerStorageKey(PLAYER_PREFERENCES_STORAGE_KEY, preferenceScope),
      JSON.stringify(preferences),
    );
    playerPreferencesDirtyRef.current = true;
    const timeout = window.setTimeout(() => {
      void fetch("/api/preferences/player", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: preferences }),
      }).then((response) => {
        if (response.ok) playerPreferencesDirtyRef.current = false;
      }).catch(() => {
        playerPreferencesDirtyRef.current = true;
      });
    }, 500);
    return () => window.clearTimeout(timeout);
  }, [
    fullscreenAutoHideMs,
    hasLoadedPreferences,
    playbackRate,
    preferenceScope,
    subtitleContrast,
    subtitleLineHeight,
    subtitlePosition,
    subtitleScale,
    subtitleTextColor,
    subtitleBackground,
    volume,
  ]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      const fullscreenDocument = document as FullscreenDocument;
      const fullscreenElement = document.fullscreenElement ?? fullscreenDocument.webkitFullscreenElement ?? null;
      setIsBrowserFullscreen(fullscreenElement === panelRef.current);
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    document.addEventListener("webkitfullscreenchange", handleFullscreenChange as EventListener);

    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
      document.removeEventListener("webkitfullscreenchange", handleFullscreenChange as EventListener);
    };
  }, []);

  useEffect(() => {
    if (!isInlineFullscreen) {
      return;
    }

    const previousBodyOverflow = document.body.style.overflow;
    const previousRootOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousRootOverflow;
    };
  }, [isInlineFullscreen]);

  useEffect(() => {
    onInlineFullscreenChange?.(isInlineFullscreen);

    return () => {
      onInlineFullscreenChange?.(false);
    };
  }, [isInlineFullscreen, onInlineFullscreenChange]);

  useEffect(() => {
    setIsChapterListOpen(false);
  }, [item?.id]);

  useEffect(() => {
    setIsSubtitleDisplayOptionsOpen(false);
  }, [item?.id]);

  useEffect(() => {
    if (!chapters.length) {
      setIsChapterListOpen(false);
    }
  }, [chapters.length]);

  useEffect(() => {
    if (!playerStatus) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setPlayerStatus((current) => (current === playerStatus ? null : current));
    }, STATUS_MESSAGE_DURATION_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [playerStatus]);

  useEffect(() => {
    if (!subtitleStatus) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setSubtitleStatus((current) => (current === subtitleStatus ? null : current));
    }, STATUS_MESSAGE_DURATION_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [subtitleStatus]);

  const pauseListeningClock = useEventCallback(() => {
    if (listenWindowStartRef.current !== null) {
      listenedSecondsRef.current += (performance.now() - listenWindowStartRef.current) / 1000;
      listenWindowStartRef.current = null;
    }
  });

  const resumeListeningClock = useEventCallback(() => {
    if (listenWindowStartRef.current === null) {
      listenWindowStartRef.current = performance.now();
    }
  });

  const snapshotListeningSeconds = useEventCallback(() => {
    let seconds = listenedSecondsRef.current;

    if (listenWindowStartRef.current !== null) {
      seconds += (performance.now() - listenWindowStartRef.current) / 1000;
    }

    return Math.max(0, seconds);
  });

  const resetListeningClock = useEventCallback(() => {
    listenedSecondsRef.current = 0;
    listenWindowStartRef.current = isPlayingRef.current ? performance.now() : null;
  });

  const clearFullscreenControlsTimer = useEventCallback(() => {
    if (fullscreenControlsTimeoutRef.current !== null) {
      window.clearTimeout(fullscreenControlsTimeoutRef.current);
      fullscreenControlsTimeoutRef.current = null;
    }
  });

  const hideFullscreenControls = useEventCallback(() => {
    if (!isFullscreen || !isPlaying || isChapterListOpen) {
      return;
    }

    clearFullscreenControlsTimer();
    setIsFullscreenControlsVisible(false);
  });

  const revealFullscreenControls = useEventCallback((keepVisible = false) => {
    if (!isFullscreen) {
      return;
    }

    setIsFullscreenControlsVisible(true);
    clearFullscreenControlsTimer();

    if (keepVisible || !isPlaying || isChapterListOpen) {
      return;
    }

    fullscreenControlsTimeoutRef.current = window.setTimeout(() => {
      setIsFullscreenControlsVisible(false);
      fullscreenControlsTimeoutRef.current = null;
    }, fullscreenAutoHideMs);
  });

  useEffect(() => {
    if (!isFullscreen) {
      setIsFullscreenControlsVisible(true);
      clearFullscreenControlsTimer();
      return;
    }

    revealFullscreenControls();

    return () => {
      clearFullscreenControlsTimer();
    };
  }, [clearFullscreenControlsTimer, isChapterListOpen, isFullscreen, isPlaying, revealFullscreenControls]);

  const exitFullscreenSafely = useEventCallback(async (target?: Element | null) => {
    const activeTarget = target ?? panelRef.current;
    const fullscreenDocument = document as FullscreenDocument;
    const fullscreenElement = document.fullscreenElement ?? fullscreenDocument.webkitFullscreenElement ?? null;

    if (isInlineFullscreen && activeTarget === panelRef.current) {
      setIsInlineFullscreen(false);
      return;
    }

    if (
      !activeTarget ||
      fullscreenElement !== activeTarget ||
      document.visibilityState !== "visible" ||
      !document.hasFocus() ||
      (typeof document.exitFullscreen !== "function" &&
        typeof fullscreenDocument.webkitExitFullscreen !== "function")
    ) {
      return;
    }

    try {
      if (typeof document.exitFullscreen === "function") {
        await document.exitFullscreen();
        return;
      }

      if (typeof fullscreenDocument.webkitExitFullscreen === "function") {
        await fullscreenDocument.webkitExitFullscreen.call(document);
      }
    } catch {
      // Ignore browser timing issues if the document is no longer active.
    }
  });

  const clearWakeLockReference = useEventCallback(() => {
    const sentinel = wakeLockRef.current;
    const listener = wakeLockReleaseListenerRef.current;

    if (sentinel && listener && typeof sentinel.removeEventListener === "function") {
      sentinel.removeEventListener("release", listener);
    }

    wakeLockRef.current = null;
    wakeLockReleaseListenerRef.current = null;
  });

  const releaseWakeLock = useEventCallback(async () => {
    const sentinel = wakeLockRef.current;

    if (!sentinel) {
      return;
    }

    clearWakeLockReference();

    try {
      await sentinel.release();
    } catch {
      // Ignore wake lock teardown errors during tab switches and unload.
    }
  });

  const requestWakeLock = useEventCallback(async () => {
    if (typeof document === "undefined" || typeof navigator === "undefined") {
      return false;
    }

    if (document.visibilityState !== "visible") {
      return false;
    }

    const activeWakeLock = wakeLockRef.current;

    if (activeWakeLock && !activeWakeLock.released) {
      return true;
    }

    clearWakeLockReference();

    const wakeLockNavigator = navigator as NavigatorWithWakeLock;

    if (typeof wakeLockNavigator.wakeLock?.request !== "function") {
      return false;
    }

    try {
      const sentinel = await wakeLockNavigator.wakeLock.request("screen");
      const handleRelease: EventListener = () => {
        if (wakeLockRef.current === sentinel) {
          wakeLockRef.current = null;
          wakeLockReleaseListenerRef.current = null;
        }
      };

      sentinel.addEventListener?.("release", handleRelease);
      wakeLockRef.current = sentinel;
      wakeLockReleaseListenerRef.current = handleRelease;
      return true;
    } catch {
      return false;
    }
  });

  useEffect(() => {
    if (!shouldKeepScreenAwake) {
      void releaseWakeLock();
      return;
    }

    void requestWakeLock();
  }, [releaseWakeLock, requestWakeLock, shouldKeepScreenAwake]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        if (shouldKeepScreenAwake) {
          void requestWakeLock();
        }

        return;
      }

      void releaseWakeLock();
    };

    const handlePageHide = () => {
      void releaseWakeLock();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pagehide", handlePageHide);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pagehide", handlePageHide);
    };
  }, [releaseWakeLock, requestWakeLock, shouldKeepScreenAwake]);

  const clearAudio = useEventCallback(() => {
    const audio = audioRef.current;

    if (!audio) {
      return;
    }

    pendingAutoplayRef.current = false;
    pendingLocalTimeRef.current = 0;
    loadedTrackSignatureRef.current = "";
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
  });

  const updatePlayhead = useEventCallback((time: number) => {
    const clamped = clampTime(time, totalDurationRef.current);
    currentTimeRef.current = clamped;
    setCurrentTime(clamped);
  });

  const safePlay = useEventCallback(async (audio: HTMLAudioElement) => {
    try {
      await audio.play();
      setPlayerError(null);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to begin playback.";
      const normalized = message.toLowerCase();
      const isInterrupted = PLAY_INTERRUPTED_PATTERNS.some((pattern) => normalized.includes(pattern));

      if (!isInterrupted) {
        setPlayerError(message);
      }

      return false;
    }
  });

  const queueTrackLoad = useEventCallback(
    (time: number, autoplay: boolean, providedTracks?: AudioTrack[]) => {
      const trackList = providedTracks?.length ? providedTracks : tracksRef.current;
      const resolvedDuration = resolveTimelineDuration(itemRef.current, trackList) || totalDurationRef.current;
      const nextTime = clampTime(time, resolvedDuration);

      updatePlayhead(nextTime);

      if (!trackList.length) {
        setPlayerError("This Audiobookshelf item does not expose playable audio tracks.");
        setIsPlaying(false);
        pauseListeningClock();
        return;
      }

      const nextTrack = getTrackAtTime(trackList, nextTime);

      if (!nextTrack) {
        return;
      }

      const signature = getTrackSignature(nextTrack);
      const desiredLocalTime = clampTime(
        nextTime - nextTrack.startOffset,
        Math.max(nextTrack.duration - 0.05, 0),
      );
      const audio = audioRef.current;

      pendingAutoplayRef.current = autoplay;
      pendingLocalTimeRef.current = desiredLocalTime;

      if (audio && audio.src && loadedTrackSignatureRef.current === signature) {
        if (Math.abs(audio.currentTime - desiredLocalTime) > 0.25) {
          audio.currentTime = desiredLocalTime;
        }

        audio.playbackRate = playbackRateRef.current;

        if (autoplay) {
          void safePlay(audio);
        } else {
          audio.pause();
          setIsPlaying(false);
          pauseListeningClock();
        }

        return;
      }

      trackRequestIdRef.current += 1;
      setTrackLoadRequest({
        requestId: trackRequestIdRef.current,
        autoplay,
        time: nextTime,
        track: nextTrack,
      });
    },
  );

  const syncToAudiobookshelf = useEventCallback(
    async (
      mode: "sync" | "close",
      options?: {
        refreshItem?: boolean;
        silent?: boolean;
        targetItem?: LibraryItemExpanded | null;
        targetSession?: PlaybackSession | null;
      },
    ) => {
      const targetItem = options?.targetItem ?? itemRef.current;
      const targetSession = options?.targetSession ?? sessionRef.current;

      if (!targetItem || !targetSession?.id) {
        return false;
      }

      const capturedTime = currentTimeRef.current;
      const capturedListeningSeconds = snapshotListeningSeconds();
      const capturedCompletion = completionReachedRef.current;

      const previousCheckpoint = checkpointQueueRef.current;
      let releaseCheckpoint: () => void = () => {};
      checkpointQueueRef.current = new Promise<void>((resolve) => {
        releaseCheckpoint = resolve;
      });
      await previousCheckpoint;
      const isCurrent = () => targetItem.id === itemRef.current?.id && targetSession.id === sessionRef.current?.id;

      const duration = Math.max(
        resolveTimelineDuration(
          targetItem,
          targetSession?.audioTracks?.length ? targetSession.audioTracks : targetItem.media.tracks ?? [],
        ),
        1,
      );
      const now = Date.now();
      const nextTime = clampTime(isCurrent() ? currentTimeRef.current : capturedTime, duration);
      const timeListened = isCurrent() ? snapshotListeningSeconds() : capturedListeningSeconds;
      const isFinished = playbackFinished(nextTime, duration, isCurrent() ? completionReachedRef.current : capturedCompletion, Boolean(targetItem.userMediaProgress?.isFinished));

      if (!options?.silent) {
        setBusyAction("syncing");
        setPlayerError(null);
        setPlayerStatus(mode === "close" ? "Saving progress..." : "Syncing to Audiobookshelf...");
      }

      if (isCurrent()) setProgressSaveNotice({ state: "saving", message: "Saving progress…", retryable: false });
      let failureStatus: number | undefined;
      try {
        const checkpointSequence = checkpointSequenceRef.current + 1;
        const sessionResponse = await fetch(`/api/session/${targetSession.id}/checkpoint`, {
          method: "POST",
          keepalive: mode === "close",
          signal: AbortSignal.timeout(15000),
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            sequence: checkpointSequence,
            action: mode,
            currentTime: nextTime,
            timeListened,
            duration,
            progress: {
              itemId: targetItem.id,
              progress: isFinished ? 1 : duration > 0 ? nextTime / duration : 0,
              isFinished,
              finishedAt: isFinished ? now : null,
              startedAt: targetItem.userMediaProgress?.startedAt ?? targetSession?.startedAt ?? now,
            },
          }),
        });
        if (!sessionResponse.ok) failureStatus = sessionResponse.status;
        const sessionPayload = (await sessionResponse.json()) as {
          ok?: boolean;
          error?: string;
          session?: PlaybackSession | null;
        };

        if (!sessionResponse.ok) {
          failureStatus = sessionResponse.status;
          throw new Error(sessionPayload.error ?? "Unable to sync the Audiobookshelf session.");
        }

        checkpointSequenceRef.current = checkpointSequence;
        if (isCurrent()) {
          failedCheckpointRef.current = null;
          saveFailuresRef.current = 0;
          setProgressSaveNotice({ state: "saved", message: "Progress saved to Audiobookshelf.", retryable: false });
        }

        if (sessionPayload.session?.id && isCurrent()) {
          setSession(sessionPayload.session);
          sessionRef.current = sessionPayload.session;
        }

        if (isCurrent()) { resetListeningClock(); lastSyncedTimeRef.current = nextTime; }
        publishProgress(targetItem.id, { duration, currentTime: nextTime, progress: isFinished ? 1 : nextTime / duration, isFinished, startedAt: targetItem.userMediaProgress?.startedAt || targetSession.startedAt || now, finishedAt: isFinished ? now : null, lastUpdate: now });

        if (mode === "close" && isCurrent()) {
          setSession(null);
          sessionRef.current = null;
        }

        if (options?.refreshItem) {
          try { await onItemRefresh(targetItem.id); } catch { /* A refresh failure is not a failed save. */ }
        }

        if (!options?.silent) {
          setPlayerStatus(
            mode === "close"
              ? "Playback progress saved to Audiobookshelf."
              : "Synced with Audiobookshelf.",
          );
        }

        return true;
      } catch (error) {
        if (isCurrent()) {
          const failure = progressSaveFailure(failureStatus);
          failedCheckpointRef.current = { itemId: targetItem.id, sessionId: targetSession.id, mode };
          saveFailuresRef.current++;
          setProgressSaveNotice({ state: "failed", ...failure });
        }
        return false;
      } finally {
        releaseCheckpoint();
        if (!options?.silent) {
          setBusyAction(null);
        }
      }
    },
  );

  const startPlayback = useEventCallback(async (restartSession = false) => {
    const activeItem = itemRef.current;

    if (!activeItem) {
      return;
    }

    setBusyAction("starting");
    setPlayerError(null);
    setPlayerStatus(restartSession ? "Restarting synced playback..." : "Starting synced playback...");

    try {
      if (restartSession && sessionRef.current) {
        await syncToAudiobookshelf("close", {
          silent: true,
          targetItem: activeItem,
          targetSession: sessionRef.current,
        });
      }

      const response = await fetch(`/api/items/${activeItem.id}/play`, {
        method: "POST",
      });
      const payload = (await response.json()) as PlaybackSession | { error?: string };

      if (!response.ok || !("id" in payload)) {
        throw new Error(
          "error" in payload
            ? payload.error ?? "Unable to start synced playback."
            : "Unable to start synced playback.",
        );
      }

      setSession(payload);
      sessionRef.current = payload;
      setHasPlaybackStarted(true);
      setPlayerStatus("Playback session started.");
      resetListeningClock();

      const preferredStartTime = currentTimeRef.current > 0 ? currentTimeRef.current : payload.currentTime;
      queueTrackLoad(preferredStartTime, true, payload.audioTracks);
    } catch (error) {
      setPlayerError(error instanceof Error ? error.message : "Unable to start synced playback.");
    } finally {
      setBusyAction(null);
    }
  });

  const pullLatestServerProgress = useEventCallback(
    async (options?: { silent?: boolean }) => {
      const activeItem = itemRef.current;

      if (!activeItem) {
        return;
      }

      if (!options?.silent) {
        setBusyAction("refreshing");
        setPlayerError(null);
        setPlayerStatus("Pulling latest server progress...");
      }

      try {
        const refreshedItem = await onItemRefresh(activeItem.id);

        if (!refreshedItem) {
          throw new Error("Unable to refresh this Audiobookshelf book.");
        }

        itemRef.current = refreshedItem;
        const refreshedTime = refreshedItem.userMediaProgress?.currentTime ?? 0;
        const nextTracks =
          sessionRef.current?.audioTracks?.length
            ? sessionRef.current.audioTracks
            : refreshedItem.media.tracks ?? [];
        const shouldQueue = Boolean(sessionRef.current) || Boolean(audioRef.current?.src);
        lastSyncedTimeRef.current = refreshedTime;

        if (shouldQueue && nextTracks.length) {
          queueTrackLoad(refreshedTime, isPlayingRef.current, nextTracks);
        } else {
          updatePlayhead(refreshedTime);
        }

        if (!options?.silent) {
          setPlayerStatus("Loaded the latest Audiobookshelf progress.");
        }
      } catch (error) {
        if (!options?.silent) {
          setPlayerError(error instanceof Error ? error.message : "Unable to refresh the current book.");
        }
      } finally {
        if (!options?.silent) {
          setBusyAction(null);
        }
      }
    },
  );

  const loadServerSubtitle = useEventCallback(async (file: LibraryFile) => {
    const activeItem = itemRef.current;

    if (!activeItem) {
      return;
    }

    setSubtitleError(null);
    setSubtitleStatus("Loading subtitle file...");
    setSelectedServerSubtitleId(String(file.ino));

    try {
      const response = await fetch(`/api/items/${activeItem.id}/files/${encodeURIComponent(String(file.ino))}`);
      const body = await response.text();

      if (!response.ok) {
        throw new Error(body || "Unable to load the selected subtitle file.");
      }

      const parsedCues = parseSubtitle(body);

      if (!parsedCues.length) {
        throw new Error("That subtitle file did not contain any readable SRT or WebVTT cues.");
      }

      setSubtitleCues(parsedCues);
      setSubtitleSourceLabel(getLibraryFileLabel(file));
      setSubtitleStatus(`Loaded ${getLibraryFileLabel(file)} from Audiobookshelf.`);
    } catch (error) {
      setSubtitleCues([]);
      setSubtitleError(error instanceof Error ? error.message : "Unable to load the selected subtitle file.");
      setSubtitleStatus("Choose a different subtitle file to keep going.");
    }
  });

  useEffect(() => {
    const previousItem = previousItemRef.current;

    void exitFullscreenSafely(panelRef.current);

    if (previousItem?.id && previousItem.id !== item?.id) {
      void syncToAudiobookshelf("close", {
        silent: true,
        refreshItem: false,
        targetItem: previousItem,
        targetSession: sessionRef.current,
      });
    }

    clearAudio();
    pauseListeningClock();
    previousItemRef.current = item;
    itemRef.current = item;
    sessionRef.current = null;
    setSession(null);
    setTrackLoadRequest(null);
    setIsPlaying(false);
    setBusyAction(null);
    setPlayerError(null);
    setPlayerStatus(null);
    setProgressSaveNotice(null);
    failedCheckpointRef.current = null;
    saveFailuresRef.current = 0;
    listenedSecondsRef.current = 0;
    listenWindowStartRef.current = null;

    const initialTime = item?.userMediaProgress?.currentTime ?? 0;
    currentTimeRef.current = initialTime;
    lastSyncedTimeRef.current = initialTime;
    setCurrentTime(initialTime);
    completionReachedRef.current = false;

    setSubtitleCues([]);
    setSubtitleError(null);
    const savedSubtitlePreference = item ? readBookSubtitlePreference(item.id, preferenceScope) : { offset: 0, serverFileId: "" };
    setSubtitleOffset(savedSubtitlePreference.offset);
    setSelectedServerSubtitleId(savedSubtitlePreference.serverFileId);
    setSubtitlePreferenceItemId(item?.id ?? null);
    setHasPlaybackStarted(false);
    fullscreenFallbackStatusShownRef.current = false;
    void releaseWakeLock();
    setIsOptionsOpen(false);
    setIsBrowserFullscreen(false);
    setIsInlineFullscreen(false);

    if (!item) {
      setSubtitleSourceLabel("No subtitle file loaded");
      setSubtitleStatus(null);
      return;
    }

    const firstSubtitleFile =
      serverSubtitleFiles.find((file) => String(file.ino) === savedSubtitlePreference.serverFileId) ??
      serverSubtitleFiles[0];

    if (firstSubtitleFile) {
      setSubtitleSourceLabel(getLibraryFileLabel(firstSubtitleFile));
      setSubtitleStatus("Loading subtitle file...");
      void loadServerSubtitle(firstSubtitleFile);
      return;
    }

    setSubtitleSourceLabel("No subtitle file loaded");
    setSubtitleStatus(null);
  }, [exitFullscreenSafely, item?.id, preferenceScope, releaseWakeLock, subtitlePreferencesRevision]);

  useEffect(() => {
    if (!item?.id || subtitlePreferenceItemId !== item.id) return;
    writeBookSubtitlePreference(item.id, { offset: subtitleOffset, serverFileId: selectedServerSubtitleId }, preferenceScope);
    if (!hasLoadedSubtitlePreferences) return;
    subtitlePreferencesDirtyRef.current = true;
    const timeout = window.setTimeout(() => {
      void fetch("/api/preferences/subtitles", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: readAllBookSubtitlePreferences(preferenceScope) }),
      }).then((response) => {
        if (response.ok) subtitlePreferencesDirtyRef.current = false;
      }).catch(() => {
        subtitlePreferencesDirtyRef.current = true;
      });
    }, 500);
    return () => window.clearTimeout(timeout);
  }, [hasLoadedSubtitlePreferences, item?.id, preferenceScope, selectedServerSubtitleId, subtitleOffset, subtitlePreferenceItemId]);

  useEffect(() => {
    const handleOnline = () => {
      if (playerPreferencesDirtyRef.current) {
        const raw = window.localStorage.getItem(scopedPlayerStorageKey(PLAYER_PREFERENCES_STORAGE_KEY, preferenceScope));
        if (raw) {
          void fetch("/api/preferences/player", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ value: parseStoredPreferences(raw) }),
          }).then((response) => {
            if (response.ok) playerPreferencesDirtyRef.current = false;
          }).catch(() => undefined);
        }
      }
      if (subtitlePreferencesDirtyRef.current) {
        void fetch("/api/preferences/subtitles", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ value: readAllBookSubtitlePreferences(preferenceScope) }),
        }).then((response) => {
          if (response.ok) subtitlePreferencesDirtyRef.current = false;
        }).catch(() => undefined);
      }
    };
    window.addEventListener("online", handleOnline);
    return () => window.removeEventListener("online", handleOnline);
  }, [preferenceScope]);

  useEffect(() => {
    if (!item || sessionRef.current || audioRef.current?.src) {
      return;
    }

    const nextTime = item.userMediaProgress?.currentTime ?? 0;
    currentTimeRef.current = nextTime;
    lastSyncedTimeRef.current = nextTime;
    setCurrentTime(nextTime);
  }, [item, item?.userMediaProgress?.currentTime]);

  useEffect(() => {
    if (!item?.id || openToken <= 0) {
      return;
    }

    if (lastAutoRefreshTokenRef.current === openToken) {
      return;
    }

    lastAutoRefreshTokenRef.current = openToken;
    void pullLatestServerProgress({ silent: true });
  }, [item?.id, openToken, pullLatestServerProgress]);

  useEffect(() => {
    const audio = audioRef.current;

    if (!audio || !trackLoadRequest) {
      return;
    }

    const track = trackLoadRequest.track;
    const signature = getTrackSignature(track);
    const streamUrl = `/api/stream?path=${encodeURIComponent(track.contentUrl)}`;
    const localTime = clampTime(
      trackLoadRequest.time - track.startOffset,
      Math.max(track.duration - 0.05, 0),
    );

    pendingAutoplayRef.current = trackLoadRequest.autoplay;
    pendingLocalTimeRef.current = localTime;

    if (loadedTrackSignatureRef.current === signature && audio.src) {
      if (Math.abs(audio.currentTime - localTime) > 0.25) {
        audio.currentTime = localTime;
      }

      audio.playbackRate = playbackRateRef.current;

      if (trackLoadRequest.autoplay) {
        void safePlay(audio);
      } else {
        audio.pause();
        setIsPlaying(false);
        pauseListeningClock();
      }

      return;
    }

    audio.pause();
    loadedTrackSignatureRef.current = signature;
    audio.src = streamUrl;
    audio.load();
  }, [pauseListeningClock, safePlay, trackLoadRequest]);

  useEffect(() => {
    const audio = audioRef.current;

    if (!audio) {
      return;
    }

    audio.playbackRate = playbackRate;
  }, [playbackRate]);

  useEffect(() => {
    const audio = audioRef.current;

    if (!audio) {
      return;
    }

    audio.volume = volume;
  }, [volume]);

  useEffect(() => {
    if (!progressSaveNotice) return;
    if (progressSaveNotice.state === "saved") {
      const timeout = window.setTimeout(() => setProgressSaveNotice(null), 5000);
      return () => window.clearTimeout(timeout);
    }
    if (progressSaveNotice.state !== "failed" || !progressSaveNotice.retryable) return;
    const retry = () => {
      const failed = failedCheckpointRef.current;
      if (failed && failed.itemId === itemRef.current?.id && failed.sessionId === sessionRef.current?.id) void syncToAudiobookshelf(failed.mode, { silent: true });
    };
    const timeout = window.setTimeout(retry, progressRetryDelay(saveFailuresRef.current));
    window.addEventListener("online", retry);
    return () => { window.clearTimeout(timeout); window.removeEventListener("online", retry); };
  }, [progressSaveNotice, syncToAudiobookshelf]);

  useEffect(() => {
    if (!session?.id) {
      return;
    }

    const interval = window.setInterval(() => {
      if (!isPlayingRef.current || failedCheckpointRef.current) {
        return;
      }

      if (Math.abs(currentTimeRef.current - lastSyncedTimeRef.current) < AUTO_SYNC_MIN_PROGRESS_SECONDS) {
        return;
      }

      void syncToAudiobookshelf("sync", { silent: true });
    }, AUTO_SYNC_INTERVAL_MS);

    return () => {
      window.clearInterval(interval);
    };
  }, [session?.id, syncToAudiobookshelf]);

  useEffect(() => {
    return () => {
      pauseListeningClock();
      void releaseWakeLock();
      void syncToAudiobookshelf("close", { silent: true, refreshItem: false });
    };
  }, [pauseListeningClock, releaseWakeLock, syncToAudiobookshelf]);

  async function handleManualSubtitleUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    setSubtitleError(null);
    setSubtitleStatus("Loading subtitle file...");
    setSelectedServerSubtitleId("");

    try {
      const body = await file.text();
      const parsedCues = parseSubtitle(body);

      if (!parsedCues.length) {
        throw new Error("That subtitle file did not contain any readable SRT or WebVTT cues.");
      }

      setSubtitleCues(parsedCues);
      setSubtitleSourceLabel(file.name);
      setSubtitleStatus(`Loaded ${file.name} from this device.`);
    } catch (error) {
      setSubtitleCues([]);
      setSubtitleError(error instanceof Error ? error.message : "Unable to read that subtitle file.");
      setSubtitleStatus("Choose a different subtitle file to keep going.");
    }

    event.currentTarget.value = "";
  }

  async function handlePrimaryTransport() {
    if (!item) {
      return;
    }

    if (!session) {
      await startPlayback(false);
      return;
    }

    const audio = audioRef.current;

    if (!audio) {
      return;
    }

    if (isPlayingRef.current) {
      audio.pause();
      setIsPlaying(false);
      pauseListeningClock();
      setPlayerStatus("Playback paused.");
      return;
    }

    setHasPlaybackStarted(true);

    if (!audio.src) {
      queueTrackLoad(currentTimeRef.current, true);
      return;
    }

    audio.playbackRate = playbackRateRef.current;
    const didPlay = await safePlay(audio);

    if (didPlay) {
      setPlayerStatus("Playback resumed.");
    }
  }

  function handleSeek(nextTime: number) {
    queueTrackLoad(nextTime, Boolean(sessionRef.current) && isPlayingRef.current);
  }

  function addBookmark() {
    const activeItem = itemRef.current;
    if (!activeItem || totalDurationRef.current <= 0) return;

    const time = clampTime(currentTimeRef.current, totalDurationRef.current);
    const bookmark: PlayerBookmark = {
      id: `${Date.now().toString(36)}-${Math.round(time * 1000).toString(36)}`,
      time,
      chapterTitle: activeChapter ? getChapterTitle(activeChapter, Math.max(activeChapterIndex, 0)) : null,
      createdAt: Date.now(),
    };

    setBookmarks((current) => {
      const next = [...current, bookmark].sort((a, b) => a.time - b.time);
      writeBookmarks(preferenceScope, activeItem.id, next);
      return next;
    });
    setPlayerStatus(`Bookmark saved at ${formatTime(time)}.`);
    setIsBookmarksOpen(true);
    revealFullscreenControls(true);
  }

  function removeBookmark(bookmarkId: string) {
    const activeItem = itemRef.current;
    if (!activeItem) return;
    setBookmarks((current) => {
      const next = current.filter((bookmark) => bookmark.id !== bookmarkId);
      writeBookmarks(preferenceScope, activeItem.id, next);
      return next;
    });
  }

  function clearBookmarks() {
    const activeItem = itemRef.current;
    if (!activeItem) return;
    setBookmarks([]);
    writeBookmarks(preferenceScope, activeItem.id, []);
  }

  function jumpToBookmark(bookmark: PlayerBookmark) {
    handleSeek(bookmark.time);
    setIsBookmarksOpen(false);
    revealFullscreenControls(true);
  }

  function handleFullscreenCoverPointerDown(event: PointerEvent<HTMLDivElement>) {
    event.stopPropagation();
    if (!isFullscreenCoverEditing) {
      revealFullscreenControls(true);
      return;
    }
    fullscreenCoverDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: fullscreenCover.x,
      originY: fullscreenCover.y,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handleFullscreenCoverPointerMove(event: PointerEvent<HTMLDivElement>) {
    event.stopPropagation();
    const drag = fullscreenCoverDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const width = Math.max(event.currentTarget.clientWidth, 1);
    const height = Math.max(event.currentTarget.clientHeight, 1);
    const dx = ((event.clientX - drag.startX) / width) * 100;
    const dy = ((event.clientY - drag.startY) / height) * 100;
    setFullscreenCover((current) => ({
      ...current,
      x: Math.min(40, Math.max(-40, drag.originX + dx)),
      y: Math.min(40, Math.max(-40, drag.originY + dy)),
      useSharedDefault: false, applyToAll: false,
    }));
  }

  function handleFullscreenCoverPointerUp(event: PointerEvent<HTMLDivElement>) {
    event.stopPropagation();
    if (fullscreenCoverDragRef.current?.pointerId === event.pointerId) {
      fullscreenCoverDragRef.current = null;
    }
  }

  function handleFullscreenCoverWheel(event: WheelEvent<HTMLDivElement>) {
    if (!isFullscreenCoverEditing) return;
    event.preventDefault();
    event.stopPropagation();
    setFullscreenCover((current) => ({
      ...current,
      scale: Math.min(1.35, Math.max(0.45, current.scale + (event.deltaY < 0 ? 0.04 : -0.04))),
      useSharedDefault: false, applyToAll: false,
    }));
  }

  function resetFullscreenCover() {
    setFullscreenCover((current) => ({ ...current, scale: 0.60, x: 0, y: -16, opacity: 0.96 }));
  }

  function handleRelativeSeek(delta: number) {
    queueTrackLoad(currentTimeRef.current + delta, Boolean(sessionRef.current) && isPlayingRef.current);
  }

  function handleChapterJump(chapter: Chapter, index: number) {
    queueTrackLoad(chapter.start, Boolean(sessionRef.current) && isPlayingRef.current);
    setIsChapterListOpen(false);
    setPlayerStatus(`Jumped to ${getChapterTitle(chapter, index)}.`);
  }

  function handleChapterStep(direction: "previous" | "next") {
    if (!chapters.length || activeChapterIndex < 0) {
      return;
    }

    const nextIndex =
      direction === "previous"
        ? Math.max(activeChapterIndex - 1, 0)
        : Math.min(activeChapterIndex + 1, chapters.length - 1);

    if (nextIndex === activeChapterIndex) {
      return;
    }

    const targetChapter = chapters[nextIndex];

    if (!targetChapter) {
      return;
    }

    handleChapterJump(targetChapter, nextIndex);
  }

  function handleLoadedMetadata() {
    const audio = audioRef.current;

    if (!audio) {
      return;
    }

    const desiredTime = clampTime(
      pendingLocalTimeRef.current,
      Math.max(audio.duration - 0.05, 0),
    );

    if (Math.abs(audio.currentTime - desiredTime) > 0.2) {
      audio.currentTime = desiredTime;
    }

    audio.playbackRate = playbackRateRef.current;

    if (pendingAutoplayRef.current) {
      void safePlay(audio);
    }
  }

  function handleTimeUpdate() {
    const audio = audioRef.current;
    const track = activeTrack ?? getTrackAtTime(tracksRef.current, currentTimeRef.current);

    if (!audio || !track) {
      return;
    }

    const nextTime = track.startOffset + audio.currentTime;
    if (!audio.paused && !audio.seeking && playbackFinished(nextTime, totalDurationRef.current, true)) completionReachedRef.current = true;
    updatePlayhead(nextTime);
  }

  function handlePlay() {
    const current = itemRef.current;
    if (current) publishProgress(current.id, { ...current.userMediaProgress, duration: totalDurationRef.current, currentTime: currentTimeRef.current, progress: currentTimeRef.current / Math.max(totalDurationRef.current, 1), isFinished: Boolean(current.userMediaProgress?.isFinished), startedAt: current.userMediaProgress?.startedAt || Date.now(), lastUpdate: Date.now() });
    setIsPlaying(true);
    if (audioContextRef.current?.state === "suspended") void audioContextRef.current.resume();
    resumeListeningClock();
    void requestWakeLock();
    void syncToAudiobookshelf("sync", { silent: true });
  }

  function handlePause() {
    setIsPlaying(false);
    pauseListeningClock();
    void releaseWakeLock();
    void syncToAudiobookshelf("sync", { silent: true });
  }

  function handleEnded() {
    const trackList = tracksRef.current;
    const trackIndex = getTrackIndexAtTime(trackList, currentTimeRef.current);

    if (trackIndex >= 0 && trackIndex < trackList.length - 1) {
      queueTrackLoad(trackList[trackIndex + 1].startOffset, true, trackList);
      return;
    }

    completionReachedRef.current = true;
    updatePlayhead(totalDurationRef.current);
    setIsPlaying(false);
    pauseListeningClock();
    void syncToAudiobookshelf("sync", { silent: true });
  }

  function openPopout() {
    if (!item) {
      return;
    }

    window.open(
      `/player/${item.id}`,
      `spoken-page-${item.id}`,
      "popup=yes,width=1120,height=880,resizable=yes,scrollbars=yes",
    );
  }

  async function toggleFullscreen() {
    const panel = panelRef.current as FullscreenPanelElement | null;

    if (!panel) {
      return;
    }

    if (isFullscreen) {
      await exitFullscreenSafely(panel);
      return;
    }

    try {
      if (typeof panel.requestFullscreen === "function") {
        await panel.requestFullscreen({ navigationUI: "hide" });
        return;
      }

      if (typeof panel.webkitRequestFullscreen === "function") {
        await panel.webkitRequestFullscreen();
        return;
      }
    } catch {
      // Fall back to an in-page fullscreen layout for browsers like iPad Safari.
    }

    setIsInlineFullscreen(true);
    setIsOptionsOpen(false);

    if (!fullscreenFallbackStatusShownRef.current) {
      setPlayerStatus("Using the immersive tablet view for this browser.");
      fullscreenFallbackStatusShownRef.current = true;
    }
  }

  function handlePlaybackRateChange(nextValue: number) {
    setPlaybackRate(nextValue);
    revealFullscreenControls();
  }

  function handleVolumeChange(nextValue: number) {
    setVolume(nextValue);
    revealFullscreenControls();
  }

  function handleSubtitleScaleChange(nextValue: SubtitleScale) {
    setSubtitleScale(nextValue);
    markAppearanceCustom();
    revealFullscreenControls(true);
  }

  function handleSubtitleLineHeightChange(nextValue: SubtitleLineHeight) {
    setSubtitleLineHeight(nextValue);
    markAppearanceCustom();
    revealFullscreenControls(true);
  }

  function handleSubtitlePositionChange(nextValue: SubtitlePosition) {
    setSubtitlePosition(nextValue);
    markAppearanceCustom();
    revealFullscreenControls(true);
  }

  function handleSubtitleContrastChange(nextValue: SubtitleContrast) {
    setSubtitleContrast(nextValue);
    markAppearanceCustom();
    revealFullscreenControls(true);
  }

  function handleSubtitleTextColorChange(nextValue: SubtitleTextColor) {
    setSubtitleTextColor(nextValue);
    markAppearanceCustom();
    revealFullscreenControls(true);
  }

  function handleSubtitleBackgroundChange(nextValue: SubtitleBackground) {
    setSubtitleBackground(nextValue);
    markAppearanceCustom();
    revealFullscreenControls(true);
  }

  function handleFullscreenAutoHideChange(nextValue: FullscreenAutoHide) {
    setFullscreenAutoHideMs(nextValue);
    revealFullscreenControls(true);
  }

  function toggleSubtitleDisplayOptions() {
    setIsSubtitleDisplayOptionsOpen((current) => !current);
    setIsFullscreenAppearanceOpen(false);
    revealFullscreenControls(true);
  }

  function openFullscreenAppearance(tab: "cover" | "background" | "visualizer" | "subtitles") {
    const shouldClose = isFullscreenAppearanceOpen && fullscreenAppearanceTab === tab;
    setFullscreenAppearanceTab(tab);
    setIsFullscreenAppearanceOpen(!shouldClose);
    setIsSubtitleDisplayOptionsOpen(false);
    revealFullscreenControls(true);
  }

  function handleVisualizerPointerDown(event: PointerEvent<HTMLCanvasElement>) {
    if (fullscreenCover.visualizerLocked) return;
    visualizerDragRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, originX: fullscreenCover.visualizerX, originY: fullscreenCover.visualizerY };
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch {}
    event.stopPropagation();
  }

  function handleVisualizerPointerMove(event: PointerEvent<HTMLCanvasElement>) {
    const drag = visualizerDragRef.current;
    const stage = panelRef.current?.getBoundingClientRect();
    if (!drag || drag.pointerId !== event.pointerId || !stage) return;
    const deltaX = ((event.clientX - drag.startX) / Math.max(stage.width, 1)) * 100;
    const deltaY = ((event.clientY - drag.startY) / Math.max(stage.height, 1)) * 100;
    setFullscreenCover((current) => ({ ...current, visualizerX: Math.min(40, Math.max(-40, drag.originX + deltaX)), visualizerY: Math.min(40, Math.max(-40, drag.originY + deltaY)), useSharedDefault: false, applyToAll: false }));
    event.stopPropagation();
  }

  function handleVisualizerPointerUp(event: PointerEvent<HTMLCanvasElement>) {
    if (visualizerDragRef.current?.pointerId === event.pointerId) visualizerDragRef.current = null;
    event.stopPropagation();
  }

  // [ENHANCED v1.3.15] Appearance dragging is header-only; settings scrolling never moves the menu.
  function handleAppearancePointerDown(event: PointerEvent<HTMLElement>) {
    if ((event.target as Element).closest("button, input, select, label, a")) return;
    fullscreenAppearanceDragRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, originX: fullscreenAppearancePosition.x, originY: fullscreenAppearancePosition.y };
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* Optional browser feature. */ }
  }

  function handleAppearancePointerMove(event: PointerEvent<HTMLElement>) {
    const drag = fullscreenAppearanceDragRef.current;
    const stage = panelRef.current?.getBoundingClientRect();
    const menu = event.currentTarget.closest<HTMLElement>(".fullscreen-appearance-panel")?.getBoundingClientRect();
    if (!drag || drag.pointerId !== event.pointerId || !stage || !menu) return;
    const deltaX = ((event.clientX - drag.startX) / Math.max(stage.width, 1)) * 100;
    const deltaY = ((event.clientY - drag.startY) / Math.max(stage.height, 1)) * 100;
    const menuWidthPct = (menu.width / Math.max(stage.width, 1)) * 100;
    const menuHeightPct = (menu.height / Math.max(stage.height, 1)) * 100;
    setFullscreenAppearancePosition({
      x: Math.min(100 - menuWidthPct - 1, Math.max(1, drag.originX + deltaX)),
      y: Math.min(100 - menuHeightPct - 1, Math.max(1, drag.originY + deltaY)),
    });
  }

  function handleAppearancePointerUp(event: PointerEvent<HTMLElement>) {
    if (fullscreenAppearanceDragRef.current?.pointerId === event.pointerId) fullscreenAppearanceDragRef.current = null;
    try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* Optional browser feature. */ }
  }

  function markAppearanceCustom() {
    setActiveLayoutPreset("custom");
    setFullscreenCover((current) => ({ ...current, useSharedDefault: false, applyToAll: false }));
  }

  function applySharedAppearance(appearance: FullscreenCoverPreference, forceAll = false) {
    const value = { ...appearance, useSharedDefault: true, applyToAll: forceAll, appearanceGeneration: forceAll ? Date.now() : readSharedFullscreenAppearance(preferenceScope).appearanceGeneration, customizedAtGeneration: 0 };
    setFullscreenCover(value);
    setSubtitleScale(value.subtitleScale);
    setSubtitleLineHeight(value.subtitleLineHeight);
    setSubtitlePosition(value.subtitlePosition);
    setSubtitleContrast(value.subtitleContrast);
    setSubtitleTextColor(value.subtitleTextColor);
    setSubtitleBackground(value.subtitleBackground);
    try { window.localStorage.setItem(sharedFullscreenStorageKey(preferenceScope), JSON.stringify(value)); } catch {}
    fullscreenVisualMapRef.current[FULLSCREEN_VISUAL_GLOBAL_ID] = value;
    if (fullscreenVisualServerLoadedRef.current) {
      const payload = JSON.parse(JSON.stringify(fullscreenVisualMapRef.current));
      fullscreenVisualSavePromiseRef.current = fullscreenVisualSavePromiseRef.current.catch(() => undefined).then(async () => {
        try {
          await fetch("/api/preferences/fullscreen-visuals", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ value: payload }) });
        } catch {}
      });
    }
  }

  function applyLayoutPreset(kind: "standard" | "cinema" | "minimal") {
    // [ENHANCED v1.3.15] Presets change layout/visual treatment without
    // unexpectedly overwriting the user's subtitle size, colors, contrast,
    // or line-height. All presets keep subtitles in the safe lower-third zone.
    const base: FullscreenCoverPreference = {
      ...DEFAULT_ENHANCED_FULLSCREEN_COVER_PREFERENCE,
      subtitleScale,
      subtitleLineHeight,
      subtitlePosition: "lower-third",
      subtitleContrast,
      subtitleTextColor,
      subtitleBackground,
      useSharedDefault: false,
      applyToAll: false,
    };

    if (kind === "standard") {
      base.scale = 0.60;
      base.y = -16;
      base.backgroundColor = "black";
      base.backgroundPattern = "none";
      base.backgroundPatternOpacity = 0;
      base.visualizerEnabled = true;
      base.visualizerStyle = "bars";
      base.visualizerScale = 0.62;
      base.visualizerX = 0;
      base.visualizerY = 18;
      base.visualizerOpacity = 0.72;
      base.visualizerColor = "orange";
      base.visualizerGlow = 10;
      base.visualizerLocked = true;
    } else if (kind === "cinema") {
      base.scale = 0.72;
      base.y = -14;
      base.backgroundColor = "near-black";
      base.backgroundPattern = "none";
      base.backgroundPatternOpacity = 0;
      base.visualizerEnabled = false;
      base.visualizerStyle = "off";
      base.visualizerLocked = true;
    } else {
      base.scale = 0.50;
      base.y = -22;
      base.backgroundColor = "charcoal";
      base.backgroundPattern = "none";
      base.backgroundPatternOpacity = 0;
      base.visualizerEnabled = true;
      base.visualizerStyle = "bars";
      base.visualizerScale = 0.50;
      base.visualizerX = 0;
      base.visualizerY = 8;
      base.visualizerOpacity = 0.58;
      base.visualizerColor = "orange";
      base.visualizerGlow = 6;
      base.visualizerLocked = true;
    }

    setActiveLayoutPreset(kind === "standard" ? "enhanced" : kind);
    setFullscreenCover(base);
    setSubtitlePosition("lower-third");
    revealFullscreenControls(true);
  }

  function applyCurrentAppearanceToAllBooks() {
    const confirmed = window.confirm("WARNING: Apply this appearance to ALL books?\n\nThis changes the shared/default look and overrides existing custom appearance choices until a book is customized again.\n\nNo audiobook files are changed.");
    if (!confirmed) return;
    applySharedAppearance({ ...fullscreenCover, useSharedDefault: true }, true);
  }

  function applyOriginalLookToAllBooks() {
    const confirmed = window.confirm("WARNING: Restore the basic original look for ALL books?\n\nBooks using the shared default will immediately use the original look.");
    if (!confirmed) return;
    applySharedAppearance({ ...DEFAULT_ORIGINAL_FULLSCREEN_COVER_PREFERENCE, useSharedDefault: true }, true);
  }

  function setVisualizerForAllBooks(enabled: boolean) {
    const action = enabled ? "Turn the audio visualizer ON" : "Turn the audio visualizer OFF";
    const confirmed = window.confirm(`WARNING: ${action} for ALL books?\n\nThis changes the shared/default visualizer state for every book. Individual books can still be customized afterward.\n\nNo audiobook files are changed.`);
    if (!confirmed) return;
    const shared = readSharedFullscreenAppearance(preferenceScope);
    applySharedAppearance({
      ...shared,
      visualizerEnabled: enabled,
      visualizerStyle: enabled ? "bars" : "off",
      visualizerColor: enabled ? "orange" : shared.visualizerColor,
      visualizerY: enabled ? 18 : shared.visualizerY,
      useSharedDefault: true,
    }, true);
  }

  function useSharedDefaultForCurrentBook() {
    applySharedAppearance(readSharedFullscreenAppearance(preferenceScope), false);
  }

  function handleFullscreenStageTap(event: MouseEvent<HTMLDivElement>) {
    if (!isFullscreen) {
      return;
    }

    const target = event.target;

    if (!(target instanceof Element)) {
      return;
    }

    if (target.closest(".transport-shell-fullscreen, .fullscreen-cover-editor, .subtitle-display-options-wrap, .fullscreen-appearance-panel, .shortcut-help-panel, .chapter-picker, .fullscreen-interactive-layer")) {
      return;
    }

    if (shouldShowFullscreenControls && isPlaying && !isChapterListOpen) {
      hideFullscreenControls();
      return;
    }

    revealFullscreenControls();
  }

  useEffect(() => {
    const handleWindowKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) {
        return;
      }

      const target = event.target;

      if (target instanceof HTMLElement) {
        const tagName = target.tagName;

        if (
          target.isContentEditable ||
          tagName === "BUTTON" ||
          tagName === "A" ||
          tagName === "INPUT" ||
          tagName === "TEXTAREA" ||
          tagName === "SELECT"
        ) {
          return;
        }
      }

      const key = event.key.toLowerCase();
      let handled = true;

      if (event.code === "Space" || key === "k") {
        void handlePrimaryTransport();
      } else if (key === "j") {
        handleRelativeSeek(-10);
      } else if (key === "l") {
        handleRelativeSeek(10);
      } else if (event.key === "ArrowLeft" && event.shiftKey) {
        handleChapterStep("previous");
      } else if (event.key === "ArrowRight" && event.shiftKey) {
        handleChapterStep("next");
      } else if (event.key === "ArrowLeft") {
        handleRelativeSeek(-15);
      } else if (event.key === "ArrowRight") {
        handleRelativeSeek(30);
      } else if (key === "m") {
        setVolume((current) => (current > 0 ? 0 : 1));
      } else if (key === "f") {
        void toggleFullscreen();
      } else if (key === "b") {
        addBookmark();
      } else if (event.key === "?") {
        setIsShortcutHelpOpen((current) => !current);
      } else if (event.key === "Escape" && isFullscreenAppearanceOpen) {
        setIsFullscreenAppearanceOpen(false);
      } else if (event.key === "Escape" && isSubtitleDisplayOptionsOpen) {
        setIsSubtitleDisplayOptionsOpen(false);
      } else if (event.key === "Escape" && isShortcutHelpOpen) {
        setIsShortcutHelpOpen(false);
      } else {
        handled = false;
      }

      if (handled) {
        event.preventDefault();
        revealFullscreenControls(true);
      }
    };

    window.addEventListener("keydown", handleWindowKeyDown);

    return () => {
      window.removeEventListener("keydown", handleWindowKeyDown);
    };
  });

  function renderSubtitleTools() {
    return (
      <>
        <div className="subtitle-tools-grid">
          <label className="field">
            <span>Audiobookshelf subtitles</span>
            <select
              disabled={!serverSubtitleFiles.length}
              onChange={(event) => {
                const nextFile = serverSubtitleFiles.find(
                  (entry) => String(entry.ino) === event.target.value,
                );

                if (nextFile) {
                  void loadServerSubtitle(nextFile);
                }
              }}
              value={selectedServerSubtitleId}
            >
              {serverSubtitleFiles.length ? null : <option value="">No attached subtitle files</option>}
              {serverSubtitleFiles.map((file) => (
                <option key={String(file.ino)} value={String(file.ino)}>
                  {getLibraryFileLabel(file)}
                </option>
              ))}
            </select>
          </label>

          <label className="field field-file">
            <span>Upload .srt or .vtt file</span>
            <input accept=".srt,.vtt,text/vtt" onChange={handleManualSubtitleUpload} ref={subtitleUploadRef} type="file" />
          </label>

          <label className="field">
            <span>Subtitle offset</span>
            <input
              max={8}
              min={-8}
              onChange={(event) => setSubtitleOffset(Number(event.target.value))}
              step={0.1}
              type="range"
              value={subtitleOffset}
            />
            <small>
              {subtitleOffset >= 0 ? "+" : ""}
              {subtitleOffset.toFixed(1)} seconds
            </small>
          </label>
        </div>

        <div className="subtitle-display-options-panel">{renderSubtitleDisplayOptions()}</div>
      </>
    );
  }

  function renderFullscreenAppearancePanel() {
    if (!isFullscreen || !isFullscreenAppearanceOpen) return null;
    return (
      <section
        aria-label="Fullscreen appearance and subtitle settings"
        className="fullscreen-appearance-panel fullscreen-interactive-layer"
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
        onWheel={(event) => event.stopPropagation()}
        style={{ left: `${fullscreenAppearancePosition.x}%`, top: `${fullscreenAppearancePosition.y}%` }}
      >
        <div className="fullscreen-appearance-head">
          <div
            className="fullscreen-appearance-drag-region"
            onPointerDown={(event) => { event.stopPropagation(); handleAppearancePointerDown(event); }}
            onPointerMove={(event) => { event.stopPropagation(); handleAppearancePointerMove(event); }}
            onPointerUp={(event) => { event.stopPropagation(); handleAppearancePointerUp(event); }}
          >
            <strong>Appearance &amp; subtitle settings</strong>
            <small>Drag this header to move the menu</small>
          </div>
          <button
            className="icon-button appearance-close-button"
            aria-label="Close appearance settings"
            onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); }}
            onClick={(event) => { event.preventDefault(); event.stopPropagation(); setIsFullscreenAppearanceOpen(false); setIsSubtitleDisplayOptionsOpen(false); }}
            title="Close appearance settings"
            type="button"
          >
            X
          </button>
        </div>

        <div className="fullscreen-appearance-tabs" role="tablist" aria-label="Appearance sections">
          {([
            ["cover", "Cover"],
            ["background", "Background"],
            ["visualizer", "Visualizer"],
            ["subtitles", "Subtitles"],
          ] as const).map(([key, label]) => (
            <button
              className={`appearance-tab ${fullscreenAppearanceTab === key ? "appearance-tab-active" : ""}`.trim()}
              key={key}
              onClick={() => setFullscreenAppearanceTab(key)}
              role="tab"
              aria-selected={fullscreenAppearanceTab === key}
              type="button"
            >
              {label}
            </button>
          ))}
        </div>

        <div className="fullscreen-appearance-body fullscreen-interactive-scroll">
          <div className="appearance-scope-panel">
            <div className="appearance-scope-row">
              <div>
                <strong>{fullscreenCover.useSharedDefault ? "Shared/default appearance" : "Book-specific appearance"}</strong>
                <small>{fullscreenCover.useSharedDefault ? "This book follows the shared Enhanced look." : "Changes auto-save for this book."}</small>
              </div>
              <button className="button button-secondary button-compact" disabled={fullscreenCover.useSharedDefault} onClick={useSharedDefaultForCurrentBook} type="button">Use shared default</button>
            </div>
            <label className="field field-compact">
              <span>Layout preset</span>
              <select
                value={activeLayoutPreset}
                onChange={(event) => {
                  const next = event.target.value as "enhanced" | "cinema" | "minimal" | "custom";
                  if (next === "custom") {
                    setActiveLayoutPreset("custom");
                    return;
                  }
                  applyLayoutPreset(next === "enhanced" ? "standard" : next);
                }}
              >
                <option value="enhanced">Enhanced — cover + orange bars + lower subtitles</option>
                <option value="cinema">Cinema — larger cover + clean dark stage</option>
                <option value="minimal">Minimal — smaller cover + simple bars</option>
                <option value="custom">Custom — keep my settings</option>
              </select>
            </label>
            <div className="appearance-all-books-actions">
              <button className="button button-danger-text button-compact" onClick={applyCurrentAppearanceToAllBooks} type="button">Apply this look to all books</button>
              <button className="button button-danger-text button-compact" onClick={applyOriginalLookToAllBooks} type="button">Basic original look for all books</button>
            </div>
          </div>
          <div className="appearance-scope-divider" />

          {fullscreenAppearanceTab === "cover" ? (
            <div className="appearance-form-grid">
              <div className="appearance-inline-actions appearance-cover-actions">
                <div className="appearance-lock-status" aria-live="polite"><span>Cover editing</span><strong>{isFullscreenCoverEditing ? "Unlocked" : "Locked"}</strong></div>
                <button className={`button button-secondary button-compact ${isFullscreenCoverEditing ? "button-active" : ""}`.trim()} onClick={() => setIsFullscreenCoverEditing((current) => !current)} type="button">{isFullscreenCoverEditing ? "Lock cover" : "Unlock cover"}</button>
                <button className="button button-secondary button-compact" onClick={() => setFullscreenCover((current) => ({ ...current, visible: !current.visible, useSharedDefault: false, applyToAll: false }))} type="button">{fullscreenCover.visible ? "Hide cover" : "Show cover"}</button>
              </div>
              <label className="field field-compact"><span>Cover size</span><input disabled={!isFullscreenCoverEditing} max="1.35" min="0.45" step="0.01" type="range" value={fullscreenCover.scale} onChange={(event) => { markAppearanceCustom(); setFullscreenCover((current) => ({ ...current, scale: Number(event.target.value), useSharedDefault: false, applyToAll: false })); }}/><small>{Math.round(fullscreenCover.scale * 100)}%</small></label>
              <label className="field field-compact"><span>Cover opacity</span><input max="1" min="0.1" step="0.01" type="range" value={fullscreenCover.opacity} onChange={(event) => { markAppearanceCustom(); setFullscreenCover((current) => ({ ...current, opacity: Number(event.target.value), useSharedDefault: false, applyToAll: false })); }}/><small>{Math.round(fullscreenCover.opacity * 100)}%</small></label>
              <label className="field field-compact"><span>Ambient cover</span><input max="0.4" min="0" step="0.01" type="range" value={fullscreenCover.backdropOpacity} onChange={(event) => { markAppearanceCustom(); setFullscreenCover((current) => ({ ...current, backdropOpacity: Number(event.target.value), useSharedDefault: false, applyToAll: false })); }}/><small>{Math.round(fullscreenCover.backdropOpacity * 100)}%</small></label>
              <label className="field field-compact"><span>Ambient blur</span><input max="8" min="0" step="1" type="range" value={fullscreenCover.backdropBlur} onChange={(event) => { markAppearanceCustom(); setFullscreenCover((current) => ({ ...current, backdropBlur: Number(event.target.value), useSharedDefault: false, applyToAll: false })); }}/><small>{fullscreenCover.backdropBlur}px</small></label>
              <button className="button button-secondary button-compact" disabled={!isFullscreenCoverEditing} onClick={() => { resetFullscreenCover(); markAppearanceCustom(); }} type="button">Reset cover position/size</button>
              <p className="appearance-help">Unlock the cover before dragging or scrolling to zoom. Locked covers cannot be accidentally moved.</p>
            </div>
          ) : null}

          {fullscreenAppearanceTab === "background" ? (
            <div className="appearance-form-grid">
              <label className="field field-compact"><span>Background color</span><select value={fullscreenCover.backgroundColor} onChange={(event) => { markAppearanceCustom(); setFullscreenCover((current) => ({ ...current, backgroundColor: event.target.value as FullscreenBackgroundColor, useSharedDefault: false, applyToAll: false })); }}>{Object.keys(FULLSCREEN_BACKGROUND_COLORS).map((key) => <option key={key} value={key}>{key.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}</option>)}</select></label>
              <label className="field field-compact"><span>Pattern</span><select value={fullscreenCover.backgroundPattern} onChange={(event) => { markAppearanceCustom(); setFullscreenCover((current) => ({ ...current, backgroundPattern: event.target.value as FullscreenBackgroundPattern, useSharedDefault: false, applyToAll: false })); }}>{Object.keys(FULLSCREEN_BACKGROUND_PATTERNS).map((key) => <option key={key} value={key}>{key.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}</option>)}</select></label>
              <label className="field field-compact"><span>Pattern strength</span><input max="0.6" min="0" step="0.01" type="range" value={fullscreenCover.backgroundPatternOpacity} onChange={(event) => { markAppearanceCustom(); setFullscreenCover((current) => ({ ...current, backgroundPatternOpacity: Number(event.target.value), useSharedDefault: false, applyToAll: false })); }}/><small>{Math.round(fullscreenCover.backgroundPatternOpacity * 100)}%</small></label>
              <p className="appearance-help">Black + no pattern is the basic look. Colors and patterns stay behind the cover, subtitles, and controls.</p>
            </div>
          ) : null}

          {fullscreenAppearanceTab === "visualizer" ? (
            <div className="appearance-form-grid">
              <div className="appearance-inline-actions"><button className={`button button-secondary button-compact ${fullscreenCover.visualizerEnabled ? "button-active" : ""}`.trim()} onClick={() => setFullscreenCover((current) => ({ ...current, visualizerEnabled: !current.visualizerEnabled, visualizerStyle: !current.visualizerEnabled ? "bars" : current.visualizerStyle, useSharedDefault: false, applyToAll: false }))} type="button">{fullscreenCover.visualizerEnabled ? "Visualizer: On" : "Visualizer: Off"}</button><button className="button button-secondary button-compact" onClick={() => setFullscreenCover((current) => ({ ...current, visualizerLocked: !current.visualizerLocked, useSharedDefault: false, applyToAll: false }))} type="button">{fullscreenCover.visualizerLocked ? "Unlock visual" : "Lock visual"}</button></div>
              <div className="appearance-inline-actions appearance-all-books-actions-row"><button className="button button-danger-text button-compact" onClick={() => setVisualizerForAllBooks(true)} type="button">Turn visualizer ON for all books</button><button className="button button-danger-text button-compact" onClick={() => setVisualizerForAllBooks(false)} type="button">Turn visualizer OFF for all books</button></div>
              <label className="field field-compact"><span>Style</span><select value={fullscreenCover.visualizerStyle} onChange={(event) => { markAppearanceCustom(); setFullscreenCover((current) => ({ ...current, visualizerStyle: event.target.value as VisualizerStyle, useSharedDefault: false, applyToAll: false })); }}><option value="bars">Bars only</option><option value="waveform">Waveform</option><option value="wave-bars">Wave + bars</option><option value="pulse">Pulse</option><option value="off">Off</option></select></label>
              <label className="field field-compact"><span>Size</span><input max="1.4" min="0.35" step="0.01" type="range" value={fullscreenCover.visualizerScale} onChange={(event) => { markAppearanceCustom(); setFullscreenCover((current) => ({ ...current, visualizerScale: Number(event.target.value), useSharedDefault: false, applyToAll: false })); }}/><small>{Math.round(fullscreenCover.visualizerScale * 100)}%</small></label>
              <label className="field field-compact"><span>Horizontal position</span><input max="40" min="-40" step="1" type="range" value={fullscreenCover.visualizerX} onChange={(event) => { markAppearanceCustom(); setFullscreenCover((current) => ({ ...current, visualizerX: Number(event.target.value), useSharedDefault: false, applyToAll: false })); }}/><small>{fullscreenCover.visualizerX}%</small></label>
              <label className="field field-compact"><span>Vertical position</span><input max="40" min="-40" step="1" type="range" value={fullscreenCover.visualizerY} onChange={(event) => { markAppearanceCustom(); setFullscreenCover((current) => ({ ...current, visualizerY: Number(event.target.value), useSharedDefault: false, applyToAll: false })); }}/><small>{fullscreenCover.visualizerY}%</small></label>
              <label className="field field-compact"><span>Opacity</span><input max="1" min="0" step="0.01" type="range" value={fullscreenCover.visualizerOpacity} onChange={(event) => { markAppearanceCustom(); setFullscreenCover((current) => ({ ...current, visualizerOpacity: Number(event.target.value), useSharedDefault: false, applyToAll: false })); }}/><small>{Math.round(fullscreenCover.visualizerOpacity * 100)}%</small></label>
              <label className="field field-compact"><span>Color</span><select value={fullscreenCover.visualizerColor} onChange={(event) => { markAppearanceCustom(); setFullscreenCover((current) => ({ ...current, visualizerColor: event.target.value as FullscreenBackgroundColor, useSharedDefault: false, applyToAll: false })); }}><option value="orange">Orange</option>{Object.keys(FULLSCREEN_BACKGROUND_COLORS).filter((key) => key !== "orange").map((key) => <option key={key} value={key}>{key.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}</option>)}</select></label>
              <label className="field field-compact"><span>Glow</span><input max="32" min="0" step="1" type="range" value={fullscreenCover.visualizerGlow} onChange={(event) => { markAppearanceCustom(); setFullscreenCover((current) => ({ ...current, visualizerGlow: Number(event.target.value), useSharedDefault: false, applyToAll: false })); }}/><small>{fullscreenCover.visualizerGlow}px</small></label>
              <label className="field field-compact"><span>Sensitivity</span><input max="2" min="0.2" step="0.05" type="range" value={fullscreenCover.visualizerSensitivity} onChange={(event) => { markAppearanceCustom(); setFullscreenCover((current) => ({ ...current, visualizerSensitivity: Number(event.target.value), useSharedDefault: false, applyToAll: false })); }}/><small>{fullscreenCover.visualizerSensitivity.toFixed(2)}</small></label>
              <label className="field field-compact"><span>Smoothing</span><input max="0.95" min="0.05" step="0.05" type="range" value={fullscreenCover.visualizerSmoothing} onChange={(event) => { markAppearanceCustom(); setFullscreenCover((current) => ({ ...current, visualizerSmoothing: Number(event.target.value), useSharedDefault: false, applyToAll: false })); }}/><small>{Math.round(fullscreenCover.visualizerSmoothing * 100)}%</small></label>
              <p className="appearance-help">Enhanced default: orange bars directly below the cover and above lower-third subtitles. Use the position sliders or unlock the visual to move it.</p>
            </div>
          ) : null}

          {fullscreenAppearanceTab === "subtitles" ? (
            <div className="appearance-form-grid">
              <label className="field field-compact"><span>Subtitle size</span><select value={subtitleScale} onChange={(event) => handleSubtitleScaleChange(event.target.value as SubtitleScale)}><option value="standard">Standard</option><option value="large">Large</option><option value="x-large">Extra large</option></select></label>
              <label className="field field-compact"><span>Line height</span><select value={subtitleLineHeight} onChange={(event) => handleSubtitleLineHeightChange(event.target.value as SubtitleLineHeight)}><option value="tight">Tight</option><option value="standard">Standard</option><option value="relaxed">Relaxed</option></select></label>
              <label className="field field-compact"><span>Subtitle position</span><select value={subtitlePosition} onChange={(event) => handleSubtitlePositionChange(event.target.value as SubtitlePosition)}><option value="lower-third">Lower third</option><option value="center">Center</option><option value="raised">Raised</option></select></label>
              <label className="field field-compact"><span>Contrast</span><select value={subtitleContrast} onChange={(event) => handleSubtitleContrastChange(event.target.value as SubtitleContrast)}><option value="solid">Solid</option><option value="soft">Soft</option><option value="glow">Glow</option></select></label>
              <label className="field field-compact"><span>Text color</span><select value={subtitleTextColor} onChange={(event) => handleSubtitleTextColorChange(event.target.value as SubtitleTextColor)}>{["white","yellow","gold","orange","red","pink","blue","cyan","green","black"].map((key) => <option key={key} value={key}>{key[0].toUpperCase()+key.slice(1)}</option>)}</select></label>
              <label className="field field-compact"><span>Text background</span><select value={subtitleBackground} onChange={(event) => handleSubtitleBackgroundChange(event.target.value as SubtitleBackground)}>{["none","black","white","dark-gray","yellow","gold","red","blue","navy"].map((key) => <option key={key} value={key}>{key.replace(/-/g," ").replace(/\b\w/g,(c)=>c.toUpperCase())}</option>)}</select></label>
              <label className="field field-compact"><span>Controls auto-hide</span><select value={fullscreenAutoHideMs} onChange={(event) => handleFullscreenAutoHideChange(Number(event.target.value) as FullscreenAutoHide)}><option value="1500">1.5 sec</option><option value="2500">2.5 sec</option><option value="4000">4 sec</option><option value="6000">6 sec</option></select></label>
            </div>
          ) : null}
        </div>
      </section>
    );
  }

  function renderMetaGrid() {
    return (
      <dl className="meta-grid">
        <div>
          <dt>Author</dt>
          <dd>{item?.media.metadata.authorName ?? "Unknown author"}</dd>
        </div>
        <div>
          <dt>Narrator</dt>
          <dd>{item?.media.metadata.narratorName ?? "Unknown narrator"}</dd>
        </div>
        <div>
          <dt>Subtitle source</dt>
          <dd>{subtitleSourceLabel}</dd>
        </div>
        <div>
          <dt>Track</dt>
          <dd>{activeTrack?.title ?? "Waiting for playback"}</dd>
        </div>
      </dl>
    );
  }

  function renderSubtitlePrompt() {
    const promptTitle = hasLoadedSubtitles
      ? "Press start to bring subtitles into view."
      : "Pick a subtitle file to turn on read-along mode.";
    const promptBody = isFullscreen && !hasLoadedSubtitles
      ? "No subtitle file is loaded yet. Exit full screen to choose an Audiobookshelf subtitle or upload your own .srt or .vtt file."
      : hasLoadedSubtitles
        ? "Your subtitle file is ready. Start playback and the active line will appear here."
        : serverSubtitleFiles.length
          ? "We found subtitle files in Audiobookshelf, but none are loaded yet. Open subtitle options to choose one."
          : "No subtitle file is loaded yet. Open subtitle options to pick an Audiobookshelf subtitle or upload your own .srt or .vtt file.";

    return (
      <article className="subtitle-prompt-card">
        <div>
          <p className="subtitle-prompt-title">{promptTitle}</p>
          <p className="subtitle-prompt-copy">{promptBody}</p>
        </div>

        {!isFullscreen ? (
          <div className="subtitle-prompt-actions">
            <button
              className="button button-secondary"
              onClick={() => setIsOptionsOpen(true)}
              type="button"
            >
              Subtitle options
            </button>

            {!serverSubtitleFiles.length ? (
              <button
                className="button button-secondary"
                onClick={() => subtitleUploadRef.current?.click()}
                type="button"
              >
                Upload subtitles
              </button>
            ) : null}
          </div>
        ) : null}
      </article>
    );
  }

  function renderSubtitleStage() {
    return (
      <section className="subtitle-stage" style={isFullscreen ? subtitleStageStyle : undefined}>
        {!isDock && !isFullscreen ? <div className="subtitle-tools">{renderSubtitleTools()}</div> : null}

        {shouldShowLyricsStage ? (
          <article
            className={`subtitle-card subtitle-card-contrast-${subtitleContrast} subtitle-card-color-${subtitleTextColor} subtitle-card-background-${subtitleBackground} ${
              isFullscreen ? `subtitle-card-position-${subtitlePosition}` : ""
            } ${
              hasLoadedSubtitles ? "" : "subtitle-card-empty"
            }`.trim()}
          >
            {hasLoadedSubtitles && !shouldShowLoadedSubtitlePrompt ? (
              <p aria-live="polite" aria-atomic="true" className="subtitle-active">
                {activeSubtitleText || "\u00A0"}
              </p>
            ) : (
              renderSubtitlePrompt()
            )}
          </article>
        ) : (
          renderSubtitlePrompt()
        )}
      </section>
    );
  }

  function renderSubtitleDisplayOptions() {
    return (
      <section className="subtitle-display-options-wrap fullscreen-interactive-layer" onClick={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
        <div className="player-subpanel-head">
          <strong>Subtitle display</strong>
          <button
            aria-label="Close subtitle display options"
            className="button button-secondary button-compact player-subpanel-close"
            onClick={() => setIsSubtitleDisplayOptionsOpen(false)}
            type="button"
          >
            Close
          </button>
        </div>
        <div className="subtitle-display-options-grid">
        <label className="field field-compact">
          <span>Subtitle size</span>
          <select
            onChange={(event) => handleSubtitleScaleChange(event.target.value as SubtitleScale)}
            value={subtitleScale}
          >
            <option value="standard">Standard</option>
            <option value="large">Large</option>
            <option value="x-large">Extra large</option>
          </select>
        </label>

        <label className="field field-compact">
          <span>Line height</span>
          <select
            onChange={(event) => handleSubtitleLineHeightChange(event.target.value as SubtitleLineHeight)}
            value={subtitleLineHeight}
          >
            <option value="tight">Tight</option>
            <option value="standard">Standard</option>
            <option value="relaxed">Relaxed</option>
          </select>
        </label>

        <label className="field field-compact">
          <span>Subtitle position</span>
          <select
            onChange={(event) => handleSubtitlePositionChange(event.target.value as SubtitlePosition)}
            value={subtitlePosition}
          >
            <option value="center">Center</option>
            <option value="raised">Raised</option>
            <option value="lower-third">Lower third</option>
          </select>
        </label>

        <label className="field field-compact">
          <span>Contrast</span>
          <select
            onChange={(event) => handleSubtitleContrastChange(event.target.value as SubtitleContrast)}
            value={subtitleContrast}
          >
            <option value="solid">Solid</option>
            <option value="soft">Soft</option>
            <option value="glow">Glow</option>
          </select>
        </label>

        <label className="field field-compact">
          <span>Text color</span>
          <select
            onChange={(event) => handleSubtitleTextColorChange(event.target.value as SubtitleTextColor)}
            value={subtitleTextColor}
          >
            <option value="white">White</option>
            <option value="yellow">Yellow</option>
            <option value="gold">Gold</option>
            <option value="orange">Orange</option>
            <option value="red">Red</option>
            <option value="pink">Pink</option>
            <option value="blue">Blue</option>
            <option value="cyan">Cyan</option>
            <option value="green">Green</option>
            <option value="black">Black</option>
          </select>
        </label>

        <label className="field field-compact">
          <span>Text background</span>
          <select
            onChange={(event) => handleSubtitleBackgroundChange(event.target.value as SubtitleBackground)}
            value={subtitleBackground}
          >
            <option value="none">None</option>
            <option value="black">Black</option>
            <option value="white">White</option>
            <option value="dark-gray">Dark gray</option>
            <option value="yellow">Yellow</option>
            <option value="gold">Gold</option>
            <option value="red">Red</option>
            <option value="blue">Blue</option>
            <option value="navy">Navy</option>
          </select>
        </label>

        <label className="field field-compact">
          <span>Hide controls</span>
          <select
            onChange={(event) =>
              handleFullscreenAutoHideChange(Number(event.target.value) as FullscreenAutoHide)
            }
            value={fullscreenAutoHideMs}
          >
            <option value={1500}>1.5s</option>
            <option value={2500}>2.5s</option>
            <option value={4000}>4s</option>
            <option value={6000}>6s</option>
          </select>
        </label>
        </div>
      </section>
    );
  }

  function renderCollapsedTransport() {
    const fullscreenLabel = isFullscreen ? "Exit full screen" : "Enter full screen";
    return (
      <section
        className={`transport transport-collapsed ${isFullscreen ? "transport-fullscreen fullscreen-interactive-layer" : ""}`.trim()}
        aria-label="Collapsed player controls"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="transport-collapsed-row">
          <button
            aria-label="Show full player controls"
            className="icon-button transport-action-button fullscreen-button transport-collapse-toggle"
            onClick={() => { setIsTransportCollapsed(false); revealFullscreenControls(true); }}
            title="Show player controls"
            type="button"
          >
            <span aria-hidden="true">⌄</span>
          </button>
          <span className="transport-collapsed-label">Player controls</span>
          <div className="transport-collapsed-actions">
            <button
              aria-label="Appearance settings"
              className={`icon-button transport-action-button fullscreen-button ${isFullscreenAppearanceOpen ? "transport-action-button-active" : ""}`.trim()}
              onClick={() => { if (isFullscreen) openFullscreenAppearance(fullscreenAppearanceTab); else setPlayerStatus("Appearance settings are available in fullscreen mode."); }}
              title="Appearance settings"
              type="button"
            >
              <span aria-hidden="true">⚙</span>
            </button>
            <button
              aria-label="Subtitle display options"
              className={`icon-button transport-action-button fullscreen-button ${isSubtitleDisplayOptionsOpen ? "transport-action-button-active" : ""}`.trim()}
              onClick={() => { if (isFullscreen) toggleSubtitleDisplayOptions(); else setIsSubtitleDisplayOptionsOpen((current) => !current); }}
              title="Subtitle display options"
              type="button"
            >
              <span aria-hidden="true" className="subtitle-options-glyph">A<small>a</small></span>
            </button>
            <button
              aria-label={fullscreenLabel}
              className="icon-button transport-action-button fullscreen-button"
              onClick={() => { revealFullscreenControls(true); void toggleFullscreen(); }}
              title={fullscreenLabel}
              type="button"
            >
              <svg aria-hidden="true" viewBox="0 0 20 20">
                <path d="M3 8V3h5" /><path d="M12 3h5v5" /><path d="M17 12v5h-5" /><path d="M8 17H3v-5" />
              </svg>
            </button>
          </div>
        </div>
      </section>
    );
  }

  function renderTransport() {
    const primaryLabel = !session ? "Start playback" : isPlaying ? "Pause playback" : "Resume playback";
    const fullscreenLabel = isFullscreen ? "Exit full screen" : "Enter full screen";
    const volumePercent = Math.round(volume * 100);
    const timeModeLabel = timeDisplayMode === "remaining" ? "Show elapsed time" : "Show remaining time";
    const timelineDisplay =
      timeDisplayMode === "remaining"
        ? `-${formatTime(Math.max(totalDuration - currentTime, 0))}`
        : formatTime(currentTime);

    if (isTransportCollapsed) {
      return renderCollapsedTransport();
    }

    return (
      <section
        className={`transport ${isFullscreen ? "transport-fullscreen fullscreen-interactive-layer" : ""}`.trim()}
        onBlur={(event) => {
          if (!isFullscreen) {
            return;
          }

          const nextFocused = event.relatedTarget;

          if (nextFocused instanceof Node && event.currentTarget.contains(nextFocused)) {
            return;
          }

          revealFullscreenControls();
        }}
        onFocus={() => {
          if (isFullscreen) {
            revealFullscreenControls(true);
          }
        }}
      >
        <div className="transport-topline">
          <div className="transport-timeline">
            <button
              aria-label={timeModeLabel}
              className="progress-pill progress-pill-button"
              onClick={() =>
                setTimeDisplayMode((current) => (current === "elapsed" ? "remaining" : "elapsed"))
              }
              title={timeModeLabel}
              type="button"
            >
              <span>{timelineDisplay}</span>
              <span>/</span>
              <span>{formatTime(totalDuration)}</span>
            </button>

            {chapterLabel ? (
              <button
                aria-expanded={isChapterListOpen}
                aria-haspopup="listbox"
                className={`chapter-pill chapter-pill-button ${
                  isChapterListOpen ? "chapter-pill-button-active" : ""
                }`.trim()}
                onClick={() => {
                  setIsChapterListOpen((current) => !current);
                  revealFullscreenControls(true);
                }}
                type="button"
              >
                {chapterLabel}
              </button>
            ) : null}
          </div>

          <div className="transport-settings">
            <label className="speed-control">
              <span>Speed</span>
              <select
                onChange={(event) => handlePlaybackRateChange(Number(event.target.value))}
                value={playbackRate}
              >
                {[0.8, 1, 1.15, 1.25, 1.4, 1.5, 1.75, 2].map((speed) => (
                  <option key={speed} value={speed}>
                    {speed}x
                  </option>
                ))}
              </select>
            </label>

            <label className="volume-control">
              <span>Volume</span>
              <input
                aria-label="Player volume"
                className="volume-slider"
                max={1}
                min={0}
                onChange={(event) => handleVolumeChange(Number(event.target.value))}
                step={0.01}
                style={{ "--volume-percent": `${volumePercent}%` } as CSSProperties}
                type="range"
                value={volume}
              />
              <output aria-live="off" className="volume-value">
                {volumePercent}%
              </output>
            </label>

            <details className="sleep-timer-popover">
              <summary>
                <span>Sleep timer</span>
                <output aria-live="polite">
                  {sleepTimer.selection === "off" ? "Off" : formatSleepTimer(sleepTimer.remainingSeconds)}
                </output>
              </summary>
              <div aria-label="Sleep timer choices" className="sleep-timer-panel" role="group">
                <div className="sleep-timer-options">
                {([
                  ["off", "Off"],
                  [15, "15m"],
                  [30, "30m"],
                  [45, "45m"],
                  [60, "60m"],
                  ["chapter", "Chapter"],
                ] as Array<[SleepTimerSelection, string]>).map(([value, label]) => (
                  <button
                    aria-pressed={sleepTimer.selection === value}
                    className={`sleep-timer-option ${sleepTimer.selection === value ? "sleep-timer-option-active" : ""}`}
                    disabled={value === "chapter" && !activeChapter}
                    key={String(value)}
                    onClick={(event) => {
                      sleepTimer.setSelection(value);
                      event.currentTarget.closest("details")?.removeAttribute("open");
                    }}
                    type="button"
                  >
                    {label}
                  </button>
                ))}
                </div>
                <p>Choose a duration or stop at the end of the current chapter.</p>
              </div>
            </details>

            <details
              className="bookmark-popover"
              open={isBookmarksOpen}
              onToggle={(event) => setIsBookmarksOpen(event.currentTarget.open)}
            >
              <summary aria-label={`Bookmarks${bookmarks.length ? ` (${bookmarks.length})` : ""}`} title="Bookmarks">
                <span className="bookmark-summary-icon" aria-hidden="true">
                  <svg viewBox="0 0 20 20">
                    <path d="M5.5 3.5h9v13l-4.5-3-4.5 3z" />
                  </svg>
                </span>
                <span className="bookmark-summary-label">Bookmarks</span>
                <output aria-live="polite">{bookmarks.length}</output>
              </summary>
              <div aria-label="Bookmark choices" className="bookmark-panel" role="group">
                {bookmarks.length ? (
                  <>
                    <div className="bookmark-list">
                      {bookmarks.map((bookmark) => (
                        <div className="bookmark-row" key={bookmark.id}>
                          <button className="bookmark-jump" onClick={() => jumpToBookmark(bookmark)} type="button">
                            <span>{formatTime(bookmark.time)}</span>
                            <small>{bookmark.chapterTitle ?? "Bookmark"}</small>
                          </button>
                          <button
                            aria-label={`Remove bookmark at ${formatTime(bookmark.time)}`}
                            className="bookmark-remove"
                            onClick={() => removeBookmark(bookmark.id)}
                            title="Remove bookmark"
                            type="button"
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                    <button className="bookmark-clear" onClick={clearBookmarks} type="button">Clear all bookmarks</button>
                  </>
                ) : (
                  <p>No bookmarks yet. Press <kbd>B</kbd> to save the current position.</p>
                )}
              </div>
            </details>

          </div>
        </div>

        <div className="progress-track-wrap">
          <input
          aria-label={`Playback position, ${formatTime(currentTime)} of ${formatTime(totalDuration)}`}
          className="progress-slider"
          max={Math.max(totalDuration, 1)}
          min={0}
          onChange={(event) => {
            handleSeek(Number(event.target.value));
            revealFullscreenControls();
          }}
          step={0.1}
          type="range"
          value={Math.min(currentTime, Math.max(totalDuration, 1))}
        />
        {totalDuration > 0 ? (
          <div className="progress-bookmark-markers">
            {bookmarks.map((bookmark) => (
              <button
                aria-label={`Jump to bookmark at ${formatTime(bookmark.time)}`}
                className="progress-bookmark-marker"
                key={bookmark.id}
                onClick={() => jumpToBookmark(bookmark)}
                style={{ left: `${Math.min(Math.max(bookmark.time / totalDuration, 0), 1) * 100}%` }}
                title={`Bookmark ${formatTime(bookmark.time)}`}
                type="button"
              />
            ))}
          </div>
        ) : null}
        </div>

        <div className="transport-controls">
          <div className="transport-controls-main">
            <button
              aria-label="Previous chapter"
              className="icon-button transport-action-button transport-chapter-button"
              disabled={!hasPreviousChapter}
              onClick={() => {
                handleChapterStep("previous");
                revealFullscreenControls();
              }}
              title="Previous chapter"
              type="button"
            >
              <svg aria-hidden="true" viewBox="0 0 20 20">
                <path d="M6 4v12" />
                <path d="M14 5l-6 5 6 5" />
              </svg>
            </button>

            <button
              aria-label="Back 15 seconds"
              className="icon-button transport-action-button"
              onClick={() => {
                handleRelativeSeek(-15);
                revealFullscreenControls();
              }}
              title="Back 15 seconds"
              type="button"
            >
              <svg aria-hidden="true" viewBox="0 0 20 20">
                <path d="M11 5l-5 5 5 5" />
                <path d="M16 5l-5 5 5 5" />
              </svg>
            </button>

            <button
              aria-label={primaryLabel}
              className="icon-button transport-action-button"
              disabled={busyAction === "starting"}
              onClick={() => {
                void handlePrimaryTransport();
                revealFullscreenControls(true);
              }}
              title={busyAction === "starting" ? "Starting playback" : primaryLabel}
              type="button"
            >
              {isPlaying ? (
                <svg aria-hidden="true" viewBox="0 0 20 20">
                  <path d="M8 5v10" />
                  <path d="M12 5v10" />
                </svg>
              ) : (
                <svg aria-hidden="true" viewBox="0 0 20 20">
                  <path d="M7 5.5l7 4.5-7 4.5z" />
                </svg>
              )}
            </button>

            <button
              aria-label="Forward 30 seconds"
              className="icon-button transport-action-button"
              onClick={() => {
                handleRelativeSeek(30);
                revealFullscreenControls();
              }}
              title="Forward 30 seconds"
              type="button"
            >
              <svg aria-hidden="true" viewBox="0 0 20 20">
                <path d="M9 5l5 5-5 5" />
                <path d="M4 5l5 5-5 5" />
              </svg>
            </button>

            <button
              aria-label="Next chapter"
              className="icon-button transport-action-button transport-chapter-button"
              disabled={!hasNextChapter}
              onClick={() => {
                handleChapterStep("next");
                revealFullscreenControls();
              }}
              title="Next chapter"
              type="button"
            >
              <svg aria-hidden="true" viewBox="0 0 20 20">
                <path d="M14 4v12" />
                <path d="M6 5l6 5-6 5" />
              </svg>
            </button>
          </div>

          <div className="transport-controls-side">
            <button
              aria-label="Minimize player controls"
              className="icon-button transport-action-button fullscreen-button"
              onClick={() => { setIsTransportCollapsed(true); revealFullscreenControls(true); }}
              title="Minimize player controls"
              type="button"
            >
              <span aria-hidden="true">⌃</span>
            </button>
            <button
              aria-expanded={isShortcutHelpOpen}
              aria-label="Keyboard shortcuts"
              className="icon-button transport-action-button fullscreen-button"
              onClick={() => setIsShortcutHelpOpen((current) => !current)}
              title="Keyboard shortcuts (?)"
              type="button"
            >
              ?
            </button>
            <button
              aria-expanded={isFullscreen ? isFullscreenAppearanceOpen : false}
              aria-label="Appearance settings"
              className={`icon-button transport-action-button fullscreen-button ${isFullscreenAppearanceOpen ? "transport-action-button-active" : ""}`.trim()}
              onClick={() => { if (isFullscreen) openFullscreenAppearance(fullscreenAppearanceTab); else setPlayerStatus("Appearance settings are available in fullscreen mode."); }}
              title="Appearance settings"
              type="button"
            >
              <svg aria-hidden="true" viewBox="0 0 20 20">
                <path d="M5 5h10v10H5z" />
                <path d="M7 7h6M7 10h6M7 13h4" />
              </svg>
            </button>
            <button
              aria-expanded={isFullscreen ? isSubtitleDisplayOptionsOpen : false}
              aria-label="Subtitle display options"
              className={`icon-button transport-action-button fullscreen-button ${isSubtitleDisplayOptionsOpen ? "transport-action-button-active" : ""}`.trim()}
              onClick={() => { if (isFullscreen) toggleSubtitleDisplayOptions(); else setIsSubtitleDisplayOptionsOpen((current) => !current); }}
              title="Subtitle display options"
              type="button"
            >
              <span aria-hidden="true" className="subtitle-options-glyph">A<small>a</small></span>
            </button>


            <button
              aria-label="Pop out player"
              className="icon-button transport-action-button fullscreen-button"
              onClick={() => {
                revealFullscreenControls(true);
                openPopout();
              }}
              title="Pop out player"
              type="button"
            >
              <svg aria-hidden="true" viewBox="0 0 20 20">
                <path d="M11 4h5v5" />
                <path d="M10 10l6-6" />
                <path d="M8 4H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-3" />
              </svg>
            </button>

            {onHide ? (
              <button
                aria-label="Close player"
                className="icon-button transport-action-button fullscreen-button"
                onClick={() => {
                  if (isFullscreen) void exitFullscreenSafely(panelRef.current);
                  onHide();
                }}
                title="Close player"
                type="button"
              >
                <svg aria-hidden="true" viewBox="0 0 20 20"><path d="M5 5l10 10"/><path d="M15 5L5 15"/></svg>
              </button>
            ) : null}

            <button
              aria-label={fullscreenLabel}
              className="icon-button transport-action-button fullscreen-button"
              onClick={() => {
                revealFullscreenControls(true);
                void toggleFullscreen();
              }}
              title={fullscreenLabel}
              type="button"
            >
              <svg aria-hidden="true" viewBox="0 0 20 20">
                <path d="M3 8V3h5" />
                <path d="M12 3h5v5" />
                <path d="M17 12v5h-5" />
                <path d="M8 17H3v-5" />
              </svg>
            </button>
          </div>
        </div>


        {isShortcutHelpOpen ? (
          <section aria-label="Keyboard shortcuts" className="transport-subpanel shortcut-help-panel fullscreen-interactive-layer">
            <div className="player-subpanel-head">
              <strong>Keyboard shortcuts</strong>
              <button
                aria-label="Close keyboard shortcuts"
                className="button button-secondary button-compact player-subpanel-close"
                onClick={() => setIsShortcutHelpOpen(false)}
                type="button"
              >
                Close
              </button>
            </div>
            <p><kbd>Space</kbd>/<kbd>K</kbd> play or pause · <kbd>J</kbd>/<kbd>L</kbd> back/forward 10s</p>
            <p><kbd>←</kbd>/<kbd>→</kbd> back 15s/forward 30s · <kbd>Shift</kbd> + arrows change chapter</p>
            <p><kbd>M</kbd> mute · <kbd>B</kbd> bookmark · <kbd>F</kbd> full screen · <kbd>?</kbd> toggle this help</p>
          </section>
        ) : null}

        {isChapterListOpen && chapters.length ? (
          <section className="chapter-picker fullscreen-interactive-layer">
            <div className="chapter-list" role="list">
              {chapters.map((chapter, index) => {
                const isActiveChapter = index === activeChapterIndex;

                return (
                  <button
                    aria-current={isActiveChapter ? "true" : undefined}
                    className={`chapter-option ${isActiveChapter ? "chapter-option-active" : ""}`.trim()}
                    key={chapter.id ?? `${chapter.start}-${chapter.end}-${index}`}
                    onClick={() => {
                      handleChapterJump(chapter, index);
                      revealFullscreenControls();
                    }}
                    type="button"
                  >
                    <span className="chapter-option-title">{getChapterTitle(chapter, index)}</span>
                    <span className="chapter-option-meta">{formatTime(chapter.start)}</span>
                  </button>
                );
              })}
            </div>
          </section>
        ) : null}

        <div className="transport-meta">
          <span>{item?.media.metadata.title ?? "Waiting for audiobook"}</span>
          <span>{Math.round(progressValue * 100)}% complete</span>
        </div>
      </section>
    );
  }

  function renderFooterMeta() {
    const shouldShowSubtitleMeta = shouldShowLyricsStage;
    const footerNotice = playerError ?? subtitleError ?? playerStatus ?? subtitleStatus;
    const footerNoticeIsError = Boolean(playerError || subtitleError);

    if (!shouldShowSubtitleMeta && !footerNotice && !progressSaveNotice) {
      return null;
    }

    return (
      <section className="player-footer">
        {progressSaveNotice ? <div className={`progress-save-feedback ${progressSaveNotice.state === "failed" ? "progress-save-feedback-failed" : ""}`} role="status" aria-live="polite">
          <span>{progressSaveNotice.message}</span>
          {progressSaveNotice.state === "failed" && progressSaveNotice.retryable ? <button className="button book-action-secondary button-compact" onClick={() => { const failed = failedCheckpointRef.current; if (failed) void syncToAudiobookshelf(failed.mode, { silent: true }); }} type="button">Retry now</button> : null}
        </div> : null}
        <div className={`player-footer-row ${shouldShowSubtitleMeta ? "" : "player-footer-row-end"}`.trim()}>
          {footerNotice || shouldShowSubtitleMeta ? (
            <div className="player-footer-notice" aria-live="polite">
              {footerNotice ? (
                <p role={footerNoticeIsError ? "alert" : "status"} className={`status-message ${footerNoticeIsError ? "status-error" : ""}`.trim()}>
                  {footerNotice}
                </p>
              ) : (
                <p aria-hidden="true" className="status-message player-footer-placeholder">
                  .
                </p>
              )}
            </div>
          ) : null}

        </div>
      </section>
    );
  }

  function renderActionButtons() {
    return (
      <div className="player-actions">
        <button
          className="button button-secondary"
          disabled={busyAction === "starting"}
          onClick={() => {
            void startPlayback(true);
          }}
          type="button"
        >
          Restart synced playback
        </button>

        <button
          className="button button-secondary"
          disabled={busyAction === "refreshing"}
          onClick={() => {
            void pullLatestServerProgress();
          }}
          type="button"
        >
          Pull latest server progress
        </button>

        <button
          className="button button-secondary"
          disabled={busyAction === "syncing" || !hasActiveSession}
          onClick={() => {
            void syncToAudiobookshelf("sync", { refreshItem: true });
          }}
          type="button"
        >
          Force sync to Audiobookshelf
        </button>

      </div>
    );
  }

  if (!item) {
    return (
      <section className="empty-player">
        <p className="status-message">Choose an audiobook to start synced playback and subtitles.</p>
      </section>
    );
  }

  return (
    <section
      ref={panelRef}
      className={`player-panel ${isDock ? "player-panel-dock" : "player-panel-full"} ${
        focusMode ? "player-panel-focus" : ""
      } ${isBrowserFullscreen ? "player-panel-fullscreen" : ""} ${
        isInlineFullscreen ? "player-panel-inline-fullscreen" : ""
      } ${
        shouldShowLyricsStage ? "player-panel-reading" : "player-panel-compact"
      } ${isFullscreen && !shouldShowFullscreenControls ? "player-panel-fullscreen-controls-hidden" : ""}`}
      onKeyDownCapture={() => {
        if (isFullscreen) {
          revealFullscreenControls(true);
        }
      }}
      onMouseMove={() => {
        if (isFullscreen) {
          revealFullscreenControls();
        }
      }}
    >
      <audio
        onEnded={handleEnded}
        onLoadedMetadata={handleLoadedMetadata}
        onPause={handlePause}
        onPlay={handlePlay}
        onTimeUpdate={handleTimeUpdate}
        preload="metadata"
        ref={audioRef}
      />

      {!isFullscreen && focusMode ? (
        <header className="focus-mode-header">
          <div className="book-summary">
            <img alt="" className="book-cover-large" src={`/api/items/${item.id}/cover`} />

            <div className="book-summary-meta">
              <div>
                <p className="eyebrow">Focused Player</p>
                <h2>{item.media.metadata.title}</h2>
                <p className="panel-description">
                  {item.media.metadata.authorName ?? "Unknown author"}
                  {item.media.metadata.narratorName ? ` / ${item.media.metadata.narratorName}` : ""}
                </p>
              </div>

              <div className="focus-mode-meta">
                <span>{formatTime(currentTime)} in play</span>
                <span>{formatTime(totalDuration)} total</span>
                <span>{subtitleSourceLabel}</span>
              </div>

              {renderMetaGrid()}
            </div>
          </div>
        </header>
      ) : null}

      {!isDock && !focusMode && !isFullscreen ? (
        <header className="book-summary">
          <img alt="" className="book-cover-large" src={`/api/items/${item.id}/cover`} />

          <div className="book-summary-meta">
            <div>
              <p className="eyebrow">Synced Player</p>
              <h2>{item.media.metadata.title}</h2>
              <p className="panel-description">
                {item.media.metadata.authorName ?? "Unknown author"}
                {item.media.metadata.narratorName ? ` / ${item.media.metadata.narratorName}` : ""}
              </p>
            </div>

            {renderMetaGrid()}
          </div>
        </header>
      ) : null}

      {isFullscreen ? (
        <div
          className="player-panel-fullscreen-stage"
          onClick={handleFullscreenStageTap}
          style={fullscreenStageStyle}
        >
          {fullscreenCover.backgroundPattern !== "none" ? (
            <div className="fullscreen-background-pattern-layer" style={{ backgroundImage: FULLSCREEN_BACKGROUND_PATTERNS[fullscreenCover.backgroundPattern], opacity: fullscreenCover.backgroundPatternOpacity }} aria-hidden="true" />
          ) : null}
          {fullscreenCover.visualizerEnabled ? (
            <canvas
              aria-hidden="true"
              className={`fullscreen-audio-visualizer ${fullscreenCover.visualizerLocked ? "visualizer-locked" : "visualizer-editing"}`.trim()}
              ref={(node) => { visualizerCanvasRef.current = node; }}
              onPointerDown={handleVisualizerPointerDown}
              onPointerMove={handleVisualizerPointerMove}
              onPointerUp={handleVisualizerPointerUp}
              onPointerCancel={handleVisualizerPointerUp}
              style={{ left: `calc(50% + ${fullscreenCover.visualizerX}%)`, opacity: fullscreenCover.visualizerOpacity, top: `calc(50% + ${fullscreenCover.visualizerY}%)`, transform: `translate(-50%, -50%) scale(${fullscreenCover.visualizerScale})`, filter: `drop-shadow(0 0 ${fullscreenCover.visualizerGlow}px ${FULLSCREEN_BACKGROUND_COLORS[fullscreenCover.visualizerColor]})`, pointerEvents: fullscreenCover.visualizerLocked ? "none" : "auto" }}
            />
          ) : null}
          {fullscreenCover.visible ? (
            <>
              <div
                aria-hidden="true"
                className="fullscreen-cover-backdrop"
                style={{
                  backgroundImage: `url("/api/items/${item.id}/cover")`,
                  filter: `blur(${fullscreenCover.backdropBlur}px)`,
                  opacity: fullscreenCover.backdropOpacity,
                }}
              />
              <div
                aria-label="Book cover. Click to unlock cover positioning."
                className={`fullscreen-cover-art ${isFullscreenCoverEditing ? "fullscreen-cover-art-editing" : ""}`.trim()}
                onClick={(event) => {
                  event.stopPropagation();
                  revealFullscreenControls(true);
                }}
                onDoubleClick={(event) => {
                  event.stopPropagation();
                  if (isFullscreenCoverEditing) resetFullscreenCover();
                }}
                onPointerCancel={handleFullscreenCoverPointerUp}
                onPointerDown={handleFullscreenCoverPointerDown}
                onPointerMove={handleFullscreenCoverPointerMove}
                onPointerUp={handleFullscreenCoverPointerUp}
                onWheel={handleFullscreenCoverWheel}
                role="button"
                style={{
                  left: `calc(50% + ${fullscreenCover.x}%)`,
                  opacity: fullscreenCover.opacity,
                  top: `calc(50% + ${fullscreenCover.y}%)`,
                  transform: `translate(-50%, -50%) scale(${fullscreenCover.scale})`,
                }}
                tabIndex={0}
              >
                <div className="fullscreen-cover-image-frame">
                  <img alt="" draggable={false} src={`/api/items/${item.id}/cover`} />
                </div>
              </div>
              <div aria-hidden="true" className="fullscreen-cover-overlay" />
              {isFullscreenCoverEditing ? (
                <section className="fullscreen-cover-editor fullscreen-interactive-layer" onClick={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
                  <div className="fullscreen-cover-editor-head">
                    <strong>Cover editor</strong>
                    <div className="fullscreen-cover-editor-actions">
                      <button
                        aria-pressed={isFullscreenCoverEditing}
                        className="button button-secondary button-compact"
                        onClick={() => setIsFullscreenCoverEditing(false)}
                        type="button"
                      >
                        Lock
                      </button>
                      <button
                        aria-label="Close cover editor"
                        className="button button-secondary button-compact"
                        onClick={() => setIsFullscreenCoverEditing(false)}
                        type="button"
                      >
                        Close
                      </button>
                    </div>
                  </div>
                  <label className="field field-compact">
                    <span>Size</span>
                    <input
                      max="1.35"
                      min="0.45"
                      onChange={(event) => setFullscreenCover((current) => ({ ...current, scale: Number(event.target.value) }))}
                      step="0.01"
                      type="range"
                      value={fullscreenCover.scale}
                    />
                    <small>{Math.round(fullscreenCover.scale * 100)}%</small>
                  </label>
                  <label className="field field-compact">
                    <span>Image opacity</span>
                    <input
                      max="1"
                      min="0.1"
                      onChange={(event) => setFullscreenCover((current) => ({ ...current, opacity: Number(event.target.value) }))}
                      step="0.01"
                      type="range"
                      value={fullscreenCover.opacity}
                    />
                    <small>{Math.round(fullscreenCover.opacity * 100)}%</small>
                  </label>
                  <label className="field field-compact">
                    <span>Fullscreen background</span>
                    <select
                      value={fullscreenCover.backgroundColor}
                      onChange={(event) =>
                        setFullscreenCover((current) => ({
                          ...current,
                          backgroundColor: event.target.value as FullscreenBackgroundColor,
                        }))
                      }
                    >
                      <option value="black">Black</option>
                      <option value="near-black">Near black</option>
                      <option value="charcoal">Charcoal</option>
                      <option value="dark-gray">Dark gray</option>
                      <option value="gray">Gray</option>
                      <option value="slate">Slate gray</option>
                      <option value="silver">Silver gray</option>
                      <option value="white">White</option>
                      <option value="navy">Navy</option>
                      <option value="blue">Blue</option>
                      <option value="teal">Teal</option>
                      <option value="green">Green</option>
                      <option value="purple">Purple</option>
                      <option value="red">Deep red</option>
                      <option value="brown">Brown</option>
                    </select>
                  </label>
                  <button
                    aria-pressed={fullscreenCover.visible}
                    className="button button-secondary button-compact"
                    onClick={() => {
                      setFullscreenCover((current) => ({ ...current, visible: !current.visible }));
                    }}
                    type="button"
                  >
                    {fullscreenCover.visible ? "Cover art: On" : "Cover art: Off"}
                  </button>
                  <label className="field field-compact">
                    <span>Ambient cover opacity</span>
                    <input
                      max="0.4"
                      min="0"
                      onChange={(event) => setFullscreenCover((current) => ({ ...current, backdropOpacity: Number(event.target.value) }))}
                      step="0.01"
                      type="range"
                      value={fullscreenCover.backdropOpacity}
                    />
                    <small>{Math.round(fullscreenCover.backdropOpacity * 100)}%</small>
                  </label>
                  <label className="field field-compact">
                    <span>Ambient blur</span>
                    <input
                      max="8"
                      min="0"
                      onChange={(event) => setFullscreenCover((current) => ({ ...current, backdropBlur: Number(event.target.value) }))}
                      step="1"
                      type="range"
                      value={fullscreenCover.backdropBlur}
                    />
                    <small>{fullscreenCover.backdropBlur}px</small>
                  </label>
                  <button className="button button-secondary button-compact" onClick={resetFullscreenCover} type="button">Reset position/size</button>
                  <p className="fullscreen-cover-editor-hint">Cover editing starts locked. Unlock with the lock button, then drag to move, scroll to zoom, or double-click to reset.</p>
                </section>
              ) : null}
            </>
          ) : null}
          {renderFullscreenAppearancePanel()}
          {isFullscreen && isSubtitleDisplayOptionsOpen ? (
            <section className="fullscreen-subtitle-options-panel fullscreen-interactive-layer" onClick={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
              {renderSubtitleDisplayOptions()}
            </section>
          ) : null}
          {renderSubtitleStage()}

          <div
            aria-hidden={!shouldShowFullscreenControls}
            className={`transport-shell-fullscreen ${
              shouldShowFullscreenControls ? "transport-shell-visible" : "transport-shell-hidden"
            }`.trim()}
            onClick={(event) => event.stopPropagation()}
          >
            {renderTransport()}
          </div>
        </div>
      ) : (
        <>
          {renderSubtitleStage()}
          {renderTransport()}
        </>
      )}
      {!isFullscreen ? renderFooterMeta() : null}

      {isDock && !isFullscreen ? (
        <details
          className="player-options-drawer"
          onToggle={(event) => setIsOptionsOpen(event.currentTarget.open)}
          open={isOptionsOpen}
        >
          <summary>Player options</summary>

          <div className="player-options-body">
            <p className="player-options-meta">
              Subtitle source, force sync, and pop out controls live here when the dock is collapsed.
            </p>
            {renderSubtitleTools()}
            {renderMetaGrid()}
            {renderActionButtons()}
          </div>
        </details>
      ) : !isFullscreen ? (
        renderActionButtons()
      ) : null}
    </section>
  );
}
