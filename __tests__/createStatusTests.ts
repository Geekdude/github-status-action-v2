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
function httpError(status: number): Error {
    return Object.assign(new Error(`HTTP ${status}`), { status });
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
