import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DownloadTask, Status } from './DownloadTask';
import type { StoreableMediaContainer, MediaItem } from './providers/MediaPlugin';
import type { StorageController } from './StorageController';
import { DeferredTask } from './taskpool/DeferredTask';
import { TransientStatusError } from './TransientErrors';
import { Exception } from './Error';
import { EngineResourceKey as R } from '../i18n/ILocale';

function MockItem(resolve: boolean, delay: number = undefined) {
    const item = { Fetch: vi.fn() };
    if(resolve) {
        if(delay) {
            item.Fetch.mockReturnValue(new Promise(resolve => setTimeout(resolve, 5)));
        } else {
            item.Fetch.mockResolvedValue(null);
        }
    } else {
        if(delay) {
            item.Fetch.mockReturnValue(new Promise((_, reject) => setTimeout(reject, 5)));
        } else {
            item.Fetch.mockRejectedValue('x');
        }
    }
    return item as unknown as MediaItem;
}

class TestFixture {

    public readonly MediaContainerMock = { Update: vi.fn(), Store: vi.fn() };
    public readonly StorageControllerMock = { SaveTemporary: vi.fn(), RemoveTemporary: vi.fn() };
    public readonly StatusChangedCallbackMock = vi.fn();
    public readonly ProgressChangedCallbackMock = vi.fn();

    public CreateTestee() {
        const testee = new DownloadTask(this.MediaContainerMock as unknown as StoreableMediaContainer<MediaItem>, this.StorageControllerMock as unknown as StorageController);
        testee.Status.Subscribe(this.StatusChangedCallbackMock);
        testee.Progress.Subscribe(this.ProgressChangedCallbackMock);
        return testee;
    }

    public SetupMediaContainer(items: MediaItem[]): TestFixture {
        Object.defineProperty(this.MediaContainerMock, 'Entries', { get: vi.fn(() => ({ Value: items })) });
        return this;
    }
}

