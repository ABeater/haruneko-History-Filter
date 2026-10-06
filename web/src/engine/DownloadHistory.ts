import { Observable, type IObservable } from './Observable';
import { SanitizeFileName } from './StorageController';
import type { HistoryStorage } from './DownloadHistoryStorage';
import type { MediaChild, MediaContainer, MediaItem, StoreableMediaContainer } from './providers/MediaPlugin';
import type { SettingsManager, Directory, Check, Choice } from './SettingsManager';
import { Key as GlobalKey, Scope as GlobalScope } from './SettingsGlobal';
import { type DownloadTask, Status } from './DownloadTask';
import type { InteractiveFileContentProvider } from './InteractiveFileContentProvider';
import { GetChapterExportTarget, GetChapterExportTargets } from './exporters/MangaExporterRegistry';
import { MapLegacyWebsiteIdentifier } from './transformers/BookmarkConverter';
import { GetMediaDirectories, IsSameLocation, IsStorageLocation, type StorageKind, type StorageLocation, type StorageTarget } from './StorageLocation';
import { Exception } from './Error';
import { EngineResourceKey as R } from '../i18n/ILocale';
import {
    type FlatHistoryRecord,
    type HistoryEntryRecord,
    type HistoryMediaRecord,
    MediaKey,
    MergeEntryRecords,
    ParseExport,
    Presence,
    RecordOrigin,
    SchemaVersion,
    SerializeExport,
} from './DownloadHistoryFormat';

export { Presence, RecordOrigin } from './DownloadHistoryFormat';

/**
 * The combined history information of a single entry (e.g., chapter) as presented to the frontend.
 */
export type DownloadHistoryEntryState = {
    /** Whether the entry was ever successfully downloaded (or adopted/imported as such) */
    readonly Downloaded: boolean;
    /** Whether the files are currently present, `null` when never downloaded */
    readonly Presence: Presence | null;
    readonly Location: StorageLocation | null;
};

const NotDownloaded: DownloadHistoryEntryState = Object.freeze({ Downloaded: false, Presence: null, Location: null });

/**
 * Notification about changed history records, {@link MediaKey} is `undefined` when (potentially) all records changed.
 */
export type HistoryChangedEvent = {
    readonly MediaKey?: string;
};

export const ReconcileOutcome = {
    /** The scan completed and the presence of all verifiable records was updated */
    Completed: 'completed',
    /** No media directory is configured */
    Unavailable: 'unavailable',
    /** Read permission for the media directory is required (can only be requested through user interaction) */
    AccessRequired: 'access-required',
    /** The media directory could not be accessed (e.g., disconnected drive), nothing was changed */
    Failed: 'failed',
    /** The media directory is empty while records are known to be present (e.g., unmounted drive), nothing was changed */
    EmptyRoot: 'empty-root',
} as const;
export type ReconcileOutcome = typeof ReconcileOutcome[keyof typeof ReconcileOutcome];

export type ReconcileResult = {
    Outcome: ReconcileOutcome;
    Error?: string;
    Started: number;
    Finished: number;
    /** Number of history records which were checked */
    Checked: number;
    Present: number;
    Missing: number;
    /** Records which could not be verified due to access errors (their previous state is retained) */
    Unverified: number;
    /** Records which were found at a different location than recorded (e.g., renamed website directory) */
    Relocated: number;
    /** Files/folders on disk which are not (yet) associated with any history record */
    Untracked: number;
};

export type ReconcileOptions = {
    /**
     * Allow marking all records as missing when the media directory is completely empty.
     * Should only be set after explicit user confirmation.
     */
    AllowEmptyRoot?: boolean;
};

export type ScanState = {
    readonly Running: boolean;
    readonly Last: ReconcileResult | null;
};

export type ImportSummary = {
    /** Number of records in the imported file */
    Found: number;
    /** Records which were not yet in the history */
    New: number;
    /** Records which were already in the history (merged, never duplicated) */
    AlreadyPresent: number;
    /** Subset of {@link AlreadyPresent} where the import added information (e.g., an earlier download date) */
    Updated: number;
    /** Records which appeared multiple times within the imported file */
    DuplicatesInFile: number;
    /** Records which could not be identified (missing identifiers), these are never imported */
    Rejected: number;
    /** Subset of {@link New} which belong to a website that is not available in this installation (kept, but inactive) */
    UnavailableWebsite: number;
};

export type ImportPreview = {
    readonly Cancelled: boolean;
    /** The expected result of the import, `null` when cancelled */
    readonly Summary: ImportSummary | null;
    /** Merge the imported records into the history (never starts any download), `null` when cancelled */
    readonly Commit: (() => Promise<ImportSummary>) | null;
};

export type HistoryExportResult = {
    Cancelled: boolean;
    Exported: number;
};

/**
 * Read-only view of a single history record (e.g., chapter) for presentation in the frontend.
 */
export type HistoryEntryView = {
    readonly EntryID: string;
    readonly Title: string;
    readonly Presence: Presence;
    readonly Origin: RecordOrigin;
    /** Time (epoch ms) of the first successful download, `0` when unknown */
    readonly FirstDownloaded: number;
    /** Time (epoch ms) of the most recent successful download, `0` when unknown */
    readonly LastDownloaded: number;
    readonly DownloadCount: number;
    /** Path segments relative to the media directory (recorded location, otherwise the expected location) */
    readonly Folder: ReadonlyArray<string>;
};

/**
 * Read-only view of the history of a media (e.g., manga) for presentation in the frontend.
 */
export type HistoryMediaView = {
    /** Same key as used in {@link HistoryChangedEvent} */
    readonly Key: string;
    readonly WebsiteID: string;
    /** Current title of the website, or the last known title when the website is not available */
    readonly WebsiteTitle: string;
    /** Whether the website is available in this installation */
    readonly WebsiteAvailable: boolean;
    /** Icon of the website, `null` when the website is not available */
    readonly WebsiteIcon: string | null;
    readonly MediaID: string;
    readonly MediaTitle: string;
    /** Path segments of the media directory, relative to the media directory */
    readonly Folder: ReadonlyArray<string>;
    readonly Present: number;
    readonly Missing: number;
    readonly Unverified: number;
    /** Time (epoch ms) of the most recent download of any entry, `0` when unknown */
    readonly LastDownloaded: number;
    /** All entries, in natural order of their titles (e.g., `Chapter 2` before `Chapter 10`) */
    readonly Entries: ReadonlyArray<HistoryEntryView>;
};

