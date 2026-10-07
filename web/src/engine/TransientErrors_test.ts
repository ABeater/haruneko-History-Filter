import { describe, it, expect } from 'vitest';
import { IsTransientError, ThrowOnTransientStatus, TransientStatusError } from './TransientErrors';
import { Exception } from './Error';
import { EngineResourceKey as R } from '../i18n/ILocale';

function Respond(status: number, headers: Record<string, string> = {}): Response {
    return new Response(null, { status, headers });
}

function Catch(action: () => void): unknown {
    try {
        action();
    } catch(error) {
        return error;
    }
}

describe('TransientErrors', () => {

    describe('ThrowOnTransientStatus', () => {

        it('Should not throw for successful or permanent statuses', () => {
            for(const status of [ 200, 204, 206, 301, 304, 400, 401, 403, 404, 410, 501, 505, 511 ]) {
                expect(() => ThrowOnTransientStatus(Respond(status)), `status ${status}`).not.toThrow();
            }
        });

        it('Should throw for request timeout, too many requests and server errors', () => {
            for(const status of [ 408, 429, 500, 502, 503, 504, 520, 522, 524 ]) {
                const error = Catch(() => ThrowOnTransientStatus(Respond(status)));
                expect(error, `status ${status}`).toBeInstanceOf(TransientStatusError);
                expect((error as TransientStatusError).Status).toBe(status);
                expect((error as TransientStatusError).RetryAfter).toBe(0);
            }
        });

        it('Should provide the time to wait from the Retry-After header', () => {
            expect((Catch(() => ThrowOnTransientStatus(Respond(429, { 'Retry-After': '12' }))) as TransientStatusError).RetryAfter).toBe(12_000);
            expect((Catch(() => ThrowOnTransientStatus(Respond(503, { 'Retry-After': 'invalid' }))) as TransientStatusError).RetryAfter).toBe(0);

            const date = new Date(Date.now() + 60_000).toUTCString();
            const retryAfter = (Catch(() => ThrowOnTransientStatus(Respond(503, { 'Retry-After': date }))) as TransientStatusError).RetryAfter;
            expect(retryAfter).toBeGreaterThan(55_000);
            expect(retryAfter).toBeLessThanOrEqual(60_000);
        });

        it('Should be a localized exception', () => {
            const error = Catch(() => ThrowOnTransientStatus(Respond(503)));
            expect(error).toBeInstanceOf(Exception);
            expect((error as Exception).name).toBe(`TransientStatusError<${R.FetchProvider_Fetch_TransientStatus}>`);
        });
    });

    describe('IsTransientError', () => {

        it('Should detect temporary problems', () => {
            expect(IsTransientError(new TransientStatusError('https://host/image.png', 503, 0))).toBe(true);
            expect(IsTransientError(new TypeError('Failed to fetch'))).toBe(true);
            expect(IsTransientError(new TypeError('NetworkError when attempting to fetch resource.'))).toBe(true);
            expect(IsTransientError(new TypeError('fetch failed'))).toBe(true);
            expect(IsTransientError(new DOMException('The operation timed out.', 'TimeoutError'))).toBe(true);
            expect(IsTransientError(new DOMException('', 'NetworkError'))).toBe(true);
        });

        it('Should not consider permanent or unknown problems as temporary', () => {
            expect(IsTransientError(new DOMException('', 'AbortError'))).toBe(false);
            expect(IsTransientError(new Exception(R.FetchProvider_Fetch_Forbidden, 'https://host'))).toBe(false);
            expect(IsTransientError(new TypeError('text/html'))).toBe(false);
            expect(IsTransientError(new TypeError(`Cannot read properties of undefined (reading 'url')`))).toBe(false);
            expect(IsTransientError(new Error('Failed to fetch'))).toBe(false);
            expect(IsTransientError(new SyntaxError('Unexpected token < in JSON'))).toBe(false);
            expect(IsTransientError('x')).toBe(false);
            expect(IsTransientError(undefined)).toBe(false);
        });

        it('Should only consider aggregated errors as temporary when all errors are temporary', () => {
            expect(IsTransientError(new AggregateError([ new TypeError('Failed to fetch'), new TransientStatusError('', 502, 0) ]))).toBe(true);
            expect(IsTransientError(new AggregateError([ new TypeError('Failed to fetch'), new TypeError('text/html') ]))).toBe(false);
            expect(IsTransientError(new AggregateError([]))).toBe(false);
        });
    });
});
