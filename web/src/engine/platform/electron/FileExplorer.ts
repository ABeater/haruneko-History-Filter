import type { IFileExplorer } from '../FileExplorer';
import { GetIPC } from './InterProcessCommunication';
import { Channels } from '../../../../../app/electron/src/ipc/InterProcessCommunicationChannels';

export default class implements IFileExplorer {

    private readonly ipc = GetIPC();

    public async GetDirectoryHints(): Promise<string[]> {
        return this.ipc.Invoke(Channels.FileExplorer.GetDirectoryHints);
    }

    public async PickDirectory(title: string): Promise<string | null> {
        return this.ipc.Invoke(Channels.FileExplorer.PickDirectory, title);
    }

    public async VerifyDirectory(directory: string, name: string, entries: string[]): Promise<boolean> {
        return this.ipc.Invoke(Channels.FileExplorer.VerifyDirectory, directory, name, entries);
    }

    public async Reveal(root: string, segments: string[]): Promise<string | null> {
        return this.ipc.Invoke(Channels.FileExplorer.Reveal, root, segments);
    }
}
