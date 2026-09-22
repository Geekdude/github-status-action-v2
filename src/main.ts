import * as core from "@actions/core";
import makeStatusRequest, { StatusRequest } from "./makeStatusRequest";
import createStatusWithRetry from "./createStatus";
import inputNames from "./inputNames";
import parseIntInput from "./parseIntInput";

async function run(): Promise<void> {
  const authToken: string = core.getInput("authToken");
  let octokit: any | null = null;

  try {
    const { getOctokit } = await import("@actions/github");
    octokit = getOctokit(authToken);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    core.setFailed("Error creating octokit:\n" + message);
    return;
  }

  if (octokit == null) {
    core.setFailed("Error creating octokit:\noctokit was null");
    return;
  }

  const originalStateInput = core.getInput(inputNames.state);

  let statusRequest: StatusRequest;
  try {
    statusRequest = makeStatusRequest();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    core.setFailed(`Error creating status request object: ${message}`);
    return;
  }

  // 0 retries and 0 delay are both valid configurations; only the timeout has
  // to be positive, since a 0ms AbortSignal aborts before the request starts.
  // Upper bounds guard against a mistyped input (e.g. "300" instead of "30")
  // turning a single step into an hours-long hang.
  const retries = parseIntInput(core.getInput(inputNames.retries), 3, 0, 10);
  const retryDelaySeconds = parseIntInput(core.getInput(inputNames.retryDelaySeconds), 5, 0, 300);
  const timeoutSeconds = parseIntInput(core.getInput(inputNames.timeoutSeconds), 30, 1, 300);

  try {
    await createStatusWithRetry(octokit, statusRequest, { retries, retryDelaySeconds, timeoutSeconds });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const attemptsMade = (error as { attemptsMade?: number } | undefined)?.attemptsMade ?? 1;
    core.setFailed(
      `GitHub returned error "${message}" when setting status on commit: ${statusRequest.sha}\n` +
        ` Failed after ${attemptsMade} attempt(s) (configured retry limit: ${retries}).\n` +
        (originalStateInput !== statusRequest.state
          ? ` Input state "${originalStateInput}" was mapped to "${statusRequest.state}".\n`
          : "") +
        ` Request object:\n` +
        ` ${JSON.stringify(statusRequest, null, 2)}` +
        ` Possible issues could be that the token used does not have access to the repository containing the commit or the commit/repository does not exist.`,
    );
  }
}

run();
