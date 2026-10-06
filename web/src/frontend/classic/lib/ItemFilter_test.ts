import { describe, it, expect } from 'vitest';
import { Tags, type Tag } from '../../../engine/Tags';
import { FilterItems, GetGroupsNotInTitle, ListItemGroups, type FilterableItem, type ItemFilter } from './ItemFilter';

type TestItem = FilterableItem & { readonly ID: string };

function Item(id: string, title: string, groups: string[], ...tags: Tag[]): TestItem {
    return { ID: id, Title: title, Groups: groups, Tags: { Value: tags } };
}

// Two releases of chapter 2 with the exact same title, only distinguishable by their group
const items = [
    Item('1-a', 'Ch. 1 [Series Name]', [ 'Group A' ], Tags.Language.English),
    Item('2-a', 'Ch. 2 [Series Name]', [ 'Group A' ], Tags.Language.English),
    Item('2-b', 'Ch. 2 [Series Name]', [ 'Group B' ], Tags.Language.German),
    Item('3-b', 'Ch. 3 [Series Name]', [ 'Group B' ], Tags.Language.German),
    Item('4-x', 'Ch. 4 [Series Name]', [], Tags.Language.English),
];

const noFilter: ItemFilter = { Query: '', Language: null, Group: null };

function IDs(...args: Parameters<typeof FilterItems<TestItem>>): string[] {
    return FilterItems(...args).map(item => item.ID);
}

describe('ItemFilter', () => {

    describe('FilterItems', () => {

        it('Should include all items without filters', () => {
            expect(IDs(items, noFilter)).toEqual([ '1-a', '2-a', '2-b', '3-b', '4-x' ]);
        });

        it('Should search titles case-insensitive and include all groups', () => {
            expect(IDs(items, { ...noFilter, Query: 'ch. 2' })).toEqual([ '2-a', '2-b' ]);
            expect(IDs(items, { ...noFilter, Query: 'SERIES' })).toEqual([ '1-a', '2-a', '2-b', '3-b', '4-x' ]);
            expect(IDs(items, { ...noFilter, Query: 'Ch. 5' })).toEqual([]);
        });

        it('Should not search the groups with the title search', () => {
            expect(IDs(items, { ...noFilter, Query: 'Group A' })).toEqual([]);
        });

        it('Should only include items of the selected group, independent of the title', () => {
            expect(IDs(items, { ...noFilter, Group: 'Group A' })).toEqual([ '1-a', '2-a' ]);
            expect(IDs(items, { ...noFilter, Group: 'Group B' })).toEqual([ '2-b', '3-b' ]);
            expect(IDs(items, { ...noFilter, Group: 'Group C' })).toEqual([]);
        });

        it('Should include items with any of their groups matching the selected group', () => {
            const joint = [ Item('joint', 'Ch. 5', [ 'Group A', 'Group B' ]), Item('solo', 'Ch. 5', [ 'Group B' ]) ];

            expect(FilterItems(joint, { ...noFilter, Group: 'Group A' }).map(item => item.ID)).toEqual([ 'joint' ]);
            expect(FilterItems(joint, { ...noFilter, Group: 'Group B' }).map(item => item.ID)).toEqual([ 'joint', 'solo' ]);
        });

        it('Should only include items matching the title search and the selected group', () => {
            expect(IDs(items, { ...noFilter, Query: 'Ch. 2', Group: 'Group B' })).toEqual([ '2-b' ]);
            expect(IDs(items, { ...noFilter, Query: 'Ch. 2', Group: 'Group A' })).toEqual([ '2-a' ]);
            expect(IDs(items, { ...noFilter, Query: 'Ch. 3', Group: 'Group A' })).toEqual([]);
        });

        it('Should only include items matching the selected language', () => {
            expect(IDs(items, { ...noFilter, Language: Tags.Language.German })).toEqual([ '2-b', '3-b' ]);
            expect(IDs(items, { ...noFilter, Language: Tags.Language.French })).toEqual([]);
        });

        it('Should only include items matching all filters', () => {
            expect(IDs(items, { Query: 'Ch.', Language: Tags.Language.English, Group: 'Group A' })).toEqual([ '1-a', '2-a' ]);
            expect(IDs(items, { Query: 'Ch.', Language: Tags.Language.German, Group: 'Group A' })).toEqual([]);
        });
    });

    describe('ListItemGroups', () => {

        it('Should list all groups with their number of items in natural order', () => {
            const unsorted = [
                Item('1', 'Ch. 1', [ 'Team 10' ]),
                Item('2', 'Ch. 2', [ 'Team 2', 'alpha' ]),
                Item('3', 'Ch. 3', [ 'Team 10' ]),
            ];

            expect(ListItemGroups(unsorted)).toEqual([
                { Name: 'alpha', Items: 1 },
                { Name: 'Team 2', Items: 1 },
                { Name: 'Team 10', Items: 2 },
            ]);
        });

        it('Should count the items of each group', () => {
            expect(ListItemGroups(items)).toEqual([
                { Name: 'Group A', Items: 2 },
                { Name: 'Group B', Items: 2 },
            ]);
        });

        it('Should be empty when no item has a group', () => {
            expect(ListItemGroups([ Item('1', 'Ch. 1', []), Item('2', 'Ch. 2', []) ])).toEqual([]);
            expect(ListItemGroups([])).toEqual([]);
        });
    });

    describe('GetGroupsNotInTitle', () => {

        it('Should only get groups which are not mentioned in the title', () => {
            expect(GetGroupsNotInTitle(Item('1', 'Ch. 2 [Series Name]', [ 'Group A' ]))).toEqual([ 'Group A' ]);
            expect(GetGroupsNotInTitle(Item('2', 'Ch. 2 [group a]', [ 'Group A' ]))).toEqual([]);
            expect(GetGroupsNotInTitle(Item('3', 'Ch. 2 [Group A]', [ 'Group A', 'Group B' ]))).toEqual([ 'Group B' ]);
            expect(GetGroupsNotInTitle(Item('4', 'Ch. 2', []))).toEqual([]);
        });
    });
});
