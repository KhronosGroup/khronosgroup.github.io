// SPDX-FileCopyrightText: 2026 The Khronos Group, Inc.
// SPDX-License-Identifier: Apache-2.0 OR MIT

// Pure functions that turn fetched repository data into the page model.
// No I/O. Every function takes the current time as an argument.

const DAY = 86_400_000;

export function daysBetween(earlier, later) {
  return (new Date(later) - new Date(earlier)) / DAY;
}

export function isBot(name, bots = []) {
  if (!name) {
    return false;
  }

  const lower = name.toLowerCase();

  return lower.endsWith('[bot]') || bots.some((bot) => bot.toLowerCase() === lower);
}

/**
 * Why a repository can never be listed, or null.
 * Overrides cannot lift these, except the fork rule.
 */
export function exclusionReason(repo, health, overrides) {
  if (repo.isPrivate) {
    return 'private';
  }

  if (repo.isArchived) {
    return 'archived';
  }

  if (repo.isDisabled) {
    return 'disabled';
  }

  if (repo.isEmpty) {
    return 'empty';
  }

  const pattern = (health.exclude_patterns ?? []).find((source) => new RegExp(source, 'i').test(repo.name));

  if (pattern) {
    return `name matches /${pattern}/`;
  }

  if (overrides.exclude.includes(repo.name)) {
    return 'excluded in overrides.yml';
  }

  if (overrides.include.includes(repo.name)) {
    return null;
  }

  if (repo.isTemplate) {
    return 'template';
  }

  if (repo.isFork && health.exclude_forks) {
    return 'fork';
  }

  return null;
}

function within(date, days, now) {
  return Boolean(date) && daysBetween(date, now) <= days;
}

/** "active", "maintained" or "stale". */
export function healthTier(repo, health, now) {
  const window = health.window_days;
  const { recent_commit_days: recentDays, min_commits: minCommits } = health.active;

  if (within(repo.lastCommitAt, recentDays, now) || repo.commitsWindow >= minCommits) {
    return 'active';
  }

  const signals = [repo.lastCommitAt, repo.lastMergedPrAt, repo.lastReleaseAt];

  return signals.some((date) => within(date, window, now)) ? 'maintained' : 'stale';
}

export function groupFor(repo, groups, overrides) {
  const forced = overrides.repos[repo.name]?.group;

  if (forced) {
    const group = groups.find((candidate) => candidate.id === forced);

    if (!group) {
      throw new Error(`overrides.yml: unknown group "${forced}" for ${repo.name}`);
    }

    return group;
  }

  const topics = repo.topics ?? [];

  return (
    groups.find((group) => (group.repos ?? []).includes(repo.name)) ??
    groups.find((group) => (group.patterns ?? []).some((source) => new RegExp(source, 'i').test(repo.name))) ??
    groups.find((group) => (group.topics ?? []).some((topic) => topics.includes(topic))) ??
    groups.find((group) => group.fallback)
  );
}

function latest(dates) {
  return dates.filter(Boolean).sort().at(-1) ?? null;
}

function activityScore(repo) {
  return (repo.commitsRecent ?? 0) + (repo.mergedPrsRecent ?? 0) + (repo.issuesClosedRecent ?? 0);
}

function starGainPerDay(repo) {
  const gain = repo.starGain;

  return gain && gain.days > 0 ? Math.max(gain.gain, 0) / gain.days : 0;
}

/** Sum of each signal scaled to the largest value among the candidates. */
function trendingScores(repos) {
  const visitors = (repo) => repo.traffic?.uniques ?? 0;
  const maxVisitors = Math.max(0, ...repos.map(visitors));
  const maxGain = Math.max(0, ...repos.map(starGainPerDay));

  return new Map(
    repos.map((repo) => [
      repo.name,
      (maxVisitors ? visitors(repo) / maxVisitors : 0) + (maxGain ? starGainPerDay(repo) / maxGain : 0),
    ]),
  );
}

function top(repos, count, score) {
  return repos
    .map((repo) => ({ repo, value: score(repo) }))
    .filter(({ value }) => value > 0)
    .sort((a, b) => b.value - a.value || a.repo.name.localeCompare(b.repo.name))
    .slice(0, count)
    .map(({ repo }) => repo);
}

/**
 * Build the page model and the audit report.
 *
 * @param {{generatedAt: string, repos: object[]}} data output of scripts/fetch.mjs
 * @param {{health: object, groups: object[], overrides: object}} config
 * @param {Date|string} now
 */
export function buildSite(data, config, now = new Date()) {
  const { health, groups, overrides } = config;
  const report = [];
  const listed = [];

  for (const repo of data.repos) {
    const excluded = exclusionReason(repo, health, overrides);

    if (excluded) {
      report.push({ name: repo.name, status: 'excluded', reason: excluded });
      continue;
    }

    const tier = healthTier(repo, health, now);
    const forced = overrides.include.includes(repo.name);

    if (tier === 'stale' && health.hide_stale && !forced) {
      report.push({
        name: repo.name,
        status: 'hidden',
        reason: `stale: no human commit, merged pull request or release in ${health.window_days} days`,
      });
      continue;
    }

    const group = groupFor(repo, groups, overrides);
    const custom = overrides.repos[repo.name] ?? {};

    listed.push({
      ...repo,
      title: custom.title ?? repo.name,
      description: custom.description ?? repo.description ?? '',
      tier,
      group: group.id,
      lastActivityAt: latest([repo.lastCommitAt, repo.lastMergedPrAt, repo.lastReleaseAt]),
    });

    report.push({
      name: repo.name,
      status: 'listed',
      tier,
      group: group.id,
      reason: forced ? 'included in overrides.yml' : undefined,
    });
  }

  const byStars = (a, b) => b.stars - a.stars || a.name.localeCompare(b.name);
  const count = health.highlights.count;
  const trending = trendingScores(listed);

  return {
    generatedAt: data.generatedAt,
    sample: Boolean(data.sample),
    org: health.org,
    groups: groups
      .map((group) => ({ ...group, repos: listed.filter((repo) => repo.group === group.id).sort(byStars) }))
      .filter((group) => group.repos.length > 0),
    highlights: {
      starred: top(listed, count, (repo) => repo.stars),
      trending: top(listed, count, (repo) => trending.get(repo.name)),
      active: top(listed, count, activityScore),
    },
    stats: {
      total: data.repos.filter((repo) => !repo.isPrivate).length,
      listed: listed.length,
      active: listed.filter((repo) => repo.tier === 'active').length,
      stars: listed.reduce((sum, repo) => sum + repo.stars, 0),
    },
    report: report.sort((a, b) => a.name.localeCompare(b.name)),
  };
}
