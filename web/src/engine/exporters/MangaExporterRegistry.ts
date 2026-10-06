import type { StorageController } from '../StorageController';
import type { MangaExporter, MangaExporterClass } from './MangaExporter';
import type { StorageTarget } from '../StorageLocation';
import { ImageDirectoryExporter } from './ImageDirectoryExporter';
import { ComicBookArchiveExporter } from './ComicBookArchiveExporter';
import { ElectronicPublicationExporter } from './ElectronicPublicationExporter';
import { PortableDocumentFormatExporter } from './PortableDocumentFormatExporter';

export enum MangaExportFormat {
    /**
     * Save images from website in a folder
     */
    RAWs = 'image/*',
    /**
     * Save images from website in a folder, convert non-PNG to PNG
     */
    PNGs = 'image/png',
    /**
     * Save images from website in a folder, convert non-JPEG to JPEG
     */
    JPEGs = 'image/jpeg',
    /**
     * Save images from website in a folder, convert non-WEBP to WEBP
     */
    WEBPs = 'image/webp',
    /**
     * Save images from website in a zip-archive
     */
    CBZ = 'application/x-cbz',
    /**
     * Save images from website in a EPUB file
     */
    EPUB = 'application/epub+zip',
    /**
     * Save images from website in a document, non-compliant images will be converted to JPEG with q=95%
     */
    PDF = 'application/pdf',
}

/**
 * All supported exporters, the type ensures that each exporter declares the name of its output.
 */
const exporters = {
    [MangaExportFormat.RAWs]: ImageDirectoryExporter,
    [MangaExportFormat.CBZ]: ComicBookArchiveExporter,
    [MangaExportFormat.PDF]: PortableDocumentFormatExporter,
    [MangaExportFormat.EPUB]: ElectronicPublicationExporter,
} satisfies Record<string, MangaExporterClass>;

export function CreateChapterExportRegistry(storageController: StorageController): Record<string, MangaExporter> {
    return Object.fromEntries(Object.entries(exporters).map(([ format, exporterClass ]) => [ format, new exporterClass(storageController) ]));
}

/**
 * Get the name and kind of the entry which is created when a chapter with the given {@link chapterTitle} is exported in the given {@link format}.
 * Falls back to the default format ({@link MangaExportFormat.RAWs}) for unknown formats.
 */
export function GetChapterExportTarget(format: string, chapterTitle: string): StorageTarget {
    return (exporters[format as keyof typeof exporters] ?? exporters[MangaExportFormat.RAWs]).GetTarget(chapterTitle);
}

/**
 * Get all possible entries (one per supported export format) which may have been created for a chapter with the given {@link chapterTitle}.
 * This is used to detect existing downloads regardless of the export format that was configured at the time of the download.
 */
export function GetChapterExportTargets(chapterTitle: string): StorageTarget[] {
    return Object.values(exporters).map(exporterClass => exporterClass.GetTarget(chapterTitle));
}