const naturalOrder = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

export type HistoryStatistics = {
    Media: number;
    Entries: number;
    Present: number;
    Missing: number;
    Unverified: number;
};

const downloadHistoryFileType: FilePickerAcceptType = {
    description: 'HakuNeko Download History',
    accept: {
        'application/json': [ '.json' ]
    }
};

type WebsiteProvider = {
    readonly WebsitePlugins: ReadonlyArray<MediaContainer<MediaChild>>;
};

type BookmarkProvider = {
    readonly Entries: IObservable<ReadonlyArray<MediaContainer<MediaChild>>, unknown>;
};

type DownloadQueueProvider = {
    readonly Queue: IObservable<DownloadTask[], unknown>;
};

type Identity = {
    WebsiteID: string;
    WebsiteTitle: string;
    MediaID: string;
    MediaTitle: string;
    EntryID: string;
    EntryTitle: string;
};

type Listing = Map<string, StorageKind>;

type ListResult = { Status: 'ok', Entries: Listing } | { Status: 'missing' } | { Status: 'error', Error: unknown };

type UntrackedDirectory = {
    readonly Directories: ReadonlyArray<string>;
    readonly Names: Map<string, StorageKind>;
};

function DirKey(directories: ReadonlyArray<string>): string {
    // NOTE: Path separators can never be part of a valid file name on any supported OS
    return directories.join('/');
}

function PathKey(location: StorageLocation): string {
    return `${location.Kind}|${DirKey([ ...location.Directories, location.Name ])}`;
}

function ErrorMessage(error: unknown): string {
    try {
        return error instanceof Error ? error.message : String(error);
    } catch {
        return String(error);
    }
}

/**
 * Only these errors prove that a file system entry does not exist.
 * Any other error (permission, I/O, disconnected device, ...) means the state is unknown.
 */
function IsMissingError(error: unknown): boolean {
    const name = (error as { name?: string })?.name;
    return name === 'NotFoundError' || name === 'TypeMismatchError';
}

/**
 * Read-only, cached access to the directory tree below the media directory.
 * Each directory is opened and listed at most once per scan.
 */
class DirectoryReader {

    private readonly handles = new Map<string, Promise<FileSystemDirectoryHandle | null>>();
    private readonly listings = new Map<string, Promise<ListResult>>();

    constructor(private readonly root: FileSystemDirectoryHandle) {}

    private GetHandle(directories: ReadonlyArray<string>): Promise<FileSystemDirectoryHandle | null> {
        const key = DirKey(directories);
        if(!this.handles.has(key)) {
            this.handles.set(key, (async () => {
                if(directories.length === 0) {
                    return this.root;
                }
                const parent = await this.GetHandle(directories.slice(0, -1));
                if(!parent) {
                    return null;
                }
                try {
                    return await parent.getDirectoryHandle(directories.at(-1));
                } catch(error) {
                    if(IsMissingError(error)) {
                        return null;
                    }
                    throw error;
                }
            })());
        }
        return this.handles.get(key);
    }

    public List(directories: ReadonlyArray<string>): Promise<ListResult> {
        const key = DirKey(directories);
        if(!this.listings.has(key)) {
            this.listings.set(key, (async (): Promise<ListResult> => {
                try {
                    const handle = await this.GetHandle(directories);
                    if(!handle) {
                        return { Status: 'missing' };
                    }
                    const entries: Listing = new Map();
                    for await (const entry of handle.values()) {
                        entries.set(entry.name, entry.kind);
                    }
                    return { Status: 'ok', Entries: entries };
                } catch(error) {
                    return IsMissingError(error) ? { Status: 'missing' } : { Status: 'error', Error: error };
                }
            })());
        }
        return this.listings.get(key);
    }

    /**
     * Check whether a directory contains at least one entry.
     * @returns `true`/`false`, or `null` when the directory could not be accessed
     */
    public async HasContent(directories: ReadonlyArray<string>): Promise<boolean | null> {
        try {
            const handle = await this.GetHandle(directories);
            if(!handle) {
                return false;
            }
            const iterator = handle.keys();
            try {
                const first = await iterator.next();
                return !first.done;
            } finally {
                await iterator.return?.();
            }
        } catch(error) {
            return IsMissingError(error) ? false : null;
        }
    }
}

/**
 * In-memory representation of the history of a single media.
 * Entry records are treated as immutable values (replaced instead of mutated),
 * which allows to detect concurrent modifications by reference comparison.
 */
class MediaHistory {

    public readonly Entries = new Map<string, HistoryEntryRecord>();

    constructor(public readonly WebsiteID: string, public WebsiteTitle: string, public readonly MediaID: string, public MediaTitle: string) {}

    public get Key(): string {
        return MediaKey(this.WebsiteID, this.MediaID);
    }

    public Serialize(): HistoryMediaRecord {
        return {
            Version: SchemaVersion,
            WebsiteID: this.WebsiteID,
            WebsiteTitle: this.WebsiteTitle,
            MediaID: this.MediaID,
            MediaTitle: this.MediaTitle,
            Entries: [ ...this.Entries.values() ].map(entry => ({
                ...entry,
                Location: entry.Location ? { ...entry.Location, Directories: [ ...entry.Location.Directories ] } : null,
            })),
        };
    }
}

function IsStoredMediaRecord(value: unknown): value is HistoryMediaRecord {
    const record = value as HistoryMediaRecord;
    return typeof record === 'object' && record !== null
        && typeof record.WebsiteID === 'string' && record.WebsiteID.length > 0
        && typeof record.MediaID === 'string' && record.MediaID.length > 0
        && Array.isArray(record.Entries);
}

