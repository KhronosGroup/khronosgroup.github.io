// SPDX-FileCopyrightText: 2026 The Khronos Group, Inc.
// SPDX-License-Identifier: Apache-2.0 OR MIT

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadConfig } from './lib/config.mjs';
import { reduceRepo } from './lib/github.mjs';
import { attachStarGain, pickBaseline, snapshotOf } from './lib/history.mjs';
import { buildSite, exclusionReason, groupFor, healthTier, isBot } from './lib/score.mjs';

const NOW = '2026-11-17T00:00:00Z';
const daysAgo = (days) => new Date(new Date(NOW) - days * 86_400_000).toISOString();

const health = {
  org: 'KhronosGroup',
  exclude_patterns: ['registry', '^\\.github$'],
  exclude_forks: true,
  hide_stale: true,
  window_days: 365,
  active: { recent_commit_days: 90, min_commits: 12 },
  bots: ['dependabot'],
  highlights: { count: 2, activity_days: 90, min_snapshot_age_days: 7, star_gain_days: 30 },
};

const groups = [
  { id: 'vulkan', title: 'Vulkan', repos: ['MoltenVK'], patterns: ['^vulkan(?!sc)'], topics: ['vulkan'] },
  { id: 'vulkansc', title: 'Vulkan SC', patterns: ['^vulkansc'] },
  { id: 'other', title: 'Other', fallback: true },
];

const noOverrides = { include: [], exclude: [], repos: {} };

function repo(fields = {}) {
  return {
    name: 'Vulkan-Docs',
    url: 'https://github.com/KhronosGroup/Vulkan-Docs',
    description: '',
    stars: 10,
    forks: 1,
    topics: [],
    lastCommitAt: daysAgo(5),
    commitsWindow: 40,
    commitsRecent: 10,
    lastMergedPrAt: daysAgo(6),
    mergedPrsRecent: 2,
    lastReleaseAt: null,
    issuesClosedRecent: 1,
    traffic: null,
    starGain: null,
    ...fields,
  };
}

test('isBot matches the [bot] suffix and the configured list', () => {
  assert.equal(isBot('dependabot[bot]'), true);
  assert.equal(isBot('Dependabot', ['dependabot']), true);
  assert.equal(isBot('octocat', ['dependabot']), false);
  assert.equal(isBot(null), false);
});

test('private, archived, disabled and empty repositories are excluded', () => {
  for (const flag of ['isPrivate', 'isArchived', 'isDisabled', 'isEmpty']) {
    assert.ok(exclusionReason(repo({ [flag]: true }), health, noOverrides), flag);
  }
});

test('Registry repositories are excluded regardless of case or position', () => {
  for (const name of ['Vulkan-Registry', 'Registry-Root', 'glTF-Generator-Registry', 'egl-registry']) {
    assert.match(exclusionReason(repo({ name }), health, noOverrides), /registry/);
  }
});

test('forks are excluded unless included in overrides', () => {
  const fork = repo({ name: 'shaderc', isFork: true });

  assert.equal(exclusionReason(fork, health, noOverrides), 'fork');
  assert.equal(exclusionReason(fork, health, { ...noOverrides, include: ['shaderc'] }), null);
});

test('include cannot lift the private, archived or Registry rules', () => {
  const overrides = { ...noOverrides, include: ['Vulkan-Docs', 'Vulkan-Registry'] };

  assert.equal(exclusionReason(repo({ isArchived: true }), health, overrides), 'archived');
  assert.equal(exclusionReason(repo({ isPrivate: true }), health, overrides), 'private');
  assert.ok(exclusionReason(repo({ name: 'Vulkan-Registry' }), health, overrides));
});

test('exclude in overrides hides a healthy repository', () => {
  assert.ok(exclusionReason(repo(), health, { ...noOverrides, exclude: ['Vulkan-Docs'] }));
});

