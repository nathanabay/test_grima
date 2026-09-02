const path = require('path');

/** @type {import('next').NextConfig} */
module.exports = {
  reactStrictMode: true,
  transpilePackages: ['@pharmacore/shared'],
  // Several lockfiles exist above this directory; pin the trace root to the
  // monorepo so Next does not guess the wrong one.
  outputFileTracingRoot: path.join(__dirname, '../..'),
  // Production builds write to their own directory. Sharing `.next` with a
  // running dev server corrupts its chunk map and the dev server starts
  // throwing MODULE_NOT_FOUND for chunks the build replaced.
  distDir: process.env.NEXT_DIST_DIR || '.next',
};
