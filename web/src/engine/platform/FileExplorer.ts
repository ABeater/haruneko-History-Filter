import { Runtime } from './PlatformInfo';
import { PlatformInstanceActivator } from './PlatformInstanceActivator';
import NodeWebkitFileExplorer from './nw/FileExplorer';
import ElectronFileExplorer from './electron/FileExplorer';

/**
 * Access to the file manager of the operating system (only available in desktop runtimes).
 * @remarks
 * The web-app only knows the media directory as a `FileSystemDirectoryHandle` which does not expose the absolute path,
 * therefore the absolute path must be determined (and verified) through the platform.
 */
export interface IFileExplorer {
    /**
     * Get absolute paths of directories which were recently granted to the application (best effort, may be empty).
     */
    GetDirectoryHints(): Promise<string[]>;
    /**
     * Show a native dialog to select a directory.
     * @returns The absolute path of the selected directory, or `null` when cancelled
     */
    PickDirectory(title: string): Promise<string | null>;
    /**
     * Verify that the absolute {@link directory} has the given {@link name} and contains all given {@link entries}.
     */
    VerifyDirectory(directory: string, name: string, entries: string[]): Promise<boolean>;
    /**
     * Open the deepest existing directory of `root/segments...` (or reveal a file in its folder).
     * @returns The opened path, or `null` when the {@link root} does not exist
     */
    Reveal(root: string, segments: string[]): Promise<string | null>;
}

/**
 * @returns The file explorer for the current platform, or `null` when the platform does not support it (e.g., web-browser)
 */
export function CreateFileExplorer(): IFileExplorer | null {
    try {
        return new PlatformInstanceActivator<IFileExplorer>()
            .Configure(Runtime.NodeWebkit, () => new NodeWebkitFileExplorer())
            .Configure(Runtime.Electron, () => new ElectronFileExplorer())
            .Create();
    } catch {
        return null;
    }
}