function NormalizeStoredEntry(value: unknown): HistoryEntryRecord | null {
    const entry = value as Partial<HistoryEntryRecord>;
    if(typeof entry !== 'object' || entry === null || typeof entry.EntryID !== 'string' || entry.EntryID.length === 0) {
        return null;
    }
    const presence = Object.values<string>(Presence).includes(entry.Presence) ? entry.Presence : Presence.Unknown;
    const origin = Object.values<string>(RecordOrigin).includes(entry.Origin) ? entry.Origin : RecordOrigin.Download;
    return {
        EntryID: entry.EntryID,
        EntryTitle: typeof entry.EntryTitle === 'string' ? entry.EntryTitle : '',
        FirstDownloaded: Number(entry.FirstDownloaded) || 0,
        LastDownloaded: Number(entry.LastDownloaded) || 0,
        DownloadCount: Number(entry.DownloadCount) || 0,
        Origin: origin,
        Location: IsStorageLocation(entry.Location) ? entry.Location : null,
        Presence: presence,
        PresenceChecked: Number(entry.PresenceChecked) || 0,
    };
}

/**
 * Persistent download history, which remembers successfully downloaded entries (e.g., chapters) across application restarts
 * and reconciles them with the files in the media directory.
 * @remarks
 * - The history answers _"Was this ever downloaded successfully?"_ and never deletes records because files are missing.
 * - The file system answers _"Is it here now?"_ ({@link Presence}).
 * - Download task states (queued, failed, ...) are intentionally **not** persisted, they remain owned by the existing {@link DownloadTask}.
 * - Identity is always based on the existing website/media/entry identifiers, titles and paths are attributes only.
 */
export class DownloadHistory {

    private readonly media = new Map<string, MediaHistory>();
    /** Keys of records written by a newer (unknown) schema version, these are never overwritten */
    private readonly foreign = new Set<string>();
    private readonly loaded: Promise<void>;
    private writeChain: Promise<void> = Promise.resolve();
    private untracked: Map<string, UntrackedDirectory> | null = null;
    private readonly adoptionAttempts = new Set<string>();
    private reconciling: Promise<ReconcileResult> | null = null;
    private readonly watchedTasks = new Map<DownloadTask, (status: Status) => void>();

    private readonly changed = new Observable<HistoryChangedEvent, DownloadHistory>({}, this);
    private readonly scanState = new Observable<ScanState, DownloadHistory>({ Running: false, Last: null }, this);

    constructor(
        private readonly storage: HistoryStorage,
        private readonly settings: SettingsManager,
        private readonly websites: WebsiteProvider,
        private readonly bookmarks: BookmarkProvider,
        private readonly downloads: DownloadQueueProvider,
        private readonly fileIO: InteractiveFileContentProvider,
    ) {
        this.loaded = this.Load().catch(error => console.warn('DownloadHistory: Failed to load the download history!', error));
        this.downloads.Queue.Subscribe(this.OnDownloadQueueChanged);
        this.OnDownloadQueueChanged(this.downloads.Queue.Value ?? []);
    }

    /**
     * Occurs whenever history records were added or changed.
     */
    public get Changed(): IObservable<HistoryChangedEvent, DownloadHistory> {
        return this.changed;
    }

    /**
     * The current state and result of the most recent file system reconciliation.
     */
    public get ScanState(): IObservable<ScanState, DownloadHistory> {
        return this.scanState;
    }

    /**
     * Resolves when the persisted history was loaded.
     */
    public get Ready(): Promise<void> {
        return this.loaded;
    }

    /**
     * Load the history and start a reconciliation with the file system in the background (non-blocking).
     */
    public async Initialize(): Promise<void> {
        await this.loaded;
        this.Reconcile().catch(error => console.warn('DownloadHistory: Background scan failed!', error));
    }

    // -----------------------------------------------------------------------------------------------------------------
    // Persistence
    // -----------------------------------------------------------------------------------------------------------------

    private async Load(): Promise<void> {
        const stored = await this.storage.Load() ?? [];
        const migrated = new Map<string, string>();
        for(const record of stored) {
            if(!IsStoredMediaRecord(record)) {
                continue;
            }
            if(record.Version > SchemaVersion) {
                // Written by a newer version of HakuNeko (e.g., after a downgrade) => keep untouched
                this.foreign.add(MediaKey(record.WebsiteID, record.MediaID));
                continue;
            }
            // Website identifiers which were renamed in the past are mapped to their current identifier
            const websiteID = MapLegacyWebsiteIdentifier(record.WebsiteID);
            const media = this.GetOrCreateMedia(websiteID, record.WebsiteTitle, record.MediaID, record.MediaTitle);
            for(const stored of record.Entries) {
                const entry = NormalizeStoredEntry(stored);
                if(entry) {
                    const existing = media.Entries.get(entry.EntryID);
                    media.Entries.set(entry.EntryID, existing ? MergeEntryRecords(existing, entry).Merged : entry);
                }
            }
            if(websiteID !== record.WebsiteID) {
                migrated.set(MediaKey(record.WebsiteID, record.MediaID), media.Key);
            }
        }
        if(migrated.size > 0) {
            // NOTE: Write the merged records first, so a crash in between can never lose data (the merge is idempotent)
            await this.Persist(...new Set(migrated.values()));
            await this.storage.Remove(...migrated.keys());
        }
        this.Notify();
    }

    /**
     * Persist the current state of the given media records.
     * All records of a single call are written within one atomic transaction, consecutive calls are serialized.
     */
    private Persist(...keys: string[]): Promise<void> {
        const snapshot: Record<string, HistoryMediaRecord> = {};
        for(const key of new Set(keys)) {
            const media = this.media.get(key);
            if(media && !this.foreign.has(key)) {
                snapshot[key] = media.Serialize();
            }
        }
        if(Object.keys(snapshot).length === 0) {
            return Promise.resolve();
        }
        const write = this.writeChain.then(() => this.storage.Save(snapshot));
        this.writeChain = write.catch(error => console.warn('DownloadHistory: Failed to persist the download history!', error));
        return write;
    }

