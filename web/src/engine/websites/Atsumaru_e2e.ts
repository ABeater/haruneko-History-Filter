import { TestFixture } from '../../../test/WebsitesFixture';

new TestFixture({
    plugin: {
        id: 'atsumaru',
        title: 'Atsumaru'
    },
    container: {
        url: 'https://atsu.moe/manga/XLD5S',
        id: 'XLD5S',
        title: '+Anima'
    },
    child: {
        id: 'CKjlYQaj',
        title: 'Chapter 44',
        attributes: { Group: [ 'Alpha' ] }
    },
    entry: {
        index: 0,
        size: 179_770,
        type: 'image/webp'
    }
}).AssertWebsite();

// Several groups released the same chapters with the same title
new TestFixture({
    plugin: {
        id: 'atsumaru',
        title: 'Atsumaru'
    },
    container: {
        url: 'https://atsu.moe/manga/MluV8',
        id: 'MluV8',
        title: 'Noa Is My Senior, and My Friend.'
    },
    child: {
        id: '1sh2Ns',
        title: 'Chapter 1 [Gamma]',
        attributes: { Group: [ 'Gamma' ] }
    }
}).AssertWebsite();
