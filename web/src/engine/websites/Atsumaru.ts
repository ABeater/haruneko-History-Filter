import { Tags } from '../Tags';
import icon from './Atsumaru.webp';
import { FetchJSON } from '../platform/FetchProvider';
import { type MangaPlugin, Manga, Chapter, Page, DecoratableMangaScraper } from '../providers/MangaPlugin';
import * as Common from './decorators/Common';
import * as Grouple from './decorators/Grouple';

import { Delay } from '../BackgroundTimers';

type APIManga = {
    id: string;
    title: string;
    chapters?: {
        id: string;
        title: string;
        index: number;
        scanId?: string;
    }[];
};

type APIMangaPage = {
    mangaPage: {
        scanlators?: {
            id: string;
            name: string;
        }[];
    };
};

type APIMangas = {
    hits: {
        document: APIManga;
    }[];
};

type APIPages = {
    readChapter: {
        pages: {
            image: string;
        }[];
    };
};

@Common.MangaCSS<HTMLMetaElement>(/^{origin}\/manga\/[^/]+$/, 'meta[property="og:title"]', (element, uri) => ({ id: uri.pathname.split('/').at(-1), title: element.content.trim() }))
@Grouple.ImageWithMirrors()

export default class extends DecoratableMangaScraper {

    private readonly apiURL = 'https://atsu.moe/api/';
    private readonly CDN = 'https://cdn.atsu.moe';

    public constructor() {
        super('atsumaru', 'Atsumaru', 'https://atsu.moe', Tags.Media.Manga, Tags.Media.Manhwa, Tags.Media.Manhua, Tags.Language.English, Tags.Source.Aggregator);
    }

    public override get Icon() {
        return icon;
    }

    public override async FetchMangas(provider: MangaPlugin): Promise<Manga[]> {
        type This = typeof this;
        return Array.fromAsync(async function* (this: This) {
            for (let page = 1, run = true; run; page++) {
                await Delay(500);
                const { hits } = await FetchJSON<APIMangas>(new Request(new URL(`./collections/manga/documents/search?q=*&page=${page}&per_page=250`, this.URI)));
                const mangas = hits.map(({ document: { id, title } }) => new Manga(this, provider, id, title));
                mangas.length > 0 ? yield* mangas : run = false;
            }
        }.call(this));
    }

    public override async FetchChapters(manga: Manga): Promise<Chapter[]> {
        const [ { chapters }, scanlators ] = await Promise.all([
            FetchJSON<APIManga>(new Request(new URL(`./manga/info?mangaId=${manga.Identifier}`, this.apiURL))),
            FetchJSON<APIMangaPage>(new Request(new URL(`./manga/page?id=${manga.Identifier}`, this.apiURL)))
                .then(({ mangaPage }) => ({ names: mangaPage.scanlators ?? [], error: null }))
                .catch((error: unknown) => ({ names: [] as APIMangaPage['mangaPage']['scanlators'], error })),
        ]);
        const groups = new Map<string, string>(scanlators.names.map(({ id, name }) => [ id, name ]));
        // Releases of different groups usually have the same title, so the group is added to keep them distinct (e.g., for the file name)
        const hasMultipleGroups = new Set(chapters.map(({ scanId }) => scanId)).size > 1;
        // NOTE: The title determines the file name of a download and the viewed flags, so it must not depend on whether the names could be loaded.
        //       The names are only optional for a manga with a single group (its titles never contain the group).
        if(hasMultipleGroups && scanlators.error) {
            throw scanlators.error;
        }
        return chapters
            .sort((self, other) => other.index - self.index)
            .map(({ id, title, scanId }) => {
                const group = groups.get(scanId);
                // A group without a name (e.g., removed from the website) falls back to its identifier, which is stable as well
                const label = group ?? scanId;
                return new Chapter(this, manga, id, hasMultipleGroups && label ? `${title} [${label}]` : title).WithGroups(group);
            });
    }

    public override async FetchPages(chapter: Chapter): Promise<Page[]> {
        const { readChapter: { pages } } = await FetchJSON<APIPages>(new Request(new URL(`./read/chapter?mangaId=${chapter.Parent.Identifier}&chapterId=${chapter.Identifier}`, this.apiURL)));
        return pages.map(({ image }) => new Page(this, chapter, new URL(image, this.URI), { mirrors: [new URL(image, this.CDN).href] }));
    }
}