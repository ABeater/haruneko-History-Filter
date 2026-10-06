import type { Tag } from '../../../engine/Tags';

/**
 * The properties of an item (e.g., chapter) which are relevant for filtering.
 */
export type FilterableItem = {
    readonly Title: string;
    readonly Groups: ReadonlyArray<string>;
    readonly Tags: { readonly Value: ReadonlyArray<Tag> };
};

export type ItemFilter = {
    /** Case-insensitive text matched against the item title, empty for any title */
    readonly Query: string;
    /** Only include items with this language tag, `null` for any language */
    readonly Language: Tag | null;
    /** Only include items released by this group, `null` for any group (including items without a group) */
    readonly Group: string | null;
};

export type ItemGroup = {
    readonly Name: string;
    /** Number of items released by this group */
    readonly Items: number;
};

const naturalOrder = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/**
 * Get all items which match each of the given filters (title, language and group).
 */
export function FilterItems<T extends FilterableItem>(items: ReadonlyArray<T>, filter: ItemFilter): T[] {
    const needle = filter.Query.toLowerCase();
    return items.filter(item => {
        if(needle && !item.Title.toLowerCase().includes(needle)) {
            return false;
        }
        if(filter.Language && !item.Tags.Value.includes(filter.Language)) {
            return false;
        }
        if(filter.Group && !item.Groups.includes(filter.Group)) {
            return false;
        }
        return true;
    });
}

/**
 * Get all groups which released at least one of the given items, in natural order of their names.
 */
export function ListItemGroups(items: ReadonlyArray<FilterableItem>): ItemGroup[] {
    const groups = new Map<string, number>();
    for(const item of items) {
        for(const group of item.Groups) {
            groups.set(group, (groups.get(group) ?? 0) + 1);
        }
    }
    return [ ...groups ]
        .map(([ name, count ]) => ({ Name: name, Items: count }))
        .sort((self, other) => naturalOrder.compare(self.Name, other.Name));
}

/**
 * Get the groups of the item which are not already mentioned in its title (many websites add the group to the title).
 */
export function GetGroupsNotInTitle(item: FilterableItem): string[] {
    const title = item.Title.toLowerCase();
    return item.Groups.filter(group => !title.includes(group.toLowerCase()));
}
