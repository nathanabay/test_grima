const path = require('path');

/** @type {import('next').NextConfig} */
module.exports = {
  reactStrictMode: true,
  transpilePackages: ['@pharmacore/shared'],
  // Several lockfiles exist above this directory; pin the trace root to the
  // monorepo so Next does not guess the wrong one.
  outputFileTracingRoot: path.join(__dirname, '../..'),
};
