// SPDX-FileCopyrightText: 2026 The Khronos Group, Inc.
// SPDX-License-Identifier: Apache-2.0 OR MIT

// Print which repositories are listed, hidden or excluded, and why.
//
//   npm run report            summary plus every hidden or excluded repository
//   npm run report -- --all   every repository

import { loadConfig } from './lib/config.mjs';
import { loadData } from './lib/data.mjs';
import { buildSite } from './lib/score.mjs';

const { data, source } = loadData();
const site = buildSite(data, loadConfig());
const all = process.argv.includes('--all');
const count = (status) => site.report.filter((entry) => entry.status === status).length;

console.log(`source: ${source} (${data.generatedAt})`);
console.log(`listed: ${count('listed')}  hidden: ${count('hidden')}  excluded: ${count('excluded')}\n`);

for (const entry of site.report) {
  if (all || entry.status !== 'listed') {
    const detail = entry.status === 'listed' ? `${entry.tier}, ${entry.group}` : entry.reason;

    console.log(`${entry.status.padEnd(9)} ${entry.name.padEnd(42)} ${detail}`);
  }
}
