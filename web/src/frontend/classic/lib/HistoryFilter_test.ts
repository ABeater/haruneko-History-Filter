import { describe, it, expect } from 'vitest';
import { Presence, RecordOrigin, type HistoryEntryView, type HistoryMediaView } from '../../../engine/DownloadHistory';
import { AllWebsites, CountEntries, FilterHistory, ListHistoryWebsites } from './HistoryFilter';

function Entry(title: string, presence: Presence = Presence.Present): HistoryEntryView {
    return { EntryID: title, Title: title, Presence: presence, Origin: RecordOrigin.Download, FirstDownloaded: 1, LastDownloaded: 1, DownloadCount: 1, Folder: [ title ] };
}

function View(websiteID: string, websiteTitle: string, mediaTitle: string, ...entries: HistoryEntryView[]): HistoryMediaView {
    return {
        Key: `${websiteID} :: ${mediaTitle}`, WebsiteID: websiteID, WebsiteTitle: websiteTitle, WebsiteAvailable: websiteID !== 'removed', WebsiteIcon: `icon://${websiteID}`,
        MediaID: mediaTitle, MediaTitle: mediaTitle, Folder: [ websiteTitle, mediaTitle ], Present: 0, Missing: 0, Unverified: 0, LastDownloaded: 1, Entries: entries,
    };
}

const views = [
    View('mangadex', 'MangaDex', 'Bleach', Entry('Chapter 1'), Entry('Chapter 2', Presence.Missing)),
    View('mangadex', 'MangaDex', 'One Piece', Entry('Chapter 1'), Entry('Romance Dawn', Presence.Unknown)),
    View('mangafire', 'MangaFire', 'One Piece', Entry('Chapter 1', Presence.Missing)),
    View('removed', 'Removed Website', 'Naruto', Entry('Chapter 700')),
];

function Titles(...args: Parameters<typeof FilterHistory>): string[] {
    return FilterHistory(...args).map(group => `${group.View.MediaTitle} @ ${group.View.WebsiteTitle}: ${group.Entries.map(entry => entry.Title).join(', ')}`);
}

describe('HistoryFilter', () => {

    describe('FilterHistory', () => {

        it('Should include everything without filters', () => {
            const groups = FilterHistory(views, { Query: '', Presence: 'all', WebsiteID: AllWebsites });

            expect(groups.length).toBe(4);
            expect(CountEntries(groups)).toBe(6);
            expect(groups.every(group => !group.MatchedEntries)).toBe(true);
        });

        it('Should only include manga from the selected website', () => {
            expect(Titles(views, { Query: '', Presence: 'all', WebsiteID: 'mangafire' })).toEqual([ 'One Piece @ MangaFire: Chapter 1' ]);
            expect(Titles(views, { Query: '', Presence: 'all', WebsiteID: 'mangadex' })).toEqual([
                'Bleach @ MangaDex: Chapter 1, Chapter 2',
                'One Piece @ MangaDex: Chapter 1, Romance Dawn',
            ]);
        });

        it('Should search manga and website titles (all chapters) and chapter titles (matching chapters only)', () => {
            expect(Titles(views, { Query: 'one PIECE', Presence: 'all', WebsiteID: AllWebsites })).toEqual([
                'One Piece @ MangaDex: Chapter 1, Romance Dawn',
                'One Piece @ MangaFire: Chapter 1',
            ]);
            expect(Titles(views, { Query: 'fire', Presence: 'all', WebsiteID: AllWebsites })).toEqual([ 'One Piece @ MangaFire: Chapter 1' ]);
            const chapters = FilterHistory(views, { Query: 'dawn', Presence: 'all', WebsiteID: AllWebsites });
            expect(chapters.map(group => group.Entries.map(entry => entry.Title))).toEqual([ [ 'Romance Dawn' ] ]);
            expect(chapters[0].MatchedEntries).toBe(true);
        });

        it('Should filter by presence and drop manga without remaining chapters', () => {
            expect(Titles(views, { Query: '', Presence: Presence.Missing, WebsiteID: AllWebsites })).toEqual([
                'Bleach @ MangaDex: Chapter 2',
                'One Piece @ MangaFire: Chapter 1',
            ]);
            expect(Titles(views, { Query: '', Presence: Presence.Unknown, WebsiteID: AllWebsites })).toEqual([ 'One Piece @ MangaDex: Romance Dawn' ]);
        });

        it('Should combine all filters', () => {
            expect(Titles(views, { Query: 'chapter', Presence: Presence.Missing, WebsiteID: 'mangadex' })).toEqual([ 'Bleach @ MangaDex: Chapter 2' ]);
            expect(Titles(views, { Query: 'bleach', Presence: 'all', WebsiteID: 'mangafire' })).toEqual([]);
        });
    });

    describe('ListHistoryWebsites', () => {

        it('Should list each website once with counts, in natural order', () => {
            expect(ListHistoryWebsites(views)).toEqual([
                { ID: 'mangadex', Title: 'MangaDex', Icon: 'icon://mangadex', Available: true, Media: 2, Entries: 4 },
                { ID: 'mangafire', Title: 'MangaFire', Icon: 'icon://mangafire', Available: true, Media: 1, Entries: 1 },
                { ID: 'removed', Title: 'Removed Website', Icon: 'icon://removed', Available: false, Media: 1, Entries: 1 },
            ]);
        });

        it('Should be empty for an empty history', () => {
            expect(ListHistoryWebsites([])).toEqual([]);
        });
    });
});
