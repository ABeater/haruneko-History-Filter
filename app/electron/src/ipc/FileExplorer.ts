import fs from 'node:fs/promises';
import path from 'node:path';
import { dialog, shell, type BrowserWindow } from 'electron';
import type { IPC } from './InterProcessCommunication';
import { Channels } from './InterProcessCommunicationChannels';
import { CreateNodePathOperations, RevealPath, VerifyDirectory } from '../../../../web/src/engine/platform/FileExplorerPaths';

const maxHints = 8;
const hints: string[] = [];

/**
 * Remember the absolute path of a directory for which the web-app requested file system access.
 * This is only used as a hint, the web-app always verifies a hint before using it.
 */
export function RememberDirectoryHint(directory: string): void {
    if(typeof directory !== 'string' || !path.isAbsolute(directory)) {
        return;
    }
    const index = hints.indexOf(directory);
    if(index > -1) {
        hints.splice(index, 1);
    }
    hints.unshift(directory);
    hints.length = Math.min(hints.length, maxHints);
}

export class FileExplorer {

    private readonly operations = CreateNodePathOperations(fs, path);

    constructor(private readonly ipc: IPC, private readonly window: BrowserWindow) {
        this.ipc.Handle(Channels.FileExplorer.GetDirectoryHints, this.GetDirectoryHints.bind(this));
        this.ipc.Handle(Channels.FileExplorer.PickDirectory, this.PickDirectory.bind(this));
        this.ipc.Handle(Channels.FileExplorer.VerifyDirectory, this.VerifyDirectory.bind(this));
        this.ipc.Handle(Channels.FileExplorer.Reveal, this.Reveal.bind(this));
    }

    private async GetDirectoryHints(): Promise<string[]> {
        return [ ...hints ];
    }

    private async PickDirectory(title: string): Promise<string | null> {
        const result = await dialog.showOpenDialog(this.window, {
            title: typeof title === 'string' ? title : undefined,
            properties: [ 'openDirectory', 'dontAddToRecent' ],
        });
        return result.canceled ? null : result.filePaths.at(0) ?? null;
    }

    private async VerifyDirectory(directory: string, name: string, entries: string[]): Promise<boolean> {
        return VerifyDirectory(this.operations, directory, name, entries);
    }

    private async Reveal(root: string, segments: string[]): Promise<string | null> {
        return RevealPath(this.operations, {
            openDirectory: async (directory: string) => {
                // NOTE: Only directories reach this point, so `openPath` never launches a file
                const error = await shell.openPath(directory);
                if(error) {
                    throw new Error(error);
                }
            },
            revealFile: (file: string) => shell.showItemInFolder(file),
        }, root, segments);
    }
}
