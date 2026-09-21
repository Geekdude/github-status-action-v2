"use strict";

// Plain, hand-written CommonJS (deliberately outside src/, untouched by tsc)
// so this dynamic import() reaches the bundler as a real ESM import, not a
// downleveled `require()`. TypeScript's `--module commonjs` output always
// rewrites `await import(...)` into `Promise.resolve().then(() =>
// require(...))`, and `require()` cannot load `@actions/github`, which has
// been ESM-only (no "require" export condition) since v9. Keeping this one
// line outside tsc's pipeline lets ncc bundle @actions/github's ESM build
// directly into dist/index.js instead of failing to resolve it.
module.exports.loadGetOctokit = async function loadGetOctokit() {
  const { getOctokit } = await import("@actions/github");
  return getOctokit;
};
