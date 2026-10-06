import { vi, describe, it, expect } from 'vitest';
import { GetMediaDirectories, IsSameLocation, IsStorageLocation } from './StorageLocation';
import { GetChapterExportTarget, GetChapterExportTargets, MangaExportFormat } from './exporters/MangaExporterRegistry';
import { ImageDirectoryExporter } from './exporters/ImageDirectoryExporter';
import type { StorageController } from './StorageController';

describe('StorageLocation', () => {

    describe('GetMediaDirectories', () => {

        it('Should create the [Website/]Media layout with sanitized names', () => {
            expect(GetMediaDirectories(true, 'MangaDex', 'Re:Zero?')).toEqual([ 'MangaDex', 'Re꞉Zero？' ]);
            expect(GetMediaDirectories(false, 'MangaDex', 'One Piece')).toEqual([ 'One Piece' ]);
            expect(GetMediaDirectories(true, undefined, 'One Piece')).toEqual([ 'One Piece' ]);
        });
    });

    describe('IsSameLocation / IsStorageLocation', () => {

        it('Should compare locations structurally', () => {
            const location = { Directories: [ 'A', 'B' ], Name: 'C', Kind: 'directory' as const };
            expect(IsSameLocation(location, { ...location, Directories: [ 'A', 'B' ] })).toBe(true);
            expect(IsSameLocation(location, { ...location, Kind: 'file' })).toBe(false);
            expect(IsSameLocation(location, null)).toBe(false);
            expect(IsStorageLocation(location)).toBe(true);
            expect(IsStorageLocation({ ...location, Directories: [ '' ] })).toBe(false);
        });
    });

    describe('Chapter export targets', () => {

        it('Should provide the output name of every export format', () => {
            expect(GetChapterExportTargets('Chapter 1: Start').map(target => `${target.Kind}:${target.Name}`).sort()).toEqual([
                'directory:Chapter 1꞉ Start',
                'file:Chapter 1꞉ Start.cbz',
                'file:Chapter 1꞉ Start.epub',
                'file:Chapter 1꞉ Start.pdf',
            ]);
            expect(GetChapterExportTarget(MangaExportFormat.CBZ, 'Chapter 1')).toEqual({ Name: 'Chapter 1.cbz', Kind: 'file' });
            expect(GetChapterExportTarget('unknown/format', 'Chapter 1')).toEqual({ Name: 'Chapter 1', Kind: 'directory' });
        });

        it('Should be the same name which the exporter actually writes', async () => {
            const created: string[] = [];
            const target = {
                getDirectoryHandle: vi.fn(async (name: string) => {
                    created.push(name);
                    return { getFileHandle: async () => ({ createWritable: async () => ({ write: vi.fn(), close: vi.fn() }) }) };
                }),
            } as unknown as FileSystemDirectoryHandle;
            const storage = { LoadTemporary: vi.fn(async () => new Blob([ 'x' ], { type: 'image/png' })) } as unknown as StorageController;

            await new ImageDirectoryExporter(storage).Export(new Map([ [ 0, 'temp' ] ]), target, 'Chapter 1: Start?');

            expect(created).toEqual([ GetChapterExportTarget(MangaExportFormat.RAWs, 'Chapter 1: Start?').Name ]);
        });
    });
});
