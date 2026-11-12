import type { NextConfig } from 'next';
import { existsSync } from 'node:fs';

// One .env for the whole repository (see .env.example). Only NEXT_PUBLIC_* values reach the browser.
if (existsSync('../.env')) process.loadEnvFile('../.env');

const config: NextConfig = {
  // The same chipnet server as the demo scripts and the keeper (CHIPNET_ELECTRUM_SERVER in .env).
  env: { NEXT_PUBLIC_ELECTRUM_SERVER: process.env.NEXT_PUBLIC_ELECTRUM_SERVER || process.env.CHIPNET_ELECTRUM_SERVER || '' },
  // A static site: no server, no API routes. Everything runs in the browser.
  output: 'export',
  images: { unoptimized: true },
  // The workspace packages ship TypeScript source.
  transpilePackages: ['@backstop/contracts', '@backstop/keeper', '@backstop/demo'],
  // Relative asset paths, so the built site works from any folder (e.g. GitHub Pages).
  // Only for the static build: the dev server cannot serve a relative prefix, and the page
  // then never starts in the browser.
  assetPrefix: process.env.NODE_ENV === 'production' ? './' : undefined,
  trailingSlash: true,
  // The shared packages import './x.js' for './x.ts' (TypeScript's NodeNext style). Webpack maps it;
  // Turbopack does not yet, so dev and build run with --webpack.
  webpack(webpackConfig) {
    webpackConfig.resolve.extensionAlias = { '.js': ['.ts', '.tsx', '.js'] };
    // libauth uses top-level await; every browser in the browserslist supports it.
    webpackConfig.output.environment = { ...webpackConfig.output.environment, asyncFunction: true };
    return webpackConfig;
  },
};

export default config;