    private Notify(mediaKey?: string) {
        this.changed.Value = { MediaKey: mediaKey };
    }

    private GetOrCreateMedia(websiteID: string, websiteTitle: string, mediaID: string, mediaTitle: string): MediaHistory {
        const key = MediaKey(websiteID, mediaID);
        let media = this.media.get(key);
        if(!media) {
            media = new MediaHistory(websiteID, websiteTitle ?? '', mediaID, mediaTitle ?? '');
            this.media.set(key, media);
        }
        return media;
    }

    // -----------------------------------------------------------------------------------------------------------------
    // Identity & Settings
    // -----------------------------------------------------------------------------------------------------------------

    /**
     * Extract the identity from the existing website/media/entry identifiers.
     * @returns `null` when the entry cannot be identified reliably
     */
    private Identify(entry: MediaContainer<MediaChild>): Identity | null {
        const media = entry?.Parent;
        const website = media?.Parent;
        if(!entry?.Identifier || !media?.Identifier || !website?.Identifier) {
            return null;
        }
        return {
            WebsiteID: website.Identifier,
            WebsiteTitle: website.Title,
            MediaID: media.Identifier,
            MediaTitle: media.Title,
            EntryID: entry.Identifier,
            EntryTitle: entry.Title,
        };
    }

    private FindWebsite(websiteID: string): MediaContainer<MediaChild> | undefined {
        return this.websites.WebsitePlugins.find(website => website.Identifier === websiteID);
    }

    private GetMediaDirectoryHandle(): FileSystemDirectoryHandle | null {
        return this.settings.OpenScope(GlobalScope).Get<Directory>(GlobalKey.MediaDirectory)?.Value ?? null;
    }

    private get UseWebsiteSubDirectory(): boolean {
        return this.settings.OpenScope(GlobalScope).Get<Check>(GlobalKey.UseWebsiteSubDirectory)?.Value ?? false;
    }

    // -----------------------------------------------------------------------------------------------------------------
    // Queries
    // -----------------------------------------------------------------------------------------------------------------

    /**
     * Get the history state of an entry (e.g., chapter).
     * When the entry is not in the history, this may trigger the (asynchronous) adoption of matching files
     * that were downloaded before the history existed. A {@link Changed} notification is raised on success.
     */
    public GetEntryState(entry: MediaContainer<MediaChild>): DownloadHistoryEntryState {
        const identity = this.Identify(entry);
        if(!identity) {
            return NotDownloaded;
        }
        const record = this.media.get(MediaKey(identity.WebsiteID, identity.MediaID))?.Entries.get(identity.EntryID);
        if(!record) {
            this.ScheduleAdoption(entry.Parent);
            return NotDownloaded;
        }
        return { Downloaded: true, Presence: record.Presence, Location: record.Location };
    }

    /**
     * Get the key which is used in {@link HistoryChangedEvent} for the media (e.g., manga) of the given entry.
     */
    public GetMediaKey(media: MediaContainer<MediaChild>): string | undefined {
        return media?.Parent?.Identifier && media.Identifier ? MediaKey(media.Parent.Identifier, media.Identifier) : undefined;
    }

    /**
     * Get the path segments (relative to the media directory) of an entry's files.
     * Uses the recorded location if available, otherwise the expected location based on the current settings.
     */
    public GetEntryFolder(entry: StoreableMediaContainer<MediaItem>): string[] {
        const identity = this.Identify(entry);
        const recorded = identity ? this.media.get(MediaKey(identity.WebsiteID, identity.MediaID))?.Entries.get(identity.EntryID)?.Location : null;
        const location = recorded ?? entry.GetStorageLocation();
        return [ ...location.Directories, location.Name ];
    }

    /**
     * Get the path segments (relative to the media directory) of a media's directory (e.g., manga folder).
     * Prefers the directory of the most recent present download, otherwise the expected directory based on the current settings.
     */
    public GetMediaFolder(media: MediaContainer<MediaChild>): string[] {
        const website = media?.Parent;
        const history = website ? this.media.get(MediaKey(website.Identifier, media.Identifier)) : undefined;
        return this.ResolveMediaFolder(history, website?.Title, media?.Title);
    }

    private ResolveMediaFolder(history: MediaHistory | undefined, websiteTitle?: string, mediaTitle?: string): string[] {
        const located = Array.from(history?.Entries.values() ?? [])
            .filter(entry => entry.Location?.Directories.length > 0)
            .sort((self, other) => Number(other.Presence === Presence.Present) - Number(self.Presence === Presence.Present) || other.LastDownloaded - self.LastDownloaded);
        if(located.length > 0) {
            return [ ...located[0].Location.Directories ];
        }
        return GetMediaDirectories(this.UseWebsiteSubDirectory, websiteTitle, mediaTitle);
    }

    /**
     * Get a read-only view of the complete history, grouped by media (e.g., manga).
     * Media are ordered by website and title, entries in natural order of their titles.
     */
    public GetMediaViews(): HistoryMediaView[] {
        const format = this.settings.OpenScope(GlobalScope).Get<Choice>(GlobalKey.MangaExportFormat)?.Value;
        const views: HistoryMediaView[] = [];
        for(const media of this.media.values()) {
            if(media.Entries.size === 0) {
                continue;
            }
            const website = this.FindWebsite(media.WebsiteID);
            const websiteTitle = website?.Title || media.WebsiteTitle || media.WebsiteID;
            const mediaFolder = this.ResolveMediaFolder(media, websiteTitle, media.MediaTitle);
            const entries: HistoryEntryView[] = Array.from(media.Entries.values(), entry => ({
                EntryID: entry.EntryID,
                Title: entry.EntryTitle || entry.EntryID,
                Presence: entry.Presence,
                Origin: entry.Origin,
                FirstDownloaded: entry.FirstDownloaded,
                LastDownloaded: entry.LastDownloaded,
                DownloadCount: entry.DownloadCount,
                // Without recorded location the expected location is derived from the title, without title only the media folder is known
                Folder: entry.Location
                    ? [ ...entry.Location.Directories, entry.Location.Name ]
                    : entry.EntryTitle ? [ ...mediaFolder, GetChapterExportTarget(format, entry.EntryTitle).Name ] : [ ...mediaFolder ],
            })).sort((self, other) => naturalOrder.compare(self.Title, other.Title));
            views.push({
                Key: media.Key,
                WebsiteID: media.WebsiteID,
                WebsiteTitle: websiteTitle,
                WebsiteAvailable: !!website,
                WebsiteIcon: website?.Icon ?? null,
                MediaID: media.MediaID,
                MediaTitle: media.MediaTitle || media.MediaID,
                Folder: mediaFolder,
                Present: entries.filter(entry => entry.Presence === Presence.Present).length,
                Missing: entries.filter(entry => entry.Presence === Presence.Missing).length,
                Unverified: entries.filter(entry => entry.Presence === Presence.Unknown).length,
                LastDownloaded: Math.max(0, ...entries.map(entry => entry.LastDownloaded)),
                Entries: entries,
            });
        }
        return views.sort((self, other) => naturalOrder.compare(self.MediaTitle, other.MediaTitle) || naturalOrder.compare(self.WebsiteTitle, other.WebsiteTitle));
    }

