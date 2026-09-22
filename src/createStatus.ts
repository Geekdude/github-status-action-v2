import { StatusRequest } from './makeStatusRequest';

export interface CreateStatusOptions {
    retries: number;
    retryDelaySeconds: number;
    timeoutSeconds: number;
}

export interface OctokitForStatus {
    rest: {
        repos: {
            createCommitStatus: (params: any) => Promise<any>;
        };
    };
}

export type Sleep = (seconds: number) => Promise<void>;

const defaultSleep: Sleep = (seconds) =>
    new Promise((resolve) => setTimeout(resolve, seconds * 1000));

type ErrorHeaders = Record<string, string | string[] | number | undefined>;

interface StatusErrorLike {
    status?: number;
    response?: {
        headers?: ErrorHeaders;
    };
}

// Never wait longer than retryDelaySeconds' own upper bound (see main.ts), so
// a large or misconfigured Retry-After / x-ratelimit-reset can't reopen the
// hang that bound is meant to prevent.
const MAX_RATE_LIMIT_DELAY_SECONDS = 300;

function getHeader(headers: ErrorHeaders | undefined, name: string): string | undefined {
    if (!headers) {
        return undefined;
    }
    const key = Object.keys(headers).find((headerName) => headerName.toLowerCase() === name);
    const value = key ? headers[key] : undefined;
    if (typeof value === 'string') {
        return value;
    }
    if (Array.isArray(value)) {
        return value[0];
    }
    if (typeof value === 'number') {
        return String(value);
    }
    return undefined;
}

function getRateLimitHeaders(error: unknown): ErrorHeaders | undefined {
    const statusError = error as StatusErrorLike | undefined;
    return statusError?.response?.headers;
}

function getRateLimitDelaySeconds(error: unknown): number | undefined {
    const headers = getRateLimitHeaders(error);
    const retryAfter = getHeader(headers, 'retry-after');
    if (retryAfter) {
        const seconds = Number(retryAfter);
        if (Number.isFinite(seconds) && seconds >= 0) {
            return Math.min(Math.ceil(seconds), MAX_RATE_LIMIT_DELAY_SECONDS);
        }

        const retryDate = Date.parse(retryAfter);
        if (Number.isFinite(retryDate)) {
            return Math.min(Math.max(0, Math.ceil((retryDate - Date.now()) / 1000)), MAX_RATE_LIMIT_DELAY_SECONDS);
        }
    }

    if (getHeader(headers, 'x-ratelimit-remaining') !== '0') {
        return undefined;
    }

    const resetAt = getHeader(headers, 'x-ratelimit-reset');
    if (!resetAt) {
        return undefined;
    }

    const resetSeconds = Number(resetAt);
    if (!Number.isFinite(resetSeconds)) {
        return undefined;
    }

    const currentDateHeader = getHeader(headers, 'date');
    const currentTimeSeconds = currentDateHeader ? Date.parse(currentDateHeader) / 1000 : Date.now() / 1000;
    return Math.min(Math.max(0, Math.ceil(resetSeconds - currentTimeSeconds)), MAX_RATE_LIMIT_DELAY_SECONDS);
}

function isRateLimited(error: unknown): boolean {
    const status = (error as StatusErrorLike | undefined)?.status;
    if (status === 429) {
        return true;
    }
    if (status !== 403) {
        return false;
    }

    const headers = getRateLimitHeaders(error);
    return getHeader(headers, 'x-ratelimit-remaining') === '0' || getRateLimitDelaySeconds(error) !== undefined;
}

/**
 * Only transient failures are worth another attempt. Octokit's own retry plugin
 * draws the same line: retry network/timeout errors and 5xx, never a 4xx that
 * will fail identically next time (a bad token, a missing commit, a malformed
 * request). 408 and 429 are the two 4xx that do clear on their own.
 */
export function isTransient(error: unknown): boolean {
    const status = (error as StatusErrorLike | undefined)?.status;
    if (typeof status !== 'number') {
        return true; // network error, or the per-attempt AbortSignal firing
    }
    return status === 408 || isRateLimited(error) || status >= 500;
}

function withAttemptsMade(error: unknown, attemptsMade: number): unknown {
    if (error && typeof error === 'object') {
        (error as { attemptsMade?: number }).attemptsMade = attemptsMade;
    }
    return error;
}

export default async function createStatusWithRetry(
    octokit: OctokitForStatus,
    statusRequest: StatusRequest,
    options: CreateStatusOptions,
    sleep: Sleep = defaultSleep
): Promise<void> {
    const { retries, retryDelaySeconds, timeoutSeconds } = options;
    // `retries` counts retries, not total requests, matching `curl --retry N`.
    const attempts = retries + 1;
    let lastError: unknown;

    for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
            await octokit.rest.repos.createCommitStatus({
                ...statusRequest,
                request: { ...statusRequest.request, signal: AbortSignal.timeout(timeoutSeconds * 1000) },
            });
            return;
        } catch (error) {
            if (!isTransient(error)) {
                throw withAttemptsMade(error, attempt);
            }
            lastError = error;
            if (attempt < attempts) {
                await sleep(getRateLimitDelaySeconds(error) ?? retryDelaySeconds);
            }
        }
    }

    throw withAttemptsMade(lastError, attempts);
}
