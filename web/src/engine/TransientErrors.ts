import { EngineResourceKey as R } from '../i18n/ILocale';
import { Exception } from './Error';

/**
 * An exception for a response whose HTTP status indicates a temporary problem of the website (e.g., overloaded or unavailable).
 */
export class TransientStatusError extends Exception {

    /**
     * @param Status - The HTTP status code of the response
     * @param RetryAfter - The time (in milliseconds) the website asked to wait before the next request (`Retry-After` header), `0` when not provided
     */
    constructor(url: string, public readonly Status: number, public readonly RetryAfter: number) {
        super(R.FetchProvider_Fetch_TransientStatus, url, `${Status}`);
    }
}

/**
 * Determine whether the HTTP {@link status} code indicates a temporary problem (request timeout, too many requests, server errors).
 * Server errors which are permanent by definition (not implemented, unsupported HTTP version, network authentication required) are excluded.
 */
function IsTransientStatus(status: number): boolean {
    if(status === 408 || status === 429) {
        return true;
    }
    return status >= 500 && status <= 599 && ![ 501, 505, 511 ].includes(status);
}

/**
 * Get the time (in milliseconds) to wait from the value of a `Retry-After` header (delay in seconds, or a date), `0` when not provided or invalid.
 */
function ParseRetryAfter(value: string | null): number {
    if(!value?.trim()) {
        return 0;
    }
    const seconds = Number(value);
    if(Number.isFinite(seconds)) {
        return Math.max(0, seconds * 1000);
    }
    const date = Date.parse(value);
    return Number.isNaN(date) ? 0 : Math.max(0, date - Date.now());
}

/**
 * Throw a {@link TransientStatusError} when the HTTP status of the {@link response} indicates a temporary problem.
 * This prevents the content of an error page from being processed as regular data (e.g., stored as image).
 */
export function ThrowOnTransientStatus(response: Response): void {
    if(IsTransientStatus(response.status)) {
        throw new TransientStatusError(response.url, response.status, ParseRetryAfter(response.headers.get('Retry-After')));
    }
}

/**
 * Determine whether the {@link error} is likely caused by a temporary problem, so the same request may succeed when retried later.
 * Errors which are unknown or require an intervention (e.g., aborted by the user, access denied, parser error) are not considered as temporary.
 */
export function IsTransientError(error: unknown): boolean {
    if(error instanceof TransientStatusError) {
        return true;
    }
    if(error instanceof DOMException) {
        return error.name === 'TimeoutError' || error.name === 'NetworkError';
    }
    if(error instanceof TypeError) {
        // The Fetch API rejects with a TypeError on network failures (e.g., connection reset), other type errors are unrelated (e.g., bugs)
        return /^(Failed to fetch|NetworkError when attempting to fetch resource\.|Load failed|fetch failed)$/i.test(error.message);
    }
    if(error instanceof AggregateError) {
        // e.g., all mirrors of an image failed
        return error.errors.length > 0 && error.errors.every(IsTransientError);
    }
    return false;
}