    /**
     * Get the media (e.g., manga) for a history record, so it can be shown in the frontend.
     * Uses the entry from the website's media list when available, otherwise a stand-in with the same identifier (like bookmarks).
     * @returns `null` when the website is not available in this installation
     */
    public ResolveMedia(websiteID: string, mediaID: string): MediaContainer<MediaChild> | null {
        const website = this.FindWebsite(websiteID);
        if(!website) {
            return null;
        }
        const existing = (website.Entries?.Value ?? [] as ReadonlyArray<MediaContainer<MediaChild>>).find(entry => (entry as MediaContainer<MediaChild>).Identifier === mediaID) as MediaContainer<MediaChild>;
        if(existing) {
            return existing;
        }
        try {
            return website.CreateEntry(mediaID, this.media.get(MediaKey(websiteID, mediaID))?.MediaTitle ?? mediaID) as MediaContainer<MediaChild>;
        } catch {
            return null;
        }
    }

    public GetStatistics(): HistoryStatistics {
        const statistics: HistoryStatistics = { Media: this.media.size, Entries: 0, Present: 0, Missing: 0, Unverified: 0 };
        for(const media of this.media.values()) {
            for(const entry of media.Entries.values()) {
                statistics.Entries++;
                switch(entry.Presence) {
                    case Presence.Present: statistics.Present++; break;
                    case Presence.Missing: statistics.Missing++; break;
                    default: statistics.Unverified++; break;
                }
            }
        }
        return statistics;
    }

    // -----------------------------------------------------------------------------------------------------------------
    // Recording (integration with the existing download manager)
    // -----------------------------------------------------------------------------------------------------------------

    private readonly OnDownloadQueueChanged = (tasks: DownloadTask[]) => {
        for(const task of tasks) {
            if(!this.watchedTasks.has(task)) {
                const callback = (status: Status) => {
                    // NOTE: A task is only completed when the media was successfully stored, failed attempts are never recorded
                    if(status === Status.Completed) {
                        this.RecordDownload(task.Media).catch(error => console.warn('DownloadHistory: Failed to record download!', error));
                    }
                };
                task.Status.Subscribe(callback);
                this.watchedTasks.set(task, callback);
            }
        }
        for(const [ task, callback ] of this.watchedTasks) {
            if(!tasks.includes(task)) {
                task.Status.Unsubscribe(callback);
                this.watchedTasks.delete(task);
            }
        }
    };

    /**
     * Record a successful download of the given {@link entry}.
     * An existing record (same identity) is updated in-place, so re-downloads never create duplicates.
     */
    public async RecordDownload(entry: StoreableMediaContainer<MediaItem>): Promise<void> {
        await this.loaded;
        const identity = this.Identify(entry);
        if(!identity) {
            return;
        }
        let location: StorageLocation | null = null;
        try {
            location = entry.GetStorageLocation() ?? null;
        } catch { /* location is optional information */ }

        const media = this.GetOrCreateMedia(identity.WebsiteID, identity.WebsiteTitle, identity.MediaID, identity.MediaTitle);
        // Titles are attributes and may change over time, the identity remains stable
        media.WebsiteTitle = identity.WebsiteTitle || media.WebsiteTitle;
        media.MediaTitle = identity.MediaTitle || media.MediaTitle;

        const now = Date.now();
        const existing = media.Entries.get(identity.EntryID);
        media.Entries.set(identity.EntryID, {
            EntryID: identity.EntryID,
            EntryTitle: identity.EntryTitle || existing?.EntryTitle || '',
            // Keep `0` (unknown) for adopted records, the actual first download happened before the history existed
            FirstDownloaded: existing ? existing.FirstDownloaded : now,
            LastDownloaded: now,
            DownloadCount: (existing?.DownloadCount ?? 0) + 1,
            Origin: existing?.Origin ?? RecordOrigin.Download,
            Location: location ?? existing?.Location ?? null,
            Presence: Presence.Present,
            PresenceChecked: now,
        });
        if(location) {
            this.untracked?.get(DirKey(location.Directories))?.Names.delete(location.Name);
        }
        await this.Persist(media.Key);
        this.Notify(media.Key);

        // A download proves that the media directory is accessible => catch up on a scan that was not possible on start-up
        const last = this.scanState.Value.Last;
        if(!this.reconciling && (!last || last.Outcome === ReconcileOutcome.AccessRequired || last.Outcome === ReconcileOutcome.Unavailable)) {
            this.Reconcile().catch(error => console.warn('DownloadHistory: Background scan failed!', error));
        }
    }

    // -----------------------------------------------------------------------------------------------------------------
    // Reconciliation with the file system
    // -----------------------------------------------------------------------------------------------------------------

