import test from 'ava';
import createStatusWithRetry, { OctokitForStatus } from '../src/createStatus';
import { StatusRequest } from '../src/makeStatusRequest';

const STATUS_REQUEST = { owner: "TestOwner", repo: "Test.Repository-1" } as StatusRequest;
const NO_DELAY = async () => {};

/** An octokit double that records every request it is handed. */
function makeOctokit(behaviors: Array<() => void>) {
    const requests: any[] = [];
    const octokit: OctokitForStatus = {
        rest: {
            repos: {
                createCommitStatus: async (params: any) => {
                    const behavior = behaviors[requests.length];
                    requests.push(params);
                    if (behavior) behavior();
                }
            }
        }
    };
    return { octokit, requests };
}

/** An octokit error carries the HTTP status the retry loop keys off. */
function httpError(
    status: number,
    headers?: Record<string, string | string[] | number | undefined>
): Error {
    return Object.assign(new Error(`HTTP ${status}`), { status, response: { headers } });
}

test("succeeds on the first attempt without retrying", async t => {
    const { octokit, requests } = makeOctokit([() => {}]);
    await createStatusWithRetry(octokit, STATUS_REQUEST, { retries: 3, retryDelaySeconds: 0, timeoutSeconds: 30 }, NO_DELAY);
    t.is(requests.length, 1);
});

test("retries after a failure and succeeds within the retry budget", async t => {
    const { octokit, requests } = makeOctokit([
        () => { throw new Error("first attempt fails"); },
        () => {}
    ]);
    await createStatusWithRetry(octokit, STATUS_REQUEST, { retries: 3, retryDelaySeconds: 0, timeoutSeconds: 30 }, NO_DELAY);
    t.is(requests.length, 2);
});

test("makes retries + 1 requests, matching curl --retry N", async t => {
    const fail = () => { throw new Error("still failing"); };
    const { octokit, requests } = makeOctokit([fail, fail, fail, fail, fail]);
    await t.throwsAsync(() =>
        createStatusWithRetry(octokit, STATUS_REQUEST, { retries: 3, retryDelaySeconds: 0, timeoutSeconds: 30 }, NO_DELAY)
    );
    t.is(requests.length, 4);
});

test("retries: 0 makes exactly one request", async t => {
    const { octokit, requests } = makeOctokit([() => { throw new Error("only attempt"); }]);
    await t.throwsAsync(() =>
        createStatusWithRetry(octokit, STATUS_REQUEST, { retries: 0, retryDelaySeconds: 0, timeoutSeconds: 30 }, NO_DELAY)
    );
    t.is(requests.length, 1);
});

test("throws the last error once retries are exhausted", async t => {
    const { octokit, requests } = makeOctokit([
        () => { throw new Error("attempt 1"); },
        () => { throw new Error("attempt 2"); },
        () => { throw new Error("attempt 3"); }
    ]);
    const err = await t.throwsAsync(() =>
        createStatusWithRetry(octokit, STATUS_REQUEST, { retries: 2, retryDelaySeconds: 0, timeoutSeconds: 30 }, NO_DELAY)
    );
    t.is(err.message, "attempt 3");
    t.is(requests.length, 3);
});

test("sleeps the configured delay between attempts", async t => {
    const delays: number[] = [];
    const { octokit } = makeOctokit([
        () => { throw new Error("attempt 1"); },
        () => { throw new Error("attempt 2"); },
        () => {}
    ]);
    await createStatusWithRetry(
        octokit, STATUS_REQUEST, { retries: 3, retryDelaySeconds: 7, timeoutSeconds: 30 },
        async (seconds) => { delays.push(seconds); }
    );
    t.deepEqual(delays, [7, 7]);
});

test("a zero delay is honoured rather than slept on", async t => {
    const delays: number[] = [];
    const { octokit } = makeOctokit([() => { throw new Error("attempt 1"); }, () => {}]);
    await createStatusWithRetry(
        octokit, STATUS_REQUEST, { retries: 3, retryDelaySeconds: 0, timeoutSeconds: 30 },
        async (seconds) => { delays.push(seconds); }
    );
    t.deepEqual(delays, [0]);
});

test("does not retry a permission error, which would fail identically", async t => {
    const { octokit, requests } = makeOctokit([
        () => { throw httpError(403); },
        () => {}
    ]);
    const err = await t.throwsAsync(() =>
        createStatusWithRetry(octokit, STATUS_REQUEST, { retries: 3, retryDelaySeconds: 0, timeoutSeconds: 30 }, NO_DELAY)
    );
    t.is((err as any).status, 403);
    t.is(requests.length, 1);
});

