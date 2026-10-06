import type { MediaChild, MediaContainer, MediaItem, StoreableMediaContainer } from '../../../engine/providers/MediaPlugin';
import { Key as GlobalKey } from '../../../engine/SettingsGlobal';
import type { Directory } from '../../../engine/SettingsManager';

/**
 * Whether folders can be opened in the file manager of the operating system (desktop apps only).
 */
export function CanOpenFolders(): boolean {
    return window.HakuNeko.MediaDirectoryExplorer.IsSupported;
}

async function Reveal(segments: () => string[]): Promise<void> {
    try {
        await window.HakuNeko.SettingsManager.OpenScope().Get<Directory>(GlobalKey.MediaDirectory).EnsureAccess();
        await window.HakuNeko.MediaDirectoryExplorer.Reveal(segments());
    } catch(error) {
        // TODO: Use appropriate error visualization ... (same as for download errors)
        alert(error?.message ?? error);
    }
}

/**
 * Open the folder of a downloaded entry (e.g., chapter), or its nearest existing parent folder.
 * Archives (e.g., CBZ) are selected in their folder.
 */
export function OpenEntryFolder(entry: MediaContainer<MediaItem>): Promise<void> {
    return Reveal(() => window.HakuNeko.DownloadHistory.GetEntryFolder(entry as StoreableMediaContainer<MediaItem>));
}

/**
 * Open the folder of a media (e.g., manga), or its nearest existing parent folder.
 */
export function OpenMediaFolder(media: MediaContainer<MediaChild>): Promise<void> {
    return Reveal(() => window.HakuNeko.DownloadHistory.GetMediaFolder(media));
}

/**
 * Open a folder (path segments relative to the media directory), or its nearest existing parent folder.
 */
export function OpenFolder(segments: ReadonlyArray<string>): Promise<void> {
    return Reveal(() => [ ...segments ]);
}
