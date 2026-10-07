import { describe, it, expect } from 'vitest';
import { MediaAttribute, MediaContainer, type MediaItem } from './MediaPlugin';

class TestContainer extends MediaContainer<MediaItem> {
    protected PerformUpdate(): Promise<MediaItem[]> {
        return Promise.resolve([]);
    }
}

describe('MediaContainer', () => {

    describe('Groups', () => {

        it('Should be empty when not assigned', async () => {
            const testee = new TestContainer('id', 'Ch. 2');

            expect(testee.Groups).toEqual([]);
        });

        it('Should assign groups in the given order and return the same instance', async () => {
            const testee = new TestContainer('id', 'Ch. 2');

            expect(testee.WithGroups('Group B', 'Group A')).toBe(testee);
            expect(testee.Groups).toEqual([ 'Group B', 'Group A' ]);
        });

        it('Should normalize whitespace and ignore blank names', async () => {
            const testee = new TestContainer('id', 'Ch. 2').WithGroups('  Group \n A ', '', '   ', null, undefined);

            expect(testee.Groups).toEqual([ 'Group A' ]);
        });

        it('Should remove duplicates', async () => {
            const testee = new TestContainer('id', 'Ch. 2').WithGroups('Group A', ' Group A', 'Group B', 'Group A');

            expect(testee.Groups).toEqual([ 'Group A', 'Group B' ]);
        });

        it('Should replace previously assigned groups', async () => {
            const testee = new TestContainer('id', 'Ch. 2').WithGroups('Group A').WithGroups('Group B');

            expect(testee.Groups).toEqual([ 'Group B' ]);
            expect(new TestContainer('id', 'Ch. 2').WithGroups('Group A').WithGroups().Groups).toEqual([]);
        });

        it('Should keep the title and identifier unchanged', async () => {
            const testee = new TestContainer('id', 'Ch. 2 [Group A]').WithGroups('Group A');

            expect(testee.Identifier).toBe('id');
            expect(testee.Title).toBe('Ch. 2 [Group A]');
        });
    });

    describe('Attributes', () => {

        it('Should be empty when not assigned', async () => {
            const testee = new TestContainer('id', 'Ch. 2');

            expect(testee.GetAttribute(MediaAttribute.Group)).toEqual([]);
            expect(testee.GetAttribute(MediaAttribute.Type)).toEqual([]);
        });

        it('Should keep the values of different attributes separately', async () => {
            const testee = new TestContainer('id', 'Ch. 2').WithAttribute(MediaAttribute.Type, 'official').WithGroups('Group A');

            expect(testee.GetAttribute(MediaAttribute.Type)).toEqual([ 'official' ]);
            expect(testee.GetAttribute(MediaAttribute.Group)).toEqual([ 'Group A' ]);
            expect(testee.Groups).toEqual([ 'Group A' ]);
        });

        it('Should normalize values like the groups', async () => {
            const testee = new TestContainer('id', 'Ch. 2').WithAttribute(MediaAttribute.Type, ' un\nofficial ', null, 'un official', '');

            expect(testee.GetAttribute(MediaAttribute.Type)).toEqual([ 'un official' ]);
        });

        it('Should provide the groups as the group attribute', async () => {
            const testee = new TestContainer('id', 'Ch. 2').WithAttribute(MediaAttribute.Group, 'Group B');

            expect(testee.Groups).toEqual([ 'Group B' ]);
        });
    });
});
