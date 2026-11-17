// SPDX-FileCopyrightText: 2026 The Khronos Group, Inc.
// SPDX-License-Identifier: Apache-2.0 OR MIT

// Fetch repository data for the organization into data/repos.json.
//
//   GH_TOKEN      GitHub token. Without it nothing is fetched and the build
//                 falls back to data/sample.json.
//   HISTORY_DIR   Directory of daily snapshots (the `data` branch in CI).
//                 Enables star gain and receives today's snapshot.
//   --sample      Write data/sample.json, the committed fixture, instead.
//                 Traffic is left out because it is not public data.

import { writeFileSync } from 'node:fs';
import { loadConfig, root } from './lib/config.mjs';
import { attachTraffic, fetchRepos } from './lib/github.mjs';
import { attachStarGain, listSnapshots, pickBaseline, readSnapshot, writeSnapshot } from './lib/history.mjs';
import { exclusionReason } from './lib/score.mjs';

const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
const sample = process.argv.includes('--sample');

if (!token) {
  console.log('fetch: GH_TOKEN is not set. The build uses the last fetched data, or data/sample.json.');
  process.exit(0);
}

const { health, overrides } = loadConfig();
const now = new Date();

const repos = await fetchRepos(token, {
  org: health.org,
  now,
  windowDays: health.window_days,
  recentDays: health.highlights.activity_days,
  bots: health.bots,
  onPage: (count) => process.stdout.write(`\rfetch: ${count} repositories`),
});
process.stdout.write('\n');

const eligible = repos.filter((repo) => !exclusionReason(repo, health, overrides));
const traffic = !sample && (await attachTraffic(token, health.org, eligible));

if (!sample) {
  console.log(
    traffic
      ? `fetch: traffic for ${eligible.length} repositories`
      : 'fetch: token has no access to traffic (needs Administration read). Continuing without it.',
  );
}

const historyDir = process.env.HISTORY_DIR;

if (historyDir) {
  const baseline = pickBaseline(listSnapshots(historyDir), now, {
    targetDays: health.highlights.star_gain_days,
    minDays: health.highlights.min_snapshot_age_days,
  });

  if (baseline) {
    attachStarGain(repos, readSnapshot(historyDir, baseline.date), baseline.age);
    console.log(`fetch: star gain measured against ${baseline.date}`);
  } else {
    console.log('fetch: no snapshot old enough for star gain yet');
  }

  console.log(`fetch: wrote snapshot ${writeSnapshot(historyDir, now, eligible)}`);
}

const file = `${root}data/${sample ? 'sample' : 'repos'}.json`;
const data = { generatedAt: now.toISOString(), org: health.org, traffic, ...(sample && { sample: true }), repos };

writeFileSync(file, `${JSON.stringify(data, null, sample ? 1 : 0)}\n`);
console.log(`fetch: wrote ${file}`);
