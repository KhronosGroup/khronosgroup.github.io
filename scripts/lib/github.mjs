// SPDX-FileCopyrightText: 2026 The Khronos Group, Inc.
// SPDX-License-Identifier: Apache-2.0 OR MIT

// GitHub API access and reduction of raw API nodes to compact repository records.

import { isBot } from './score.mjs';

const API = 'https://api.github.com';
const DAY = 86_400_000;

const QUERY = `
query ($org: String!, $cursor: String, $sinceWindow: GitTimestamp!, $sinceRecent: GitTimestamp!, $sinceRecentDate: DateTime!) {
  organization(login: $org) {
    repositories(first: 10, after: $cursor, privacy: PUBLIC, orderBy: { field: NAME, direction: ASC }) {
      pageInfo { hasNextPage endCursor }
      nodes {
        name url description homepageUrl
        isPrivate isArchived isDisabled isEmpty isFork isTemplate
        stargazerCount forkCount pushedAt
        primaryLanguage { name }
        licenseInfo { spdxId }
        repositoryTopics(first: 20) { nodes { topic { name } } }
        defaultBranchRef {
          target {
            ... on Commit {
              window: history(first: 100, since: $sinceWindow) {
                totalCount
                nodes { committedDate author { name user { login } } }
              }
              recent: history(since: $sinceRecent) { totalCount }
            }
          }
        }
        mergedPrs: pullRequests(states: MERGED, first: 100, orderBy: { field: UPDATED_AT, direction: DESC }) {
          nodes { mergedAt author { __typename login } }
        }
        latestRelease { publishedAt }
        tags: refs(refPrefix: "refs/tags/", first: 1, orderBy: { field: TAG_COMMIT_DATE, direction: DESC }) {
          nodes { target { __typename ... on Commit { committedDate } ... on Tag { tagger { date } } } }
        }
        openIssues: issues(states: OPEN) { totalCount }
        closedIssues: issues(states: CLOSED, filterBy: { since: $sinceRecentDate }) { totalCount }
      }
    }
  }
}`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function request(path, token, init = {}, attempt = 1) {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'User-Agent': 'khronosgroup.github.io-build',
      'X-GitHub-Api-Version': '2022-11-28',
      ...init.headers,
    },
  });

  const retryable = response.status >= 500 || response.status === 429 || response.headers.get('retry-after');

  if (retryable && attempt < 4) {
    await sleep(Number(response.headers.get('retry-after') ?? 2 ** attempt) * 1000);

    return request(path, token, init, attempt + 1);
  }

  return response;
}

async function graphql(token, variables, attempt = 1) {
  const response = await request('/graphql', token, {
    method: 'POST',
    body: JSON.stringify({ query: QUERY, variables }),
  });
  const body = await response.json().catch(() => ({}));

  if (response.ok && !body.errors) {
    return body.data;
  }

  // GraphQL reports timeouts as errors on an HTTP 200 response.
  if (attempt < 3) {
    await sleep(2000 * attempt);

    return graphql(token, variables, attempt + 1);
  }

  throw new Error(`GraphQL request failed (${response.status}): ${JSON.stringify(body.errors ?? body)}`);
}