    /**
     * Compare the history with the files in the media directory and update the presence of all records.
     * Only a successful scan changes records, a failed or inaccessible scan retains the previous state.
     * Concurrent calls share the same running scan.
     */
    public Reconcile(options: ReconcileOptions = {}): Promise<ReconcileResult> {
        if(!this.reconciling) {
            this.scanState.Value = { Running: true, Last: this.scanState.Value.Last };
            this.reconciling = this.PerformReconcile(options).then(result => {
                this.reconciling = null;
                this.scanState.Value = { Running: false, Last: result };
                return result;
            });
        }
        return this.reconciling;
    }

    private async PerformReconcile(options: ReconcileOptions): Promise<ReconcileResult> {
        const result: ReconcileResult = {
            Outcome: ReconcileOutcome.Completed,
            Started: Date.now(),
            Finished: 0,
            Checked: 0,
            Present: 0,
            Missing: 0,
            Unverified: 0,
            Relocated: 0,
            Untracked: 0,
        };
        const finish = (outcome: ReconcileOutcome, error?: unknown) => {
            result.Outcome = outcome;
            if(error !== undefined) {
                result.Error = ErrorMessage(error);
            }
            result.Finished = Date.now();
            return result;
        };

        try {
            await this.loaded;
            const root = this.GetMediaDirectoryHandle();
            if(!root) {
                return finish(ReconcileOutcome.Unavailable);
            }
            // NOTE: Permissions cannot be requested without user interaction, a background scan must not prompt
            if(await root.queryPermission({ mode: 'read' }) !== 'granted') {
                return finish(ReconcileOutcome.AccessRequired);
            }

            const reader = new DirectoryReader(root);
            const rootListing = await reader.List([]);
            if(rootListing.Status !== 'ok') {
                return finish(ReconcileOutcome.Failed, rootListing.Status === 'error' ? rootListing.Error : `'${root.name}' not found`);
            }

            // 1. Snapshot of all records (record objects are immutable, so the snapshot detects concurrent changes)
            const snapshot = [ ...this.media.values() ].flatMap(media => [ ...media.Entries.values() ].map(entry => ({ media, entry })));
            const recordedPaths = new Set(snapshot.filter(item => item.entry.Location).map(item => PathKey(item.entry.Location)));

            // 2. Verify the presence of each record
            const now = Date.now();
            const found = new Set<string>();
            const updates: { media: MediaHistory, before: HistoryEntryRecord, after: HistoryEntryRecord }[] = [];
            for(const { media, entry } of snapshot) {
                result.Checked++;
                const location = await this.LocateEntry(reader, media, entry, recordedPaths);
                if(location === null) {
                    result.Unverified++;
                    continue;
                }
                if(location) {
                    result.Present++;
                    found.add(PathKey(location));
                    if(entry.Location && !IsSameLocation(location, entry.Location)) {
                        result.Relocated++;
                    }
                } else {
                    result.Missing++;
                }
                const presence = location ? Presence.Present : Presence.Missing;
                const relocated = location && !IsSameLocation(location, entry.Location);
                if(presence !== entry.Presence || relocated) {
                    updates.push({ media, before: entry, after: { ...entry, Presence: presence, PresenceChecked: now, Location: location || entry.Location } });
                }
            }

            // 3. Index files/folders which are not associated with any record (e.g., downloads from before the history existed)
            const untracked = await this.IndexUntracked(reader, rootListing.Entries, new Set([ ...recordedPaths, ...found ]));

            // 4. Re-verify the media directory is still accessible, otherwise the results above are not trustworthy
            const verification = await new DirectoryReader(root).List([]);
            if(verification.Status !== 'ok') {
                return finish(ReconcileOutcome.Failed, verification.Status === 'error' ? verification.Error : `'${root.name}' not found`);
            }
            if(rootListing.Entries.size === 0 && !options.AllowEmptyRoot && snapshot.some(item => item.entry.Presence === Presence.Present)) {
                return finish(ReconcileOutcome.EmptyRoot);
            }

            // 5. Commit (records modified during the scan, e.g. by a completed download, are newer and therefore skipped)
            const changed = new Set<string>();
            for(const { media, before, after } of updates) {
                if(this.media.get(media.Key) === media && media.Entries.get(before.EntryID) === before) {
                    media.Entries.set(after.EntryID, after);
                    changed.add(media.Key);
                }
            }
            await this.Persist(...changed);
            this.untracked = untracked;
            this.adoptionAttempts.clear();
            result.Untracked = [ ...untracked.values() ].reduce((sum, directory) => sum + directory.Names.size, 0);
            this.Notify();
            return finish(ReconcileOutcome.Completed);
        } catch(error) {
            return finish(ReconcileOutcome.Failed, error);
        }
    }

    /**
     * Possible locations of an entry, the recorded location always comes first.
     * Derived locations cover renamed website directories and changed export formats within the same layout.
     */
    private GetCandidateLocations(media: MediaHistory, entry: HistoryEntryRecord): StorageLocation[] {
        const candidates: StorageLocation[] = [];
        const add = (directories: ReadonlyArray<string>, target: StorageTarget) => {
            const candidate: StorageLocation = { Directories: [ ...directories ], Name: target.Name, Kind: target.Kind };
            if(!candidates.some(other => IsSameLocation(other, candidate))) {
                candidates.push(candidate);
            }
        };
        const targets = GetChapterExportTargets(entry.EntryTitle);
        const website = this.FindWebsite(media.WebsiteID);
        if(entry.Location) {
            const layouts: ReadonlyArray<string>[] = [ entry.Location.Directories ];
            if(entry.Location.Directories.length === 2 && website) {
                layouts.push([ SanitizeFileName(website.Title), entry.Location.Directories[1] ]);
            }
            for(const layout of layouts) {
                add(layout, entry.Location);
                targets.forEach(target => add(layout, target));
            }
        } else {
            const layout = GetMediaDirectories(this.UseWebsiteSubDirectory, website?.Title ?? media.WebsiteTitle, media.MediaTitle);
            targets.forEach(target => add(layout, target));
        }
        return candidates;
    }

