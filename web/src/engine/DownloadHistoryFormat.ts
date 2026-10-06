import { Exception } from './Error';
import { EngineResourceKey as R } from '../i18n/ILocale';
import { IsStorageLocation, type StorageKind, type StorageLocation } from './StorageLocation';

/**
 * Whether the files of a previously downloaded entry are currently present in the media directory.
 * This is intentionally independent from the download history itself (a missing file never removes the history).
 */
export const Presence = {
    /** Not yet verified (e.g., imported, or the media directory was never accessible) */
    Unknown: 'unknown',
    /** Verified by a successful file system scan or a successful download */
    Present: 'present',
    /** A successful file system scan could not find the files */
    Missing: 'missing',
} as const;
export type Presence = typeof Presence[keyof typeof Presence];

/**
 * How a history record was created in this installation.
 */
export const RecordOrigin = {
    /** Recorded after a successful download by the existing download manager */
    Download: 'download',
    /** Adopted from existing files on disk which were downloaded before the history existed */
    Scan: 'scan',
    /** Imported from an exported download history */
    Import: 'import',
} as const;
export type RecordOrigin = typeof RecordOrigin[keyof typeof RecordOrigin];

/**
 * The persisted history of a single entry (e.g., chapter), identified by {@link EntryID} within its media.
 */
export type HistoryEntryRecord = {
    /** Stable identifier of the entry, as provided by the website plugin (e.g., `Chapter.Identifier`) */
    EntryID: string;
    /** Last known title (attribute only, never used for identification) */
    EntryTitle: string;
    /** Time (epoch ms) of the first successful download, `0` when unknown (e.g., adopted from disk) */
    FirstDownloaded: number;
    /** Time (epoch ms) of the most recent successful download, `0` when unknown */
    LastDownloaded: number;
    /** Number of successful downloads observed by this installation */
    DownloadCount: number;
    Origin: RecordOrigin;
    /** Last known location (relative to the media directory), never part of the identity */
    Location: StorageLocation | null;
    Presence: Presence;
    /** Time (epoch ms) when {@link Presence} was last verified, `0` when never */
    PresenceChecked: number;
};

/**
 * Current version of the persisted (internal) record schema.
 */
export const SchemaVersion = 1;

/**
 * The persisted history of all entries of a single media (e.g., manga), stored under {@link MediaKey}.
 * Grouping by media mirrors the layout of the existing item flags and keeps writes small and atomic.
 */
export type HistoryMediaRecord = {
    Version: number;
    /** Stable identifier of the website plugin (e.g., `mangadex`) */
    WebsiteID: string;
    /** Last known title of the website plugin (attribute only) */
    WebsiteTitle: string;
    /** Stable identifier of the media within the website (e.g., manga URL/key) */
    MediaID: string;
    /** Last known title of the media (attribute only) */
    MediaTitle: string;
    /** Stored as array (instead of an object map) to be safe against arbitrary identifiers such as `__proto__` */
    Entries: HistoryEntryRecord[];
};

/**
 * The storage key for a media, following the same convention as bookmarks and item flags.
 */
export function MediaKey(websiteID: string, mediaID: string): string {
    return `${websiteID} :: ${mediaID}`;
}

function MinKnown(self: number, other: number): number {
    if(!self) return other || 0;
    if(!other) return self;
    return Math.min(self, other);
}

/**
 * Merge an {@link incoming} record (e.g., from an import) into an existing {@link local} record of the same identity.
 * The merge is idempotent: merging the same incoming record multiple times yields the same result.
 * Local attributes (titles, presence, origin, location) take precedence, because they describe this installation.
 */
export function MergeEntryRecords(local: HistoryEntryRecord, incoming: HistoryEntryRecord): { Merged: HistoryEntryRecord, Changed: boolean } {
    const merged: HistoryEntryRecord = {
        ...local,
        FirstDownloaded: MinKnown(local.FirstDownloaded, incoming.FirstDownloaded),
        LastDownloaded: Math.max(local.LastDownloaded || 0, incoming.LastDownloaded || 0),
        DownloadCount: Math.max(local.DownloadCount || 0, incoming.DownloadCount || 0),
        Location: local.Location ?? incoming.Location ?? null,
        EntryTitle: local.EntryTitle || incoming.EntryTitle,
    };
    const changed = merged.FirstDownloaded !== local.FirstDownloaded
        || merged.LastDownloaded !== local.LastDownloaded
        || merged.DownloadCount !== local.DownloadCount
        || merged.Location !== local.Location
        || merged.EntryTitle !== local.EntryTitle;
    return { Merged: merged, Changed: changed };
}

// ---------------------------------------------------------------------------------------------------------------------
// Interchange (export/import) format
// The interchange format is deliberately decoupled from the internal schema above,
// so the internal storage can evolve without breaking existing backups.
// ---------------------------------------------------------------------------------------------------------------------

export const ExportFormatName = 'haruneko-download-history';
export const ExportFormatVersion = 1;

