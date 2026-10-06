import { vi, describe, it, expect } from 'vitest';
import { DownloadHistory, Presence, RecordOrigin, ReconcileOutcome, type ImportPreview } from './DownloadHistory';
import { type HistoryMediaRecord, ExportFormatName, MediaKey, SerializeExport } from './DownloadHistoryFormat';
import { DownloadTask, Status } from './DownloadTask';
import { ObservableArray } from './Observable';
import { Exception } from './Error';
import type { HistoryStorage } from './DownloadHistoryStorage';
import type { StorageController } from './StorageController';
import type { SettingsManager } from './SettingsManager';
import type { InteractiveFileContentProvider } from './InteractiveFileContentProvider';
import type { MediaChild, MediaContainer, MediaItem, StoreableMediaContainer } from './providers/MediaPlugin';
import { CreateDirectoryTarget, CreateFileTarget, GetMediaDirectories, type StorageLocation } from './StorageLocation';

// ---------------------------------------------------------------------------------------------------------------------
// In-memory fakes
// ---------------------------------------------------------------------------------------------------------------------

class FakeFile {
    public readonly kind = 'file';
    constructor(public readonly name: string) {}
}

/**
 * Minimal in-memory implementation of a `FileSystemDirectoryHandle` with fault injection.
 */
/* eslint-disable @typescript-eslint/naming-convention */ //=> Methods must match the names of the File System Access API
class FakeDirectory {

    public readonly kind = 'directory';
    public readonly children = new Map<string, FakeDirectory | FakeFile>();
    /** When set, any access to this directory throws a `DOMException` with this name */
    public failure: string | null = null;
    public permission: PermissionState = 'granted';

    constructor(public readonly name: string) {}

    private Check() {
        if(this.failure) {
            throw new DOMException('Simulated failure', this.failure);
        }
    }

    public async queryPermission(): Promise<PermissionState> {
        return this.permission;
    }

    public async getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<FakeDirectory> {
        this.Check();
        const child = this.children.get(name);
        if(child instanceof FakeDirectory) {
            return child;
        }
        if(child) {
            throw new DOMException('Not a directory', 'TypeMismatchError');
        }
        if(options?.create) {
            return this.Dir(name);
        }
        throw new DOMException('Not found', 'NotFoundError');
    }

    public async *values(): AsyncGenerator<FakeDirectory | FakeFile> {
        this.Check();
        for(const child of [ ...this.children.values() ]) {
            yield child;
        }
    }

    public async *keys(): AsyncGenerator<string> {
        this.Check();
        for(const name of [ ...this.children.keys() ]) {
            yield name;
        }
    }
    /* eslint-enable @typescript-eslint/naming-convention */

    public Dir(...path: string[]): FakeDirectory {
        let current: FakeDirectory = this;
        for(const name of path) {
            let child = current.children.get(name);
            if(!(child instanceof FakeDirectory)) {
                child = new FakeDirectory(name);
                current.children.set(name, child);
            }
            current = child;
        }
        return current;
    }

    public File(...path: string[]): FakeFile {
        const file = new FakeFile(path.at(-1));
        this.Dir(...path.slice(0, -1)).children.set(file.name, file);
        return file;
    }

    public Remove(...path: string[]): void {
        this.Dir(...path.slice(0, -1)).children.delete(path.at(-1));
    }

    public Clear(): void {
        this.children.clear();
    }
}

/**
 * In-memory history storage with the same semantics as the IndexedDB implementation (values are cloned).
 */
class MemoryStorage implements HistoryStorage {

    public readonly records = new Map<string, unknown>();

    public readonly Save = vi.fn(async (records: Record<string, unknown>) => {
        for(const key of Object.keys(records)) {
            this.records.set(key, structuredClone(records[key]));
        }
    });

    public async Load(): Promise<unknown[]> {
        return [ ...this.records.values() ].map(value => structuredClone(value));
    }

    public async Remove(...keys: string[]): Promise<void> {
        keys.forEach(key => this.records.delete(key));
    }
}

type FakeMedia = MediaContainer<MediaChild> & { entries: FakeChapter[] };
type FakeChapter = StoreableMediaContainer<MediaItem> & { Title: string };

class TestFixture {

    public readonly Root = new FakeDirectory('Downloads');
    public readonly Storage = new MemoryStorage();
    public readonly Queue = new ObservableArray<DownloadTask>([]);
    public readonly Websites: MediaContainer<MediaChild>[] = [];
    public readonly Bookmarks: MediaContainer<MediaChild>[] = [];
    public readonly SettingValues: Record<string, unknown> = {
        'media-directory': this.Root,
        'website-subdirectory': true,
        'manga-export-format': 'image/*',
    };
    public readonly FileIO = {
        IsAbortError: (error: Error) => error instanceof DOMException && error.name === 'AbortError',
        LoadFile: vi.fn(),
        SaveFile: vi.fn(),
    };

    public readonly Settings = {
        OpenScope: () => ({
            Get: (key: string) => key in this.SettingValues ? { Value: this.SettingValues[key] } : undefined,
        }),
    };

