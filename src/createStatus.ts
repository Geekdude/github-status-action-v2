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
    headers?: ErrorHeaders;
    response?: {
        headers?: ErrorHeaders;
    };
}

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
    return statusError?.response?.headers ?? statusError?.headers;
}

function getRateLimitDelaySeconds(error: unknown): number | undefined {
    const headers = getRateLimitHeaders(error);
    const retryAfter = getHeader(headers, 'retry-after');
    if (retryAfter) {
        const seconds = Number(retryAfter);
        if (Number.isFinite(seconds) && seconds >= 0) {
            return Math.ceil(seconds);
        }

        const retryDate = Date.parse(retryAfter);
        if (Number.isFinite(retryDate)) {
            return Math.max(0, Math.ceil((retryDate - Date.now()) / 1000));
        }
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
    return Math.max(0, Math.ceil(resetSeconds - currentTimeSeconds));
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
                request: { signal: AbortSignal.timeout(timeoutSeconds * 1000) },
            });
            return;
        } catch (error) {
            if (!isTransient(error)) {
                throw error;
            }
            lastError = error;
            if (attempt < attempts) {
                await sleep(getRateLimitDelaySeconds(error) ?? retryDelaySeconds);
            }
        }
    }

    throw lastError;
}
