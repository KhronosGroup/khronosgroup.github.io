// SPDX-FileCopyrightText: 2026 The Khronos Group, Inc.
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { existsSync, readFileSync } from 'node:fs';
import { root } from './config.mjs';

/** Load data/repos.json, or the committed sample when nothing was fetched. */
export function loadData() {
  const source = ['data/repos.json', 'data/sample.json'].find((file) => existsSync(root + file));

  return { data: JSON.parse(readFileSync(root + source, 'utf8')), source };
}