describe('DownloadTask', () => {

    describe('Constructor', () => {

        it('Should correctly initialize', async () => {
            const fixture = new TestFixture().SetupMediaContainer([]);
            const testee = fixture.CreateTestee();

            expect(typeof testee.ID).toBe('symbol');
            expect(Date.now() - testee.Created.getTime()).toBeLessThan(7.5);
            await new Promise(resolve => setTimeout(resolve, 5));
            expect(testee.Media).toBe(fixture.MediaContainerMock);
            expect(testee.Errors.Value).toEqual([]);
            expect(testee.Status.Value).toBe(Status.Queued);
            expect(fixture.StatusChangedCallbackMock).not.toHaveBeenCalled();
            expect(testee.Progress.Value).toBe(0);
            expect(fixture.ProgressChangedCallbackMock).not.toHaveBeenCalled();
        });
    });

    describe('Run', () => {

        it('Should process all entries in container on success', async () => {
            const items = [ MockItem(true), MockItem(true), MockItem(true), MockItem(true) ];
            const fixture = new TestFixture().SetupMediaContainer(items);
            fixture.MediaContainerMock.Store.mockResolvedValue(undefined);
            const testee = fixture.CreateTestee();

            await testee.Run();

            for(const item of items) {
                expect(item.Fetch).toHaveBeenCalledTimes(1);
            }
            expect(fixture.MediaContainerMock.Update).toHaveBeenCalledTimes(1);
            expect(fixture.MediaContainerMock.Store).toHaveBeenCalledTimes(1);
            expect(fixture.StorageControllerMock.SaveTemporary).toHaveBeenCalledTimes(4);
            expect(fixture.StorageControllerMock.RemoveTemporary).toHaveBeenCalledTimes(1);
        });

        it('Should gracefully succeed on downloading errors', async () => {
            const items = [ MockItem(true), MockItem(false), MockItem(true), MockItem(false) ];
            const fixture = new TestFixture().SetupMediaContainer(items);
            const testee = fixture.CreateTestee();

            await testee.Run();

            for(const item of items) {
                expect(item.Fetch).toHaveBeenCalledTimes(1);
            }
            expect(fixture.MediaContainerMock.Update).toHaveBeenCalledTimes(1);
            expect(fixture.MediaContainerMock.Store).toHaveBeenCalledTimes(0);
            expect(fixture.StorageControllerMock.SaveTemporary).toHaveBeenCalledTimes(2);
            expect(fixture.StorageControllerMock.RemoveTemporary).toHaveBeenCalledTimes(1);
        });

        it('Should gracefully succeed on processing error', async () => {
            const items = [ MockItem(true), MockItem(true), MockItem(true), MockItem(true) ];
            const fixture = new TestFixture().SetupMediaContainer(items);
            fixture.MediaContainerMock.Store.mockRejectedValue('o');
            const testee = fixture.CreateTestee();

            await testee.Run();

            for(const item of items) {
                expect(item.Fetch).toHaveBeenCalledTimes(1);
            }
            expect(fixture.MediaContainerMock.Update).toHaveBeenCalledTimes(1);
            expect(fixture.MediaContainerMock.Store).toHaveBeenCalledTimes(1);
            expect(fixture.StorageControllerMock.SaveTemporary).toHaveBeenCalledTimes(4);
            expect(fixture.StorageControllerMock.RemoveTemporary).toHaveBeenCalledTimes(1);
        });

        it('Should prevent multiple calls', async () => {
            const item = MockItem(true, 5);
            const fixture = new TestFixture().SetupMediaContainer([ item ]);
            fixture.MediaContainerMock.Store.mockResolvedValue(undefined);
            const testee = fixture.CreateTestee();

            const promise = testee.Run();
            testee.Run();
            await promise;

            expect(item.Fetch).toHaveBeenCalledTimes(1);
            expect(fixture.MediaContainerMock.Update).toHaveBeenCalledTimes(1);
            expect(fixture.MediaContainerMock.Store).toHaveBeenCalledTimes(1);
            expect(fixture.StorageControllerMock.SaveTemporary).toHaveBeenCalledTimes(1);
            expect(fixture.StorageControllerMock.RemoveTemporary).toHaveBeenCalledTimes(1);
        });
    });

    describe('Abort', () => {

        it('Should signal abort for active downloads', async () => {
            const signals: AbortSignal[] = [];
            const item = { Fetch: vi.fn((_, signal) => {
                signals.push(signal);
                return Promise.resolve(null);
            }) } as unknown as MediaItem;
            const fixture = new TestFixture().SetupMediaContainer([ item, item, item, item ]);
            fixture.MediaContainerMock.Store.mockResolvedValue(undefined);
            const testee = fixture.CreateTestee();

            const promise = testee.Run();
            testee.Abort();
            await promise;

            expect(signals.length).toBe(4);
            for(const signal of signals) {
                expect(signal.aborted).toBeTruthy();
            }
        });

        it('Should reset abort after success', async () => {
            const fixture = new TestFixture().SetupMediaContainer([ MockItem(true) ]);
            fixture.MediaContainerMock.Store.mockResolvedValue(undefined);
            const testee = fixture.CreateTestee();

            const promise = testee.Run();
            const abort = testee.Abort;
            await promise;

            expect(abort).not.toBe(testee.Abort);
        });

        it('Should reset abort after downloading error', async () => {
            const fixture = new TestFixture().SetupMediaContainer([ MockItem(false) ]);
            const testee = fixture.CreateTestee();

            const promise = testee.Run();
            const abort = testee.Abort;
            await promise;

            expect(abort).not.toBe(testee.Abort);
        });

        it('Should reset abort after processing error', async () => {
            const fixture = new TestFixture().SetupMediaContainer([ MockItem(false) ]);
            fixture.MediaContainerMock.Store.mockRejectedValue('o');
            const testee = fixture.CreateTestee();

            const promise = testee.Run();
            const abort = testee.Abort;
            await promise;

            expect(abort).not.toBe(testee.Abort);
        });
    });

    describe('Errors', () => {

        it('Should be empty on success', async () => {
            const items = [ MockItem(true), MockItem(true), MockItem(true), MockItem(true) ];
            const fixture = new TestFixture().SetupMediaContainer(items);
            fixture.MediaContainerMock.Store.mockResolvedValue(undefined);
            const testee = fixture.CreateTestee();

            await testee.Run();

            expect(testee.Errors.Value.length).toBe(0);
        });

        it('Should catch and keep all downloading errors', async () => {
            const items = [ MockItem(true), MockItem(false), MockItem(true), MockItem(false) ];
            const fixture = new TestFixture().SetupMediaContainer(items);
            const testee = fixture.CreateTestee();

            await testee.Run();

            expect(testee.Errors.Value.length).toBe(2);
            expect(testee.Errors.Value.at(0).message).toBe('x');
            expect(testee.Errors.Value.at(1).message).toBe('x');
        });

        it('Should catch and keep any processing error', async () => {
            const items = [ MockItem(true), MockItem(true), MockItem(true), MockItem(true) ];
            const fixture = new TestFixture().SetupMediaContainer(items);
            fixture.MediaContainerMock.Store.mockRejectedValue('o');
            const testee = fixture.CreateTestee();

            await testee.Run();

            expect(testee.Errors.Value.length).toBe(1);
            expect(testee.Errors.Value.at(0).message).toBe('o');
        });
    });

    describe('Status', () => {

        it('Should set expected values on success', async () => {
            const item = MockItem(true, 5);
            const fixture = new TestFixture().SetupMediaContainer([ item ]);
            const cleaned = new DeferredTask(() => Promise.resolve(), undefined);
            fixture.StorageControllerMock.RemoveTemporary.mockImplementationOnce(() => cleaned.Run());
            fixture.MediaContainerMock.Store.mockResolvedValue(undefined);
            const testee = fixture.CreateTestee();

            expect(testee.Status.Value).toBe(Status.Queued);
            const promise = testee.Run();
            expect(testee.Status.Value).toBe(Status.Downloading);
            await cleaned.Promise;
            expect(testee.Status.Value).toBe(Status.Processing);
            await promise;
            expect(testee.Status.Value).toBe(Status.Completed);
        });

        it('Should set expected values on downloading error', async () => {
            const item = MockItem(false, 5);
            const fixture = new TestFixture().SetupMediaContainer([ item ]);
            const cleaned = new DeferredTask(() => Promise.resolve(), undefined);
            fixture.StorageControllerMock.RemoveTemporary.mockImplementationOnce(() => cleaned.Run());
            const testee = fixture.CreateTestee();

            expect(testee.Status.Value).toBe(Status.Queued);
            const promise = testee.Run();
            expect(testee.Status.Value).toBe(Status.Downloading);
            await cleaned.Promise;
            expect(testee.Status.Value).toBe(Status.Downloading);
            await promise;
            expect(testee.Status.Value).toBe(Status.Failed);
        });

        it('Should set expected values on processing error', async () => {
            const item = MockItem(true, 5);
            const fixture = new TestFixture().SetupMediaContainer([ item ]);
            const cleaned = new DeferredTask(() => Promise.resolve(), undefined);
            fixture.StorageControllerMock.RemoveTemporary.mockImplementationOnce(() => cleaned.Run());
            fixture.MediaContainerMock.Store.mockRejectedValue('o');
            const testee = fixture.CreateTestee();

            expect(testee.Status.Value).toBe(Status.Queued);
            const promise = testee.Run();
            expect(testee.Status.Value).toBe(Status.Downloading);
            await cleaned.Promise;
            expect(testee.Status.Value).toBe(Status.Processing);
            await promise;
            expect(testee.Status.Value).toBe(Status.Failed);
        });
    });

    describe('StatusChanged', () => {

        it('Should invoke expected events on success', async () => {
            const item = MockItem(true);
            const fixture = new TestFixture().SetupMediaContainer([ item ]);
            fixture.MediaContainerMock.Store.mockResolvedValue(undefined);
            const testee = fixture.CreateTestee();

            await testee.Run();

            expect(fixture.StatusChangedCallbackMock).toHaveBeenCalledTimes(3);
            expect(fixture.StatusChangedCallbackMock).toHaveBeenNthCalledWith(1, Status.Downloading, testee);
            expect(fixture.StatusChangedCallbackMock).toHaveBeenNthCalledWith(2, Status.Processing, testee);
            expect(fixture.StatusChangedCallbackMock).toHaveBeenNthCalledWith(3, Status.Completed, testee);
        });

        it('Should invoke expected events on downloading error', async () => {
            const item = MockItem(false);
            const fixture = new TestFixture().SetupMediaContainer([ item ]);
            const testee = fixture.CreateTestee();

            await testee.Run();

            expect(fixture.StatusChangedCallbackMock).toHaveBeenCalledTimes(2);
            expect(fixture.StatusChangedCallbackMock).toHaveBeenNthCalledWith(1, Status.Downloading, testee);
            expect(fixture.StatusChangedCallbackMock).toHaveBeenNthCalledWith(2, Status.Failed, testee,);
        });

        it('Should invoke expected events on processing error', async () => {
            const item = MockItem(true);
            const fixture = new TestFixture().SetupMediaContainer([ item ]);
            fixture.MediaContainerMock.Store.mockRejectedValue('o');
            const testee = fixture.CreateTestee();

            await testee.Run();

            expect(fixture.StatusChangedCallbackMock).toHaveBeenCalledTimes(3);
            expect(fixture.StatusChangedCallbackMock).toHaveBeenNthCalledWith(1, Status.Downloading, testee,);
            expect(fixture.StatusChangedCallbackMock).toHaveBeenNthCalledWith(2, Status.Processing, testee,);
            expect(fixture.StatusChangedCallbackMock).toHaveBeenNthCalledWith(3, Status.Failed, testee,);
        });
    });

    describe('Progress', () => {

        it('Should set expected values on success', async () => {
            const item = MockItem(true, 5);
            const fixture = new TestFixture().SetupMediaContainer([ item ]);
            const testee = fixture.CreateTestee();

            expect(testee.Progress.Value).toBe(0);
            const promise = testee.Run();
            expect(testee.Progress.Value).toBe(0);
            await promise;
            expect(testee.Progress.Value).toBe(1);
        });

        it('Should set expected values on downloading errors', async () => {
            const items = [ MockItem(true, 5), MockItem(false, 5), MockItem(true, 5), MockItem(false, 5) ];
            const fixture = new TestFixture().SetupMediaContainer(items);
            const testee = fixture.CreateTestee();

            expect(testee.Progress.Value).toBe(0);
            const promise = testee.Run();
            expect(testee.Progress.Value).toBe(0);
            await promise;
            expect(testee.Progress.Value).toBe(2/4);
        });

        it('Should set expected values on processing error', async () => {
            const items = [ MockItem(true, 5), MockItem(true, 5), MockItem(true, 5), MockItem(true, 5) ];
            const fixture = new TestFixture().SetupMediaContainer(items);
            fixture.MediaContainerMock.Store.mockRejectedValue('o');
            const testee = fixture.CreateTestee();

            expect(testee.Progress.Value).toBe(0);
            const promise = testee.Run();
            expect(testee.Progress.Value).toBe(0);
            await promise;
            expect(testee.Progress.Value).toBe(1.0);
        });
    });

    describe('ProgressChanged', () => {

        it('Should invoke expected events on success', async () => {
            const items = [ MockItem(true), MockItem(true), MockItem(true), MockItem(true) ];
            const fixture = new TestFixture().SetupMediaContainer(items);
            fixture.MediaContainerMock.Store.mockResolvedValue(undefined);
            const testee = fixture.CreateTestee();

            await testee.Run();

            expect(fixture.ProgressChangedCallbackMock).toHaveBeenCalledTimes(items.length + 2);
            for(let page = 1; page <= items.length; page++) {
                expect(fixture.ProgressChangedCallbackMock).toHaveBeenNthCalledWith(page, page/items.length, testee);
            }
            expect(fixture.ProgressChangedCallbackMock).toHaveBeenNthCalledWith(items.length + 1, -1.0, testee);
            expect(fixture.ProgressChangedCallbackMock).toHaveBeenNthCalledWith(items.length + 2, 1.0, testee);
        });

        it('Should invoke expected events on downloading errors', async () => {
            const items = [ MockItem(true), MockItem(false), MockItem(true), MockItem(false) ];
            const fixture = new TestFixture().SetupMediaContainer(items);
            const testee = fixture.CreateTestee();

            await testee.Run();

            expect(fixture.ProgressChangedCallbackMock).toHaveBeenCalledTimes(2);
            expect(fixture.ProgressChangedCallbackMock).toHaveBeenNthCalledWith(1, 1/items.length, testee);
            expect(fixture.ProgressChangedCallbackMock).toHaveBeenNthCalledWith(2, 2/items.length, testee);
        });

        it('Should invoke expected events on processing error', async () => {
            const items = [ MockItem(true), MockItem(true), MockItem(true), MockItem(true) ];
            const fixture = new TestFixture().SetupMediaContainer(items);
            fixture.MediaContainerMock.Store.mockRejectedValue('o');
            const testee = fixture.CreateTestee();

            await testee.Run();

            expect(fixture.ProgressChangedCallbackMock).toHaveBeenCalledTimes(items.length + 2);
            for(let page = 1; page <= items.length; page++) {
                expect(fixture.ProgressChangedCallbackMock).toHaveBeenNthCalledWith(page, page/items.length, testee);
            }
            expect(fixture.ProgressChangedCallbackMock).toHaveBeenNthCalledWith(items.length + 1, -1.0, testee);
            expect(fixture.ProgressChangedCallbackMock).toHaveBeenNthCalledWith(items.length + 2, 1.0, testee);
        });
    });
    describe('Retry', () => {

        const success = Symbol('success');
        const networkError = () => new TypeError('Failed to fetch');

        /**
         * Create an item whose fetch results in the given {@link results} (one per call: rejected with the error, or resolved for {@link success}).
         */
        function FlakyItem(...results: unknown[]) {
            const item = { Fetch: vi.fn() };
            for(const result of results) {
                result === success ? item.Fetch.mockResolvedValueOnce(null) : item.Fetch.mockRejectedValueOnce(result);
            }
            return item as unknown as MediaItem & { Fetch: ReturnType<typeof vi.fn> };
        }

        async function RunToEnd(testee: DownloadTask): Promise<void> {
            const promise = testee.Run();
            await vi.runAllTimersAsync();
            await promise;
        }

        beforeEach(() => {
            vi.useFakeTimers();
            vi.spyOn(Math, 'random').mockReturnValue(0);
            vi.spyOn(console, 'warn').mockImplementation(() => {});
        });

        afterEach(() => {
            vi.useRealTimers();
            vi.restoreAllMocks();
        });

        it('Should retry a page after a temporary failure and complete', async () => {
            const items = [ FlakyItem(networkError(), success), FlakyItem(success) ];
            const fixture = new TestFixture().SetupMediaContainer(items);
            fixture.MediaContainerMock.Store.mockResolvedValue(undefined);
            const testee = fixture.CreateTestee();

            await RunToEnd(testee);

            expect(items[0].Fetch).toHaveBeenCalledTimes(2);
            expect(items[1].Fetch).toHaveBeenCalledTimes(1);
            expect(fixture.MediaContainerMock.Store).toHaveBeenCalledTimes(1);
            expect(testee.Errors.Value).toEqual([]);
            expect(testee.Status.Value).toBe(Status.Completed);
        });

        it('Should retry at most twice with increasing delays and then fail', async () => {
            const error = new TransientStatusError('https://host/page.png', 503, 0);
            const item = FlakyItem(error, error, error, success);
            const fixture = new TestFixture().SetupMediaContainer([ item ]);
            const testee = fixture.CreateTestee();

            const promise = testee.Run();
            await vi.advanceTimersByTimeAsync(1_999);
            expect(item.Fetch).toHaveBeenCalledTimes(1);
            await vi.advanceTimersByTimeAsync(1);
            expect(item.Fetch).toHaveBeenCalledTimes(2);
            await vi.advanceTimersByTimeAsync(5_999);
            expect(item.Fetch).toHaveBeenCalledTimes(2);
            await vi.advanceTimersByTimeAsync(1);
            expect(item.Fetch).toHaveBeenCalledTimes(3);
            await vi.runAllTimersAsync();
            await promise;

            expect(item.Fetch).toHaveBeenCalledTimes(3);
            expect(fixture.MediaContainerMock.Store).not.toHaveBeenCalled();
            expect(testee.Errors.Value).toEqual([ error ]);
            expect(testee.Status.Value).toBe(Status.Failed);
        });

        it('Should not retry permanent or unknown failures', async () => {
            const items = [
                FlakyItem(new Exception(R.FetchProvider_Fetch_Forbidden, 'https://host'), success),
                FlakyItem(new TypeError('text/html'), success),
                FlakyItem(new DOMException('', 'AbortError'), success),
                FlakyItem('x', success),
            ];
            const fixture = new TestFixture().SetupMediaContainer(items);
            const testee = fixture.CreateTestee();

            await RunToEnd(testee);

            for(const item of items) {
                expect(item.Fetch).toHaveBeenCalledTimes(1);
            }
            expect(testee.Errors.Value.length).toBe(4);
            expect(testee.Status.Value).toBe(Status.Failed);
            expect(console.warn).not.toHaveBeenCalled();
        });

        it('Should wait as long as requested by the website', async () => {
            const item = FlakyItem(new TransientStatusError('https://host/page.png', 429, 10_000), success);
            const fixture = new TestFixture().SetupMediaContainer([ item ]);
            fixture.MediaContainerMock.Store.mockResolvedValue(undefined);
            const testee = fixture.CreateTestee();

            const promise = testee.Run();
            await vi.advanceTimersByTimeAsync(9_999);
            expect(item.Fetch).toHaveBeenCalledTimes(1);
            await vi.runAllTimersAsync();
            await promise;

            expect(item.Fetch).toHaveBeenCalledTimes(2);
            expect(testee.Status.Value).toBe(Status.Completed);
        });

        it('Should not retry when the website asks to wait too long', async () => {
            const item = FlakyItem(new TransientStatusError('https://host/page.png', 429, 60_000), success);
            const fixture = new TestFixture().SetupMediaContainer([ item ]);
            const testee = fixture.CreateTestee();

            await RunToEnd(testee);

            expect(item.Fetch).toHaveBeenCalledTimes(1);
            expect(testee.Status.Value).toBe(Status.Failed);
        });

        it('Should not retry when another page already failed permanently', async () => {
            const items = [ FlakyItem(networkError(), success), FlakyItem('x') ];
            const fixture = new TestFixture().SetupMediaContainer(items);
            const testee = fixture.CreateTestee();

            await RunToEnd(testee);

            expect(items[0].Fetch).toHaveBeenCalledTimes(1);
            expect(items[1].Fetch).toHaveBeenCalledTimes(1);
            expect(testee.Status.Value).toBe(Status.Failed);
        });

        it('Should stop waiting for a retry when aborted', async () => {
            const item = FlakyItem(networkError(), success);
            const fixture = new TestFixture().SetupMediaContainer([ item ]);
            const testee = fixture.CreateTestee();

            const promise = testee.Run();
            await vi.advanceTimersByTimeAsync(500);
            testee.Abort();
            await promise;

            expect(item.Fetch).toHaveBeenCalledTimes(1);
            expect(testee.Status.Value).toBe(Status.Failed);
        });

        it('Should retry getting the pages of the chapter after a temporary failure', async () => {
            const fixture = new TestFixture().SetupMediaContainer([ FlakyItem(success) ]);
            fixture.MediaContainerMock.Update.mockRejectedValueOnce(networkError()).mockResolvedValue(undefined);
            fixture.MediaContainerMock.Store.mockResolvedValue(undefined);
            const testee = fixture.CreateTestee();

            await RunToEnd(testee);

            expect(fixture.MediaContainerMock.Update).toHaveBeenCalledTimes(2);
            expect(testee.Status.Value).toBe(Status.Completed);
        });

        it('Should be able to retry a failed task manually', async () => {
            const item = FlakyItem('x', success);
            const fixture = new TestFixture().SetupMediaContainer([ item ]);
            fixture.MediaContainerMock.Store.mockResolvedValue(undefined);
            const testee = fixture.CreateTestee();

            await RunToEnd(testee);
            expect(testee.Status.Value).toBe(Status.Failed);
            await RunToEnd(testee);

            expect(item.Fetch).toHaveBeenCalledTimes(2);
            expect(testee.Errors.Value).toEqual([]);
            expect(testee.Status.Value).toBe(Status.Completed);
        });
    });
});