/** Reduce one GraphQL repository node to the record stored in data/repos.json. */
export function reduceRepo(node, { now, windowDays, recentDays, bots }) {
  const recentCutoff = new Date(now) - recentDays * DAY;
  const windowCutoff = new Date(now) - windowDays * DAY;
  const history = node.defaultBranchRef?.target?.window;
  const commits = history?.nodes ?? [];
  const human = commits.filter((commit) => !isBot(commit.author?.user?.login ?? commit.author?.name, bots));

  // Only the latest 100 commits carry authors. Counts beyond that are
  // estimated from the share of human commits in the sample.
  const humanShare = commits.length ? human.length / commits.length : 0;
  const totalRecent = node.defaultBranchRef?.target?.recent?.totalCount ?? 0;

  const merged = (node.mergedPrs?.nodes ?? []).filter(
    (pr) => pr.mergedAt && pr.author?.__typename !== 'Bot' && !isBot(pr.author?.login, bots),
  );
  const mergedDates = merged.map((pr) => pr.mergedAt).sort();

  const tag = node.tags?.nodes?.[0]?.target;
  const releaseDates = [node.latestRelease?.publishedAt, tag?.committedDate, tag?.tagger?.date].filter(Boolean).sort();

  return {
    name: node.name,
    url: node.url,
    description: node.description ?? '',
    homepageUrl: node.homepageUrl || null,
    isPrivate: node.isPrivate,
    isArchived: node.isArchived,
    isDisabled: node.isDisabled,
    isEmpty: node.isEmpty,
    isFork: node.isFork,
    isTemplate: node.isTemplate,
    stars: node.stargazerCount,
    forks: node.forkCount,
    language: node.primaryLanguage?.name ?? null,
    license: node.licenseInfo?.spdxId ?? null,
    topics: (node.repositoryTopics?.nodes ?? []).map((entry) => entry.topic.name),
    pushedAt: node.pushedAt,
    lastCommitAt: human[0]?.committedDate ?? null,
    commitsWindow: Math.round((history?.totalCount ?? 0) * humanShare),
    commitsRecent: Math.round(totalRecent * humanShare),
    lastMergedPrAt: mergedDates.at(-1) ?? null,
    mergedPrsWindow: mergedDates.filter((date) => new Date(date) >= windowCutoff).length,
    mergedPrsRecent: mergedDates.filter((date) => new Date(date) >= recentCutoff).length,
    lastReleaseAt: releaseDates.at(-1) ?? null,
    openIssues: node.openIssues?.totalCount ?? 0,
    issuesClosedRecent: node.closedIssues?.totalCount ?? 0,
    traffic: null,
    starGain: null,
  };
}

export async function fetchRepos(token, { org, now, windowDays, recentDays, bots, onPage }) {
  const variables = {
    org,
    sinceWindow: new Date(new Date(now) - windowDays * DAY).toISOString(),
    sinceRecent: new Date(new Date(now) - recentDays * DAY).toISOString(),
  };
  variables.sinceRecentDate = variables.sinceRecent;

  const repos = [];
  let cursor = null;

  do {
    const data = await graphql(token, { ...variables, cursor });
    const page = data.organization.repositories;

    repos.push(...page.nodes.map((node) => reduceRepo(node, { now, windowDays, recentDays, bots })));
    cursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
    onPage?.(repos.length);
  } while (cursor);

  return repos;
}

async function trafficFor(token, org, name) {
  const [views, clones] = await Promise.all(
    ['views', 'clones'].map((kind) => request(`/repos/${org}/${name}/traffic/${kind}`, token)),
  );

  if (!views.ok || !clones.ok) {
    return { status: views.ok ? clones.status : views.status };
  }

  const [viewData, cloneData] = [await views.json(), await clones.json()];

  return {
    status: 200,
    traffic: {
      views: viewData.count,
      uniques: viewData.uniques,
      clones: cloneData.count,
      cloners: cloneData.uniques,
    },
  };
}

/**
 * Attach 14 day traffic to each repository, in place.
 * The traffic endpoints need Administration read access. Returns false when
 * the token lacks it, leaving every `traffic` field null.
 */
export async function attachTraffic(token, org, repos) {
  if (repos.length === 0) {
    return false;
  }

  const probe = await trafficFor(token, org, repos[0].name);

  if (probe.status !== 200) {
    return false;
  }

  repos[0].traffic = probe.traffic;

  const queue = repos.slice(1);
  const worker = async () => {
    for (let repo = queue.shift(); repo; repo = queue.shift()) {
      const result = await trafficFor(token, org, repo.name);

      repo.traffic = result.traffic ?? null;
    }
  };

  await Promise.all(Array.from({ length: 4 }, worker));

  return true;
}
