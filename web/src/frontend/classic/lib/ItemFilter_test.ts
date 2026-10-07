import { describe, it, expect } from 'vitest';
import { Tags, type Tag } from '../../../engine/Tags';
import { MediaAttribute } from '../../../engine/providers/MediaPlugin';
import { FilterItems, GetAttributeValuesNotInTitle, ListAttributeValues, type FilterableItem, type ItemFilter } from './ItemFilter';

type TestItem = FilterableItem & { readonly ID: string };

function Item(id: string, title: string, attributes: Partial<Record<MediaAttribute, string[]>>, ...tags: Tag[]): TestItem {
    return { ID: id, Title: title, Tags: { Value: tags }, GetAttribute: attribute => attributes[attribute] ?? [] };
}

// Two releases of chapter 2 with the exact same title, only distinguishable by their group
const items = [
    Item('1-a', 'Ch. 1 [Series Name]', { [MediaAttribute.Group]: [ 'Group A' ] }, Tags.Language.English),
    Item('2-a', 'Ch. 2 [Series Name]', { [MediaAttribute.Group]: [ 'Group A' ] }, Tags.Language.English),
    Item('2-b', 'Ch. 2 [Series Name]', { [MediaAttribute.Group]: [ 'Group B' ] }, Tags.Language.German),
    Item('3-b', 'Ch. 3 [Series Name]', { [MediaAttribute.Group]: [ 'Group B' ] }, Tags.Language.German),
    Item('4-x', 'Ch. 4 [Series Name]', {}, Tags.Language.English),
];

// Two releases of chapter 2 which only differ by their type (e.g., MangaFire)
const releases = [
    Item('1-o', 'Ch. 1 [Series Name]', { [MediaAttribute.Type]: [ 'official' ] }),
    Item('2-o', 'Ch. 2 [Series Name]', { [MediaAttribute.Type]: [ 'official' ] }),
    Item('2-u', 'Ch. 2 [Series Name]', { [MediaAttribute.Type]: [ 'unofficial' ] }),
    Item('3-u', 'Ch. 3 [Series Name]', { [MediaAttribute.Type]: [ 'unofficial' ] }),
    Item('v-1', 'Vol. 1 [Series Name]', {}),
];

const noFilter: ItemFilter = { Query: '', Language: null, Attributes: {} };

function IDs(items: ReadonlyArray<TestItem>, filter: ItemFilter): string[] {
    return FilterItems(items, filter).map(item => item.ID);
}

