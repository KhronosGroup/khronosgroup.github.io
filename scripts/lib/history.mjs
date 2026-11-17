// SPDX-FileCopyrightText: 2026 The Khronos Group, Inc.
// SPDX-License-Identifier: Apache-2.0 OR MIT

// Daily snapshots of stars and traffic. GitHub keeps traffic for 14 days and
// has no star history, so trends need stored snapshots.

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { daysBetween } from './score.mjs';

const FILE = /^(\d{4}-\d{2}-\d{2})\.json$/;

export function snapshotOf(repos) {
  return Object.fromEntries(
    repos.map((repo) => [repo.name, { stars: repo.stars, forks: repo.forks, ...(repo.traffic ?? {}) }]),
  );
}

/**
 * Pick the snapshot date closest to `targetDays` ago that is at least
 * `minDays` old. Returns null when none qualifies.
 */
export function pickBaseline(dates, now, { targetDays, minDays }) {
  const today = new Date(now).toISOString().slice(0, 10);

  return (
    dates
      .map((date) => ({ date, age: Math.round(daysBetween(date, today)) }))
      .filter(({ age }) => age >= minDays)
      .sort((a, b) => Math.abs(a.age - targetDays) - Math.abs(b.age - targetDays))[0] ?? null
  );
}

/** Set `starGain` on each repository from the baseline snapshot, in place. */
export function attachStarGain(repos, baseline, age) {
  for (const repo of repos) {
    const before = baseline[repo.name];

    repo.starGain = before ? { gain: repo.stars - before.stars, days: age } : null;
  }
}

export function listSnapshots(dir) {
  try {
    return readdirSync(dir)
      .map((file) => FILE.exec(file)?.[1])
      .filter(Boolean)
      .sort();
  } catch {
    return [];
  }
}

export function readSnapshot(dir, date) {
  return JSON.parse(readFileSync(join(dir, `${date}.json`), 'utf8'));
}

export function writeSnapshot(dir, now, repos) {
  mkdirSync(dir, { recursive: true });

  const file = join(dir, `${new Date(now).toISOString().slice(0, 10)}.json`);

  writeFileSync(file, `${JSON.stringify(snapshotOf(repos))}\n`);

  return file;
}
