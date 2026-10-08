"use client";

// [Spoken Page Enhanced v1.3.15] CUSTOM MAINTAINER NOTES
// -----------------------------------------------------
// Enhanced dashboard additions: account-synced personal lists, SRT-ready
// filtering, safer list management, deletable personal lists, and visible Enhanced branding.
// [Enhanced v1.3.15] Every personal list is deletable after confirmation; list data uses
// the account preference namespace with legacy/local fallback for migration.
// Keep these changes when syncing or rebasing the project.

import { useEffect, useMemo, useRef, useState } from "react";
import { useLibrarySearch } from "@/components/library/use-library-search";
import { migrateLibraryPreferences, type LibraryPreferences } from "@/lib/library-preferences";
import { listeningState, type ProgressAction } from "@/lib/listening-status";
import { changeListeningProgress, PROGRESS_EVENT } from "@/lib/progress-client";
import { parseLibraryQuery } from "@/lib/library-query";
import { hasBrowseQuery, restoreBrowsePreferences } from "@/lib/browse-preferences";
import { bookSeries } from "@/lib/series";
import type { MediaProgress } from "@/lib/types";
import { PlayerPanel } from "@/components/player-panel";
import { BookDetails } from "@/components/library/book-details";
import { BookTile } from "@/components/library/book-tile";
import {
  formatDuration,
  libraryItemsById,
  BookProgressStatus,
  BookStatusOverrides,
  LibrarySort,
  ProgressFilter,
  stripSeriesSuffix,
  unloadedShelfIds,
} from "@/components/library/library-utils";
import {
  AuthorizedSummary,
  Library,
  LibraryFilterData,
  LibraryItemExpanded,
  LibraryItemMinified,
} from "@/lib/types";

const FAVORITES_STORAGE_KEY = "spoken-page-favorites";
const PLAYED_RECENTS_STORAGE_KEY = "spoken-page-played-recents";
const HIDDEN_RECENTS_STORAGE_KEY = "spoken-page-hidden-recents";
const QUEUE_STORAGE_KEY = "spoken-page-queue";
const STATUS_OVERRIDES_STORAGE_KEY = "spoken-page-status-overrides";
const LIBRARY_PREFERENCES_STORAGE_KEY = "spoken-page-library-v2";
const PERSONAL_LISTS_STORAGE_KEY = "spoken-page-personal-lists-v1";
const PERSONAL_LISTS_PREFERENCE_NAMESPACE = "personal-lists";
const SRT_INDEX_STORAGE_KEY = "spoken-page-srt-index-v1";

type PersonalListId = string;
type PersonalList = { id: PersonalListId; name: string; ids: string[] };
type SrtIndexCache = { scannedIds: string[]; srtIds: string[] };

const DEFAULT_PERSONAL_LISTS: PersonalList[] = [
  { id: "personal-list-1", name: "My Listen", ids: [] },
  { id: "personal-list-2", name: "My Favorites", ids: [] },
];

const EMPTY_SRT_INDEX: SrtIndexCache = { scannedIds: [], srtIds: [] };

function userStorageKey(base: string, userId: string) {
  return `${base}:${encodeURIComponent(userId)}`;
}

const EMPTY_BROWSE_FILTERS = {
  genre: "",
  tag: "",
  author: "",
  narrator: "",
  series: "",
  language: "",
};

type BrowseFilters = typeof EMPTY_BROWSE_FILTERS;
type BrowseFilterKey = keyof BrowseFilters;

type DashboardProps = {
  initialLibraries: Library[];
  initialProfile: AuthorizedSummary;
};

function parseStoredIds(value: string | null) {
  if (!value) {
    return [] as string[];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter((entry): entry is string => typeof entry === "string");
  } catch {
    return [];
  }
}

function parseStatusOverrides(value: unknown): BookStatusOverrides {
  if (typeof value === "string") {
    try {
      return parseStatusOverrides(JSON.parse(value) as unknown);
    } catch {
      return {};
    }
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, BookProgressStatus] =>
        entry[1] === "planned" || entry[1] === "unstarted" || entry[1] === "in-progress" || entry[1] === "finished",
    ),
  );
}

function parsePersonalLists(value: unknown) {
  if (typeof value === "string") {
    try {
      return parsePersonalLists(JSON.parse(value) as unknown);
    } catch {
      return DEFAULT_PERSONAL_LISTS.map((entry) => ({ ...entry, ids: [] }));
    }
  }

  const entries = Array.isArray(value) ? value : [];
  const parsed = entries
    .map((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
      const raw = entry as { id?: unknown; name?: unknown; ids?: unknown };
      if (typeof raw.id !== "string" || !/^personal-list-\d+$/.test(raw.id)) return null;
      const name = typeof raw.name === "string" && raw.name.trim()
        ? raw.name.trim().slice(0, 48)
        : `My List ${Number(raw.id.slice("personal-list-".length)) || 3}`;
      const ids = Array.isArray(raw.ids)
        ? raw.ids.filter((id): id is string => typeof id === "string")
        : [];
      return { id: raw.id, name, ids: [...new Set(ids)] };
    })
    .filter((entry): entry is PersonalList => Boolean(entry));

  if (!Array.isArray(value)) {
    return DEFAULT_PERSONAL_LISTS.map((entry) => ({ ...entry, ids: [] }));
  }

  // [Enhanced v1.0] Personal-list sync: a real stored array is authoritative.
  // Missing built-in
  // lists stay deleted instead of being silently recreated on reload/device sync.
  return parsed.sort((left, right) => Number(left.id.slice("personal-list-".length)) - Number(right.id.slice("personal-list-".length)));
}

function readSrtIndex(scope: string, libraryId: string) {
  try {
    const raw = window.localStorage.getItem(userStorageKey(SRT_INDEX_STORAGE_KEY, `${scope}:${libraryId}`));
    if (!raw) return EMPTY_SRT_INDEX;
    const parsed = JSON.parse(raw) as Partial<SrtIndexCache>;
    return {
      scannedIds: Array.isArray(parsed.scannedIds) ? parsed.scannedIds.filter((id): id is string => typeof id === "string") : [],
      srtIds: Array.isArray(parsed.srtIds) ? parsed.srtIds.filter((id): id is string => typeof id === "string") : [],
    };
  } catch {
    return EMPTY_SRT_INDEX;
  }
}

function writeSrtIndex(scope: string, libraryId: string, value: SrtIndexCache) {
  try {
    window.localStorage.setItem(
      userStorageKey(SRT_INDEX_STORAGE_KEY, `${scope}:${libraryId}`),
      JSON.stringify(value),
    );
  } catch {
    // Browser storage is only a cache; the SRT scan can be repeated.
  }
}

function hasSrtSubtitleFile(item: LibraryItemExpanded | null) {
  if (!item?.libraryFiles?.length) return false;
  return item.libraryFiles.some((file) => {
    const ext = (file.metadata?.ext ?? "").trim().toLowerCase().replace(/^\./, "");
    const name = (file.metadata?.filename ?? file.metadata?.relPath ?? file.metadata?.path ?? "").toLowerCase();
    return ext === "srt" || name.endsWith(".srt");
  });
}

function personalItemMatches(entry: LibraryItemMinified, text: string, filters: BrowseFilters) {
  const needle = normalizeValue(text);
  const haystack = normalizeValue([
    entry.media.metadata.title,
    entry.media.metadata.authorName,
    entry.media.metadata.narratorName,
    bookSeries(entry.media.metadata).map((membership) => membership.name).join(" "),
  ].filter(Boolean).join(" "));
  if (needle && !haystack.includes(needle)) return false;
  if (!matchesDelimitedValue(entry.media.metadata.authorName, filters.author)) return false;
  if (!matchesDelimitedValue(entry.media.metadata.narratorName, filters.narrator)) return false;
  if (filters.series && !bookSeries(entry.media.metadata).some((membership) => normalizeValue(membership.name) === normalizeValue(filters.series))) return false;
  if (filters.genre && !(entry.media.metadata.genres ?? []).some((genre) => normalizeValue(genre) === normalizeValue(filters.genre))) return false;
  if (filters.tag && !(entry.media.tags ?? []).some((tag) => normalizeValue(tag) === normalizeValue(filters.tag))) return false;
  if (filters.language && normalizeValue(entry.media.metadata.language) !== normalizeValue(filters.language)) return false;
  return true;
}

