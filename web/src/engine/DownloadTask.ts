import type { StoreableMediaContainer, MediaItem } from './providers/MediaPlugin';
import { Priority } from './taskpool/DeferredTask';
import type { StorageController } from './StorageController';
import { type IObservable, Observable, ObservableArray } from './Observable';
import { Delay } from './BackgroundTimers';
import { IsTransientError, TransientStatusError } from './TransientErrors';

/**
 * The delays (in milliseconds) before retrying a request which failed due to a temporary problem (e.g., network error, server error).
 * The number of delays is the maximum number of retries, each delay is randomly extended by up to 25% so failed requests are not retried at the same time.
 * The retried requests are processed by the task pool of the website again, so its concurrency and rate limit are respected.
 */
const retryDelays = [ 2_000, 6_000 ];

/**
 * A request is not retried when the website asks to wait longer than this time (in milliseconds).
 */
const retryAfterLimit = 30_000;

export const enum Status {
    Paused = 'paused',
    Queued = 'queued',
    Downloading = 'downloading',
    Processing = 'processing',
    Completed = 'completed',
    Failed = 'failed',
}

export class DownloadTask {

    public readonly ID = Symbol();
    public readonly Created = new Date();

    constructor(public readonly Media: StoreableMediaContainer<MediaItem>, private readonly storageController: StorageController) {}

    private errors = new ObservableArray<Error, typeof this>([], this);
    public get Errors(): IObservable<Error[], typeof this> {
        return this.errors;
    }

    private readonly status = new Observable(Status.Queued, this);
    public get Status(): IObservable<Status, typeof this> {
        return this.status;
    }

    private progress = new Observable(0.0, this);
    public get Progress(): IObservable<number, typeof this> {
        return this.progress;
    }

    private UpdateProgress(processed: number) {
        this.progress.Value = this.Media.Entries.Value.length > 0 ? processed / this.Media.Entries.Value.length : 0.0;
    }

    private get IsRunning(): boolean {
        return this.status.Value === Status.Downloading || this.status.Value === Status.Processing;
    }

    /**
     * Assert that the {@link Media} entries for this download task are valid
     * @throws {@link RangeError} if the media entries are empty
     */
    private AssertMediaEntries() {
        new Array(this.Media.Entries.Value.length - 1);
    }

    public async Run(/* Target Directory / Archive ? */): Promise<void> {

        if(this.IsRunning) {
            return;
        }
        this.errors.Value = [];
        this.status.Value = Status.Downloading;
        this.UpdateProgress(0);

        const resourcemap = new Map<number, string>();
        try {
            const cancellator = new AbortController();
            this.Abort = cancellator.abort.bind(cancellator);
            await this.Retry(() => this.Media.Update(), cancellator.signal);
            this.AssertMediaEntries();
            const promises = this.Media.Entries.Value.map(async (item, index: number) => {
                try {
                    const data = await this.Retry(() => item.Fetch(Priority.Low, cancellator.signal), cancellator.signal);
                    const resource = await this.storageController.SaveTemporary(data);
                    resourcemap.set(index, resource);
                    this.UpdateProgress(resourcemap.size);
                } catch(error) {
                    this.errors.Push(error instanceof Error ? error : new Error(error?.toString()));
                    // TODO: Abort all other pending downloads or keep running?
                    throw error;
                }
            });
            await Promise.allSettled(promises);
            if(this.errors.Value.length === 0) {
                this.UpdateProgress(-1 * this.Media.Entries.Value.length);
                this.status.Value = Status.Processing;
                await this.Media.Store(resourcemap);
            }
        } catch(error) {
            this.errors.Push(error instanceof Error ? error : new Error(error.toString()));
        } finally {
            await this.storageController.RemoveTemporary(...resourcemap.values());
            this.UpdateProgress(resourcemap.size);
            this.status.Value = this.errors.Value.length > 0 ? Status.Failed : Status.Completed;
            this.Abort = this.DisabledAbort;
        }
    }

    /**
     * Invoke the {@link action} and retry it a few times with increasing delays, as long as it fails due to a temporary problem.
     * No (further) retries are made when the task was aborted or already failed (e.g., another page), since another attempt would be pointless.
     */
    private async Retry<T>(action: () => Promise<T>, signal: AbortSignal): Promise<T> {
        for(let attempt = 0; ; attempt++) {
            try {
                return await action();
            } catch(error) {
                const delay = retryDelays.at(attempt);
                const retryAfter = error instanceof TransientStatusError ? error.RetryAfter : 0;
                if(delay === undefined || retryAfter > retryAfterLimit || !this.IsRetryable(error, signal)) {
                    throw error;
                }
                const wait = Math.max(delay, retryAfter) + Math.round(Math.random() * delay / 4);
                console.warn(`Retrying a request for "${this.Media.Title}" in ${wait} ms (attempt ${attempt + 2} of ${retryDelays.length + 1}) after a temporary failure:`, error);
                await new Promise<void>(resolve => {
                    const done = () => {
                        signal.removeEventListener('abort', done);
                        resolve();
                    };
                    signal.addEventListener('abort', done, { once: true });
                    Delay(wait).then(done);
                });
                if(!this.IsRetryable(error, signal)) {
                    throw error;
                }
            }
        }
    }

    private IsRetryable(error: unknown, signal: AbortSignal): boolean {
        return !signal.aborted && this.errors.Value.length === 0 && IsTransientError(error);
    }

    private DisabledAbort(/*_reason?: string*/) { /* NO-OP */ }

    public Abort = this.DisabledAbort;
}