    public CreateTestee(): DownloadHistory {
        return new DownloadHistory(
            this.Storage,
            this.Settings as unknown as SettingsManager,
            { WebsitePlugins: this.Websites },
            { Entries: { Value: this.Bookmarks, Subscribe: vi.fn(), Unsubscribe: vi.fn() } },
            { Queue: this.Queue },
            this.FileIO as unknown as InteractiveFileContentProvider,
        );
    }

    public AddWebsite(id: string, title: string): MediaContainer<MediaChild> {
        const website = {
            Identifier: id,
            Title: title,
            Icon: `icon://${id}`,
            Entries: { Value: [] },
            CreateEntry: vi.fn((identifier: string, name: string) => ({ Identifier: identifier, Title: name, Parent: website })),
        } as unknown as MediaContainer<MediaChild>;
        this.Websites.push(website);
        return website;
    }

    public AddMedia(website: MediaContainer<MediaChild>, id: string, title: string): FakeMedia {
        const entries: FakeChapter[] = [];
        const media = { Identifier: id, Title: title, Parent: website, entries, Entries: { get Value() { return entries; } } } as unknown as FakeMedia;
        (website.Entries.Value as MediaContainer<MediaChild>[]).push(media);
        return media;
    }

    /**
     * Create a chapter which stores its content in the fake media directory (like the RAW image exporter).
     */
    public AddChapter(media: FakeMedia, id: string, title: string, pages = 2): FakeChapter {
        const settings = this.SettingValues;
        const chapter = {
            Identifier: id,
            Title: title,
            Parent: media,
            Update: vi.fn(async () => {}),
            Entries: { Value: new Array(pages).fill(null).map(() => ({ Fetch: vi.fn(async () => new Blob([ 'image' ])) })) },
            GetStorageLocation(): StorageLocation {
                const directories = GetMediaDirectories(settings['website-subdirectory'] as boolean, media.Parent.Title, media.Title);
                return { Directories: directories, ...CreateDirectoryTarget(this.Title) };
            },
            Store: vi.fn(async function() {
                const location = this.GetStorageLocation();
                (settings['media-directory'] as FakeDirectory).File(...location.Directories, location.Name, '01.jpg');
            }),
        } as unknown as FakeChapter;
        media.entries.push(chapter);
        return chapter;
    }

    /**
     * Run a real {@link DownloadTask} through the queue observed by the download history.
     */
    public async Download(chapter: FakeChapter): Promise<DownloadTask> {
        const task = new DownloadTask(chapter, { SaveTemporary: vi.fn(async () => 'temp'), RemoveTemporary: vi.fn(async () => {}) } as unknown as StorageController);
        this.Queue.Push(task);
        await task.Run();
        return task;
    }

    public get StoredRecords(): HistoryMediaRecord[] {
        return Array.from(this.Storage.records.values()) as HistoryMediaRecord[];
    }
}

async function Settle(testee: DownloadHistory): Promise<void> {
    await testee.Ready;
    for(let index = 0; index < 10; index++) {
        await new Promise(resolve => setTimeout(resolve, 0));
    }
    await testee.Reconcile();
    await new Promise(resolve => setTimeout(resolve, 0));
}

function SetupMangaDex(fixture: TestFixture) {
    const website = fixture.AddWebsite('mangadex', 'MangaDex');
    const manga = fixture.AddMedia(website, '/title/one-piece', 'One Piece');
    const chapter1 = fixture.AddChapter(manga, '/chapter/1', 'Chapter 1');
    const chapter2 = fixture.AddChapter(manga, '/chapter/2', 'Chapter 2');
    return { website, manga, chapter1, chapter2 };
}

// ---------------------------------------------------------------------------------------------------------------------

