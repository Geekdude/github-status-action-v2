import * as core from "@actions/core";
import makeStatusRequest, { StatusRequest } from "./makeStatusRequest";
import createStatusWithRetry from "./createStatus";
import inputNames from "./inputNames";
import parseIntInput from "./parseIntInput";

declare function require(id: string): any;

async function run(): Promise<void> {
  const authToken: string = core.getInput("authToken");
  let octokit: any | null = null;

  try {
    // Routed through a plain-JS loader (see ../loadOctokit.cjs) so the
    // dynamic import() of the ESM-only @actions/github reaches the bundler
    // unmodified instead of being downleveled to an unresolvable require().
    const { loadGetOctokit } = require("../loadOctokit.cjs") as {
      loadGetOctokit: () => Promise<(token: string) => any>;
    };
    const getOctokit = await loadGetOctokit();
    octokit = getOctokit(authToken);
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
  // Upper bounds guard against a mistyped input (e.g. "300" instead of "30")
  // turning a single step into an hours-long hang.
  const retries = parseIntInput(core.getInput(inputNames.retries), 3, 0, 10);
  const retryDelaySeconds = parseIntInput(core.getInput(inputNames.retryDelaySeconds), 5, 0, 300);
  const timeoutSeconds = parseIntInput(core.getInput(inputNames.timeoutSeconds), 30, 1, 300);

  try {
    await createStatusWithRetry(octokit, statusRequest, { retries, retryDelaySeconds, timeoutSeconds });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    core.setFailed(
      `GitHub returned error "${message}" when setting status on commit: ${statusRequest.sha}\n` +
        ` Configured retry limit: ${retries} retry attempt(s).\n` +
        ` Request object:\n` +
        ` ${JSON.stringify(statusRequest, null, 2)}` +
        ` Possible issues could be that the token used does not have access to the repository containing the commit or the commit/repository does not exist.`,
    );
  }
}

run();
