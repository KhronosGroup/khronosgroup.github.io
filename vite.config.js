// SPDX-FileCopyrightText: 2026 The Khronos Group, Inc.
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import nunjucks from 'nunjucks';
import { defineConfig } from 'vite';
import { loadConfig } from './scripts/lib/config.mjs';
import { loadData } from './scripts/lib/data.mjs';
import { buildSite } from './scripts/lib/score.mjs';

const root = fileURLToPath(new URL('.', import.meta.url));
const templates = `${root}src/templates`;

function compact(value) {
  if (value < 1000) {
    return String(value);
  }

  const thousands = value / 1000;

  return `${thousands >= 100 ? Math.round(thousands) : thousands.toFixed(1).replace(/\.0$/, '')}k`;
}

function formatDate(value, options) {
  return value ? new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', ...options }).format(new Date(value)) : '';
}

function createEnvironment() {
  const env = new nunjucks.Environment(new nunjucks.FileSystemLoader(templates, { noCache: true }), {
    autoescape: true,
    throwOnUndefined: false,
  });

  env.addFilter('compact', compact);
  env.addFilter('plural', (count, noun) => `${count} ${noun}${count === 1 ? '' : 's'}`);
  env.addFilter('monthYear', (value) => formatDate(value, { month: 'short', year: 'numeric' }));
  env.addFilter('longDate', (value) => formatDate(value, { day: 'numeric', month: 'long', year: 'numeric' }));

  return env;
}

/** Renders index.html from the Nunjucks templates and the scored repository data. */
function khronosSite() {
  let site;

  return {
    name: 'khronos-site',

    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        const { data, source } = loadData();

        site = buildSite(data, loadConfig());
        this.info?.(`${site.stats.listed} repositories from ${source}`);

        return createEnvironment().renderString(html, { site, year: new Date().getUTCFullYear() });
      },
    },

    configureServer(server) {
      server.watcher.add([`${root}config`, `${root}data`, templates]);
      server.watcher.on('change', (file) => {
        if (/\.(njk|yml|json)$/.test(file)) {
          server.ws.send({ type: 'full-reload' });
        }
      });
    },

    generateBundle() {
      const report = { generatedAt: site.generatedAt, repositories: site.report };

      this.emitFile({ type: 'asset', fileName: 'report.json', source: `${JSON.stringify(report, null, 2)}\n` });
      this.emitFile({ type: 'asset', fileName: 'CNAME', source: readFileSync(`${root}CNAME`) });
    },
  };
}

export default defineConfig({
  base: './',
  appType: 'mpa',
  plugins: [khronosSite(), tailwindcss()],
  build: { outDir: 'dist', emptyOutDir: true },
});