test('health tiers', () => {
  assert.equal(healthTier(repo(), health, NOW), 'active');
  assert.equal(healthTier(repo({ lastCommitAt: daysAgo(200), commitsWindow: 30 }), health, NOW), 'active');
  assert.equal(healthTier(repo({ lastCommitAt: daysAgo(200), commitsWindow: 3 }), health, NOW), 'maintained');
  assert.equal(
    healthTier(repo({ lastCommitAt: null, commitsWindow: 0, lastMergedPrAt: null, lastReleaseAt: daysAgo(300) }), health, NOW),
    'maintained',
  );
  assert.equal(
    healthTier(repo({ lastCommitAt: null, commitsWindow: 0, lastMergedPrAt: daysAgo(400), lastReleaseAt: daysAgo(900) }), health, NOW),
    'stale',
  );
});

test('grouping order: explicit list, pattern, topic, fallback', () => {
  assert.equal(groupFor(repo({ name: 'MoltenVK' }), groups, noOverrides).id, 'vulkan');
  assert.equal(groupFor(repo({ name: 'Vulkan-Docs' }), groups, noOverrides).id, 'vulkan');
  assert.equal(groupFor(repo({ name: 'VulkanSC-Docs' }), groups, noOverrides).id, 'vulkansc');
  assert.equal(groupFor(repo({ name: 'glslang', topics: ['vulkan'] }), groups, noOverrides).id, 'vulkan');
  assert.equal(groupFor(repo({ name: 'glslang' }), groups, noOverrides).id, 'other');
});

test('group override wins and rejects unknown groups', () => {
  const overrides = { ...noOverrides, repos: { 'Vulkan-Docs': { group: 'other' } } };

  assert.equal(groupFor(repo(), groups, overrides).id, 'other');
  assert.throws(() => groupFor(repo(), groups, { ...noOverrides, repos: { 'Vulkan-Docs': { group: 'nope' } } }));
});

test('buildSite lists healthy repositories and reports the rest', () => {
  const data = {
    generatedAt: NOW,
    repos: [
      repo({ name: 'Vulkan-Docs', stars: 5 }),
      repo({ name: 'Vulkan-Loader', stars: 50, commitsRecent: 100 }),
      repo({ name: 'Vulkan-Registry' }),
      repo({ name: 'Old-Thing', lastCommitAt: daysAgo(900), commitsWindow: 0, lastMergedPrAt: null }),
      repo({ name: 'antora-ui', isArchived: true }),
    ],
  };
  const site = buildSite(data, { health, groups, overrides: noOverrides }, NOW);
  const status = Object.fromEntries(site.report.map((entry) => [entry.name, entry.status]));

  assert.deepEqual(status, {
    'Vulkan-Docs': 'listed',
    'Vulkan-Loader': 'listed',
    'Vulkan-Registry': 'excluded',
    'Old-Thing': 'hidden',
    'antora-ui': 'excluded',
  });
  assert.deepEqual(site.groups.map((group) => group.id), ['vulkan']);
  assert.deepEqual(site.groups[0].repos.map((entry) => entry.name), ['Vulkan-Loader', 'Vulkan-Docs']);
  assert.deepEqual(site.highlights.active.map((entry) => entry.name), ['Vulkan-Loader', 'Vulkan-Docs']);
  assert.deepEqual(site.highlights.trending, []);
  assert.equal(site.stats.listed, 2);
  assert.equal(site.stats.total, 5);

  const everything = buildSite(data, { health: { ...health, hide_stale: false }, groups, overrides: noOverrides }, NOW);
  const old = everything.groups.flatMap((group) => group.repos).find((entry) => entry.name === 'Old-Thing');

  assert.equal(old.tier, 'stale');
  assert.equal(everything.stats.listed, 3);
});

