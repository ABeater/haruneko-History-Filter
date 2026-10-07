import type { Tag } from '../../../engine/Tags';
import type { MediaAttribute } from '../../../engine/providers/MediaPlugin';

/**
 * The properties of an item (e.g., chapter) which are relevant for filtering.
 */
export type FilterableItem = {
    readonly Title: string;
    readonly Tags: { readonly Value: ReadonlyArray<Tag> };
    GetAttribute(attribute: MediaAttribute): ReadonlyArray<string>;
};

export type ItemFilter = {
    /** Case-insensitive text matched against the item title, empty for any title */
    readonly Query: string;
    /** Only include items with this language tag, `null` for any language */
    readonly Language: Tag | null;
    /** Only include items with these attribute values (e.g., a group), a missing or `null` value includes any item (also items without the attribute) */
    readonly Attributes: Partial<Record<MediaAttribute, string | null>>;
};

export type AttributeValue = {
    readonly Name: string;
    /** Number of items with this attribute value */
    readonly Items: number;
};

const naturalOrder = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/**
 * Get all items which match each of the given filters (title, language and attributes).
 */
export function FilterItems<T extends FilterableItem>(items: ReadonlyArray<T>, filter: ItemFilter): T[] {
    const needle = filter.Query.toLowerCase();
    const attributes = Object.entries(filter.Attributes).filter(([ , value ]) => value) as [ MediaAttribute, string ][];
    return items.filter(item => {
        if(needle && !item.Title.toLowerCase().includes(needle)) {
            return false;
        }
        if(filter.Language && !item.Tags.Value.includes(filter.Language)) {
            return false;
        }
        return attributes.every(([ attribute, value ]) => item.GetAttribute(attribute).includes(value));
    });
}

/**
 * Get all values of the given {@link attribute} which occur in at least one of the given items, in natural order.
 */
export function ListAttributeValues(items: ReadonlyArray<FilterableItem>, attribute: MediaAttribute): AttributeValue[] {
    const values = new Map<string, number>();
    for(const item of items) {
        for(const value of item.GetAttribute(attribute)) {
            values.set(value, (values.get(value) ?? 0) + 1);
        }
    }
    return [ ...values ]
        .map(([ name, count ]) => ({ Name: name, Items: count }))
        .sort((self, other) => naturalOrder.compare(self.Name, other.Name));
}

/**
 * Get the values of the given {@link attributes} of the item which are not already mentioned in its title (many websites add them to the title).
 */
export function GetAttributeValuesNotInTitle(item: FilterableItem, ...attributes: MediaAttribute[]): string[] {
    const title = item.Title.toLowerCase();
    return attributes.flatMap(attribute => item.GetAttribute(attribute)).filter(value => !title.includes(value.toLowerCase()));
}
