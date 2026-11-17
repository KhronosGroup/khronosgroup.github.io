<!--
SPDX-FileCopyrightText: 2017 The Khronos Group, Inc.
SPDX-License-Identifier: Apache-2.0 OR MIT
-->

# khronosgroup.github.io

Source of https://github.khronos.org/, a directory of the public open source repositories of the [KhronosGroup](https://github.com/KhronosGroup) GitHub organization.

The page is generated from the GitHub API. Repository lists are not edited by hand. Pull requests are welcome from all.

## Requirements

Node.js 22 or later.

## Commands

| Command | Result |
| --- | --- |
| `npm ci` | Install dependencies. |
| `npm run build` | Fetch repository data, then build the site into `dist/`. |
| `npm run dev` | Start the Vite dev server with live reload. |
| `npm run fetch` | Refresh `data/repos.json` from the GitHub API. |
| `npm run bundle` | Build `dist/` from the data already on disk. |
| `npm run preview` | Serve `dist/`. |
| `npm run report` | Print every excluded repository and the reason. Add `-- --all` for all repositories. |
| `npm test` | Run the unit tests. |

`npm run fetch` reads a GitHub token from `GH_TOKEN`:

```sh
GH_TOKEN=$(gh auth token) npm run build
```

Without `GH_TOKEN` the build uses the last fetched `data/repos.json`, or the committed `data/sample.json`. A page built from the sample shows a "Built from sample data" notice.

## How the page is built

1. `scripts/fetch.mjs` queries every public repository of the organization and writes `data/repos.json`.
2. `scripts/lib/score.mjs` applies the exclusions, the health rule, the grouping and the rankings.
3. Vite renders `index.html` and `src/templates/page.njk` with that result, and compiles `src/styles/app.css` with Tailwind CSS.

`dist/report.json` lists every repository with its status (`listed`, `hidden` or `excluded`) and the reason.

## Which repositories are listed

### Exclusions

A repository is never listed when it is private, archived, disabled or empty, or when its name matches a pattern in `exclude_patterns` (`registry`, `.github`). Templates and forks are excluded unless named under `include` in `config/overrides.yml`.

The "Public repositories" figure at the top of the page counts every public repository of the organization, including the excluded ones.

New repositories appear at the next build. `config/groups.yml` assigns them to a standard by name or topic. A repository that matches no rule goes to "Other".

### Health tiers

Every repository that is not excluded is listed. The tier sets the marker on its card. Set `hide_stale: true` in `config/health.yml` to hide the Stale tier.

The tiers use the trailing 365 days. Commits and pull requests by bots do not count.

| Tier | Condition | Card |
| --- | --- | --- |
| Active | A human commit on the default branch in the last 90 days, or 12 or more human commits in 365 days. | "Active" marker. |
| Maintained | A human commit, a merged pull request, or a release or tag in 365 days. | Month of last activity. |
| Stale | None of the above. | Month of last activity. |

Thresholds and the bot list are in `config/health.yml`.

### Highlights

| List | Ranking |
| --- | --- |
| Most starred | Total stars. |
| Trending | Unique visitors over 14 days plus star gain over about 30 days, each scaled to the highest value. Omitted when neither is available. |
| Most active | Human commits, merged pull requests and closed issues over 90 days. |

Commit counts beyond the latest 100 commits are estimated from the share of human commits in those 100.

## Configuration

| File | Purpose |
| --- | --- |
| `config/health.yml` | Exclusion patterns, health thresholds, bot list, highlight settings. |
| `config/groups.yml` | Standards, their order, logo, link, and the rules that assign repositories to them. |
| `config/overrides.yml` | Force a repository in or out, move it to another group, or replace its title or description. |

Run `npm run report` after editing a configuration file.

## Deployment

`.github/workflows/build.yml` builds on every push to `main`, daily at 05:17 UTC, and on manual dispatch, then deploys `dist/` to GitHub Pages. Pull requests build from `data/sample.json` and upload `dist/` as the `site-preview` artifact, without deploying.

The repository setting Pages > Source must be "GitHub Actions".

### Traffic and the GitHub App

The traffic endpoints of the GitHub API require Administration read access to each repository. The workflow obtains it from a GitHub App installed on the organization:

1. Create a GitHub App owned by KhronosGroup with the repository permissions Administration (read) and Metadata (read). No webhook.
2. Install it on the organization.
3. Add the App client ID as the repository variable `APP_CLIENT_ID`.
4. Add a private key of the App as the repository secret `APP_PRIVATE_KEY`.

Without the secret the workflow uses its own token. The page then has no traffic data, and Trending relies on star gain alone.

Raw traffic numbers are not published. They affect only the order of the Trending list.

### Snapshot history

GitHub keeps traffic for 14 days and has no star history. Each scheduled run stores stars, forks and traffic per repository as `YYYY-MM-DD.json` on the `data` branch. Star gain is measured against the snapshot closest to 30 days old, and needs one at least 7 days old.

## License

Apache-2.0 OR MIT, copyright The Khronos Group, Inc., except where a file or `REUSE.toml` states otherwise. The logos in `public/images/` are CC-BY-ND-4.0. License texts are in `LICENSES/`. The repository follows the [REUSE](https://reuse.software/) specification. Check with `reuse lint`.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) and the [Khronos Code of Conduct](https://www.khronos.org/developers/code-of-conduct).
