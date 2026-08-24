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

export default async function createStatusWithRetry(
    octokit: OctokitForStatus,
    statusRequest: StatusRequest,
    options: CreateStatusOptions,
    sleep: Sleep = defaultSleep
): Promise<void> {
    const { retries, retryDelaySeconds, timeoutSeconds } = options;
    let lastError: unknown;

    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            await octokit.rest.repos.createCommitStatus({
                ...statusRequest,
                request: { signal: AbortSignal.timeout(timeoutSeconds * 1000) },
            });
            return;
        } catch (error) {
            lastError = error;
            if (attempt < retries) {
                await sleep(retryDelaySeconds);
            }
        }
    }

    throw lastError;
}
