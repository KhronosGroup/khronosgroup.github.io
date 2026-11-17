// SPDX-FileCopyrightText: 2026 The Khronos Group, Inc.
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

export const root = fileURLToPath(new URL('../../', import.meta.url));

function readYaml(name) {
  return parse(readFileSync(`${root}config/${name}`, 'utf8'));
}

export function loadConfig() {
  const overrides = readYaml('overrides.yml') ?? {};

  return {
    health: readYaml('health.yml'),
    groups: readYaml('groups.yml'),
    overrides: {
      include: overrides.include ?? [],
      exclude: overrides.exclude ?? [],
      repos: overrides.repos ?? {},
    },
  };
}
