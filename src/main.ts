import * as core from "@actions/core";
import * as github from "@actions/github";
import makeStatusRequest, { StatusRequest } from "./makeStatusRequest";
import createStatusWithRetry from "./createStatus";
import inputNames from "./inputNames";

function parseIntInput(value: string, fallback: number, min: number): number {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= min ? parsed : fallback;
}

async function run(): Promise<void> {
  const authToken: string = core.getInput("authToken");
  let octokit: any | null = null;

  try {
    octokit = github.getOctokit(authToken);
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed("Error creating octokit:\n" + error.message);
    }
    return;
  }

  if (octokit == null) {
    core.setFailed("Error creating octokit:\noctokit was null");
    return;
  }

  let statusRequest: StatusRequest;
  try {
    statusRequest = makeStatusRequest();
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(`Error creating status request object: ${error.message}`);
    }
    return;
  }

  // 0 retries and 0 delay are both valid configurations; only the timeout has
  // to be positive, since a 0ms AbortSignal aborts before the request starts.
  const retries = parseIntInput(core.getInput(inputNames.retries), 3, 0);
  const retryDelaySeconds = parseIntInput(core.getInput(inputNames.retryDelaySeconds), 5, 0);
  const timeoutSeconds = parseIntInput(core.getInput(inputNames.timeoutSeconds), 30, 1);

  try {
    await createStatusWithRetry(octokit, statusRequest, { retries, retryDelaySeconds, timeoutSeconds });
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(
        `Github returned error "${error.message}" when setting status on commit: ${statusRequest.sha}\n` +
          ` after ${retries + 1} attempt(s).\n` +
          ` Request object:\n` +
          ` ${JSON.stringify(statusRequest, null, 2)}` +
          ` Possible issues could be that the token used does not have access to the repository containing the commit or the commit/repository does not exist.`,
      );
    }
  }
}

run();