function comparePersonalItems(left: LibraryItemMinified, right: LibraryItemMinified, sort: LibrarySort, direction: string) {
  const sign = direction === "desc" ? -1 : 1;
  const label = (value: string | null | undefined) => (value ?? "").trim();
  let comparison = 0;
  if (sort === "author") comparison = label(left.media.metadata.authorName).localeCompare(label(right.media.metadata.authorName), undefined, { sensitivity: "base" });
  else if (sort === "series") comparison = label(bookSeries(left.media.metadata).map((membership) => membership.name).join(" ")).localeCompare(label(bookSeries(right.media.metadata).map((membership) => membership.name).join(" ")), undefined, { sensitivity: "base" });
  else if (sort === "year") comparison = Number(left.media.metadata.publishedYear ?? 0) - Number(right.media.metadata.publishedYear ?? 0);
  else if (sort === "duration") comparison = Number(left.media.duration ?? 0) - Number(right.media.duration ?? 0);
  else if (sort === "progress") comparison = Number(left.userMediaProgress?.progress ?? 0) - Number(right.userMediaProgress?.progress ?? 0);
  else if (sort === "recent") comparison = Number(left.userMediaProgress?.lastUpdate ?? 0) - Number(right.userMediaProgress?.lastUpdate ?? 0);
  else comparison = label(left.media.metadata.title).localeCompare(label(right.media.metadata.title), undefined, { sensitivity: "base" });
  return comparison * sign;
}

function normalizeValue(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase();
}

function compareByLabel(left: string, right: string) {
  return left.localeCompare(right, undefined, { sensitivity: "base" });
}