type ExportLocationV1 = {
    directories: string[];
    name: string;
    kind: StorageKind;
};

export type ExportRecordV1 = {
    website: { id: string; title: string; };
    media: { id: string; title: string; };
    entry: { id: string; title: string; };
    downloaded: { first: string | null; last: string | null; count: number; };
    origin: string;
    /** Relative to the media directory of the exporting installation (absolute paths are never exported) */
    location: ExportLocationV1 | null;
};

export type ExportDocumentV1 = {
    format: typeof ExportFormatName;
    version: typeof ExportFormatVersion;
    exported: string;
    records: ExportRecordV1[];
};

/**
 * A single entry together with the identity/attributes of its media, independent from any storage layout.
 */
export type FlatHistoryRecord = {
    WebsiteID: string;
    WebsiteTitle: string;
    MediaID: string;
    MediaTitle: string;
    Entry: HistoryEntryRecord;
};

function ToISO(time: number): string | null {
    return time > 0 ? new Date(time).toISOString() : null;
}

function FromISO(text: unknown): number {
    const time = typeof text === 'string' ? Date.parse(text) : NaN;
    return Number.isFinite(time) && time > 0 ? time : 0;
}

export function SerializeExport(media: Iterable<HistoryMediaRecord>, now = new Date()): ExportDocumentV1 {
    const records: ExportRecordV1[] = [];
    for(const record of media) {
        for(const entry of record.Entries) {
            records.push({
                website: { id: record.WebsiteID, title: record.WebsiteTitle },
                media: { id: record.MediaID, title: record.MediaTitle },
                entry: { id: entry.EntryID, title: entry.EntryTitle },
                downloaded: {
                    first: ToISO(entry.FirstDownloaded),
                    last: ToISO(entry.LastDownloaded),
                    count: entry.DownloadCount,
                },
                origin: entry.Origin,
                location: entry.Location ? {
                    directories: [ ...entry.Location.Directories ],
                    name: entry.Location.Name,
                    kind: entry.Location.Kind,
                } : null,
            });
        }
    }
    return {
        format: ExportFormatName,
        version: ExportFormatVersion,
        exported: now.toISOString(),
        records,
    };
}

function IsNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0;
}

function AsString(value: unknown): string {
    return typeof value === 'string' ? value : '';
}

function ParseRecordV1(data: unknown): FlatHistoryRecord | null {
    const record = data as Partial<ExportRecordV1>;
    if(typeof record !== 'object' || record === null) {
        return null;
    }
    const websiteID = record.website?.id;
    const mediaID = record.media?.id;
    const entryID = record.entry?.id;
    if(!IsNonEmptyString(websiteID) || !IsNonEmptyString(mediaID) || !IsNonEmptyString(entryID)) {
        // A record without stable identifiers can never be matched reliably => reject (never guess by title)
        return null;
    }
    const location = record.location ? {
        Directories: record.location.directories,
        Name: record.location.name,
        Kind: record.location.kind,
    } : null;
    const count = Number(record.downloaded?.count);
    return {
        WebsiteID: websiteID,
        WebsiteTitle: AsString(record.website.title),
        MediaID: mediaID,
        MediaTitle: AsString(record.media.title),
        Entry: {
            EntryID: entryID,
            EntryTitle: AsString(record.entry.title),
            FirstDownloaded: FromISO(record.downloaded?.first),
            LastDownloaded: FromISO(record.downloaded?.last),
            DownloadCount: Number.isInteger(count) && count > 0 ? count : 1,
            Origin: RecordOrigin.Import,
            // Invalid location information is dropped, but does not invalidate the record itself
            Location: IsStorageLocation(location) ? location : null,
            Presence: Presence.Unknown,
            PresenceChecked: 0,
        },
    };
}

/**
 * Parse an exported download history document.
 * @throws {@link Exception} when the data is not a download history export or was created by a newer (unsupported) version
 * @returns All valid records and the number of rejected (malformed) records
 */
export function ParseExport(data: unknown): { Records: FlatHistoryRecord[], Rejected: number } {
    const document = data as Partial<ExportDocumentV1>;
    if(typeof document !== 'object' || document === null || document.format !== ExportFormatName || !Array.isArray(document.records)) {
        throw new Exception(R.DownloadHistory_Import_UnsupportedFormatError);
    }
    const version = Number(document.version);
    if(!Number.isInteger(version) || version < 1) {
        throw new Exception(R.DownloadHistory_Import_UnsupportedFormatError);
    }
    if(version > ExportFormatVersion) {
        throw new Exception(R.DownloadHistory_Import_NewerVersionError, version.toString(), ExportFormatVersion.toString());
    }
    // NOTE: Future versions must convert older documents here (e.g., `if(version === 1) document = MigrateV1toV2(document)`)
    const records: FlatHistoryRecord[] = [];
    let rejected = 0;
    for(const entry of document.records) {
        const record = ParseRecordV1(entry);
        if(record) {
            records.push(record);
        } else {
            rejected++;
        }
    }
    return { Records: records, Rejected: rejected };
}
