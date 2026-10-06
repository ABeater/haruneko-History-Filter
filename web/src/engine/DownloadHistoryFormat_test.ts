import { describe, it, expect } from 'vitest';
import { Exception } from './Error';
import { type HistoryEntryRecord, type HistoryMediaRecord, ExportFormatName, MediaKey, MergeEntryRecords, ParseExport, Presence, RecordOrigin, SerializeExport } from './DownloadHistoryFormat';

function Entry(override: Partial<HistoryEntryRecord> = {}): HistoryEntryRecord {
    return {
        EntryID: 'chapter-1',
        EntryTitle: 'Chapter 1',
        FirstDownloaded: 2000,
        LastDownloaded: 3000,
        DownloadCount: 2,
        Origin: RecordOrigin.Download,
        Location: { Directories: [ 'Website', 'Manga' ], Name: 'Chapter 1', Kind: 'directory' },
        Presence: Presence.Present,
        PresenceChecked: 3000,
        ...override,
    };
}

describe('DownloadHistoryFormat', () => {

    describe('MediaKey', () => {

        it('Should follow the key convention of bookmarks and item flags', () => {
            expect(MediaKey('mangadex', '/title/1')).toBe('mangadex :: /title/1');
        });
    });

    describe('MergeEntryRecords', () => {

        it('Should keep the earliest/latest dates and the local attributes', () => {
            const local = Entry();
            const incoming = Entry({ EntryTitle: 'Other', FirstDownloaded: 1000, LastDownloaded: 9000, DownloadCount: 1, Origin: RecordOrigin.Import, Location: null, Presence: Presence.Unknown });

            const { Merged, Changed } = MergeEntryRecords(local, incoming);

            expect(Changed).toBe(true);
            expect(Merged).toEqual(Entry({ FirstDownloaded: 1000, LastDownloaded: 9000 }));
        });

        it('Should be idempotent', () => {
            const incoming = Entry({ FirstDownloaded: 1000, Location: null });
            const first = MergeEntryRecords(Entry(), incoming).Merged;
            const second = MergeEntryRecords(first, incoming);

            expect(second.Changed).toBe(false);
            expect(second.Merged).toEqual(first);
        });

        it('Should treat 0 as unknown date', () => {
            expect(MergeEntryRecords(Entry({ FirstDownloaded: 0 }), Entry({ FirstDownloaded: 1500 })).Merged.FirstDownloaded).toBe(1500);
            expect(MergeEntryRecords(Entry({ FirstDownloaded: 1500 }), Entry({ FirstDownloaded: 0 })).Merged.FirstDownloaded).toBe(1500);
        });
    });

    describe('SerializeExport / ParseExport', () => {

        const media: HistoryMediaRecord = { Version: 1, WebsiteID: 'website', WebsiteTitle: 'Website', MediaID: 'manga', MediaTitle: 'Manga', Entries: [ Entry() ] };

        it('Should round-trip all identifying information', () => {
            const document = SerializeExport([ media ], new Date('2026-10-04T00:00:00.000Z'));
            const { Records, Rejected } = ParseExport(JSON.parse(JSON.stringify(document)));

            expect(document.format).toBe(ExportFormatName);
            expect(document.version).toBe(1);
            expect(Rejected).toBe(0);
            expect(Records).toEqual([ {
                WebsiteID: 'website', WebsiteTitle: 'Website', MediaID: 'manga', MediaTitle: 'Manga',
                Entry: {
                    ...Entry(),
                    // Presence is local information and never imported
                    Origin: RecordOrigin.Import, Presence: Presence.Unknown, PresenceChecked: 0,
                },
            } ]);
        });

        it('Should reject records without stable identifiers and drop invalid locations', () => {
            const document = SerializeExport([ media ]);
            document.records.push({ ...document.records[0], media: { id: '', title: 'Manga' } });
            document.records.push({ ...document.records[0], location: { directories: [ '' ], name: 'x', kind: 'directory' } });

            const { Records, Rejected } = ParseExport(document);

            expect(Rejected).toBe(1);
            expect(Records.length).toBe(2);
            expect(Records[1].Entry.Location).toBeNull();
        });

        it.each([
            [ 'bookmarks', [ { Title: 'Bookmark' } ] ],
            [ 'wrong format', { format: 'other', version: 1, records: [] } ],
            [ 'invalid version', { format: ExportFormatName, version: 0, records: [] } ],
            [ 'newer version', { format: ExportFormatName, version: 2, records: [] } ],
            [ 'null', null ],
        ])('Should throw for unsupported documents (%s)', (_, document) => {
            expect(() => ParseExport(document)).toThrow(Exception);
        });
    });
});
