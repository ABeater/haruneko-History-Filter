import type { HistoryMediaRecord } from './DownloadHistoryFormat';

/**
 * Persistence of the download history, one record per media (keyed by `MediaKey`).
 */
export interface HistoryStorage {
    /**
     * Load all stored records.
     * @remarks The records are untrusted (e.g., written by another version) and must be validated by the caller.
     */
    Load(): Promise<unknown[]>;
    /**
     * Write all given {@link records} within a single atomic transaction.
     */
    Save(records: Record<string, HistoryMediaRecord>): Promise<void>;
    Remove(...keys: string[]): Promise<void>;
}

/**
 * The download history is kept in a dedicated database instead of a store within the shared `HakuNeko` database.
 * Adding a store to the shared database would require a version upgrade of the shared database,
 * which cannot be opened anymore by any previous version of the web-app (e.g., after a rollback of a deployment).
 * The history is optional, so its database can be created, upgraded or even deleted without affecting any other data.
 */
const HistoryDatabase = 'HakuNeko-DownloadHistory';
const HistoryStore = 'Media';
const HistoryVersion = 1;

function Request<T>(request: IDBRequest<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

function Completion(transaction: IDBTransaction): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error ?? new DOMException('The transaction was aborted!', 'AbortError'));
    });
}

/**
 * Stores the download history within a dedicated IndexedDB database.
 */
export class DownloadHistoryStorage implements HistoryStorage {

    constructor(private readonly factory: IDBFactory = globalThis.indexedDB) {}

    private async Connect(): Promise<IDBDatabase> {
        return new Promise<IDBDatabase>((resolve, reject) => {
            const request = this.factory.open(HistoryDatabase, HistoryVersion);
            request.onupgradeneeded = () => {
                if(!request.result.objectStoreNames.contains(HistoryStore)) {
                    request.result.createObjectStore(HistoryStore);
                }
            };
            request.onsuccess = () => {
                const db = request.result;
                // Never block a deletion or upgrade of the database by other code
                db.onversionchange = () => db.close();
                resolve(db);
            };
            request.onerror = () => reject(request.error);
        });
    }

    private async Transact<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => Promise<T> | T): Promise<T> {
        const db = await this.Connect();
        try {
            const transaction = db.transaction(HistoryStore, mode);
            const [ result ] = await Promise.all([ action(transaction.objectStore(HistoryStore)), Completion(transaction) ]);
            return result;
        } finally {
            db.close();
        }
    }

    public async Load(): Promise<unknown[]> {
        return this.Transact('readonly', store => Request(store.getAll()));
    }

    public async Save(records: Record<string, HistoryMediaRecord>): Promise<void> {
        const keys = Object.keys(records);
        if(keys.length > 0) {
            await this.Transact('readwrite', store => keys.forEach(key => store.put(records[key], key)));
        }
    }

    public async Remove(...keys: string[]): Promise<void> {
        if(keys.length > 0) {
            await this.Transact('readwrite', store => keys.forEach(key => store.delete(key)));
        }
    }
}
