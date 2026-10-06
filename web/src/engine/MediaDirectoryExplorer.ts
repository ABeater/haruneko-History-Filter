import type { SettingsManager, Directory, Text } from './SettingsManager';
import { Key as GlobalKey, Scope as GlobalScope } from './SettingsGlobal';
import type { IFileExplorer } from './platform/FileExplorer';
import { IsValidSegment } from './platform/FileExplorerPaths';
import { Exception } from './Error';
import { EngineResourceKey as R } from '../i18n/ILocale';
import { GetLocale } from '../i18n/Localization';

/**
 * Open locations below the media directory in the file manager of the operating system.
 * @remarks
 * The media directory is only available as `FileSystemDirectoryHandle` which does not expose its absolute path.
 * The absolute path is therefore taken from the settings or from platform hints, or the user locates the folder once.
 * Any of these candidates is only used after it was verified against the directory handle.
 */
export class MediaDirectoryExplorer {

    private readonly verified = new WeakMap<FileSystemDirectoryHandle, string>();

    constructor(private readonly settings: SettingsManager, private readonly platform: IFileExplorer | null) {}

    /**
     * Whether the current platform supports opening folders in the file manager.
     */
    public get IsSupported(): boolean {
        return !!this.platform;
    }

    /**
     * Open the given location (path segments relative to the media directory) in the file manager.
     * The nearest existing parent folder is opened when the location does not exist, files are revealed in their folder.
     * Must be invoked through user interaction, because it may show a dialog to locate the media directory (only once).
     * @returns The opened path, or `null` when the user cancelled locating the media directory
     */
    public async Reveal(segments: string[]): Promise<string | null> {
        if(!this.platform) {
            throw new Exception(R.MediaDirectoryExplorer_UnsupportedPlatformError);
        }
        const handle = this.settings.OpenScope(GlobalScope).Get<Directory>(GlobalKey.MediaDirectory)?.Value;
        if(!handle) {
            throw new Exception(R.Settings_Global_MediaDirectory_UnsetError);
        }
        const root = await this.ResolveRootPath(handle);
        if(!root) {
            return null;
        }
        const opened = await this.platform.Reveal(root, segments);
        if(!opened) {
            this.verified.delete(handle);
            throw new Exception(R.MediaDirectoryExplorer_NotFoundError, handle.name);
        }
        return opened;
    }

    private async ListNames(handle: FileSystemDirectoryHandle, limit = 32): Promise<string[]> {
        const names: string[] = [];
        for await (const name of handle.keys()) {
            // NOTE: Names which are not created by HakuNeko may be rejected by the platform (e.g., `Re:Zero` on Linux/macOS),
            //       which would fail the verification of every location => only use names which can be verified
            if(!IsValidSegment(name)) {
                continue;
            }
            names.push(name);
            if(names.length >= limit) {
                break;
            }
        }
        return names;
    }

    private async ResolveRootPath(handle: FileSystemDirectoryHandle): Promise<string | null> {
        const cached = this.verified.get(handle);
        if(cached) {
            return cached;
        }
        const setting = this.settings.OpenScope(GlobalScope).Get<Text>(GlobalKey.MediaDirectoryPath);
        const names = await this.ListNames(handle);
        const candidates = [ setting?.Value, ...await this.platform.GetDirectoryHints() ]
            .filter(candidate => typeof candidate === 'string' && candidate.trim().length > 0)
            .map(candidate => candidate.trim());
        for(const candidate of new Set(candidates)) {
            if(await this.platform.VerifyDirectory(candidate, handle.name, names)) {
                return this.Remember(handle, candidate, setting);
            }
        }
        const picked = await this.platform.PickDirectory(GetLocale()[R.MediaDirectoryExplorer_LocateDialogTitle](handle.name));
        if(!picked) {
            return null;
        }
        if(!await this.platform.VerifyDirectory(picked, handle.name, names)) {
            throw new Exception(R.MediaDirectoryExplorer_LocationMismatchError, handle.name);
        }
        return this.Remember(handle, picked, setting);
    }

    private Remember(handle: FileSystemDirectoryHandle, path: string, setting?: Text): string {
        this.verified.set(handle, path);
        if(setting && setting.Value !== path) {
            setting.Value = path;
        }
        return path;
    }
}
