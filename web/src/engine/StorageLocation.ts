import { SanitizeFileName } from './StorageController';

/**
 * Physical kind of the entry which holds the content of a downloaded media item.
 * - `directory`: e.g., a folder with images
 * - `file`: e.g., a single archive (CBZ, EPUB, PDF)
 */
export type StorageKind = 'directory' | 'file';

/**
 * The name and kind of the entry that an exporter creates for a single media item (e.g., chapter).
 */
export type StorageTarget = {
    readonly Name: string;
    readonly Kind: StorageKind;
};

/**
 * The location of a stored media item, relative to the configured media directory.
 * @remarks
 * A location is only the _physical representation_ of a download and must never be used as the identity of a media item.
 */
export type StorageLocation = StorageTarget & {
    /**
     * The (sanitized) directory names below the media directory, e.g., `[ 'MangaDex', 'One Piece' ]`
     */
    readonly Directories: ReadonlyArray<string>;
};

export function CreateDirectoryTarget(title: string): StorageTarget {
    return { Name: SanitizeFileName(title), Kind: 'directory' };
}

export function CreateFileTarget(title: string, extension: string): StorageTarget {
    // NOTE: The extension must be sanitized together with the title to stay consistent with the file names created so far
    return { Name: SanitizeFileName(title + extension), Kind: 'file' };
}

/**
 * Get the directory names (relative to the media directory) where the items of a media container are stored.
 * This is the single source of truth for the directory layout `[Website/]Media/`.
 * @param useWebsiteSubDirectory - Corresponds to the global setting for using a website sub-directory
 * @param websiteTitle - Title of the website (plugin), only used when {@link useWebsiteSubDirectory} is enabled
 * @param mediaTitle - Title of the media container (e.g., manga)
 */
export function GetMediaDirectories(useWebsiteSubDirectory: boolean, websiteTitle?: string, mediaTitle?: string): string[] {
    const directories: string[] = [];
    if(useWebsiteSubDirectory && typeof websiteTitle === 'string') {
        directories.push(SanitizeFileName(websiteTitle));
    }
    if(typeof mediaTitle === 'string') {
        directories.push(SanitizeFileName(mediaTitle));
    }
    return directories;
}

export function IsSameLocation(self: StorageLocation | null | undefined, other: StorageLocation | null | undefined): boolean {
    if(!self || !other) {
        return false;
    }
    return self.Name === other.Name
        && self.Kind === other.Kind
        && self.Directories.length === other.Directories.length
        && self.Directories.every((directory, index) => directory === other.Directories[index]);
}

/**
 * Check whether the given value is a structurally valid {@link StorageLocation} (e.g., when loaded from an import file).
 */
export function IsStorageLocation(value: unknown): value is StorageLocation {
    const location = value as StorageLocation;
    return typeof location === 'object' && location !== null
        && typeof location.Name === 'string' && location.Name.length > 0
        && (location.Kind === 'directory' || location.Kind === 'file')
        && Array.isArray(location.Directories)
        && location.Directories.every(directory => typeof directory === 'string' && directory.length > 0);
}
