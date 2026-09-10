#!/usr/bin/env node
'use strict';

/**
 * YT Lite - Resource Test Runner
 *
 * Runs the resource benchmark comparison between Vanilla YouTube and YT Lite.
 * Run `node test_resources.js --help` for available options.
 */

const { runBenchmark, runSelfTest, parseArgs, printHelp } = require('./benchmark_resources.js');

if (require.main === module) {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printHelp();
    process.exit(0);
  }

  (async () => {
    try {
      if (options.selfTest) {
        await runSelfTest(options);
      } else {
        await runBenchmark(options);
      }
      process.exit(0);
    } catch (err) {
      console.error('Resource test failed:', err);
      process.exit(1);
    }
  })();
}

module.exports = require('./benchmark_resources.js');
