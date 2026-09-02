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

/**
 * Only transient failures are worth another attempt. Octokit's own retry plugin
 * draws the same line: retry network/timeout errors and 5xx, never a 4xx that
 * will fail identically next time (a bad token, a missing commit, a malformed
 * request). 408 and 429 are the two 4xx that do clear on their own.
 */
export function isTransient(error: unknown): boolean {
    const status = (error as { status?: number } | undefined)?.status;
    if (typeof status !== 'number') {
        return true; // network error, or the per-attempt AbortSignal firing
    }
    return status === 408 || status === 429 || status >= 500;
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
                await sleep(retryDelaySeconds);
            }
        }
    }

    throw lastError;
}
