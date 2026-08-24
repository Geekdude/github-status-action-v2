import test from 'ava';
import createStatusWithRetry, { OctokitForStatus } from '../src/createStatus';
import { StatusRequest } from '../src/makeStatusRequest';

const STATUS_REQUEST = { owner: "TestOwner", repo: "Test.Repository-1" } as StatusRequest;
const NO_DELAY = async () => {};

function makeOctokit(behaviors: Array<() => void>): OctokitForStatus {
    let call = 0;
    return {
        rest: {
            repos: {
                createCommitStatus: async () => {
                    const behavior = behaviors[call];
                    call++;
                    behavior();
                }
            }
        }
    };
}

test("succeeds on the first attempt without retrying", async t => {
    let calls = 0;
    const octokit = makeOctokit([() => { calls++; }]);
    await createStatusWithRetry(octokit, STATUS_REQUEST, { retries: 3, retryDelaySeconds: 0, timeoutSeconds: 30 }, NO_DELAY);
    t.is(calls, 1);
});

test("retries after a failure and succeeds within the retry budget", async t => {
    let calls = 0;
    const octokit = makeOctokit([
        () => { calls++; throw new Error("first attempt fails"); },
        () => { calls++; }
    ]);
    await createStatusWithRetry(octokit, STATUS_REQUEST, { retries: 3, retryDelaySeconds: 0, timeoutSeconds: 30 }, NO_DELAY);
    t.is(calls, 2);
});

test("throws the last error once retries are exhausted", async t => {
    let calls = 0;
    const octokit = makeOctokit([
        () => { calls++; throw new Error("attempt 1"); },
        () => { calls++; throw new Error("attempt 2"); },
        () => { calls++; throw new Error("attempt 3"); }
    ]);
    const err = await t.throwsAsync(() =>
        createStatusWithRetry(octokit, STATUS_REQUEST, { retries: 3, retryDelaySeconds: 0, timeoutSeconds: 30 }, NO_DELAY)
    );
    t.is(err.message, "attempt 3");
    t.is(calls, 3);
});

test("sleeps between attempts using the injected delay", async t => {
    const delays: number[] = [];
    const octokit = makeOctokit([
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