describe('DownloadHistory', () => {

    describe('Recording & Persistence', () => {

        it('Should record a successful download and keep it across application restarts', async () => {
            const fixture = new TestFixture();
            const { chapter1, chapter2 } = SetupMangaDex(fixture);
            const testee = fixture.CreateTestee();
            await testee.Ready;

            const task = await fixture.Download(chapter1);
            await Settle(testee);

            expect(task.Status.Value).toBe(Status.Completed);
            expect(testee.GetEntryState(chapter1)).toEqual({
                Downloaded: true,
                Presence: Presence.Present,
                Location: { Directories: [ 'MangaDex', 'One Piece' ], Name: 'Chapter 1', Kind: 'directory' },
            });
            expect(testee.GetEntryState(chapter2).Downloaded).toBe(false);

            // Simulate an application restart: new instance, same persistent storage, empty download queue
            const restarted = new TestFixture();
            Object.assign(restarted, { Storage: fixture.Storage, Root: fixture.Root, Websites: fixture.Websites });
            restarted.SettingValues['media-directory'] = fixture.Root;
            const reloaded = restarted.CreateTestee();
            await reloaded.Ready;

            expect(reloaded.GetEntryState(chapter1)).toEqual(expect.objectContaining({ Downloaded: true, Presence: Presence.Present }));
            expect(reloaded.GetEntryState(chapter2).Downloaded).toBe(false);
        });

        it('Should not record a failed download and record it once the existing task is retried successfully', async () => {
            const fixture = new TestFixture();
            const { chapter1 } = SetupMangaDex(fixture);
            const testee = fixture.CreateTestee();
            await testee.Ready;
            (chapter1.Store as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Disk full'));

            const task = await fixture.Download(chapter1);
            await Settle(testee);

            expect(task.Status.Value).toBe(Status.Failed);
            expect(task.Errors.Value.length).toBe(1);
            expect(testee.GetEntryState(chapter1).Downloaded).toBe(false);
            expect(fixture.StoredRecords.length).toBe(0);

            // Retry with the existing mechanism (same task instance, as used by the frontend)
            await task.Run();
            await Settle(testee);

            expect(task.Status.Value).toBe(Status.Completed);
            expect(fixture.Queue.Value).toEqual([ task ]);
            expect(testee.GetEntryState(chapter1)).toEqual(expect.objectContaining({ Downloaded: true, Presence: Presence.Present }));
        });

        it('Should update the existing record when a missing chapter is downloaded again (no duplicates)', async () => {
            const fixture = new TestFixture();
            const { chapter1 } = SetupMangaDex(fixture);
            const testee = fixture.CreateTestee();
            const task = await fixture.Download(chapter1);
            await Settle(testee);

            fixture.Root.Remove('MangaDex', 'One Piece', 'Chapter 1');
            await testee.Reconcile();
            expect(testee.GetEntryState(chapter1).Presence).toBe(Presence.Missing);

            await task.Run(); // download again
            await Settle(testee);

            expect(testee.GetEntryState(chapter1).Presence).toBe(Presence.Present);
            expect(fixture.StoredRecords.length).toBe(1);
            expect(fixture.StoredRecords[0].Entries.length).toBe(1);
            expect(fixture.StoredRecords[0].Entries[0]).toEqual(expect.objectContaining({ EntryID: '/chapter/1', DownloadCount: 2, Origin: RecordOrigin.Download }));
        });

        it('Should keep separate records for the same title on different websites', async () => {
            const fixture = new TestFixture();
            const mangadex = fixture.AddMedia(fixture.AddWebsite('mangadex', 'MangaDex'), '/title/one-piece', 'One Piece');
            const mangafire = fixture.AddMedia(fixture.AddWebsite('mangafire', 'MangaFire'), 'one-piece.dkw', 'One Piece');
            const chapterDex = fixture.AddChapter(mangadex, '/chapter/1', 'Chapter 1');
            const chapterFire = fixture.AddChapter(mangafire, '/read/one-piece/1', 'Chapter 1');
            const testee = fixture.CreateTestee();

            await fixture.Download(chapterDex);
            await fixture.Download(chapterFire);
            await Settle(testee);
            fixture.Root.Remove('MangaFire', 'One Piece', 'Chapter 1');
            await testee.Reconcile();

            expect(fixture.StoredRecords.map(record => MediaKey(record.WebsiteID, record.MediaID)).sort()).toEqual([ 'mangadex :: /title/one-piece', 'mangafire :: one-piece.dkw' ]);
            expect(testee.GetEntryState(chapterDex).Presence).toBe(Presence.Present);
            expect(testee.GetEntryState(chapterFire).Presence).toBe(Presence.Missing);
        });

        it('Should keep the identity when titles change', async () => {
            const fixture = new TestFixture();
            const { manga, chapter1 } = SetupMangaDex(fixture);
            const testee = fixture.CreateTestee();
            await fixture.Download(chapter1);
            await Settle(testee);

            // The website renames the manga and the chapter, the identifiers remain the same
            Object.assign(manga, { Title: 'One Piece (Official)' });
            Object.assign(chapter1, { Title: 'Ch. 1 - Romance Dawn' });
            await testee.Reconcile();

            expect(testee.GetEntryState(chapter1)).toEqual({
                Downloaded: true,
                Presence: Presence.Present, // still found at the recorded location
                Location: { Directories: [ 'MangaDex', 'One Piece' ], Name: 'Chapter 1', Kind: 'directory' },
            });
            expect(fixture.StoredRecords.length).toBe(1);
            expect(fixture.StoredRecords[0].Entries.length).toBe(1);
        });

        it('Should map renamed (legacy) website identifiers when loading', async () => {
            const fixture = new TestFixture();
            fixture.AddWebsite('manganato', 'Manganato');
            const legacy: HistoryMediaRecord = {
                Version: 1, WebsiteID: 'manganel', WebsiteTitle: 'Manganel', MediaID: 'manga-x', MediaTitle: 'X',
                Entries: [ { EntryID: 'c1', EntryTitle: 'C1', FirstDownloaded: 1, LastDownloaded: 1, DownloadCount: 1, Origin: 'download', Location: null, Presence: 'present', PresenceChecked: 1 } ],
            };
            await fixture.Storage.Save({ [MediaKey('manganel', 'manga-x')]: legacy });

            const testee = fixture.CreateTestee();
            await testee.Ready;

            expect([ ...fixture.Storage.records.keys() ]).toEqual([ 'manganato :: manga-x' ]);
            expect(fixture.StoredRecords[0].Entries[0].EntryID).toBe('c1');
        });

        it('Should never overwrite records written by a newer schema version', async () => {
            const fixture = new TestFixture();
            const { chapter1 } = SetupMangaDex(fixture);
            const future = { Version: 99, WebsiteID: 'mangadex', WebsiteTitle: 'MangaDex', MediaID: '/title/one-piece', MediaTitle: 'One Piece', Entries: [], Unknown: 'field' };
            await fixture.Storage.Save({ [MediaKey('mangadex', '/title/one-piece')]: future });
            const testee = fixture.CreateTestee();

            await fixture.Download(chapter1);
            await Settle(testee);

            expect(fixture.StoredRecords).toEqual([ future ]);
        });
    });

    describe('Reconcile', () => {

        it('Should switch between present (green) and missing (yellow) without deleting the history', async () => {
            const fixture = new TestFixture();
            const { chapter1 } = SetupMangaDex(fixture);
            const testee = fixture.CreateTestee();
            await fixture.Download(chapter1);
            await Settle(testee);
            expect(testee.GetEntryState(chapter1).Presence).toBe(Presence.Present);

            const backup = fixture.Root.Dir('MangaDex', 'One Piece').children.get('Chapter 1');
            fixture.Root.Remove('MangaDex', 'One Piece', 'Chapter 1');
            const missing = await testee.Reconcile();
            expect(missing).toEqual(expect.objectContaining({ Outcome: ReconcileOutcome.Completed, Checked: 1, Present: 0, Missing: 1 }));
            expect(testee.GetEntryState(chapter1)).toEqual(expect.objectContaining({ Downloaded: true, Presence: Presence.Missing }));

            fixture.Root.Dir('MangaDex', 'One Piece').children.set('Chapter 1', backup);
            const restored = await testee.Reconcile();
            expect(restored).toEqual(expect.objectContaining({ Outcome: ReconcileOutcome.Completed, Present: 1, Missing: 0 }));
            expect(testee.GetEntryState(chapter1)).toEqual(expect.objectContaining({ Downloaded: true, Presence: Presence.Present }));
        });

        it('Should treat an empty chapter folder as missing', async () => {
            const fixture = new TestFixture();
            const { chapter1 } = SetupMangaDex(fixture);
            const testee = fixture.CreateTestee();
            await fixture.Download(chapter1);
            await Settle(testee);

            fixture.Root.Dir('MangaDex', 'One Piece', 'Chapter 1').Clear();
            await testee.Reconcile();

            expect(testee.GetEntryState(chapter1).Presence).toBe(Presence.Missing);
        });

        it.each([
            [ 'NotFoundError', 'disconnected drive' ],
            [ 'NotReadableError', 'I/O error' ],
            [ 'NotAllowedError', 'revoked permission' ],
        ])('Should not mark anything as missing when the media directory is inaccessible (%s, %s)', async (failure) => {
            const fixture = new TestFixture();
            const { chapter1 } = SetupMangaDex(fixture);
            const testee = fixture.CreateTestee();
            await fixture.Download(chapter1);
            await Settle(testee);
            const writes = fixture.Storage.Save.mock.calls.length;

            fixture.Root.failure = failure;
            const result = await testee.Reconcile();

            expect(result.Outcome).toBe(ReconcileOutcome.Failed);
            expect(result.Error).toBeDefined();
            expect(testee.GetEntryState(chapter1).Presence).toBe(Presence.Present);
            expect(fixture.Storage.Save.mock.calls.length).toBe(writes);
        });

        it('Should not scan without granted permission (background scans must not prompt)', async () => {
            const fixture = new TestFixture();
            const { chapter1 } = SetupMangaDex(fixture);
            const testee = fixture.CreateTestee();
            await fixture.Download(chapter1);
            await Settle(testee);

            fixture.Root.permission = 'prompt';
            fixture.Root.Remove('MangaDex');
            const result = await testee.Reconcile();

            expect(result.Outcome).toBe(ReconcileOutcome.AccessRequired);
            expect(testee.GetEntryState(chapter1).Presence).toBe(Presence.Present);
        });

        it('Should retain the previous state for records in unreadable sub-directories', async () => {
            const fixture = new TestFixture();
            const { chapter1 } = SetupMangaDex(fixture);
            const testee = fixture.CreateTestee();
            await fixture.Download(chapter1);
            await Settle(testee);

            fixture.Root.Dir('MangaDex').failure = 'NotReadableError';
            const result = await testee.Reconcile();

            expect(result).toEqual(expect.objectContaining({ Outcome: ReconcileOutcome.Completed, Unverified: 1, Missing: 0 }));
            expect(testee.GetEntryState(chapter1).Presence).toBe(Presence.Present);
        });

        it('Should refuse to mark everything as missing for an empty media directory unless confirmed', async () => {
            const fixture = new TestFixture();
            const { chapter1 } = SetupMangaDex(fixture);
            const testee = fixture.CreateTestee();
            await fixture.Download(chapter1);
            await Settle(testee);

            fixture.Root.Clear(); // e.g., unmounted network share with an empty mount point
            const guarded = await testee.Reconcile();
            expect(guarded.Outcome).toBe(ReconcileOutcome.EmptyRoot);
            expect(testee.GetEntryState(chapter1).Presence).toBe(Presence.Present);

            const confirmed = await testee.Reconcile({ AllowEmptyRoot: true });
            expect(confirmed.Outcome).toBe(ReconcileOutcome.Completed);
            expect(testee.GetEntryState(chapter1)).toEqual(expect.objectContaining({ Downloaded: true, Presence: Presence.Missing }));
        });

        it('Should not report an unavailable media directory as failure', async () => {
            const fixture = new TestFixture();
            fixture.SettingValues['media-directory'] = null;
            const testee = fixture.CreateTestee();

            expect((await testee.Reconcile()).Outcome).toBe(ReconcileOutcome.Unavailable);
        });

        it('Should find downloads in a renamed website directory and update the location', async () => {
            const fixture = new TestFixture();
            const { website, chapter1 } = SetupMangaDex(fixture);
            const testee = fixture.CreateTestee();
            await fixture.Download(chapter1);
            await Settle(testee);

            // The connector display name changed, the user moved the folder accordingly
            Object.assign(website, { Title: 'MangaDex.org' });
            const folder = fixture.Root.children.get('MangaDex');
            fixture.Root.Remove('MangaDex');
            fixture.Root.children.set('MangaDex.org', folder);
            const result = await testee.Reconcile();

            expect(result).toEqual(expect.objectContaining({ Present: 1, Relocated: 1 }));
            expect(testee.GetEntryState(chapter1).Location.Directories).toEqual([ 'MangaDex.org', 'One Piece' ]);
        });

        it('Should share a running scan between concurrent requests', async () => {
            const fixture = new TestFixture();
            const testee = fixture.CreateTestee();
            await testee.Ready;

            const [ first, second ] = await Promise.all([ testee.Reconcile(), testee.Reconcile() ]);

            expect(first).toBe(second);
        });
    });

    describe('Existing downloads (before the history existed)', () => {

        it('Should adopt existing downloads once the chapter list is known (folders and archives)', async () => {
            const fixture = new TestFixture();
            const { chapter1, chapter2 } = SetupMangaDex(fixture);
            fixture.Root.File('MangaDex', 'One Piece', 'Chapter 1', '001.png');
            fixture.Root.File('MangaDex', 'One Piece', CreateFileTarget('Chapter 2', '.cbz').Name);
            const testee = fixture.CreateTestee();
            const scan = await (await testee.Initialize(), testee.Reconcile());
            expect(scan.Untracked).toBe(2);

            expect(testee.GetEntryState(chapter1).Downloaded).toBe(false); // triggers adoption
            await vi.waitFor(() => expect(testee.GetEntryState(chapter1).Downloaded).toBe(true));

            expect(testee.GetEntryState(chapter1)).toEqual({ Downloaded: true, Presence: Presence.Present, Location: { Directories: [ 'MangaDex', 'One Piece' ], Name: 'Chapter 1', Kind: 'directory' } });
            expect(testee.GetEntryState(chapter2)).toEqual({ Downloaded: true, Presence: Presence.Present, Location: { Directories: [ 'MangaDex', 'One Piece' ], Name: 'Chapter 2.cbz', Kind: 'file' } });
            expect(fixture.StoredRecords[0].Entries.map(entry => entry.Origin)).toEqual([ RecordOrigin.Scan, RecordOrigin.Scan ]);
        });

        it('Should not adopt ambiguous entries with identical titles', async () => {
            const fixture = new TestFixture();
            const { manga, chapter1 } = SetupMangaDex(fixture);
            const duplicate = fixture.AddChapter(manga, '/chapter/1-fr', 'Chapter 1');
            fixture.Root.File('MangaDex', 'One Piece', 'Chapter 1', '001.png');
            const testee = fixture.CreateTestee();
            await testee.Ready;
            await testee.Reconcile();

            testee.GetEntryState(chapter1);
            await new Promise(resolve => setTimeout(resolve, 10));

            expect(testee.GetEntryState(chapter1).Downloaded).toBe(false);
            expect(testee.GetEntryState(duplicate).Downloaded).toBe(false);
        });

        it('Should not adopt empty folders (e.g., leftovers of failed downloads)', async () => {
            const fixture = new TestFixture();
            const { chapter1 } = SetupMangaDex(fixture);
            fixture.Root.Dir('MangaDex', 'One Piece', 'Chapter 1');
            const testee = fixture.CreateTestee();
            await testee.Ready;
            await testee.Reconcile();

            testee.GetEntryState(chapter1);
            await new Promise(resolve => setTimeout(resolve, 10));

            expect(testee.GetEntryState(chapter1).Downloaded).toBe(false);
        });

        it('Should not adopt folders of another website with the same manga title', async () => {
            const fixture = new TestFixture();
            const { chapter1 } = SetupMangaDex(fixture);
            fixture.AddWebsite('mangafire', 'MangaFire');
            fixture.Root.File('MangaFire', 'One Piece', 'Chapter 1', '001.png');
            const testee = fixture.CreateTestee();
            await testee.Ready;
            await testee.Reconcile();

            testee.GetEntryState(chapter1);
            await new Promise(resolve => setTimeout(resolve, 10));

            expect(testee.GetEntryState(chapter1).Downloaded).toBe(false);
        });

        it('Should only adopt root-level folders (without website directory) with a unique bookmark', async () => {
            const fixture = new TestFixture();
            const { manga, chapter1 } = SetupMangaDex(fixture);
            const other = fixture.AddMedia(fixture.AddWebsite('mangafire', 'MangaFire'), 'one-piece.dkw', 'One Piece');
            fixture.Root.File('One Piece', 'Chapter 1', '001.png');

            // No bookmark => ambiguous (could be from any website)
            let testee = fixture.CreateTestee();
            await testee.Ready;
            await testee.Reconcile();
            testee.GetEntryState(chapter1);
            await new Promise(resolve => setTimeout(resolve, 10));
            expect(testee.GetEntryState(chapter1).Downloaded).toBe(false);

            // Bookmarks for the same title on two websites => still ambiguous
            fixture.Bookmarks.push(manga, other);
            testee = fixture.CreateTestee();
            await testee.Ready;
            await testee.Reconcile();
            testee.GetEntryState(chapter1);
            await new Promise(resolve => setTimeout(resolve, 10));
            expect(testee.GetEntryState(chapter1).Downloaded).toBe(false);

            // A single bookmark => adopted
            fixture.Bookmarks.splice(0, fixture.Bookmarks.length, manga);
            testee = fixture.CreateTestee();
            await testee.Ready;
            await testee.Reconcile();
            testee.GetEntryState(chapter1);
            await vi.waitFor(() => expect(testee.GetEntryState(chapter1).Location?.Directories).toEqual([ 'One Piece' ]));
        });
    });

    describe('Export & Import', () => {

        async function ExportFrom(fixture: TestFixture, testee: DownloadHistory): Promise<string> {
            let exported: string;
            fixture.FileIO.SaveFile.mockImplementationOnce(async (data: Blob) => { exported = await data.text(); });
            const result = await testee.Export();
            expect(result.Cancelled).toBe(false);
            return exported;
        }

        async function ImportInto(fixture: TestFixture, testee: DownloadHistory, content: string): Promise<ImportPreview> {
            fixture.FileIO.LoadFile.mockResolvedValueOnce(new Blob([ content ], { type: 'application/json' }));
            return testee.PrepareImport();
        }

        it('Should export a versioned interchange format (not the internal schema)', async () => {
            const fixture = new TestFixture();
            const { chapter1 } = SetupMangaDex(fixture);
            const testee = fixture.CreateTestee();
            await fixture.Download(chapter1);
            await Settle(testee);

            const document = JSON.parse(await ExportFrom(fixture, testee));

            expect(document).toEqual(expect.objectContaining({ format: ExportFormatName, version: 1, exported: expect.any(String) }));
            expect(document.records).toEqual([ expect.objectContaining({
                website: { id: 'mangadex', title: 'MangaDex' },
                media: { id: '/title/one-piece', title: 'One Piece' },
                entry: { id: '/chapter/1', title: 'Chapter 1' },
                downloaded: expect.objectContaining({ count: 1, first: expect.any(String) }),
                location: { directories: [ 'MangaDex', 'One Piece' ], name: 'Chapter 1', kind: 'directory' },
            }) ]);
        });

        it('Should import into another installation and verify the files without downloading anything', async () => {
            const source = new TestFixture();
            const { chapter1 } = SetupMangaDex(source);
            const exporter = source.CreateTestee();
            await source.Download(chapter1);
            await Settle(exporter);
            const content = await ExportFrom(source, exporter);

            const target = new TestFixture();
            const { chapter1: targetChapter1 } = SetupMangaDex(target);
            target.Root.File('MangaDex', 'One Piece', 'Chapter 1', '01.jpg'); // files were copied as well
            const importer = target.CreateTestee();
            await importer.Ready;

            const preview = await ImportInto(target, importer, content);
            expect(preview.Cancelled).toBe(false);
            expect(preview.Summary).toEqual({ Found: 1, New: 1, AlreadyPresent: 0, Updated: 0, DuplicatesInFile: 0, Rejected: 0, UnavailableWebsite: 0 });
            expect(importer.GetEntryState(targetChapter1).Downloaded).toBe(false); // preview does not change anything

            await preview.Commit();
            expect(importer.GetEntryState(targetChapter1)).toEqual(expect.objectContaining({ Downloaded: true }));
            await vi.waitFor(() => expect(importer.GetEntryState(targetChapter1).Presence).toBe(Presence.Present));
            expect(target.Queue.Value).toEqual([]); // never downloads
        });

        it('Should be safe to import the same file multiple times', async () => {
            const fixture = new TestFixture();
            const { chapter1, chapter2 } = SetupMangaDex(fixture);
            const testee = fixture.CreateTestee();
            await testee.Ready;
            const content = JSON.stringify(SerializeExport([ {
                Version: 1, WebsiteID: 'mangadex', WebsiteTitle: 'MangaDex', MediaID: '/title/one-piece', MediaTitle: 'One Piece',
                Entries: [ chapter1, chapter2 ].map(chapter => ({ EntryID: chapter.Identifier, EntryTitle: chapter.Title, FirstDownloaded: 1000, LastDownloaded: 2000, DownloadCount: 1, Origin: 'download' as const, Location: null, Presence: 'present' as const, PresenceChecked: 0 })),
            } ]));

            const first = await ImportInto(fixture, testee, content);
            const firstSummary = await first.Commit();
            const second = await ImportInto(fixture, testee, content);
            const secondSummary = await second.Commit();

            expect(firstSummary).toEqual(expect.objectContaining({ Found: 2, New: 2, AlreadyPresent: 0 }));
            expect(secondSummary).toEqual(expect.objectContaining({ Found: 2, New: 0, AlreadyPresent: 2, Updated: 0 }));
            expect(fixture.StoredRecords.length).toBe(1);
            expect(fixture.StoredRecords[0].Entries.length).toBe(2);
        });

        it('Should merge into an installation which already contains some of the records', async () => {
            const fixture = new TestFixture();
            const { chapter1, chapter2 } = SetupMangaDex(fixture);
            const testee = fixture.CreateTestee();
            await fixture.Download(chapter1);
            await Settle(testee);
            const content = JSON.stringify({
                format: ExportFormatName,
                version: 1,
                exported: new Date().toISOString(),
                records: [
                    // Known locally, but downloaded earlier on the other installation
                    { website: { id: 'mangadex', title: 'MangaDex' }, media: { id: '/title/one-piece', title: 'One Piece' }, entry: { id: '/chapter/1', title: 'Chapter 1' }, downloaded: { first: '2020-01-01T00:00:00.000Z', last: '2020-01-01T00:00:00.000Z', count: 1 }, origin: 'download', location: null },
                    { website: { id: 'mangadex', title: 'MangaDex' }, media: { id: '/title/one-piece', title: 'One Piece' }, entry: { id: '/chapter/2', title: 'Chapter 2' }, downloaded: { first: null, last: null, count: 1 }, origin: 'download', location: null },
                    // Duplicate within the file
                    { website: { id: 'mangadex', title: 'MangaDex' }, media: { id: '/title/one-piece', title: 'One Piece' }, entry: { id: '/chapter/2', title: 'Chapter 2' }, downloaded: { first: null, last: null, count: 1 }, origin: 'download', location: null },
                    // Website does not exist in this installation
                    { website: { id: 'removed-website', title: 'Removed' }, media: { id: 'm', title: 'M' }, entry: { id: 'c', title: 'C' }, downloaded: { first: null, last: null, count: 1 }, origin: 'download', location: null },
                    // Not identifiable
                    { website: { id: 'mangadex', title: 'MangaDex' }, media: { title: 'One Piece' }, entry: { id: '/chapter/3' } },
                ],
            });

            const preview = await ImportInto(fixture, testee, content);
            const summary = await preview.Commit();

            expect(summary).toEqual({ Found: 5, New: 2, AlreadyPresent: 1, Updated: 1, DuplicatesInFile: 1, Rejected: 1, UnavailableWebsite: 1 });
            expect(testee.GetEntryState(chapter1).Presence).toBe(Presence.Present); // local state wins
            expect(testee.GetEntryState(chapter2).Downloaded).toBe(true);
            const local = fixture.StoredRecords.find(record => record.WebsiteID === 'mangadex').Entries.find(entry => entry.EntryID === '/chapter/1');
            expect(local.FirstDownloaded).toBe(Date.parse('2020-01-01T00:00:00.000Z'));
            expect(local.Origin).toBe(RecordOrigin.Download);
            expect(fixture.StoredRecords.find(record => record.WebsiteID === 'removed-website')).toBeDefined();
        });

        it('Should reject files which are not a download history or from a newer version', async () => {
            const fixture = new TestFixture();
            const testee = fixture.CreateTestee();

            await expect(ImportInto(fixture, testee, '[{ "Title": "a bookmark" }]')).rejects.toBeInstanceOf(Exception);
            await expect(ImportInto(fixture, testee, 'not json')).rejects.toBeInstanceOf(Exception);
            await expect(ImportInto(fixture, testee, JSON.stringify({ format: ExportFormatName, version: 2, records: [] }))).rejects.toBeInstanceOf(Exception);
        });

        it('Should report a cancelled file dialog', async () => {
            const fixture = new TestFixture();
            const testee = fixture.CreateTestee();
            fixture.FileIO.LoadFile.mockRejectedValueOnce(new DOMException('Cancelled', 'AbortError'));
            fixture.FileIO.SaveFile.mockRejectedValueOnce(new DOMException('Cancelled', 'AbortError'));

            expect(await testee.PrepareImport()).toEqual({ Cancelled: true, Summary: null, Commit: null });
            expect(await testee.Export()).toEqual({ Cancelled: true, Exported: 0 });
        });
    });

    describe('Views', () => {

        it('Should list all records grouped by manga with presence counts and natural chapter order', async () => {
            const fixture = new TestFixture();
            const { manga, chapter1, chapter2 } = SetupMangaDex(fixture);
            const chapter10 = fixture.AddChapter(manga, '/chapter/10', 'Chapter 10');
            const testee = fixture.CreateTestee();
            for(const chapter of [ chapter10, chapter2, chapter1 ]) {
                await fixture.Download(chapter);
            }
            await Settle(testee);
            fixture.Root.Remove('MangaDex', 'One Piece', 'Chapter 2');
            await testee.Reconcile();

            const views = testee.GetMediaViews();

            expect(views.length).toBe(1);
            expect(views[0]).toEqual(expect.objectContaining({
                Key: 'mangadex :: /title/one-piece',
                WebsiteID: 'mangadex',
                WebsiteTitle: 'MangaDex',
                WebsiteAvailable: true,
                WebsiteIcon: 'icon://mangadex',
                MediaID: '/title/one-piece',
                MediaTitle: 'One Piece',
                Folder: [ 'MangaDex', 'One Piece' ],
                Present: 2,
                Missing: 1,
                Unverified: 0,
                LastDownloaded: expect.any(Number),
            }));
            expect(views[0].Entries.map(entry => entry.Title)).toEqual([ 'Chapter 1', 'Chapter 2', 'Chapter 10' ]);
            expect(views[0].Entries[1]).toEqual({
                EntryID: '/chapter/2',
                Title: 'Chapter 2',
                Presence: Presence.Missing,
                Origin: RecordOrigin.Download,
                FirstDownloaded: expect.any(Number),
                LastDownloaded: expect.any(Number),
                DownloadCount: 1,
                Folder: [ 'MangaDex', 'One Piece', 'Chapter 2' ],
            });
        });

        it('Should order manga by title and keep the same title on different websites apart', async () => {
            const fixture = new TestFixture();
            const bleach = fixture.AddMedia(fixture.AddWebsite('mangadex', 'MangaDex'), '/title/bleach', 'Bleach');
            const onePieceDex = fixture.AddMedia(fixture.Websites[0], '/title/one-piece', 'One Piece');
            const onePieceFire = fixture.AddMedia(fixture.AddWebsite('mangafire', 'MangaFire'), 'one-piece.dkw', 'One Piece');
            const testee = fixture.CreateTestee();
            for(const media of [ onePieceFire, onePieceDex, bleach ]) {
                await fixture.Download(fixture.AddChapter(media, media.Identifier + '/1', 'Chapter 1'));
            }
            await Settle(testee);

            expect(testee.GetMediaViews().map(view => `${view.MediaTitle} @ ${view.WebsiteTitle}`)).toEqual([
                'Bleach @ MangaDex',
                'One Piece @ MangaDex',
                'One Piece @ MangaFire',
            ]);
        });

        it('Should list records of websites which are not available and only resolve available media', async () => {
            const fixture = new TestFixture();
            const { manga } = SetupMangaDex(fixture);
            await fixture.Storage.Save({ [MediaKey('removed-website', 'm-1')]: {
                Version: 1, WebsiteID: 'removed-website', WebsiteTitle: 'Removed Website', MediaID: 'm-1', MediaTitle: 'Some Manga',
                Entries: [ { EntryID: 'c-1', EntryTitle: '', FirstDownloaded: 0, LastDownloaded: 0, DownloadCount: 1, Origin: 'import', Location: null, Presence: 'unknown', PresenceChecked: 0 } ],
            } });
            const testee = fixture.CreateTestee();
            await testee.Ready;

            const [ view ] = testee.GetMediaViews();
            expect(view).toEqual(expect.objectContaining({ WebsiteTitle: 'Removed Website', WebsiteAvailable: false, WebsiteIcon: null, Unverified: 1 }));
            expect(view.Entries[0].Title).toBe('c-1'); // falls back to the identifier when no title is known
            expect(view.Entries[0].Folder).toEqual([ 'Removed Website', 'Some Manga' ]); // never guess a chapter folder name

            expect(testee.ResolveMedia('removed-website', 'm-1')).toBeNull();
            expect(testee.ResolveMedia('mangadex', '/title/one-piece')).toBe(manga);
            expect(testee.ResolveMedia('mangadex', '/title/unknown')).toEqual(expect.objectContaining({ Identifier: '/title/unknown', Parent: fixture.Websites[0] }));
        });
    });

    describe('Folders', () => {

        it('Should provide the recorded folder of an entry and its media, or the expected folder otherwise', async () => {
            const fixture = new TestFixture();
            const { manga, chapter1, chapter2 } = SetupMangaDex(fixture);
            const testee = fixture.CreateTestee();
            await testee.Ready;

            expect(testee.GetEntryFolder(chapter2)).toEqual([ 'MangaDex', 'One Piece', 'Chapter 2' ]);
            expect(testee.GetMediaFolder(manga)).toEqual([ 'MangaDex', 'One Piece' ]);

            await fixture.Download(chapter1);
            await Settle(testee);
            fixture.SettingValues['website-subdirectory'] = false; // settings changed after the download

            expect(testee.GetEntryFolder(chapter1)).toEqual([ 'MangaDex', 'One Piece', 'Chapter 1' ]);
            expect(testee.GetMediaFolder(manga)).toEqual([ 'MangaDex', 'One Piece' ]);
            expect(testee.GetEntryFolder(chapter2)).toEqual([ 'One Piece', 'Chapter 2' ]);
        });
    });
});
