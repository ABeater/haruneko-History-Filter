import type { Dialog } from 'puppeteer-core';
import { PuppeteerFixture } from '../../test/PuppeteerFixture';
import type { IValue } from '../src/engine/SettingsManager';

/**
 * A fixture providing shared functionality for front-end testing.
 */
export class FrontendFixture extends PuppeteerFixture {

    /**
     * Helper function to wait for a given {@link timespan} (in _milliseconds_).
     * Can be useful e.g., when it takes some time for updating dynamic elements in the frontend.
     */
    public async Delay(timespan: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, timespan));
    }

    /**
     * Clear all stored data (incl. settings, bookmarks, cache) and reload the app
     */
    public async Reset(frontend: string = 'classic'): Promise<void> {
        const page = await this.GetPage();
        await page.evaluate(() => new Promise((resolve, reject) => {
            try {
                const operation = indexedDB.deleteDatabase('HakuNeko');
                operation.addEventListener('success', resolve);
                operation.addEventListener('error', reject);
            } catch (error) {
                reject(error);
            }
        }));
        const isFrontendChanged = await page.evaluate(id => HakuNeko.SettingsManager.OpenScope('*').Get('frontend').Value !== id, frontend);
        const dismiss = async (dialog: Dialog) => dialog.dismiss();
        page.once('dialog', dismiss);
        try {
            await this.UpdateSetting('*', 'frontend', frontend);
        } finally {
            page.off('dialog', dismiss);
        }
        // A changed setting is stored in the background, reloading before it was stored would start the previous frontend
        if(isFrontendChanged) {
            await this.WaitForStoredSetting('*', 'frontend', frontend);
        }
        await page.reload();
        await this.Delay(500);
    }

    public async WaitForSelectors(timeout: number, ... selectors: string[]) {
        const page = await this.GetPage();
        return Promise.all(selectors.map(selector => page.waitForSelector(selector, { timeout })));
    }

    /**
     * Directly change a setting in the HakuNeko app via its settings manager.
     */
    public async UpdateSetting(scope: string, key: string, value: IValue): Promise<void> {
        const page = await super.GetPage();
        await page.evaluate((scope, key, value) => {
            HakuNeko.SettingsManager.OpenScope(scope).Get(key).Value = value;
        }, scope, key, value);
    }

    /**
     * Wait until the given {@link value} of a setting was written to the persistent storage (IndexedDB) of the HakuNeko app.
     */
    public async WaitForStoredSetting(scope: string, key: string, value: IValue, timeout = 5000): Promise<void> {
        const page = await super.GetPage();
        await page.waitForFunction((scope: string, key: string, expected: string) => new Promise<boolean>(resolve => {
            const request = indexedDB.open('HakuNeko');
            // Do not create the database when it does not exist (yet), this is up to the app
            request.onupgradeneeded = () => request.transaction.abort();
            request.onerror = () => resolve(false);
            request.onsuccess = () => {
                const db = request.result;
                try {
                    const query = db.transaction('Settings', 'readonly').objectStore('Settings').get(scope);
                    query.onsuccess = () => resolve(JSON.stringify(query.result?.[key]) === expected);
                    query.onerror = () => resolve(false);
                } catch {
                    resolve(false);
                } finally {
                    db.close();
                }
            };
        }), { timeout, polling: 100 }, scope, key, JSON.stringify(value));
    }

    /**
     * Get the current text for the first input element that matches {@link selectorInputElement}.
     */
    protected async GetText(selectorInputElement: string) {
        const page = await super.GetPage();
        await page.waitForSelector(selectorInputElement, { timeout: 1000 });
        return page.$eval(selectorInputElement, (input: HTMLInputElement) => input.value);
    }

    /**
     * Use the keyboard to type the given {@link text} into the first input element that matches {@link selectorInputElement}.
     * The current text will be cleared before the {@link text} is typed.
     */
    protected async SetText(selectorInputElement: string, text: string) {
        const page = await super.GetPage();
        await page.waitForSelector(selectorInputElement, { timeout: 1000 });
        await page.focus(selectorInputElement);
        while(await this.GetText(selectorInputElement)) {
            await page.keyboard.press('Delete');
            await page.keyboard.press('Backspace');
        }
        await page.keyboard.type(text);
    }
}