describe('ItemFilter', () => {

    describe('FilterItems', () => {

        it('Should include all items without filters', () => {
            expect(IDs(items, noFilter)).toEqual([ '1-a', '2-a', '2-b', '3-b', '4-x' ]);
            expect(IDs(items, { ...noFilter, Attributes: { [MediaAttribute.Group]: null, [MediaAttribute.Type]: null } })).toEqual([ '1-a', '2-a', '2-b', '3-b', '4-x' ]);
        });

        it('Should search titles case-insensitive and include all groups', () => {
            expect(IDs(items, { ...noFilter, Query: 'ch. 2' })).toEqual([ '2-a', '2-b' ]);
            expect(IDs(items, { ...noFilter, Query: 'SERIES' })).toEqual([ '1-a', '2-a', '2-b', '3-b', '4-x' ]);
            expect(IDs(items, { ...noFilter, Query: 'Ch. 5' })).toEqual([]);
        });

        it('Should not search the attributes with the title search', () => {
            expect(IDs(items, { ...noFilter, Query: 'Group A' })).toEqual([]);
            expect(IDs(releases, { ...noFilter, Query: 'unofficial' })).toEqual([]);
        });

        it('Should only include items of the selected group, independent of the title', () => {
            expect(IDs(items, { ...noFilter, Attributes: { [MediaAttribute.Group]: 'Group A' } })).toEqual([ '1-a', '2-a' ]);
            expect(IDs(items, { ...noFilter, Attributes: { [MediaAttribute.Group]: 'Group B' } })).toEqual([ '2-b', '3-b' ]);
            expect(IDs(items, { ...noFilter, Attributes: { [MediaAttribute.Group]: 'Group C' } })).toEqual([]);
        });

        it('Should include items with any of their groups matching the selected group', () => {
            const joint = [ Item('joint', 'Ch. 5', { [MediaAttribute.Group]: [ 'Group A', 'Group B' ] }), Item('solo', 'Ch. 5', { [MediaAttribute.Group]: [ 'Group B' ] }) ];

            expect(IDs(joint, { ...noFilter, Attributes: { [MediaAttribute.Group]: 'Group A' } })).toEqual([ 'joint' ]);
            expect(IDs(joint, { ...noFilter, Attributes: { [MediaAttribute.Group]: 'Group B' } })).toEqual([ 'joint', 'solo' ]);
        });

        it('Should only include items matching the title search and the selected group', () => {
            expect(IDs(items, { ...noFilter, Query: 'Ch. 2', Attributes: { [MediaAttribute.Group]: 'Group B' } })).toEqual([ '2-b' ]);
            expect(IDs(items, { ...noFilter, Query: 'Ch. 2', Attributes: { [MediaAttribute.Group]: 'Group A' } })).toEqual([ '2-a' ]);
            expect(IDs(items, { ...noFilter, Query: 'Ch. 3', Attributes: { [MediaAttribute.Group]: 'Group A' } })).toEqual([]);
        });

        it('Should only include items of the selected type, independent of the title', () => {
            expect(IDs(releases, { ...noFilter, Query: 'Ch. 2' })).toEqual([ '2-o', '2-u' ]);
            expect(IDs(releases, { ...noFilter, Attributes: { [MediaAttribute.Type]: 'official' } })).toEqual([ '1-o', '2-o' ]);
            expect(IDs(releases, { ...noFilter, Attributes: { [MediaAttribute.Type]: 'unofficial' } })).toEqual([ '2-u', '3-u' ]);
            expect(IDs(releases, { ...noFilter, Query: 'Ch. 2', Attributes: { [MediaAttribute.Type]: 'official' } })).toEqual([ '2-o' ]);
        });

        it('Should only include items matching all selected attributes', () => {
            const mixed = [
                Item('a-o', 'Ch. 1', { [MediaAttribute.Group]: [ 'Group A' ], [MediaAttribute.Type]: [ 'official' ] }),
                Item('a-u', 'Ch. 1', { [MediaAttribute.Group]: [ 'Group A' ], [MediaAttribute.Type]: [ 'unofficial' ] }),
                Item('b-u', 'Ch. 1', { [MediaAttribute.Group]: [ 'Group B' ], [MediaAttribute.Type]: [ 'unofficial' ] }),
            ];

            expect(IDs(mixed, { ...noFilter, Attributes: { [MediaAttribute.Group]: 'Group A', [MediaAttribute.Type]: 'unofficial' } })).toEqual([ 'a-u' ]);
            expect(IDs(mixed, { ...noFilter, Attributes: { [MediaAttribute.Group]: 'Group B', [MediaAttribute.Type]: 'official' } })).toEqual([]);
            expect(IDs(mixed, { ...noFilter, Attributes: { [MediaAttribute.Group]: null, [MediaAttribute.Type]: 'unofficial' } })).toEqual([ 'a-u', 'b-u' ]);
        });

        it('Should only include items matching the selected language', () => {
            expect(IDs(items, { ...noFilter, Language: Tags.Language.German })).toEqual([ '2-b', '3-b' ]);
            expect(IDs(items, { ...noFilter, Language: Tags.Language.French })).toEqual([]);
        });

        it('Should only include items matching all filters', () => {
            expect(IDs(items, { Query: 'Ch.', Language: Tags.Language.English, Attributes: { [MediaAttribute.Group]: 'Group A' } })).toEqual([ '1-a', '2-a' ]);
            expect(IDs(items, { Query: 'Ch.', Language: Tags.Language.German, Attributes: { [MediaAttribute.Group]: 'Group A' } })).toEqual([]);
        });
    });

    describe('ListAttributeValues', () => {

        it('Should list all values with their number of items in natural order', () => {
            const unsorted = [
                Item('1', 'Ch. 1', { [MediaAttribute.Group]: [ 'Team 10' ] }),
                Item('2', 'Ch. 2', { [MediaAttribute.Group]: [ 'Team 2', 'alpha' ] }),
                Item('3', 'Ch. 3', { [MediaAttribute.Group]: [ 'Team 10' ] }),
            ];

            expect(ListAttributeValues(unsorted, MediaAttribute.Group)).toEqual([
                { Name: 'alpha', Items: 1 },
                { Name: 'Team 2', Items: 1 },
                { Name: 'Team 10', Items: 2 },
            ]);
        });

        it('Should only list the values of the given attribute', () => {
            expect(ListAttributeValues(items, MediaAttribute.Group)).toEqual([
                { Name: 'Group A', Items: 2 },
                { Name: 'Group B', Items: 2 },
            ]);
            expect(ListAttributeValues(items, MediaAttribute.Type)).toEqual([]);
            expect(ListAttributeValues(releases, MediaAttribute.Type)).toEqual([
                { Name: 'official', Items: 2 },
                { Name: 'unofficial', Items: 2 },
            ]);
        });

        it('Should be empty when no item has the attribute', () => {
            expect(ListAttributeValues([ Item('1', 'Ch. 1', {}), Item('2', 'Ch. 2', {}) ], MediaAttribute.Group)).toEqual([]);
            expect(ListAttributeValues([], MediaAttribute.Group)).toEqual([]);
        });
    });

    describe('GetAttributeValuesNotInTitle', () => {

        it('Should only get values which are not mentioned in the title', () => {
            expect(GetAttributeValuesNotInTitle(Item('1', 'Ch. 2 [Series Name]', { [MediaAttribute.Group]: [ 'Group A' ] }), MediaAttribute.Group)).toEqual([ 'Group A' ]);
            expect(GetAttributeValuesNotInTitle(Item('2', 'Ch. 2 [group a]', { [MediaAttribute.Group]: [ 'Group A' ] }), MediaAttribute.Group)).toEqual([]);
            expect(GetAttributeValuesNotInTitle(Item('3', 'Ch. 2 [Group A]', { [MediaAttribute.Group]: [ 'Group A', 'Group B' ] }), MediaAttribute.Group)).toEqual([ 'Group B' ]);
            expect(GetAttributeValuesNotInTitle(Item('4', 'Ch. 2', {}), MediaAttribute.Group)).toEqual([]);
        });

        it('Should only get values of the given attributes', () => {
            const item = Item('1', 'Ch. 2 (official)', { [MediaAttribute.Group]: [ 'Group A' ], [MediaAttribute.Type]: [ 'official' ] });

            expect(GetAttributeValuesNotInTitle(item, MediaAttribute.Group, MediaAttribute.Type)).toEqual([ 'Group A' ]);
            expect(GetAttributeValuesNotInTitle(item, MediaAttribute.Type)).toEqual([]);
            expect(GetAttributeValuesNotInTitle(item)).toEqual([]);
        });
    });
});