test("retries a 403 rate-limit response when GitHub includes rate-limit headers", async t => {
    const { octokit, requests } = makeOctokit([
        () => { throw httpError(403, { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1010", date: "Thu, 01 Jan 1970 00:16:40 GMT" }); },
        () => {}
    ]);
    await createStatusWithRetry(
        octokit, STATUS_REQUEST, { retries: 3, retryDelaySeconds: 0, timeoutSeconds: 30 },
        NO_DELAY
    );
    t.is(requests.length, 2);
});

test("does not retry a 422, and does retry a 500 and a 429", async t => {
    for (const status of [404, 422]) {
        const { octokit, requests } = makeOctokit([() => { throw httpError(status); }, () => {}]);
        await t.throwsAsync(() =>
            createStatusWithRetry(octokit, STATUS_REQUEST, { retries: 3, retryDelaySeconds: 0, timeoutSeconds: 30 }, NO_DELAY)
        );
        t.is(requests.length, 1, `${status} should not be retried`);
    }
    for (const status of [429, 500, 503]) {
        const { octokit, requests } = makeOctokit([() => { throw httpError(status); }, () => {}]);
        await createStatusWithRetry(octokit, STATUS_REQUEST, { retries: 3, retryDelaySeconds: 0, timeoutSeconds: 30 }, NO_DELAY);
        t.is(requests.length, 2, `${status} should be retried`);
    }
});

test("uses GitHub's rate-limit delay instead of the configured retry delay", async t => {
    const delays: number[] = [];
    const { octokit } = makeOctokit([
        () => { throw httpError(429, { "retry-after": "17" }); },
        () => {}
    ]);
    await createStatusWithRetry(
        octokit, STATUS_REQUEST, { retries: 3, retryDelaySeconds: 5, timeoutSeconds: 30 },
        async (seconds) => { delays.push(seconds); }
    );
    t.deepEqual(delays, [17]);
});

test("caps a huge retry-after instead of hanging for it in full", async t => {
    const delays: number[] = [];
    const { octokit } = makeOctokit([
        () => { throw httpError(429, { "retry-after": "999999999" }); },
        () => {}
    ]);
    await createStatusWithRetry(
        octokit, STATUS_REQUEST, { retries: 3, retryDelaySeconds: 5, timeoutSeconds: 30 },
        async (seconds) => { delays.push(seconds); }
    );
    t.deepEqual(delays, [300]);
});

test("attaches how many attempts were actually made to the thrown error", async t => {
    const { octokit } = makeOctokit([
        () => { throw new Error("attempt 1"); },
        () => { throw new Error("attempt 2"); },
    ]);
    const err = await t.throwsAsync(() =>
        createStatusWithRetry(octokit, STATUS_REQUEST, { retries: 1, retryDelaySeconds: 0, timeoutSeconds: 30 }, NO_DELAY)
    );
    t.is((err as any).attemptsMade, 2);
});

test("attaches a single attempt when a non-transient error short-circuits", async t => {
    const { octokit } = makeOctokit([() => { throw httpError(403); }]);
    const err = await t.throwsAsync(() =>
        createStatusWithRetry(octokit, STATUS_REQUEST, { retries: 3, retryDelaySeconds: 0, timeoutSeconds: 30 }, NO_DELAY)
    );
    t.is((err as any).attemptsMade, 1);
});

test("preserves a caller's own request options instead of overwriting them", async t => {
    const requestWithOptions = { ...STATUS_REQUEST, request: { parseSuccessResponseBody: false } } as StatusRequest;
    const { octokit, requests } = makeOctokit([() => {}]);
    await createStatusWithRetry(octokit, requestWithOptions, { retries: 0, retryDelaySeconds: 0, timeoutSeconds: 30 }, NO_DELAY);
    t.is(requests[0].request.parseSuccessResponseBody, false);
    t.true(requests[0].request.signal instanceof AbortSignal);
});

// Serial: this patches a global, and AVA runs serial tests alone, before the rest.
test.serial("bounds every attempt with a fresh signal built from timeoutSeconds", async t => {
    const realTimeout = AbortSignal.timeout;
    const millis: number[] = [];
    (AbortSignal as any).timeout = (ms: number) => {
        millis.push(ms);
        return realTimeout.call(AbortSignal, ms);
    };

    let requests: any[];
    try {
        const fail = () => { throw new Error("transient"); };
        const octokitAndRequests = makeOctokit([fail, fail, () => {}]);
        requests = octokitAndRequests.requests;
        await createStatusWithRetry(
            octokitAndRequests.octokit, STATUS_REQUEST,
            { retries: 3, retryDelaySeconds: 0, timeoutSeconds: 12 }, NO_DELAY
        );
    } finally {
        (AbortSignal as any).timeout = realTimeout;
    }

    t.deepEqual(millis, [12000, 12000, 12000], "seconds are converted to milliseconds");
    const signals = requests.map(r => r.request.signal);
    t.true(signals.every(s => s instanceof AbortSignal), "every attempt carries a signal");
    t.is(new Set(signals).size, 3, "each attempt gets its own signal, not a shared one");
});