function collectNames(value: string | null | undefined) {
  if (!value) {
    return [] as string[];
  }

  return value
    .split(/,|;|\/| & /g)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function matchesDelimitedValue(value: string | null | undefined, selected: string) {
  if (!selected) {
    return true;
  }

  const normalizedSelected = normalizeValue(selected);
  const normalizedValue = normalizeValue(value);

  if (!normalizedValue) {
    return false;
  }

  if (normalizedValue === normalizedSelected) {
    return true;
  }

  return collectNames(value).some((entry) => normalizeValue(entry) === normalizedSelected);
}

function getSeriesFilterKey(value: string | null | undefined) {
  return normalizeValue(stripSeriesSuffix(value));
}

function matchesSeriesValue(value: string | null | undefined, selected: string) {
  if (!selected) {
    return true;
  }

  const normalizedValue = normalizeValue(value);
  const normalizedSelected = normalizeValue(selected);

  if (!normalizedValue) {
    return false;
  }

  if (normalizedValue === normalizedSelected) {
    return true;
  }

  return getSeriesFilterKey(value) === getSeriesFilterKey(selected);
}

function normalizeSeriesOptions(entries: LibraryFilterData["series"]) {
  const deduped = new Map<string, LibraryFilterData["series"][number]>();

  for (const entry of entries) {
    const canonicalName = entry.name.trim();
    const canonicalId = normalizeValue(canonicalName) || normalizeValue(entry.id);

    if (!canonicalName || !canonicalId || deduped.has(canonicalId)) {
      continue;
    }

    deduped.set(canonicalId, {
      id: canonicalId,
      name: canonicalName,
    });
  }

  return [...deduped.values()].sort((left, right) => compareByLabel(left.name, right.name));
}

function deriveFilterData(items: LibraryItemMinified[]) {
  const authors = new Map<string, string>();
  const series = new Map<string, string>();
  const genres = new Map<string, string>();
  const tags = new Map<string, string>();
  const narrators = new Map<string, string>();
  const languages = new Map<string, string>();

  for (const entry of items) {
    for (const author of collectNames(entry.media.metadata.authorName)) {
      authors.set(normalizeValue(author), author);
    }

    for (const narrator of collectNames(entry.media.metadata.narratorName)) {
      narrators.set(normalizeValue(narrator), narrator);
    }

    for (const membership of bookSeries(entry.media.metadata)) {
      const canonicalSeriesName = membership.name;
      const canonicalSeriesKey = normalizeValue(canonicalSeriesName);

      if (canonicalSeriesName && canonicalSeriesKey) {
        series.set(canonicalSeriesKey, canonicalSeriesName);
      }
    }

    for (const genre of entry.media.metadata.genres ?? []) {
      const trimmed = genre.trim();
      if (trimmed) {
        genres.set(normalizeValue(trimmed), trimmed);
      }
    }

    for (const tag of entry.media.tags ?? []) {
      const trimmed = tag.trim();
      if (trimmed) {
        tags.set(normalizeValue(trimmed), trimmed);
      }
    }

    const language = entry.media.metadata.language?.trim();
    if (language) {
      languages.set(normalizeValue(language), language);
    }
  }

  return {
    authors: [...authors.entries()]
      .sort((left, right) => compareByLabel(left[1], right[1]))
      .map(([id, name]) => ({ id, name })),
    genres: [...genres.values()].sort(compareByLabel),
    tags: [...tags.values()].sort(compareByLabel),
    series: [...series.entries()]
      .sort((left, right) => compareByLabel(left[1], right[1]))
      .map(([id, name]) => ({ id, name })),
    narrators: [...narrators.values()].sort(compareByLabel),
    languages: [...languages.values()].sort(compareByLabel),
  } satisfies LibraryFilterData;
}

function normalizeFilterData(payload: Partial<LibraryFilterData> | null | undefined) {
  return {
    authors: (payload?.authors ?? []).filter(
      (entry): entry is LibraryFilterData["authors"][number] =>
        Boolean(entry && typeof entry.id === "string" && typeof entry.name === "string"),
    ),
    genres: (payload?.genres ?? []).filter((entry): entry is string => typeof entry === "string"),
    tags: (payload?.tags ?? []).filter((entry): entry is string => typeof entry === "string"),
    series: normalizeSeriesOptions(
      (payload?.series ?? []).filter(
        (entry): entry is LibraryFilterData["series"][number] =>
          Boolean(entry && typeof entry.id === "string" && typeof entry.name === "string"),
      ),
    ),
    narrators: (payload?.narrators ?? []).filter((entry): entry is string => typeof entry === "string"),
    languages: (payload?.languages ?? []).filter((entry): entry is string => typeof entry === "string"),
  } satisfies LibraryFilterData;
}

export function Dashboard({ initialLibraries, initialProfile }: DashboardProps) {
  const [libraries, setLibraries] = useState(initialLibraries);
  const [profile] = useState(initialProfile);
  const [activeLibraryId, setActiveLibraryId] = useState(
    initialProfile.userDefaultLibraryId ?? initialLibraries[0]?.id ?? "",
  );



  const [selectedItemId, setSelectedItemId] = useState<string>("");
  const [selectedItem, setSelectedItem] = useState<LibraryItemExpanded | null>(null);
  const [itemState, setItemState] = useState<"idle" | "loading" | "error">("idle");
  const [itemError, setItemError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<LibrarySort>("title");
  const [progressFilter, setProgressFilter] = useState<ProgressFilter>("all");
  const [browseFilters, setBrowseFilters] = useState<BrowseFilters>({ ...EMPTY_BROWSE_FILTERS });
  const [libraryFilterData, setLibraryFilterData] = useState<LibraryFilterData | null>(null);
  const [libraryFilterState, setLibraryFilterState] = useState<"idle" | "loading" | "error">("idle");
  const [libraryFilterError, setLibraryFilterError] = useState<string | null>(null);
  const [favoriteIds, setFavoriteIds] = useState<string[]>([]);
  const [showAllPins, setShowAllPins] = useState(false);
  const [completingItemId, setCompletingItemId] = useState("");
  const [continueError, setContinueError] = useState<string | null>(null);
  const [playedRecentIds, setPlayedRecentIds] = useState<string[]>([]);
  const [hiddenRecentIds, setHiddenRecentIds] = useState<string[]>([]);
  const [isBookDetailsOpen, setIsBookDetailsOpen] = useState(false);
  const [isPlayerOpen, setIsPlayerOpen] = useState(false);
  const [isPlayerInlineFullscreen, setIsPlayerInlineFullscreen] = useState(false);
  const [playerOpenToken, setPlayerOpenToken] = useState(0);
  const [queueIds, setQueueIds] = useState<string[]>([]);
  const [preferencesHydrated, setPreferencesHydrated] = useState(false);
  const [planning, setPlanning] = useState<LibraryPreferences>(() => migrateLibraryPreferences(null));
  const [wantFilter, setWantFilter] = useState(false);
  const [hideCompleted, setHideCompleted] = useState(false);
  const [urlReady, setUrlReady] = useState(false);
  const browseSaveQueueRef = useRef(Promise.resolve());
  const browseWritableRef = useRef(false);
  const [browseSaveError, setBrowseSaveError] = useState<string | null>(null);
  const [direction, setDirection] = useState("asc");
  const [personalLists, setPersonalLists] = useState<PersonalList[]>(() => DEFAULT_PERSONAL_LISTS.map((entry) => ({ ...entry, ids: [] })));
  const [personalListsSyncState, setPersonalListsSyncState] = useState<"local" | "saving" | "synced" | "error">("local");
  const [personalListFilter, setPersonalListFilter] = useState<PersonalListId>("");
  const [hasSrtFilter, setHasSrtFilter] = useState(false);
  const [srtScannedIds, setSrtScannedIds] = useState<string[]>([]);
  const [srtIds, setSrtIds] = useState<string[]>([]);
  const [srtScanState, setSrtScanState] = useState<"idle" | "scanning" | "done" | "error">("idle");
  const [srtScanProcessed, setSrtScanProcessed] = useState(0);
  const [srtScanTotal, setSrtScanTotal] = useState(0);
  const srtScanRunningRef = useRef(false);
  const preferenceScope = profile.preferenceScope ?? profile.userId;
  const queryParams = new URLSearchParams({ q: filter, sort, direction, status: progressFilter === "planned" || personalListFilter || hasSrtFilter ? "all" : progressFilter, want: String(personalListFilter || hasSrtFilter ? false : wantFilter), hideCompleted: String(hideCompleted), ...browseFilters });
  const queryString = queryParams.toString();
  const search = useLibrarySearch(activeLibraryId, queryString, urlReady && preferencesHydrated);
  const { items, setItems, page: itemsPage, state: itemsState, error: itemsError, loadedLibrary: itemsLibraryId } = search;
  const loadMoreItems = search.loadMore;
  const loadItems = (_libraryId: string) => search.refresh(true);
    // [Spoken Page Enhanced v1.3.15] The dashboard now catches up to the entire
  // library automatically. There is no manual Load more button and no Promise
  // .finally() call because useLibrarySearch.loadMore is a void callback.
const autoLoadAllInFlightRef = useRef(false);
  const autoLoadLastCountRef = useRef(0);
  const autoLoadTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    if (autoLoadAllInFlightRef.current && items.length > autoLoadLastCountRef.current) {
      autoLoadAllInFlightRef.current = false;
    }
  }, [items.length]);

  useEffect(() => {
    const total = itemsPage?.total ?? 0;
    if (!urlReady || !preferencesHydrated || !activeLibraryId || !total || items.length >= total || itemsState === "loading" || autoLoadAllInFlightRef.current) return;
    autoLoadAllInFlightRef.current = true;
    autoLoadLastCountRef.current = items.length;
    loadMoreItems();
    if (autoLoadTimeoutRef.current !== null) window.clearTimeout(autoLoadTimeoutRef.current);
    autoLoadTimeoutRef.current = window.setTimeout(() => {
      autoLoadAllInFlightRef.current = false;
      autoLoadTimeoutRef.current = null;
    }, 15000);
  }, [activeLibraryId, items.length, itemsPage?.total, itemsState, loadMoreItems, preferencesHydrated, urlReady]);

  useEffect(() => {
    return () => {
      if (autoLoadTimeoutRef.current !== null) window.clearTimeout(autoLoadTimeoutRef.current);
    };
  }, []);


  const [shelfItemsById, setShelfItemsById] = useState<Record<string, LibraryItemMinified>>({});
  const [resolvedShelfIds, setResolvedShelfIds] = useState<Set<string>>(() => new Set());

  const requestedShelfIdsRef = useRef(new Set<string>());
  const libraryPreferencesRef = useRef<LibraryPreferences>(migrateLibraryPreferences(null));
  const libraryPreferencesDirtyRef = useRef(false);
  const preferencesWritableRef = useRef(false);
  const personalListsSaveTimerRef = useRef<number | null>(null);
  const personalListsDirtyRef = useRef(false);
  const bookDetailsTriggerRef = useRef<HTMLElement | null>(null);
  const itemLoadGenerationRef = useRef(0);

  libraryPreferencesRef.current = { ...planning, favoriteIds, playedRecentIds, hiddenRecentIds, queueIds, personalLists } as LibraryPreferences & { personalLists: PersonalList[] };

  async function saveLibraryPreferences() {
    if (!preferencesWritableRef.current) return;
    try {
      const saving = libraryPreferencesRef.current;
      const response = await fetch("/api/preferences/library", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ value: saving }),
      });
      if (!response.ok) throw new Error("Unable to save library preferences.");
      libraryPreferencesDirtyRef.current = JSON.stringify(libraryPreferencesRef.current) !== JSON.stringify(saving);
      search.refresh();
    } catch {
      libraryPreferencesDirtyRef.current = true;
      setContinueError("Library preferences could not be saved. They will retry when the connection returns.");
    }
  }

  function personalListsHaveCustomValues(lists: PersonalList[]) {
    return lists.length > DEFAULT_PERSONAL_LISTS.length || lists.some((entry, index) => {
      const fallback = DEFAULT_PERSONAL_LISTS[index];
      return !fallback || entry.ids.length > 0 || entry.name !== fallback.name;
    });
  }

  async function savePersonalLists() {
    if (!preferencesWritableRef.current) return;
    const value = parsePersonalLists(personalLists);
    setPersonalListsSyncState("saving");
    const libraryValue = { ...libraryPreferencesRef.current, personalLists: value };
    try {
      const results = await Promise.allSettled([
        fetch(`/api/preferences/${PERSONAL_LISTS_PREFERENCE_NAMESPACE}`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ value }),
        }),
        fetch("/api/preferences/library", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ value: libraryValue }),
        }),
      ]);
      const namespaceOk = results[0].status === "fulfilled" && results[0].value.ok;
      const libraryOk = results[1].status === "fulfilled" && results[1].value.ok;
      if (!namespaceOk && !libraryOk) throw new Error("Both account preference saves failed.");
      personalListsDirtyRef.current = false;
      setPersonalListsSyncState("synced");
    } catch {
      personalListsDirtyRef.current = true;
      setPersonalListsSyncState("error");
      setContinueError("Your personal lists could not be synced yet. They remain saved on this browser and will retry.");
    }
  }

  function deletePersonalList(listId: PersonalListId) {
    const current = personalLists.find((entry) => entry.id === listId);
    if (!current) return;
    const confirmed = window.confirm(
      `WARNING: Delete the personal list "${current.name}"?\n\nThis permanently removes the list and its saved book selections from your Spoken Page Enhanced preferences. It will NOT delete any audiobooks or files from Audiobookshelf.`,
    );
    if (!confirmed) return;
    setPersonalLists((currentLists) => currentLists.filter((entry) => entry.id !== listId));
    setPersonalListFilter((active) => active === listId ? "" : active);
  }

  async function loadLibraries() {
    const response = await fetch("/api/libraries");
    const payload = (await response.json()) as { libraries?: Library[]; error?: string };

    if (response.ok && payload.libraries) {
      setLibraries(payload.libraries);
      if (!activeLibraryId && payload.libraries[0]) {
        setActiveLibraryId(payload.libraries[0].id);
      }
    }
  }

  async function loadItem(itemId: string) {
    if (!itemId) {
      setSelectedItem(null);
      setItemState("idle");
      return null;
    }

    setItemState("loading");
    setItemError(null);
    const generation = ++itemLoadGenerationRef.current;
    try {
      const response = await fetch(`/api/items/${itemId}`);
      const payload = (await response.json()) as LibraryItemExpanded | { error?: string };
      if (generation !== itemLoadGenerationRef.current) return "media" in payload ? payload : null;

      if (!response.ok || !("media" in payload)) {
        setItemState("error");
        setItemError("error" in payload ? payload.error ?? "Unable to load the book." : "Unable to load the book.");
        setSelectedItem(null);
        return null;
      }

      setSelectedItem(payload);
      setItems((current) => current.map((entry) => entry.id === itemId ? payload : entry));
      setShelfItemsById((current) => current[itemId] ? { ...current, [itemId]: payload } : current);
      setItemState("idle");
      return payload;
    } catch {
      if (generation === itemLoadGenerationRef.current) {
        setItemState("error");
        setItemError("The book could not be loaded. Close and reopen its details to retry.");
        setSelectedItem(null);
      }
      return null;
    }
  }

  async function loadFilterData(libraryId: string) {
    if (!libraryId) {
      setLibraryFilterData(null);
      setLibraryFilterState("idle");
      setLibraryFilterError(null);
      return;
    }

    setLibraryFilterState("loading");
    setLibraryFilterError(null);

    const response = await fetch(`/api/libraries/${libraryId}/filterdata`);
    const payload = (await response.json()) as Partial<LibraryFilterData> | { error?: string };

    if (!response.ok || !("authors" in payload)) {
      setLibraryFilterData(null);
      setLibraryFilterState("error");
      setLibraryFilterError(
        "error" in payload ? payload.error ?? "Unable to load Audiobookshelf filters." : "Unable to load Audiobookshelf filters.",
      );
      return;
    }

    setLibraryFilterData(normalizeFilterData(payload));
    setLibraryFilterState("idle");
  }

  async function disconnect() {
    const shouldDisconnect = window.confirm(
      "Sign out of Spoken Page Enhanced on this device? You can sign in again with your Audiobookshelf account.",
    );

    if (!shouldDisconnect) {
      return;
    }

    await fetch("/api/connection", { method: "DELETE" });
    window.location.reload();
  }

  function clearBrowseSearchAndFilters() {
    setFilter("");
    setWantFilter(false);
    setHideCompleted(false);
    setPersonalListFilter("");
    setHasSrtFilter(false);
    setBrowseFilters({ ...EMPTY_BROWSE_FILTERS });
    setProgressFilter("all");
  }

  function renamePersonalList(listId: PersonalListId) {
    const current = personalLists.find((entry) => entry.id === listId);
    const nextName = window.prompt("Name this personal list:", current?.name ?? "");
    if (nextName === null) return;
    const trimmed = nextName.trim().slice(0, 48);
    if (!trimmed) return;
    setPersonalLists((currentLists) => currentLists.map((entry) => entry.id === listId ? { ...entry, name: trimmed } : entry));
  }

  function addPersonalList() {
    if (!preferencesWritableRef.current || personalLists.length >= 10) return;
    const usedIds = new Set(personalLists.map((entry) => entry.id));
    let nextNumber = 3;
    while (usedIds.has(`personal-list-${nextNumber}`)) nextNumber += 1;
    const proposedName = `My List ${nextNumber}`;
    const nextName = window.prompt("Name your new personal list:", proposedName);
    if (nextName === null) return;
    const trimmed = nextName.trim().slice(0, 48);
    if (!trimmed) return;
    setPersonalLists((currentLists) => [
      ...currentLists,
      { id: `personal-list-${nextNumber}`, name: trimmed, ids: [] },
    ]);
  }

  function togglePersonalList(listId: PersonalListId, itemId: string) {
    if (!preferencesWritableRef.current) return;
    setPersonalLists((currentLists) => currentLists.map((entry) => {
      if (entry.id !== listId) return entry;
      return entry.ids.includes(itemId)
        ? { ...entry, ids: entry.ids.filter((id) => id !== itemId) }
        : { ...entry, ids: [itemId, ...entry.ids] };
    }));
  }

  function rememberRecent(itemId: string) {
    setPlayedRecentIds((current) => [itemId, ...current.filter((entry) => entry !== itemId)].slice(0, 16));
  }

  function handleBookSelect(itemId: string) {
    bookDetailsTriggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    if (itemId !== selectedItemId) {
      setSelectedItemId(itemId);
      setSelectedItem(null);
      setItemState("loading");
      setItemError(null);
    } else if (!selectedItem && itemState !== "loading") {
      void loadItem(itemId);
    }

    setIsBookDetailsOpen(true);
    setIsPlayerOpen(false);
  }

  function handleResume() {
    if (!selectedItemId) return;
    resumeBook(selectedItemId);
  }

  function resumeBook(itemId: string) {
    closeBookDetails(false);
    if (itemId !== selectedItemId) {
      setSelectedItemId(itemId);
      setSelectedItem(null);
      setItemState("loading");
      setItemError(null);
    }
    setPlayerOpenToken((current) => current + 1);
    setIsPlayerOpen(true);
    setHiddenRecentIds((current) => current.filter((entry) => entry !== itemId));
  }

  function closeBookDetails(restoreFocus = true) {
    setIsBookDetailsOpen(false);

    if (restoreFocus && bookDetailsTriggerRef.current) {
      window.setTimeout(() => bookDetailsTriggerRef.current?.focus(), 0);
    }
  }

  function toggleFavorite(itemId: string) {
    if (!preferencesWritableRef.current) return;
    setFavoriteIds((current) =>
      current.includes(itemId)
        ? current.filter((entry) => entry !== itemId)
        : [itemId, ...current],
    );
  }

  function toggleWant(itemId: string) {
    if (!preferencesWritableRef.current) return;
    setPlanning(current => ({ ...current, wantToListenIds: current.wantToListenIds.includes(itemId) ? current.wantToListenIds.filter(id => id !== itemId) : [...current.wantToListenIds, itemId] }));
  }

  async function applyProgressAction(item: LibraryItemMinified, action: ProgressAction) {
    if (completingItemId) return;
    if (action === "restart" && !window.confirm("Start this book over? This resets its listening position and completion in Audiobookshelf.")) return;
    setCompletingItemId(item.id); setContinueError(null);
    try {
      await changeListeningProgress(item.id, action);
      search.refresh();
    } catch (error) { setContinueError(error instanceof Error ? error.message : "Unable to save progress."); }
    finally { setCompletingItemId(""); }
  }
  const markContinueComplete = (item: LibraryItemMinified) => applyProgressAction(item, "complete");

  useEffect(() => {
    void loadLibraries();
    const localPersonalLists = parsePersonalLists(
      window.localStorage.getItem(userStorageKey(PERSONAL_LISTS_STORAGE_KEY, preferenceScope)),
    );
    const local = {
      favoriteIds: parseStoredIds(window.localStorage.getItem(userStorageKey(FAVORITES_STORAGE_KEY, preferenceScope))),
      playedRecentIds: parseStoredIds(window.localStorage.getItem(userStorageKey(PLAYED_RECENTS_STORAGE_KEY, preferenceScope))),
      hiddenRecentIds: parseStoredIds(window.localStorage.getItem(userStorageKey(HIDDEN_RECENTS_STORAGE_KEY, preferenceScope))),
      queueIds: parseStoredIds(window.localStorage.getItem(userStorageKey(QUEUE_STORAGE_KEY, preferenceScope))),
      statusOverrides: parseStatusOverrides(window.localStorage.getItem(userStorageKey(STATUS_OVERRIDES_STORAGE_KEY, profile.userId))),
    };
    setPersonalLists(localPersonalLists);
    setFavoriteIds(local.favoriteIds);
    setPlayedRecentIds(local.playedRecentIds);
    setHiddenRecentIds(local.hiddenRecentIds);
    setQueueIds(local.queueIds);
    const cachedPreferences = window.localStorage.getItem(userStorageKey(LIBRARY_PREFERENCES_STORAGE_KEY, preferenceScope));
    try { setPlanning(migrateLibraryPreferences(cachedPreferences ? JSON.parse(cachedPreferences) : local)); }
    catch { setPlanning(migrateLibraryPreferences(local)); }

    void (async () => {
      try {
        const response = await fetch("/api/preferences/library");
        const payload = (await response.json()) as { value?: Partial<typeof local> & Partial<LibraryPreferences> };
        if (!response.ok || !payload.value) throw new Error("Unable to load library preferences.");
        setFavoriteIds(Array.isArray(payload.value.favoriteIds) ? payload.value.favoriteIds : local.favoriteIds);
        setPlayedRecentIds(Array.isArray(payload.value.playedRecentIds) ? payload.value.playedRecentIds : local.playedRecentIds);
        setHiddenRecentIds(Array.isArray(payload.value.hiddenRecentIds) ? payload.value.hiddenRecentIds : local.hiddenRecentIds);
        setQueueIds(Array.isArray(payload.value.queueIds) ? payload.value.queueIds : local.queueIds);
        setPlanning(migrateLibraryPreferences(payload.value));
        preferencesWritableRef.current = true;

        let namespacedLists: PersonalList[] | null = null;
        try {
          const listsResponse = await fetch(`/api/preferences/${PERSONAL_LISTS_PREFERENCE_NAMESPACE}`, { cache: "no-store" });
          const listsPayload = (await listsResponse.json()) as { value?: unknown };
          if (listsResponse.ok && listsPayload.value !== undefined && listsPayload.value !== null) {
            namespacedLists = parsePersonalLists(listsPayload.value);
          }
        } catch {
          // Existing library preference storage/local migration remains available.
        }

        const libraryPersonalLists = parsePersonalLists((payload.value as { personalLists?: unknown }).personalLists);
        const libraryListsRaw = (payload.value as { personalLists?: unknown }).personalLists;
        const libraryListsPresent = Object.prototype.hasOwnProperty.call(payload.value, "personalLists");
        const preferredServerLists = namespacedLists !== null
          ? namespacedLists
          : libraryListsPresent
            ? parsePersonalLists(libraryListsRaw)
            : null;
        const chosenLists = preferredServerLists !== null ? preferredServerLists : localPersonalLists;
        setPersonalLists(chosenLists);
        setPersonalListsSyncState(preferredServerLists !== null ? "synced" : "local");

        // Migrate any existing browser/library list into both server preference
        // locations. This makes older v4/v5 lists much more likely to follow the
        // signed-in account even when one preference route is unavailable.
        if (preferredServerLists === null && personalListsHaveCustomValues(chosenLists)) {
          try {
            const migrated = await Promise.allSettled([
              fetch(`/api/preferences/${PERSONAL_LISTS_PREFERENCE_NAMESPACE}`, {
                method: "PUT",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ value: chosenLists }),
              }),
              fetch("/api/preferences/library", {
                method: "PUT",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ value: { ...payload.value, personalLists: chosenLists } }),
              }),
            ]);
            if (!migrated.some((entry) => entry.status === "fulfilled" && entry.value.ok)) {
              personalListsDirtyRef.current = true;
              setPersonalListsSyncState("error");
            } else {
              setPersonalListsSyncState("synced");
            }
          } catch {
            personalListsDirtyRef.current = true;
            setPersonalListsSyncState("error");
          }
        }
      } catch {
        setContinueError("Your saved preferences could not be loaded. Refresh the page to retry before editing pins or Want to listen.");
      } finally {
        setPreferencesHydrated(true);
      }
    })();
  }, []);

  useEffect(() => {
    if (preferencesHydrated) window.localStorage.setItem(userStorageKey(FAVORITES_STORAGE_KEY, preferenceScope), JSON.stringify(favoriteIds));
  }, [favoriteIds, profile.userId]);

  useEffect(() => {
    if (preferencesHydrated) window.localStorage.setItem(userStorageKey(PLAYED_RECENTS_STORAGE_KEY, preferenceScope), JSON.stringify(playedRecentIds));
  }, [playedRecentIds, profile.userId]);

  useEffect(() => {
    if (preferencesHydrated) window.localStorage.setItem(userStorageKey(HIDDEN_RECENTS_STORAGE_KEY, preferenceScope), JSON.stringify(hiddenRecentIds));
  }, [hiddenRecentIds, profile.userId]);

  useEffect(() => {
    if (preferencesHydrated) window.localStorage.setItem(userStorageKey(QUEUE_STORAGE_KEY, preferenceScope), JSON.stringify(queueIds));
  }, [profile.userId, queueIds]);

  useEffect(() => {
    if (!preferencesHydrated) return;
    window.localStorage.setItem(userStorageKey(PERSONAL_LISTS_STORAGE_KEY, preferenceScope), JSON.stringify(personalLists));
    personalListsDirtyRef.current = true;
    if (personalListsSaveTimerRef.current !== null) window.clearTimeout(personalListsSaveTimerRef.current);
    personalListsSaveTimerRef.current = window.setTimeout(() => {
      personalListsSaveTimerRef.current = null;
      void savePersonalLists();
    }, 500);
    return () => {
      if (personalListsSaveTimerRef.current !== null) {
        window.clearTimeout(personalListsSaveTimerRef.current);
        personalListsSaveTimerRef.current = null;
      }
    };
  }, [personalLists, preferenceScope, preferencesHydrated]);

  useEffect(() => {
    if (!preferencesHydrated) return;
    window.localStorage.setItem(userStorageKey(LIBRARY_PREFERENCES_STORAGE_KEY, preferenceScope), JSON.stringify(libraryPreferencesRef.current));
    libraryPreferencesDirtyRef.current = true;
    const timeout = window.setTimeout(() => {
      void saveLibraryPreferences();
    }, 600);
    return () => window.clearTimeout(timeout);
  }, [favoriteIds, hiddenRecentIds, playedRecentIds, preferencesHydrated, queueIds, planning]);

  useEffect(() => {
    const handleOnline = () => {
      if (libraryPreferencesDirtyRef.current) void saveLibraryPreferences();
      if (personalListsDirtyRef.current) void savePersonalLists();
    };
    window.addEventListener("online", handleOnline);
    return () => window.removeEventListener("online", handleOnline);
  }, []);



  useEffect(() => {
    if (!activeLibraryId || itemsLibraryId !== activeLibraryId || !preferencesHydrated) return;

    const ids = unloadedShelfIds(
      [...favoriteIds, ...playedRecentIds, ...queueIds, ...personalLists.flatMap((list) => list.ids)],
      items,
      shelfItemsById,
      requestedShelfIdsRef.current,
    );
    if (!ids.length) return;
    ids.forEach((id) => requestedShelfIdsRef.current.add(id));

    void (async () => {
      for (let offset = 0; offset < ids.length; offset += 4) {
        const batch = ids.slice(offset, offset + 4);
        const fetched = await Promise.all(batch.map(async (id) => {
          try {
            const response = await fetch(`/api/items/${encodeURIComponent(id)}`);
            if (!response.ok) return null;
            const item = (await response.json()) as LibraryItemMinified;
            return item.id === id && item.mediaType === "book" && item.media?.metadata?.title ? item : null;
          } catch {
            return null;
          }
        }));
        const found = fetched.filter((item): item is LibraryItemMinified => item !== null);
        if (found.length) {
          setShelfItemsById((current) => ({
            ...current,
            ...Object.fromEntries(found.map((item) => [item.id, item])),
          }));
        }
        setResolvedShelfIds((current) => new Set([...current, ...batch]));
      }
    })();
  }, [activeLibraryId, favoriteIds, items, itemsLibraryId, personalLists, playedRecentIds, preferencesHydrated, queueIds, shelfItemsById]);

  useEffect(() => {
    if (!itemsPage?.shelfItems || itemsLibraryId !== activeLibraryId) return;
    setShelfItemsById(Object.fromEntries(itemsPage.shelfItems.map(item => [item.id, item])));
    // Update the details status without replacing its expanded chapters/tracks.
    const fresh = [...itemsPage.results, ...itemsPage.shelfItems];
    setSelectedItem(current => {
      const match = current && fresh.find(item => item.id === current.id);
      return current && match ? { ...current, userMediaProgress: match.userMediaProgress } : current;
    });
  }, [itemsPage, itemsLibraryId, activeLibraryId]);

  useEffect(() => {
    const cached = readSrtIndex(preferenceScope, activeLibraryId);
    setSrtScannedIds(cached.scannedIds);
    setSrtIds(cached.srtIds);
    setSrtScanProcessed(0);
    setSrtScanTotal(0);
    setSrtScanState("idle");
  }, [activeLibraryId, preferenceScope]);

  useEffect(() => {
    if (!hasSrtFilter || !activeLibraryId || !preferencesHydrated || !items.length || srtScanRunningRef.current) return;
    const scanned = new Set(srtScannedIds);
    const pending = items.filter((entry) => !scanned.has(entry.id));
    if (!pending.length) {
      const complete = !itemsPage?.total || items.length >= itemsPage.total;
      setSrtScanState(complete ? "done" : "scanning");
      setSrtScanProcessed(items.length);
      setSrtScanTotal(itemsPage?.total ?? items.length);
      return;
    }

    srtScanRunningRef.current = true;
    setSrtScanState("scanning");
    setSrtScanTotal(itemsPage?.total ?? items.length);

    void (async () => {
      try {
        const nextSrtIds = new Set(srtIds);
        let processed = srtScannedIds.length;
        for (let offset = 0; offset < pending.length; offset += 6) {
          const batch = pending.slice(offset, offset + 6);
          await Promise.all(batch.map(async (entry) => {
            try {
              const response = await fetch(`/api/items/${encodeURIComponent(entry.id)}`);
              if (!response.ok) return;
              const payload = (await response.json()) as LibraryItemExpanded;
              if (hasSrtSubtitleFile(payload)) nextSrtIds.add(entry.id);
              scanned.add(entry.id);
              processed += 1;
            } catch {
              // A failed individual lookup remains unscanned and can be retried automatically.
            }
          }));
          const nextScanned = [...scanned];
          const nextIds = [...nextSrtIds];
          setSrtScannedIds(nextScanned);
          setSrtIds(nextIds);
          writeSrtIndex(preferenceScope, activeLibraryId, { scannedIds: nextScanned, srtIds: nextIds });
          setSrtScanProcessed(Math.min(processed, items.length));
        }
        setSrtScanState("done");
      } catch {
        setSrtScanState("error");
      } finally {
        srtScanRunningRef.current = false;
      }
    })();
  }, [activeLibraryId, hasSrtFilter, items, itemsPage?.total, preferenceScope, preferencesHydrated, srtIds, srtScannedIds]);

  function rescanSrt() {
    setSrtScannedIds([]);
    setSrtIds([]);
    setSrtScanProcessed(0);
    setSrtScanTotal(itemsPage?.total ?? items.length);
    setSrtScanState("scanning");
    writeSrtIndex(preferenceScope, activeLibraryId, EMPTY_SRT_INDEX);
  }

  useEffect(() => {
    void loadFilterData(activeLibraryId);
  }, [activeLibraryId]);

  useEffect(() => {
    if (!selectedItemId) {
      return;
    }

    void loadItem(selectedItemId);
  }, [selectedItemId]);

  useEffect(() => {
    if (!isPlayerOpen) {
      setIsPlayerInlineFullscreen(false);
      return;
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (isPlayerInlineFullscreen) {
          setIsPlayerInlineFullscreen(false);
          return;
        }

        setIsPlayerOpen(false);
      }
    };

    window.addEventListener("keydown", handleEscape);

    return () => {
      window.removeEventListener("keydown", handleEscape);
    };
  }, [isPlayerInlineFullscreen, isPlayerOpen]);

  useEffect(() => {
    if (!isBookDetailsOpen) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeBookDetails();
      }
    };

    window.addEventListener("keydown", handleEscape);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleEscape);
    };
  }, [isBookDetailsOpen]);

  useEffect(() => {
    const receive = (event: Event) => {
      const { itemId, progress } = (event as CustomEvent<{ itemId: string; progress: MediaProgress | null }>).detail;
      setItems(current => current.map(item => item.id === itemId ? { ...item, userMediaProgress: progress } : item));
      setShelfItemsById(current => current[itemId] ? { ...current, [itemId]: { ...current[itemId], userMediaProgress: progress } } : current);
      setSelectedItem(current => current?.id === itemId ? { ...current, userMediaProgress: progress } : current);
      if (progress && (progress.startedAt || progress.currentTime > 0)) {
        rememberRecent(itemId);
        setPlanning(current => current.wantToListenIds.includes(itemId) ? { ...current, wantToListenIds: current.wantToListenIds.filter(id => id !== itemId) } : current);
      }
    };
    window.addEventListener(PROGRESS_EVENT, receive);
    return () => window.removeEventListener(PROGRESS_EVENT, receive);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const apply = (params: URLSearchParams) => {
      try {
        const query = parseLibraryQuery(params);
        setFilter(query.q); setSort(query.sort); setDirection(query.direction); setProgressFilter(query.status); setWantFilter(query.want);
        setHideCompleted(query.hideCompleted);
        setBrowseFilters({ genre: query.genre, tag: query.tag, author: query.author, narrator: query.narrator, series: query.series, language: query.language });
        const library = params.get("library"); if (library && libraries.some(item => item.id === library)) setActiveLibraryId(library);
      } catch { /* Invalid URL query falls back to the visible controls. */ }
      setUrlReady(true);
    };
    const restore = () => apply(new URLSearchParams(window.location.search));
    const initial = async () => {
      const params = new URLSearchParams(window.location.search);
      const key = userStorageKey("spoken-page-browse-v1", preferenceScope);
      let local: unknown = null;
      try { local = JSON.parse(window.localStorage.getItem(key) ?? "null"); } catch { /* Storage may be unavailable. */ }
      let saved = restoreBrowsePreferences(local, libraries.map(library => library.id));
      try {
        const response = await fetch("/api/preferences/browse");
        if (!response.ok) throw new Error("Unable to load library view.");
        const payload = await response.json();
        saved = restoreBrowsePreferences(payload.value, libraries.map(library => library.id)) ?? saved;
        browseWritableRef.current = true;
      } catch { /* Preserve the browser copy; do not overwrite unavailable server settings. */ }
      if (cancelled) return;
      if (!hasBrowseQuery(params) && saved) {
        const restored = new URLSearchParams(Object.entries(saved.query).map(([key, value]) => [key, String(value)]));
        if (saved.libraryId) restored.set("library", saved.libraryId);
        apply(restored);
      } else apply(params);
    };
    void initial(); window.addEventListener("popstate", restore);
    return () => { cancelled = true; window.removeEventListener("popstate", restore); };
  }, []);
  useEffect(() => {
    if (!urlReady) return;
    const timeout = window.setTimeout(() => {
      const params = new URLSearchParams(queryString); params.set("library", activeLibraryId);
      const next = "?" + params.toString();
      if (next !== window.location.search) window.history.pushState(null, "", next);
      const value = { schemaVersion: 1, query: queryString, libraryId: activeLibraryId };
      try { window.localStorage.setItem(userStorageKey("spoken-page-browse-v1", preferenceScope), JSON.stringify(value)); } catch { /* Server storage is still available. */ }
      if (browseWritableRef.current) browseSaveQueueRef.current = browseSaveQueueRef.current.then(async () => {
        try {
          const response = await fetch("/api/preferences/browse", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ value }) });
          if (!response.ok) throw new Error("Unable to save library view.");
          setBrowseSaveError(null);
        } catch { setBrowseSaveError("Your library view could not be synced to your account. It will retry the next time you change the view."); }
      });
    }, 350);
    return () => window.clearTimeout(timeout);
  }, [queryString, activeLibraryId, urlReady]);

  const availableFilterData = useMemo(
    () => libraryFilterData ?? deriveFilterData(items),
    [items, libraryFilterData],
  );

  const activeFilterCount = useMemo(
    () => Object.values(browseFilters).filter(Boolean).length + (progressFilter === "all" ? 0 : 1) + (wantFilter ? 1 : 0) + (hideCompleted ? 1 : 0) + (personalListFilter ? 1 : 0) + (hasSrtFilter ? 1 : 0),
    [browseFilters, hasSrtFilter, hideCompleted, personalListFilter, progressFilter, wantFilter],
  );

  const activeBrowseFilters = useMemo(
    () =>
      (
        [
          ["genre", browseFilters.genre, "Genre"],
          ["tag", browseFilters.tag, "Tag"],
          ["author", browseFilters.author, "Author"],
          ["narrator", browseFilters.narrator, "Narrator"],
          ["series", browseFilters.series, "Series"],
          ["language", browseFilters.language, "Language"],
        ] as const
      )
        .filter(([, value]) => Boolean(value))
        .map(([key, value, label]) => ({
          key: key as BrowseFilterKey,
          label: `${label}: ${value}`,
        })),
    [browseFilters],
  );

  const filteredItems = hasSrtFilter ? items.filter((entry) => srtIds.includes(entry.id)) : items;

  const itemsById = useMemo(
    () => libraryItemsById(activeLibraryId, items, shelfItemsById),
    [activeLibraryId, items, shelfItemsById],
  );

  const favoriteItems = useMemo(
    () =>
      favoriteIds
        .map((id) => itemsById.get(id))
        .filter((entry): entry is LibraryItemMinified => Boolean(entry)),
    [favoriteIds, itemsById],
  );

  const continueItem = useMemo(() =>
    [...new Map([...(itemsPage?.continueItem ? [[itemsPage.continueItem.id, itemsPage.continueItem] as const] : []), ...itemsById]).values()]
      .filter((entry) => {
        const progress = entry.userMediaProgress;
        return listeningState(progress) === "in-progress" && !hiddenRecentIds.includes(entry.id);
      })
      .sort((left, right) => (right.userMediaProgress?.lastUpdate ?? 0) - (left.userMediaProgress?.lastUpdate ?? 0))[0] ?? null,
  [hiddenRecentIds, itemsById, itemsPage]);
  const continueDuration = continueItem?.userMediaProgress?.duration || continueItem?.media.duration || 0;
  const continueCurrentTime = continueItem?.userMediaProgress?.currentTime ?? 0;
  const continuePercent = continueDuration > 0 ? Math.round(Math.min(100, continueCurrentTime / continueDuration * 100)) : 0;

  const browseItems = useMemo(() => {
    if (personalListFilter) {
      const list = personalLists.find((entry) => entry.id === personalListFilter);
      if (!list) return [];
      return list.ids
        .map((id) => itemsById.get(id))
        .filter((entry): entry is LibraryItemMinified => Boolean(entry))
        .filter((entry) => personalItemMatches(entry, filter, browseFilters))
        .filter((entry) => !hideCompleted || listeningState(entry.userMediaProgress) !== "finished")
        .sort((left, right) => comparePersonalItems(left, right, sort, direction));
    }
    return filteredItems;
  }, [browseFilters, direction, filter, filteredItems, hideCompleted, itemsById, personalListFilter, personalLists, sort]);

  const activeLibrary = libraries.find((library) => library.id === activeLibraryId) ?? null;

  const nextInSeries = selectedItem?.id === selectedItemId ? selectedItem.nextInSeries ?? null : null;
  const queueItems = useMemo(
    () => queueIds.map((id) => itemsById.get(id)).filter((entry): entry is LibraryItemMinified => Boolean(entry)),
    [itemsById, queueIds],
  );

  function renderBookTile(entry: LibraryItemMinified, section: "all" | "pinned") {
    const isFavorite = favoriteIds.includes(entry.id);
    const isSelected = entry.id === selectedItemId && (isBookDetailsOpen || isPlayerOpen);

    return <BookTile key={`${section}-${entry.id}`} item={entry} compact={section === "pinned"} favorite={isFavorite} selected={isSelected} wantToListen={planning.wantToListenIds.includes(entry.id)} onSelect={() => handleBookSelect(entry.id)} onSelectSeries={showSeries} onToggleFavorite={() => toggleFavorite(entry.id)} />;
  }

  function showSeries(seriesName: string | null | undefined) {
    const name = seriesName?.trim() ?? "";
    if (!name) return;
    setFilter("");
    setProgressFilter("all");
    setPersonalListFilter("");
    setHasSrtFilter(false);
    setBrowseFilters({ ...EMPTY_BROWSE_FILTERS, series: name });
    closeBookDetails(false);
    requestAnimationFrame(() => document.getElementById("book-library")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  return (
    <div className={`dashboard ${isPlayerOpen ? "dashboard-with-player" : ""}`}>
      <section className="panel library-panel">
        <div className="library-overview">
          <div className="library-overview-copy">
            <div className="library-overview-main">
              <h2>{activeLibrary?.name ?? "Audiobookshelf Library"}</h2>
              <p className="panel-description library-overview-meta">
                Connected as <strong>{profile.username}</strong> on Audiobookshelf {profile.serverVersion}.
              </p>
            </div>
          </div>

          <div className="library-overview-actions">
            <select
              className="library-select"
              onChange={(event) => setActiveLibraryId(event.target.value)}
              value={activeLibraryId}
            >
              {libraries.map((library) => (
                <option key={library.id} value={library.id}>
                  {library.name}
                </option>
              ))}
            </select>

            <button className="button button-secondary" onClick={() => { search.refresh(true); void loadFilterData(activeLibraryId); }} type="button">Refresh library</button>
            <button className="button button-secondary" onClick={disconnect} type="button">
              Sign out
            </button>
          </div>
        </div>

        {continueError && !isBookDetailsOpen ? <p role="alert" className="status-message status-error">{continueError}</p> : null}
        {continueItem ? (
          <section className="continue-listening" aria-label="Continue listening">
            <button className="continue-listening-book" onClick={() => handleBookSelect(continueItem.id)} type="button">
              <img alt="" src={`/api/items/${continueItem.id}/cover`} />
              <span className="continue-listening-copy">
                <span className="eyebrow">Continue listening</span>
                <strong>{continueItem.media.metadata.title}</strong>
                <span className="continue-listening-author">{continueItem.media.metadata.authorName ?? "Unknown author"}</span>
                <span className="continue-listening-time">{continuePercent}% complete · {formatDuration(Math.max(0, continueDuration - continueCurrentTime))} left</span>
                <span className="continue-listening-progress" role="progressbar" aria-label="Listening progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={continuePercent}>
                  <span style={{ width: `${continuePercent}%` }} />
                </span>
              </span>
            </button>
            <div className="continue-listening-actions">
              <button className="button book-action-secondary" disabled={Boolean(completingItemId)} onClick={() => void markContinueComplete(continueItem)} type="button">{completingItemId ? "Saving…" : "Mark complete"}</button>
              <button className="button button-primary continue-listening-resume" onClick={() => resumeBook(continueItem.id)} type="button">Resume</button>
            </div>
            {continueError ? <p className="continue-listening-error status-error" role="alert">{continueError}</p> : null}
          </section>
        ) : null}

        {continueItem && favoriteItems.length > 0 ? <div className="continue-pinned-divider" aria-hidden="true" /> : null}

        {favoriteItems.length > 0 ? (
          <section className="pinned-section" aria-label="Pinned books">
            <div className="library-section-head">
              <div><h3>Pinned books</h3></div>
              <span className="section-count">{favoriteItems.length}</span>
            </div>
            {favoriteItems.length > 0 ? (
              <>
                <div className="pinned-book-grid">
                  {(showAllPins ? favoriteItems : favoriteItems.slice(0, 4)).map((entry) => renderBookTile(entry, "pinned"))}
                </div>
                {favoriteItems.length > 4 ? (
                  <button className="button button-secondary pinned-show-more" onClick={() => setShowAllPins((current) => !current)} type="button">
                    {showAllPins ? "Show fewer" : `Show all ${favoriteItems.length} pins`}
                  </button>
                ) : null}
              </>
            ) : null}
          </section>
        ) : null}

        <section className="library-section-card library-section-main" id="book-library">
          {browseSaveError ? <p className="status-message" role="status">{browseSaveError}</p> : null}
          <div className="library-section-head">
            <div>
              <h3>Browse books</h3>
            </div>
            <span className="section-count">{itemsPage?.total ?? "…"}</span>
          </div>

          <section className="personal-lists-panel" aria-label="Personal lists">
            <div className="personal-lists-heading">
              <div>
                <h4>Personal lists</h4>
                <p>Personal lists are stored with your Spoken Page Enhanced account and synced between devices when server preferences are available. <strong className={`personal-lists-sync personal-lists-sync-${personalListsSyncState}`}>{personalListsSyncState === "saving" ? "Saving…" : personalListsSyncState === "synced" ? "Synced" : personalListsSyncState === "error" ? "Sync error — browser copy kept" : "Not synced yet"}</strong></p>
              </div>
              <button
                className="button button-secondary button-compact personal-list-add-button"
                disabled={!preferencesWritableRef.current || personalLists.length >= 10}
                onClick={addPersonalList}
                type="button"
              >
                ＋ Add list
              </button>
            </div>
            <div className="personal-lists-grid">
              {personalLists.map((list) => (
                <div className="personal-list-card" key={list.id}>
                  <button
                    className={`personal-list-select ${personalListFilter === list.id ? "personal-list-select-active" : ""}`.trim()}
                    onClick={() => {
                      setPersonalListFilter((current) => current === list.id ? "" : list.id);
                      setHasSrtFilter(false);
                      setWantFilter(false);
                      setProgressFilter("all");
                    }}
                    type="button"
                  >
                    <strong>{list.name}</strong>
                    <span>{list.ids.length} books</span>
                  </button>
                  <div className="personal-list-card-actions">
                    <button className="button personal-list-rename-button" onClick={() => renamePersonalList(list.id)} type="button">Rename</button>
                    <button className="button personal-list-delete-button" onClick={() => deletePersonalList(list.id)} type="button" aria-label={`Delete ${list.name}`} title={`Delete ${list.name}`}>Delete</button>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <div className="all-books-searchbar">
            <label className="field">
              <input
                aria-label="Search book library"
                className="library-search"
                onChange={(event) => setFilter(event.target.value)}
                placeholder="Search the entire library"
                value={filter}
              />
            </label>

            <label className="field library-compact-field">
              <span>Sort</span>
              <select aria-label="Sort books" onChange={(event) => { setSort(event.target.value as LibrarySort); setDirection(["recent", "progress", "year"].includes(event.target.value) ? "desc" : "asc"); }} value={sort}>
                <option value="title">Title</option>
                <option value="recent">Recently played</option>
                <option value="progress">Progress</option>
                <option value="author">Author</option>
                <option value="series">Series</option>
                <option value="year">Publication year</option>
                <option value="duration">Duration</option>
              </select>
            </label>


            <label className="field library-compact-field">
              <span>Status</span>
              <select
                aria-label="Filter by listening status"
                onChange={(event) => {
                  const value = event.target.value;
                  if (value === "has-srt") {
                    setHasSrtFilter(true);
                    setPersonalListFilter("");
                    setWantFilter(false);
                    setProgressFilter("all");
                    return;
                  }
                  if (value.startsWith("personal-list-") && personalLists.some((list) => list.id === value)) {
                    setPersonalListFilter(value);
                    setHasSrtFilter(false);
                    setWantFilter(false);
                    setProgressFilter("all");
                    return;
                  }
                  setPersonalListFilter("");
                  setHasSrtFilter(false);
                  const want = value === "want";
                  setWantFilter(want);
                  setProgressFilter(want ? "all" : value as ProgressFilter);
                  if (value === "finished") setHideCompleted(false);
                }}
                value={hasSrtFilter ? "has-srt" : personalListFilter || (wantFilter ? "want" : progressFilter)}
              >
                <option value="all">All books</option>
                <option value="unstarted">Not started</option>
                <option value="in-progress">In progress</option>
                <option value="finished">Completed</option>
                <option value="want">Want to listen</option>
                <option value="has-srt">Has SRT subtitles</option>
                {personalLists.map((list) => (
                  <option key={list.id} value={list.id}>{list.name}</option>
                ))}
              </select>
            </label>

            <button
              className="button button-secondary library-clear-button"
              disabled={!filter && activeFilterCount === 0}
              onClick={clearBrowseSearchAndFilters}
              type="button"
            >
              Clear
            </button>

            <details className="library-filter-dropdown">
              <summary>
                <span className="library-filter-summary-label">
                  <span>Filters</span>
                  <span className="library-filter-summary-copy">
                    {activeFilterCount > 0 ? `${activeFilterCount} active` : "Genre, author, series, and more"}
                  </span>
                </span>
                <span className="library-filter-summary-count">{activeFilterCount}</span>
              </summary>

              <div className="library-filter-dropdown-body">
                {libraryFilterState === "loading" ? (
                  <p className="library-filter-status">Loading Audiobookshelf filters...</p>
                ) : null}
                {libraryFilterError ? (
                  <p className="library-filter-status">
                    Using the books already loaded here to build the filter list.
                  </p>
                ) : null}

                <div className="library-filter-grid">
                  <label className="field">
                    <span>Genre</span>
                    <select
                      onChange={(event) =>
                        setBrowseFilters((current) => ({ ...current, genre: event.target.value }))
                      }
                      value={browseFilters.genre}
                    >
                      <option value="">All genres</option>
                      {availableFilterData.genres.map((genre) => (
                        <option key={genre} value={genre}>
                          {genre}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="field">
                    <span>Tag</span>
                    <select
                      onChange={(event) =>
                        setBrowseFilters((current) => ({ ...current, tag: event.target.value }))
                      }
                      value={browseFilters.tag}
                    >
                      <option value="">All tags</option>
                      {availableFilterData.tags.map((tag) => (
                        <option key={tag} value={tag}>
                          {tag}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="field">
                    <span>Author</span>
                    <select
                      onChange={(event) =>
                        setBrowseFilters((current) => ({ ...current, author: event.target.value }))
                      }
                      value={browseFilters.author}
                    >
                      <option value="">All authors</option>
                      {availableFilterData.authors.map((authorOption) => (
                        <option key={authorOption.id} value={authorOption.name}>
                          {authorOption.name}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="field">
                    <span>Narrator</span>
                    <select
                      onChange={(event) =>
                        setBrowseFilters((current) => ({ ...current, narrator: event.target.value }))
                      }
                      value={browseFilters.narrator}
                    >
                      <option value="">All narrators</option>
                      {availableFilterData.narrators.map((narratorOption) => (
                        <option key={narratorOption} value={narratorOption}>
                          {narratorOption}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="field">
                    <span>Series</span>
                    <select
                      onChange={(event) =>
                        setBrowseFilters((current) => ({ ...current, series: event.target.value }))
                      }
                      value={browseFilters.series}
                    >
                      <option value="">All series</option>
                      {availableFilterData.series.map((seriesOption) => (
                        <option key={seriesOption.id} value={seriesOption.name}>
                          {seriesOption.name}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="field">
                    <span>Language</span>
                    <select
                      onChange={(event) =>
                        setBrowseFilters((current) => ({ ...current, language: event.target.value }))
                      }
                      value={browseFilters.language}
                    >
                      <option value="">All languages</option>
                      {availableFilterData.languages.map((language) => (
                        <option key={language} value={language}>
                          {language}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="library-filter-toggles">
                  <button className="button book-action-secondary want-listen-button" aria-pressed={hideCompleted} onClick={() => { setHideCompleted(current => !current); if (!hideCompleted && progressFilter === "finished") setProgressFilter("all"); }} type="button">Hide completed</button>
                  <button className="button book-action-secondary" disabled={activeFilterCount === 0} onClick={clearBrowseSearchAndFilters} type="button">Clear all</button>
                </div>
              </div>
            </details>
            <button className="button book-action-secondary library-sort-direction" aria-label={`Sort ${direction === "asc" ? "ascending" : "descending"}. Switch to ${direction === "asc" ? "descending" : "ascending"}`} title={direction === "asc" ? "Ascending — switch to descending" : "Descending — switch to ascending"} onClick={() => setDirection(current => current === "asc" ? "desc" : "asc")} type="button">
              <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <g opacity={direction === "asc" ? 1 : .35}><path d="M7 19V5m-4 4 4-4 4 4" /></g>
                <g opacity={direction === "desc" ? 1 : .35}><path d="M17 5v14m-4-4 4 4 4-4" /></g>
              </svg>
            </button>
          </div>

          {activeBrowseFilters.length > 0 ? (
            <div className="all-books-active-filters" aria-label="Active filters">
              {activeBrowseFilters.map((entry) => (
                <button
                  className="filter-chip-pill"
                  key={entry.key}
                  onClick={() =>
                    setBrowseFilters((current) => ({
                      ...current,
                      [entry.key]: "",
                    }))
                  }
                  type="button"
                >
                  <span>{entry.label}</span>
                  <span aria-hidden="true">x</span>
                </button>
              ))}
            </div>
          ) : null}

          {hideCompleted ? <div className="all-books-active-filters"><button className="filter-chip-pill" onClick={() => setHideCompleted(false)} type="button"><span>Hide completed</span><span aria-hidden="true">×</span></button></div> : null}
          {progressFilter !== "all" ? <div className="all-books-active-filters"><button className="filter-chip-pill" onClick={() => setProgressFilter("all")} type="button"><span>Status: {progressFilter.replace("-", " ")}</span><span aria-hidden="true">×</span></button></div> : null}
          {personalListFilter ? (
            <div className="all-books-active-filters">
              <button className="filter-chip-pill" onClick={() => setPersonalListFilter("")} type="button">
                <span>List: {personalLists.find((list) => list.id === personalListFilter)?.name ?? "Personal list"}</span><span aria-hidden="true">×</span>
              </button>
            </div>
          ) : null}
          {hasSrtFilter ? (
            <div className="srt-scan-status" role="status">
              <span>{srtScanState === "scanning" ? `Checking SRT files: ${srtScanProcessed} of ${srtScanTotal || "…"}` : srtScanState === "error" ? "SRT scan hit an error; try again." : `SRT index ready: ${srtIds.length} books`}</span>
              <button className="button book-action-secondary button-compact" disabled={srtScanState === "scanning"} onClick={rescanSrt} type="button">Rescan SRT</button>
            </div>
          ) : null}

          {itemsState === "loading" ? <p role="status" className="status-message">{search.preparing ? `${search.preparing.verifying ? "Verifying" : "Preparing"} library search: ${search.preparing.processed} of ${search.preparing.total || "…"} books…` : items.length ? "Updating library results…" : "Preparing complete library search…"}</p> : null}
          {itemsError ? <p role="alert" className="status-message status-error">{itemsError} <button className="button button-secondary" onClick={() => search.refresh(true)} type="button">Try again</button></p> : null}

          <div className="book-tile-grid">
            {browseItems.map((entry) => renderBookTile(entry, "all"))}
          </div>

          {itemsState === "idle" && itemsPage?.total && items.length >= itemsPage.total ? (
            <p className="end-of-list-status">
              {personalListFilter ? `End of list — ${browseItems.length} books.` : `End of library — ${browseItems.length || items.length} books.`}
            </p>
          ) : null}

          {itemsState === "idle" && browseItems.length === 0 ? (
            <p className="status-message">No audiobooks in this library match your search and filters.</p>
          ) : null}
        </section>

      </section>

      {isBookDetailsOpen ? (
        <div
          className="book-details-modal-backdrop"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) closeBookDetails();
          }}
        >
          <section
            aria-label={selectedItem ? `${selectedItem.media.metadata.title} details` : "Book details"}
            aria-modal="true"
            className="book-details-modal"
            role="dialog"
          >
            <button
              aria-label="Close book details"
              autoFocus
              className="book-details-modal-close"
              onClick={() => closeBookDetails()}
              type="button"
            >
              <svg aria-hidden="true" viewBox="0 0 24 24">
                <path d="M6 6l12 12" />
                <path d="M18 6L6 18" />
              </svg>
            </button>
            {selectedItem ? (
              <div className="personal-list-detail-actions" aria-label="Personal lists">
                {personalLists.map((list) => {
                  const active = list.ids.includes(selectedItem.id);
                  return (
                    <button
                      aria-pressed={active}
                      className={`button book-action-secondary ${active ? "personal-list-button-active" : ""}`.trim()}
                      onClick={() => togglePersonalList(list.id, selectedItem.id)}
                      type="button"
                    >
                      {active ? "✓ " : "＋ "}{active ? `Remove from ${list.name}` : `Add to ${list.name}`}
                    </button>
                  );
                })}
              </div>
            ) : null}

            <BookDetails
              error={itemError}
              item={selectedItem}
              loading={itemState === "loading"}
              nextInSeries={nextInSeries}
              onAddToQueue={(item) => setQueueIds((current) => current.includes(item.id) ? current : [...current, item.id])}
              onRemoveFromQueue={(id) => setQueueIds((current) => current.filter((entry) => entry !== id))}
              onSelectQueued={(id) => {
                setQueueIds((current) => current.filter((entry) => entry !== id));
                handleBookSelect(id);
              }}
              onResume={handleResume}
              onSelectSeries={showSeries}
              onSelectNext={handleBookSelect}
              wantToListen={Boolean(selectedItem && planning.wantToListenIds.includes(selectedItem.id))}
              onToggleWant={() => { if (selectedItem) toggleWant(selectedItem.id); }}
              onProgressAction={(action) => { if (selectedItem) void applyProgressAction(selectedItem, action); }}
              progressBusy={Boolean(completingItemId)}
              progressError={continueError}
              legacyStatus={selectedItem && !planning.dismissedLegacyIds.includes(selectedItem.id) ? planning.legacyStatusOverrides[selectedItem.id] : undefined}
              onDismissLegacy={() => { if (selectedItem) setPlanning(current => ({ ...current, dismissedLegacyIds: [...current.dismissedLegacyIds, selectedItem.id] })); }}
              queue={queueItems}
            />
          </section>
        </div>
      ) : null}

      {isPlayerOpen ? (
        <section
          className={`player-subsection-panel ${
            isPlayerInlineFullscreen ? "player-subsection-panel-fullscreen" : ""
          }`}
          aria-label="Player section"
        >
          <div className="player-subsection-body">
            {itemState === "loading" ? <p className="status-message">Loading book details...</p> : null}
            {itemError ? <p className="status-message status-error">{itemError}</p> : null}
            <PlayerPanel
              item={selectedItem}
              preferenceScope={preferenceScope}
              onHide={() => {
                setIsPlayerInlineFullscreen(false);
                setIsPlayerOpen(false);
              }}
              onInlineFullscreenChange={setIsPlayerInlineFullscreen}
              onItemRefresh={loadItem}
              openToken={playerOpenToken}
              variant="dock"
            />
          </div>
        </section>
      ) : null}
    </div>
  );
}
