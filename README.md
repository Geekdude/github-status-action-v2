# GitHub Status Action V2

[![GitHub repo](https://img.shields.io/badge/GitHub-guibranco%2Fgithub--status--action--v2-green.svg?style=plastic&logo=github)](https://github.com/guibranco/github-status-action-v2 "shields.io")
[![GitHub code size in bytes](https://img.shields.io/github/languages/code-size/guibranco/github-status-action-v2?color=green&label=Code%20size&style=plastic&logo=github)](https://github.com/guibranco/github-status-action-v2 "shields.io")
[![GitHub last commit](https://img.shields.io/github/last-commit/guibranco/github-status-action-v2?color=green&logo=github&style=plastic&label=Last%20commit)](https://github.com/guibranco/github-status-action-v2 "shields.io")
[![GitHub license](https://img.shields.io/github/license/guibranco/github-status-action-v2?color=green&logo=github&style=plastic&label=License)](https://github.com/guibranco/github-status-action-v2 "shields.io")

![Test](https://github.com/guibranco/github-status-action-v2/actions/workflows/test.yml/badge.svg)
![Build](https://github.com/guibranco/github-status-action-v2/actions/workflows/build.yml/badge.svg)
![Create Release](https://github.com/guibranco/github-status-action-v2/actions/workflows/ci.yml/badge.svg)
[![wakatime](https://wakatime.com/badge/github/guibranco/github-status-action-v2.svg)](https://wakatime.com/badge/github/guibranco/github-status-action-v2)

Adds a status update to a commit. GitHub will always show the latest state of a context.

> [!Important]
>
> **Disclaimer** This version was created because the [original (V1)](https://github.com/Sibz/github-status-action) has been archived on May 1, 2024.

## Usage

### Inputs

- `authToken` (required)  
  Use secrets.GITHUB_TOKEN or your own token if you need to trigger other workflows that use "on: status"
- `state` (required)  
  The status of the check should only be `success`, `error`, `failure`, `pending`, or `cancelled`.
  `cancelled` is accepted as an input but mapped to `error` before it reaches GitHub, since
  GitHub's commit-status API has no `cancelled` state of its own.
- `context`  
  The context, is displayed as the name of the check
- `description`  
  Short text explaining the status of the check
- `owner`  
  The repository owner defaults to context github.repository_owner if omitted
- `repository`  
  Repository, default to context github.repository if omitted
- `sha`  
  SHA of commit to update status on, defaults to context github.sha  
  \*If using `on: pull_request` use `github.event.pull_request.head.sha`
- `target_url`  
  Url to use for the details link. If omitted no link is shown.
- `retries`  
  Number of retries after a failed attempt, so the step makes up to `retries + 1`
  requests in total (the same counting as `curl --retry N`). Defaults to `3`.
  Set to `0` to attempt the request once and fail. Must be between `0` and `10`;
  an out-of-range value falls back to the default rather than hanging the step.
  Only transient failures are retried: network errors, the per-attempt timeout
  firing, `408`, `429`, rate-limited `403` responses, and any `5xx`. A `4xx`
  such as `403 Resource not accessible by integration` or `422` fails the step
  immediately, since another identical request cannot succeed.
- `retryDelaySeconds`  
  Delay in seconds between retry attempts. Defaults to `5`. `0` is valid and
  retries with no delay. Must be between `0` and `300`; an out-of-range value
  falls back to the default.
- `timeoutSeconds`  
  Per-attempt request timeout in seconds, applied as a fresh `AbortSignal` on
  every attempt. Defaults to `30`. Must be between `1` and `300`; an
  out-of-range value falls back to the default.

### Outputs

None.

## Local Debugging with @github/local-action

To facilitate local debugging of your GitHub Action, this repository now includes support for [@github/local-action](https://github.com/github/local-action). This utility allows you to run and debug your action code locally by simulating the GitHub Actions runtime environment.

### Setup

1. Install the dependencies:

```bash
npm install
```

2. Run the local-action debugging command:

```bash
npx @github/local-action
```

This command bootstraps your environment and stubs out the GitHub Actions Toolkit APIs so that you can test your action locally.

For more detailed usage and advanced configuration, please refer to the [local-action documentation](https://github.com/github/local-action).

## Example

```yml
name: "test"

on: # run on any PRs and main branch changes
  pull_request:
  push:
    branches:
      - main

permissions:
  statuses: write

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Run the action
        uses: guibranco/github-status-action-v2@v1
        with:
          authToken: ${{secrets.GITHUB_TOKEN}}
          context: "Test run"
          description: "Passed"
          state: "success"
          sha: ${{github.event.pull_request.head.sha || github.sha}}
```

## Permissions Settings for GitHub Actions

With the introduction of the `permissions` block in GitHub Actions, it is crucial to configure the necessary permissions for your workflows to function correctly. Below is a guide to help you set up the permissions securely and effectively.

### Required Permissions

Refer to the [GitHub documentation](https://docs.github.com/en/actions/writing-workflows/choosing-what-your-workflow-does/controlling-permissions-for-github_token) for a detailed list of available permissions.
