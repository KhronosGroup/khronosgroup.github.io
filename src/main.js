// SPDX-FileCopyrightText: 2026 The Khronos Group, Inc.
// SPDX-License-Identifier: Apache-2.0 OR MIT

// Filters the repository directory as the visitor types.

const input = document.querySelector('[data-filter]');
const empty = document.querySelector('[data-filter-empty]');
const groups = [...document.querySelectorAll('[data-group]')];

function applyFilter() {
  const terms = input.value.toLowerCase().split(/\s+/).filter(Boolean);
  let shown = 0;

  for (const group of groups) {
    let visible = 0;

    for (const card of group.querySelectorAll('[data-repo]')) {
      const match = terms.every((term) => card.dataset.repo.includes(term));

      card.hidden = !match;
      visible += match;
    }

    group.hidden = visible === 0;
    shown += visible;
  }

  empty.hidden = shown > 0;
}

if (input) {
  input.addEventListener('input', applyFilter);
  applyFilter();
}
