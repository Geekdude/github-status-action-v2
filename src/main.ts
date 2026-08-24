import * as core from "@actions/core";
import * as github from "@actions/github";
import makeStatusRequest, { StatusRequest } from "./makeStatusRequest";
import createStatusWithRetry from "./createStatus";
import inputNames from "./inputNames";

function parsePositiveInt(value: string, fallback: number): number {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
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

  const retries = parsePositiveInt(core.getInput(inputNames.retries), 3);
  const retryDelaySeconds = parsePositiveInt(core.getInput(inputNames.retryDelaySeconds), 5);
  const timeoutSeconds = parsePositiveInt(core.getInput(inputNames.timeoutSeconds), 30);

  try {
    await createStatusWithRetry(octokit, statusRequest, { retries, retryDelaySeconds, timeoutSeconds });
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(
        `Github returned error "${error.message}" when setting status on commit: ${statusRequest.sha}\n` +
          ` after ${retries} attempt(s).\n` +
          ` Request object:\n` +
          ` ${JSON.stringify(statusRequest, null, 2)}` +
          ` Possible issues could be that the token used does not have access to the repository containing the commit or the commit/repository does not exist.`,
      );
    }
  }
}

run();