test('trending combines visitors and star gain', () => {
  const data = {
    generatedAt: NOW,
    repos: [
      repo({ name: 'Vulkan-A', traffic: { uniques: 100 }, starGain: { gain: 0, days: 30 } }),
      repo({ name: 'Vulkan-B', traffic: { uniques: 60 }, starGain: { gain: 90, days: 30 } }),
      repo({ name: 'Vulkan-C', traffic: { uniques: 0 }, starGain: null }),
    ],
  };
  const site = buildSite(data, { health, groups, overrides: noOverrides }, NOW);

  assert.deepEqual(site.highlights.trending.map((entry) => entry.name), ['Vulkan-B', 'Vulkan-A']);
});

test('reduceRepo ignores bot commits and bot pull requests', () => {
  const node = {
    name: 'X',
    stargazerCount: 1,
    forkCount: 0,
    defaultBranchRef: {
      target: {
        window: {
          totalCount: 4,
          nodes: [
            { committedDate: daysAgo(1), author: { name: 'dependabot[bot]', user: null } },
            { committedDate: daysAgo(40), author: { name: 'A Person', user: { login: 'person' } } },
            { committedDate: daysAgo(50), author: { name: 'Dependabot', user: { login: 'dependabot' } } },
            { committedDate: daysAgo(300), author: { name: 'A Person', user: { login: 'person' } } },
          ],
        },
        recent: { totalCount: 2 },
      },
    },
    mergedPrs: {
      nodes: [
        { mergedAt: daysAgo(2), author: { __typename: 'Bot', login: 'renovate' } },
        { mergedAt: daysAgo(30), author: { __typename: 'User', login: 'person' } },
        { mergedAt: daysAgo(200), author: { __typename: 'User', login: 'person' } },
      ],
    },
    latestRelease: null,
    tags: { nodes: [{ target: { __typename: 'Tag', tagger: { date: daysAgo(20) } } }] },
  };
  const record = reduceRepo(node, { now: NOW, windowDays: 365, recentDays: 90, bots: ['dependabot'] });

  assert.equal(record.lastCommitAt, daysAgo(40));
  assert.equal(record.commitsWindow, 2);
  assert.equal(record.commitsRecent, 1);
  assert.equal(record.lastMergedPrAt, daysAgo(30));
  assert.equal(record.mergedPrsRecent, 1);
  assert.equal(record.mergedPrsWindow, 2);
  assert.equal(record.lastReleaseAt, daysAgo(20));
});

test('star gain baseline is the snapshot closest to the target age', () => {
  const dates = ['2026-10-01', '2026-10-19', '2026-11-14'];

  assert.deepEqual(pickBaseline(dates, NOW, { targetDays: 30, minDays: 7 }), { date: '2026-10-19', age: 29 });
  assert.equal(pickBaseline(['2026-11-14'], NOW, { targetDays: 30, minDays: 7 }), null);

  const repos = [repo({ name: 'A', stars: 120 }), repo({ name: 'B', stars: 5 })];

  attachStarGain(repos, { A: { stars: 100 } }, 29);
  assert.deepEqual(repos[0].starGain, { gain: 20, days: 29 });
  assert.equal(repos[1].starGain, null);
  assert.deepEqual(snapshotOf([repo({ name: 'A', traffic: { uniques: 3 } })]), { A: { stars: 10, forks: 1, uniques: 3 } });
});

test('the committed configuration and sample data build a page', async () => {
  const { readFileSync } = await import('node:fs');
  const data = JSON.parse(readFileSync(new URL('../data/sample.json', import.meta.url), 'utf8'));
  const site = buildSite(data, loadConfig(), data.generatedAt);
  const listed = site.groups.flatMap((group) => group.repos);

  assert.ok(listed.length > 50);
  assert.equal(listed.some((entry) => /registry/i.test(entry.name)), false);
  assert.equal(listed.some((entry) => entry.isArchived || entry.isPrivate), false);
  assert.equal(site.report.length, data.repos.length);
  assert.equal(site.stats.total, data.repos.length);
});
