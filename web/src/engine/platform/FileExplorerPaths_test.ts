import { vi, describe, it, expect } from 'vitest';
import { FindNearestExisting, IsValidSegment, RevealPath, VerifyDirectory, type PathOperations } from './FileExplorerPaths';

/**
 * POSIX-like in-memory file system: paths ending with `/` are directories.
 */
function CreateOperations(...entries: string[]): PathOperations {
    const existing = new Map(entries.map(entry => [ entry.replace(/\/$/, ''), entry.endsWith('/') ]));
    return {
        join: (...segments: string[]) => segments.join('/').replace(/\/+/g, '/').replace(/(.)\/$/, '$1'),
        isAbsolute: (path: string) => path.startsWith('/'),
        basename: (path: string) => path.split('/').at(-1),
        stat: async (path: string) => existing.has(path) ? { isDirectory: () => existing.get(path) } : null,
    };
}

describe('FileExplorerPaths', () => {

    describe('IsValidSegment', () => {

        it.each([ 'Chapter 1', 'One Piece', 'Chapter 1.cbz', 'Re꞉Zero', '..hidden', '․․' ])('Should accept plain names (%s)', segment => {
            expect(IsValidSegment(segment)).toBe(true);
        });

        it.each([ '', '.', '..', 'a/b', 'a\\b', 'C:', 'file:stream', 'a\u0000b', 'a\nb', 42, null, 'x'.repeat(256) ])('Should reject unsafe segments (%s)', segment => {
            expect(IsValidSegment(segment)).toBe(false);
        });
    });

    describe('FindNearestExisting', () => {

        const operations = CreateOperations('/media/', '/media/Website/', '/media/Website/Manga/', '/media/Website/Manga/Chapter 1/', '/media/Website/Manga/Chapter 2.cbz');

        it('Should find the exact location', async () => {
            expect(await FindNearestExisting(operations, '/media', [ 'Website', 'Manga', 'Chapter 1' ])).toEqual({ Path: '/media/Website/Manga/Chapter 1', IsDirectory: true, Exact: true });
        });

        it('Should fall back to the nearest existing parent', async () => {
            expect(await FindNearestExisting(operations, '/media', [ 'Website', 'Manga', 'Chapter 3' ])).toEqual({ Path: '/media/Website/Manga', IsDirectory: true, Exact: false });
            expect(await FindNearestExisting(operations, '/media', [ 'Other', 'Manga' ])).toEqual({ Path: '/media', IsDirectory: true, Exact: false });
        });

        it('Should return null when the root does not exist (e.g., disconnected drive)', async () => {
            expect(await FindNearestExisting(operations, '/mnt/usb', [ 'Website' ])).toBeNull();
        });

        it('Should reject relative roots and path traversal', async () => {
            await expect(FindNearestExisting(operations, 'media', [ 'Website' ])).rejects.toThrow();
            await expect(FindNearestExisting(operations, '/media', [ '..', '..', 'etc' ])).rejects.toThrow();
            await expect(FindNearestExisting(operations, '/media', [ 'Website/../../etc' ])).rejects.toThrow();
        });
    });

    describe('RevealPath', () => {

        const operations = CreateOperations('/media/', '/media/Website/', '/media/Website/Manga/', '/media/Website/Manga/Chapter 2.cbz', '/media/Website/Manga/run.exe');

        it('Should open directories and only reveal files (never launch them)', async () => {
            const reveal = { openDirectory: vi.fn(async () => {}), revealFile: vi.fn() };

            expect(await RevealPath(operations, reveal, '/media', [ 'Website', 'Manga' ])).toBe('/media/Website/Manga');
            expect(await RevealPath(operations, reveal, '/media', [ 'Website', 'Manga', 'Chapter 2.cbz' ])).toBe('/media/Website/Manga/Chapter 2.cbz');
            expect(await RevealPath(operations, reveal, '/media', [ 'Website', 'Manga', 'run.exe' ])).toBe('/media/Website/Manga/run.exe');

            expect(reveal.openDirectory.mock.calls).toEqual([ [ '/media/Website/Manga' ] ]);
            expect(reveal.revealFile.mock.calls).toEqual([ [ '/media/Website/Manga/Chapter 2.cbz' ], [ '/media/Website/Manga/run.exe' ] ]);
        });
    });

    describe('VerifyDirectory', () => {

        const operations = CreateOperations('/home/user/Manga/', '/home/user/Manga/MangaDex/', '/home/user/Manga/MangaFire/', '/home/user/Other/');

        it('Should accept the directory matching the handle name and entries', async () => {
            expect(await VerifyDirectory(operations, '/home/user/Manga', 'Manga', [ 'MangaDex', 'MangaFire' ])).toBe(true);
            expect(await VerifyDirectory(operations, '/home/user/Manga', 'Manga', [])).toBe(true);
        });

        it.each([
            [ 'different name', '/home/user/Other', 'Manga', [] ],
            [ 'missing entry', '/home/user/Manga', 'Manga', [ 'MangaDex', 'Unknown' ] ],
            [ 'not existing', '/home/user/Gone', 'Gone', [] ],
            [ 'relative path', 'Manga', 'Manga', [] ],
            [ 'unsafe entry', '/home/user/Manga', 'Manga', [ '../Other' ] ],
            [ 'too many entries', '/home/user/Manga', 'Manga', new Array(65).fill('MangaDex') ],
        ])('Should reject a directory that does not match (%s)', async (_, directory, name, entries) => {
            expect(await VerifyDirectory(operations, directory, name, entries)).toBe(false);
        });
    });
});