    /**
     * @returns The location where the entry was found, `false` when it is missing, or `null` when it could not be verified
     */
    private async LocateEntry(reader: DirectoryReader, media: MediaHistory, entry: HistoryEntryRecord, recordedPaths: Set<string>): Promise<StorageLocation | false | null> {
        let uncertain = false;
        for(const candidate of this.GetCandidateLocations(media, entry)) {
            // A derived location must never claim files which are recorded for another entry
            if(!IsSameLocation(candidate, entry.Location) && recordedPaths.has(PathKey(candidate))) {
                continue;
            }
            const listing = await reader.List(candidate.Directories);
            if(listing.Status === 'error') {
                uncertain = true;
                continue;
            }
            if(listing.Status === 'missing' || listing.Entries.get(candidate.Name) !== candidate.Kind) {
                continue;
            }
            if(candidate.Kind === 'directory') {
                const content = await reader.HasContent([ ...candidate.Directories, candidate.Name ]);
                if(content === null) {
                    uncertain = true;
                    continue;
                }
                if(!content) {
                    continue;
                }
            }
            return candidate;
        }
        return uncertain ? null : false;
    }

    private GetWebsiteDirectoryNames(): Set<string> {
        const names = new Set(this.websites.WebsitePlugins.map(website => SanitizeFileName(website.Title)));
        for(const media of this.media.values()) {
            for(const entry of media.Entries.values()) {
                if(entry.Location?.Directories.length === 2) {
                    names.add(entry.Location.Directories[0]);
                }
            }
        }
        return names;
    }

    /**
     * Index all entries in media directories which are not associated with a record.
     * Only `[Website/]Media/` directories are listed, the content of chapter folders is never enumerated.
     */
    private async IndexUntracked(reader: DirectoryReader, rootEntries: Listing, claimed: Set<string>): Promise<Map<string, UntrackedDirectory>> {
        const index = new Map<string, UntrackedDirectory>();
        const add = (directories: string[], entries: Listing) => {
            const names = new Map<string, StorageKind>();
            for(const [ name, kind ] of entries) {
                if(!claimed.has(PathKey({ Directories: directories, Name: name, Kind: kind }))) {
                    names.set(name, kind);
                }
            }
            if(names.size > 0) {
                index.set(DirKey(directories), { Directories: directories, Names: names });
            }
        };
        const websiteDirectories = this.GetWebsiteDirectoryNames();
        for(const [ name, kind ] of rootEntries) {
            if(kind !== 'directory') {
                continue;
            }
            const listing = await reader.List([ name ]);
            if(listing.Status !== 'ok') {
                continue;
            }
            if(websiteDirectories.has(name)) {
                for(const [ child, childKind ] of listing.Entries) {
                    if(childKind === 'directory') {
                        const media = await reader.List([ name, child ]);
                        if(media.Status === 'ok') {
                            add([ name, child ], media.Entries);
                        }
                    }
                }
            } else {
                add([ name ], listing.Entries);
            }
        }
        return index;
    }

    // -----------------------------------------------------------------------------------------------------------------
    // Adoption of downloads from before the history existed
    // -----------------------------------------------------------------------------------------------------------------

    private ScheduleAdoption(media: MediaContainer<MediaChild>) {
        const key = this.GetMediaKey(media);
        // NOTE: Adoption requires the entry list (e.g., chapters) which is loaded by the frontend anyway, the history never fetches it
        if(!key || !this.untracked || this.adoptionAttempts.has(key) || !(media.Entries?.Value?.length > 0)) {
            return;
        }
        this.adoptionAttempts.add(key);
        this.Adopt(media).catch(error => console.warn('DownloadHistory: Failed to adopt existing downloads!', error));
    }

    /**
     * A root-level media directory (without website directory) is ambiguous, because the same title may exist on many websites.
     * It is only associated when exactly one bookmark (from any website) corresponds to this directory and it is this media.
     */
    private IsUniqueRootLevelBookmark(media: MediaContainer<MediaChild>, directory: string): boolean {
        if(this.GetWebsiteDirectoryNames().has(directory)) {
            return false;
        }
        const matches = (this.bookmarks.Entries.Value ?? []).filter(bookmark => typeof bookmark.Title === 'string' && SanitizeFileName(bookmark.Title) === directory);
        return matches.length === 1 && matches[0].Identifier === media.Identifier && matches[0].Parent?.Identifier === media.Parent?.Identifier;
    }

    /**
     * Associate untracked files/folders with the entries of the given {@link media}.
     * A file/folder is only adopted when exactly one entry of the media maps to its name (no guessing by similar titles).
     */
    private async Adopt(media: MediaContainer<MediaChild>): Promise<void> {
        const website = media.Parent;
        const untracked = this.untracked;
        const root = this.GetMediaDirectoryHandle();
        if(!website?.Identifier || !untracked || !root) {
            return;
        }
        const directory = SanitizeFileName(media.Title);
        // Multiple media with the same (sanitized) title on the same website would share the same directory => ambiguous
        const siblings = website.Entries?.Value ?? [];
        if(siblings.some(other => other.Identifier !== media.Identifier && typeof other.Title === 'string' && SanitizeFileName(other.Title) === directory)) {
            return;
        }
        const layouts = [ [ SanitizeFileName(website.Title), directory ] ];
        if(this.IsUniqueRootLevelBookmark(media, directory)) {
            layouts.push([ directory ]);
        }

        const targets = new Map<string, Set<MediaContainer<MediaChild>>>();
        for(const entry of media.Entries.Value as ReadonlyArray<MediaContainer<MediaChild>>) {
            for(const target of GetChapterExportTargets(entry.Title)) {
                const key = `${target.Kind}|${target.Name}`;
                targets.set(key, (targets.get(key) ?? new Set()).add(entry));
            }
        }

        const key = MediaKey(website.Identifier, media.Identifier);
        const reader = new DirectoryReader(root);
        const now = Date.now();
        let adopted = 0;
        for(const layout of layouts) {
            const candidates = untracked.get(DirKey(layout));
            if(!candidates) {
                continue;
            }
            for(const [ name, kind ] of [ ...candidates.Names ]) {
                const matches = targets.get(`${kind}|${name}`);
                if(matches?.size !== 1) {
                    continue; // unknown or ambiguous (e.g., multiple chapters with the same title)
                }
                const [ entry ] = matches;
                if(!entry.Identifier || this.media.get(key)?.Entries.has(entry.Identifier)) {
                    continue;
                }
                if(kind === 'directory' && await reader.HasContent([ ...layout, name ]) !== true) {
                    continue; // empty (e.g., leftover of a failed download) or inaccessible
                }
                const history = this.GetOrCreateMedia(website.Identifier, website.Title, media.Identifier, media.Title);
                history.Entries.set(entry.Identifier, {
                    EntryID: entry.Identifier,
                    EntryTitle: entry.Title,
                    FirstDownloaded: 0,
                    LastDownloaded: 0,
                    DownloadCount: 0,
                    Origin: RecordOrigin.Scan,
                    Location: { Directories: [ ...layout ], Name: name, Kind: kind },
                    Presence: Presence.Present,
                    PresenceChecked: now,
                });
                candidates.Names.delete(name);
                adopted++;
            }
        }
        if(adopted > 0) {
            await this.Persist(key);
            this.Notify(key);
        }
    }

