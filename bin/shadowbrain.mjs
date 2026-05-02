#!/usr/bin/env node
// Shadowbrain CLI entry point.
//
// All commands live under src/cli/. Top-level catch routes typed errors
// through formatErrorForCli so users get code/message/fix instead of a
// raw stack trace.
import { run } from '../src/cli/dispatch.mjs';
import { formatErrorForCli } from '../src/cli/errors.mjs';

run(process.argv.slice(2)).then(
  (code) => process.exit(code ?? 0),
  (err) => {
    process.stderr.write(formatErrorForCli(err));
    process.exit(1);
  }
);
