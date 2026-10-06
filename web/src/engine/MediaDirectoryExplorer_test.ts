import { vi, describe, it, expect } from 'vitest';
import { MediaDirectoryExplorer } from './MediaDirectoryExplorer';
import type { SettingsManager } from './SettingsManager';
import type { IFileExplorer } from './platform/FileExplorer';
import { Exception } from './Error';

vi.mock('../i18n/Localization', () => ({
    GetLocale: () => new Proxy({}, { get: (_, key) => (...params: string[]) => `${String(key)}(${params.join(',')})` }),
}));

class TestFixture {

    public readonly Handle = {
        name: 'Manga',
        keys: async function*(): AsyncGenerator<string> { yield 'MangaDex'; yield 'MangaFire'; },
    };
    public readonly PathSetting = { Value: '' };
    public readonly Settings = {
        OpenScope: () => ({
            Get: (key: string) => ({ 'media-directory': { Value: this.Handle }, 'media-directory-path': this.PathSetting })[key],
        }),
    };
    public readonly Platform = {
        GetDirectoryHints: vi.fn(async () => [] as string[]),
        PickDirectory: vi.fn(async () => null as string | null),
        VerifyDirectory: vi.fn(async (directory: string) => directory === '/home/user/Manga'),
        Reveal: vi.fn(async (root: string, segments: string[]) => [ root, ...segments ].join('/')),
    };

    public CreateTestee(supported = true): MediaDirectoryExplorer {
        return new MediaDirectoryExplorer(this.Settings as unknown as SettingsManager, supported ? this.Platform as IFileExplorer : null);
    }
}

describe('MediaDirectoryExplorer', () => {

    it('Should use the verified path from the settings', async () => {
        const fixture = new TestFixture();
        fixture.PathSetting.Value = '/home/user/Manga';
        const testee = fixture.CreateTestee();

        expect(await testee.Reveal([ 'MangaDex', 'One Piece' ])).toBe('/home/user/Manga/MangaDex/One Piece');
        expect(fixture.Platform.VerifyDirectory).toHaveBeenCalledWith('/home/user/Manga', 'Manga', [ 'MangaDex', 'MangaFire' ]);
        expect(fixture.Platform.PickDirectory).not.toHaveBeenCalled();
    });

    it('Should not use names for the verification which the platform would reject', async () => {
        const fixture = new TestFixture();
        fixture.Handle.keys = async function*() { yield 'Re:Zero'; yield 'MangaDex'; yield 'Tab\tName'; yield 'MangaFire'; };
        fixture.PathSetting.Value = '/home/user/Manga';
        const testee = fixture.CreateTestee();

        await testee.Reveal([]);

        expect(fixture.Platform.VerifyDirectory).toHaveBeenCalledWith('/home/user/Manga', 'Manga', [ 'MangaDex', 'MangaFire' ]);
    });

    it('Should use a verified platform hint and remember it', async () => {
        const fixture = new TestFixture();
        fixture.PathSetting.Value = '/stale/Manga';
        fixture.Platform.GetDirectoryHints.mockResolvedValue([ '/somewhere/else', '/home/user/Manga' ]);
        const testee = fixture.CreateTestee();

        await testee.Reveal([]);
        await testee.Reveal([]);

        expect(fixture.PathSetting.Value).toBe('/home/user/Manga');
        expect(fixture.Platform.GetDirectoryHints).toHaveBeenCalledTimes(1); // cached for this directory handle
    });

    it('Should let the user locate the folder once and reject a wrong folder', async () => {
        const fixture = new TestFixture();
        const testee = fixture.CreateTestee();

        fixture.Platform.PickDirectory.mockResolvedValueOnce('/home/user/Downloads');
        await expect(testee.Reveal([])).rejects.toBeInstanceOf(Exception);
        expect(fixture.PathSetting.Value).toBe('');

        fixture.Platform.PickDirectory.mockResolvedValueOnce(null);
        expect(await testee.Reveal([])).toBeNull(); // cancelled

        fixture.Platform.PickDirectory.mockResolvedValueOnce('/home/user/Manga');
        expect(await testee.Reveal([ 'MangaDex' ])).toBe('/home/user/Manga/MangaDex');
        expect(fixture.PathSetting.Value).toBe('/home/user/Manga');
    });

    it('Should report a missing media directory (e.g., disconnected drive)', async () => {
        const fixture = new TestFixture();
        fixture.PathSetting.Value = '/home/user/Manga';
        fixture.Platform.Reveal.mockResolvedValueOnce(null);
        const testee = fixture.CreateTestee();

        await expect(testee.Reveal([])).rejects.toBeInstanceOf(Exception);
    });

    it('Should not be supported without platform support (e.g., web-browser)', async () => {
        const testee = new TestFixture().CreateTestee(false);

        expect(testee.IsSupported).toBe(false);
        await expect(testee.Reveal([])).rejects.toBeInstanceOf(Exception);
    });
});