    // -----------------------------------------------------------------------------------------------------------------
    // Export & Import
    // -----------------------------------------------------------------------------------------------------------------

    /**
     * Export the complete download history in the versioned interchange format.
     */
    public async Export(): Promise<HistoryExportResult> {
        await this.loaded;
        const document = SerializeExport([ ...this.media.values() ].map(media => media.Serialize()));
        const data = new Blob([ JSON.stringify(document, null, 2) ], { type: 'application/json' });
        const today = new Date(Date.now() - 60000 * new Date().getTimezoneOffset()).toISOString().split('T').at(0);
        try {
            await this.fileIO.SaveFile(data, {
                suggestedName: `HakuNeko (${today}).download-history.json`,
                types: [ downloadHistoryFileType ]
            });
            return { Cancelled: false, Exported: document.records.length };
        } catch(error) {
            if(this.fileIO.IsAbortError(error)) {
                return { Cancelled: true, Exported: 0 };
            }
            throw error;
        }
    }

    /**
     * Load an exported download history and compute a preview of the merge, without changing anything.
     * Call {@link ImportPreview.Commit} to apply the import.
     */
    public async PrepareImport(): Promise<ImportPreview> {
        let data: Blob;
        try {
            data = await this.fileIO.LoadFile({ types: [ downloadHistoryFileType ] });
        } catch(error) {
            if(this.fileIO.IsAbortError(error)) {
                return { Cancelled: true, Summary: null, Commit: null };
            }
            throw error;
        }
        let json: unknown;
        try {
            json = JSON.parse(await data.text());
        } catch {
            throw new Exception(R.DownloadHistory_Import_UnsupportedFormatError);
        }
        const parsed = ParseExport(json);
        await this.loaded;
        return {
            Cancelled: false,
            Summary: this.PlanImport(parsed.Records, parsed.Rejected).Summary,
            Commit: () => this.CommitImport(parsed.Records, parsed.Rejected),
        };
    }

    private PlanImport(records: FlatHistoryRecord[], rejected: number) {
        const summary: ImportSummary = { Found: records.length + rejected, New: 0, AlreadyPresent: 0, Updated: 0, DuplicatesInFile: 0, Rejected: rejected, UnavailableWebsite: 0 };

        // Merge duplicates within the file itself (by identity), website identifiers which were renamed are mapped
        const incoming = new Map<string, FlatHistoryRecord>();
        for(const record of records) {
            const websiteID = MapLegacyWebsiteIdentifier(record.WebsiteID);
            const key = JSON.stringify([ websiteID, record.MediaID, record.Entry.EntryID ]);
            const duplicate = incoming.get(key);
            if(duplicate) {
                summary.DuplicatesInFile++;
                incoming.set(key, { ...duplicate, Entry: MergeEntryRecords(duplicate.Entry, record.Entry).Merged });
            } else {
                incoming.set(key, { ...record, WebsiteID: websiteID });
            }
        }

        const changes: { Record: FlatHistoryRecord, Entry: HistoryEntryRecord }[] = [];
        for(const record of incoming.values()) {
            const mediaKey = MediaKey(record.WebsiteID, record.MediaID);
            if(this.foreign.has(mediaKey)) {
                summary.Rejected++;
                continue;
            }
            const local = this.media.get(mediaKey)?.Entries.get(record.Entry.EntryID);
            if(local) {
                summary.AlreadyPresent++;
                const { Merged, Changed } = MergeEntryRecords(local, record.Entry);
                if(Changed) {
                    summary.Updated++;
                    changes.push({ Record: record, Entry: Merged });
                }
            } else {
                summary.New++;
                if(!this.FindWebsite(record.WebsiteID)) {
                    summary.UnavailableWebsite++;
                }
                changes.push({ Record: record, Entry: { ...record.Entry, Origin: RecordOrigin.Import, Presence: Presence.Unknown, PresenceChecked: 0 } });
            }
        }
        return { Summary: summary, Changes: changes };
    }

    private async CommitImport(records: FlatHistoryRecord[], rejected: number): Promise<ImportSummary> {
        await this.loaded;
        // NOTE: Re-plan against the current state, the history may have changed since the preview
        const { Summary, Changes } = this.PlanImport(records, rejected);
        const changed = new Set<string>();
        for(const { Record, Entry } of Changes) {
            const media = this.GetOrCreateMedia(Record.WebsiteID, Record.WebsiteTitle, Record.MediaID, Record.MediaTitle);
            media.Entries.set(Entry.EntryID, Entry);
            changed.add(media.Key);
        }
        // All imported records are written within a single transaction (all or nothing)
        await this.Persist(...changed);
        this.Notify();
        if(changed.size > 0) {
            // Verify the presence of the imported records in the background (this never downloads anything)
            this.Reconcile().catch(error => console.warn('DownloadHistory: Background scan failed!', error));
        }
        return Summary;
    }
}
