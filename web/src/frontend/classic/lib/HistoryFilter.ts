import type { Presence, HistoryEntryView, HistoryMediaView } from '../../../engine/DownloadHistory';

/**
 * Sentinel value of {@link HistoryFilter.WebsiteID} to include all websites.
 */
export const AllWebsites = '*';

export type HistoryFilter = {
    /** Case-insensitive text matched against manga, chapter and website titles */
    readonly Query: string;
    /** Only include chapters with this presence, `all` for any presence */
    readonly Presence: 'all' | Presence;
    /** Only include manga of this website, {@link AllWebsites} for any website */
    readonly WebsiteID: string;
};

export type HistoryGroup = {
    readonly View: HistoryMediaView;
    /** The chapters of the manga which match the filter */
    readonly Entries: HistoryEntryView[];
    /** The search matched chapter titles (not the manga/website title), so the group should be expanded */
    readonly MatchedEntries: boolean;
};

export type HistoryWebsite = {
    readonly ID: string;
    readonly Title: string;
    readonly Icon: string | null;
    readonly Available: boolean;
    /** Number of manga from this website in the history */
    readonly Media: number;
    /** Number of chapters from this website in the history */
    readonly Entries: number;
};

const naturalOrder = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/**
 * Apply the website, presence and search filters to the history.
 * A manga is only included when at least one of its chapters remains.
 * When the search matches the manga or website title, all of its chapters (matching the presence filter) are included.
 */
export function FilterHistory(views: ReadonlyArray<HistoryMediaView>, filter: HistoryFilter): HistoryGroup[] {
    const needle = filter.Query.trim().toLocaleLowerCase();
    const groups: HistoryGroup[] = [];
    for(const view of views) {
        if(filter.WebsiteID !== AllWebsites && view.WebsiteID !== filter.WebsiteID) {
            continue;
        }
        const matchedMedia = !needle
            || view.MediaTitle.toLocaleLowerCase().includes(needle)
            || view.WebsiteTitle.toLocaleLowerCase().includes(needle);
        let entries = view.Entries.filter(entry => filter.Presence === 'all' || entry.Presence === filter.Presence);
        if(!matchedMedia) {
            entries = entries.filter(entry => entry.Title.toLocaleLowerCase().includes(needle));
        }
        if(entries.length > 0) {
            groups.push({ View: view, Entries: entries, MatchedEntries: !matchedMedia });
        }
    }
    return groups;
}

/**
 * Get all websites which occur in the history, in natural order of their titles.
 */
export function ListHistoryWebsites(views: ReadonlyArray<HistoryMediaView>): HistoryWebsite[] {
    const websites = new Map<string, HistoryWebsite>();
    for(const view of views) {
        const website = websites.get(view.WebsiteID);
        websites.set(view.WebsiteID, {
            ID: view.WebsiteID,
            Title: website?.Title ?? view.WebsiteTitle,
            Icon: website?.Icon ?? view.WebsiteIcon,
            Available: view.WebsiteAvailable,
            Media: (website?.Media ?? 0) + 1,
            Entries: (website?.Entries ?? 0) + view.Entries.length,
        });
    }
    return [ ...websites.values() ].sort((self, other) => naturalOrder.compare(self.Title, other.Title));
}

/**
 * Count all chapters of the given groups which match the filter.
 */
export function CountEntries(groups: ReadonlyArray<HistoryGroup>): number {
    return groups.reduce((sum, group) => sum + group.Entries.length, 0);
}
