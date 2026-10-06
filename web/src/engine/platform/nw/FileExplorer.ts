import type { IFileExplorer } from '../FileExplorer';
import { CreateNodePathOperations, RevealPath, VerifyDirectory, type PathOperations } from '../FileExplorerPaths';

type NodeRequire = (module: string) => unknown;

/**
 * NW.js grants NodeJS access to the web-app (`node-remote`), so the file system and shell are used directly in the renderer.
 */
export default class implements IFileExplorer {

    #operations: PathOperations;

    private get Operations(): PathOperations {
        if(!this.#operations) {
            const require = (globalThis as unknown as { require: NodeRequire }).require;
            this.#operations = CreateNodePathOperations(
                require('fs/promises') as Parameters<typeof CreateNodePathOperations>[0],
                require('path') as Parameters<typeof CreateNodePathOperations>[1]
            );
        }
        return this.#operations;
    }

    public async GetDirectoryHints(): Promise<string[]> {
        return [];
    }

    public async PickDirectory(title: string): Promise<string | null> {
        return new Promise<string | null>(resolve => {
            const input = document.createElement('input');
            input.type = 'file';
            input.setAttribute('nwdirectory', '');
            input.setAttribute('nwdirectorydesc', title);
            input.addEventListener('change', () => resolve((input.files?.[0] as File & { path?: string })?.path || input.value || null), { once: true });
            input.addEventListener('cancel', () => resolve(null), { once: true });
            input.click();
        });
    }

    public async VerifyDirectory(directory: string, name: string, entries: string[]): Promise<boolean> {
        return VerifyDirectory(this.Operations, directory, name, entries);
    }

    public async Reveal(root: string, segments: string[]): Promise<string | null> {
        return RevealPath(this.Operations, {
            openDirectory: async (directory: string) => nw.Shell.openItem(directory),
            revealFile: (file: string) => nw.Shell.showItemInFolder(file),
        }, root, segments);
    }
}
