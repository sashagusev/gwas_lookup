/**
 * Sortable, filterable table component.
 * Pure DOM — no framework dependencies.
 */

/**
 * Create a sortable, filterable data table.
 *
 * @param {object} options
 * @param {Array<{key: string, label: string, numeric?: boolean, format?: function}>} options.columns
 * @param {Array<object>} options.data  Row data
 * @param {string} [options.defaultSortKey]  Column key for initial sort
 * @param {boolean} [options.defaultSortAsc]  Initial sort direction (default false = desc)
 * @param {number} [options.initialLimit]  Show this many rows initially (default 20)
 * @param {boolean} [options.filterable]  Show text filter (default true)
 * @param {string} [options.filterPlaceholder]  Placeholder text
 * @param {Array<string>} [options.categoryOptions]  If provided, show a category dropdown
 * @param {string} [options.categoryKey]  Key in data for category filtering
 * @returns {HTMLElement}
 */
export function createSortableTable({
  columns,
  data,
  defaultSortKey = null,
  defaultSortAsc = false,
  initialLimit = 10,
  filterable = true,
  filterPlaceholder = 'Filter results…',
  categoryOptions = null,
  categoryKey = null,
}) {
  const container = document.createElement('div');

  let sortKey = defaultSortKey || (columns[0]?.key ?? null);
  let sortAsc = defaultSortAsc;
  let filterText = '';
  let categoryFilter = '';
  let showAll = data.length <= initialLimit;

  // ── Controls ──
  if (filterable || categoryOptions) {
    const controls = document.createElement('div');
    controls.className = 'table-controls';

    if (filterable) {
      const filterInput = document.createElement('input');
      filterInput.type = 'text';
      filterInput.className = 'table-filter-input';
      filterInput.placeholder = filterPlaceholder;
      filterInput.addEventListener('input', () => {
        filterText = filterInput.value.toLowerCase();
        render();
      });
      controls.appendChild(filterInput);
    }

    if (categoryOptions && categoryKey) {
      const select = document.createElement('select');
      select.className = 'table-filter-select';
      const allOpt = document.createElement('option');
      allOpt.value = '';
      allOpt.textContent = 'All categories';
      select.appendChild(allOpt);
      for (const cat of categoryOptions) {
        const opt = document.createElement('option');
        opt.value = cat;
        opt.textContent = cat;
        select.appendChild(opt);
      }
      select.addEventListener('change', () => {
        categoryFilter = select.value;
        render();
      });
      controls.appendChild(select);
    }

    container.appendChild(controls);
  }

  // ── Table wrapper ──
  const wrapper = document.createElement('div');
  wrapper.className = 'table-wrapper';
  container.appendChild(wrapper);

  // ── Show more container ──
  const showMoreWrapper = document.createElement('div');
  showMoreWrapper.className = 'show-more-wrapper';
  container.appendChild(showMoreWrapper);

  function getFilteredSorted() {
    let rows = [...data];

    // Category filter
    if (categoryFilter && categoryKey) {
      rows = rows.filter(r => r[categoryKey] === categoryFilter);
    }

    // Text filter
    if (filterText) {
      rows = rows.filter(row =>
        columns.some(col => {
          const val = row[col.key];
          if (val == null) return false;
          return String(val).toLowerCase().includes(filterText);
        })
      );
    }

    // Sort
    if (sortKey) {
      const col = columns.find(c => c.key === sortKey);
      rows.sort((a, b) => {
        let va = a[sortKey];
        let vb = b[sortKey];

        if (va == null && vb == null) return 0;
        if (va == null) return 1;
        if (vb == null) return -1;

        if (col?.numeric) {
          va = Number(va);
          vb = Number(vb);
          if (isNaN(va)) return 1;
          if (isNaN(vb)) return -1;
        } else {
          va = String(va).toLowerCase();
          vb = String(vb).toLowerCase();
        }

        if (va < vb) return sortAsc ? -1 : 1;
        if (va > vb) return sortAsc ? 1 : -1;
        return 0;
      });
    }

    return rows;
  }

  function render() {
    const rows = getFilteredSorted();
    const displayRows = showAll ? rows : rows.slice(0, initialLimit);

    // Build table
    const table = document.createElement('table');
    table.className = 'data-table';

    // Thead
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    for (const col of columns) {
      const th = document.createElement('th');
      if (col.numeric) th.className = 'num';
      th.innerHTML = `${col.label} <span class="sort-indicator ${sortKey === col.key ? 'active' : ''}">${
        sortKey === col.key ? (sortAsc ? '▲' : '▼') : '⇅'
      }</span>`;
      th.addEventListener('click', () => {
        if (sortKey === col.key) {
          sortAsc = !sortAsc;
        } else {
          sortKey = col.key;
          // Numeric columns default ascending (smallest first — best for p-values);
          // text columns default ascending (A-Z)
          sortAsc = true;
        }
        render();
      });
      headerRow.appendChild(th);
    }
    thead.appendChild(headerRow);
    table.appendChild(thead);

    // Tbody
    const tbody = document.createElement('tbody');
    for (const row of displayRows) {
      const tr = document.createElement('tr');
      for (const col of columns) {
        const td = document.createElement('td');
        if (col.numeric) td.className = 'num';

        const val = row[col.key];
        if (col.format) {
          const formatted = col.format(val, row);
          if (typeof formatted === 'string') {
            td.innerHTML = formatted;
          } else if (formatted instanceof Node) {
            td.appendChild(formatted);
          } else {
            td.textContent = formatted ?? '';
          }
        } else {
          td.textContent = val ?? '';
        }

        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);

    wrapper.innerHTML = '';
    wrapper.appendChild(table);

    // Show more button
    showMoreWrapper.innerHTML = '';
    if (!showAll && rows.length > initialLimit) {
      const btn = document.createElement('button');
      btn.className = 'show-more-button';
      btn.textContent = `Show all ${rows.length} results`;
      btn.addEventListener('click', () => {
        showAll = true;
        render();
      });
      showMoreWrapper.appendChild(btn);
    }

    // Empty state
    if (displayRows.length === 0) {
      wrapper.innerHTML = '<div class="empty-state">No results match your filter.</div>';
    }
  }

  render();
  return container;
}

/**
 * Format a p-value for display.
 * Returns HTML string with significance highlighting.
 */
export function formatPValue(pval) {
  if (pval == null || isNaN(pval)) return '–';
  const significant = pval < 5e-8;
  const formatted = pval < 0.001 ? pval.toExponential(1) : pval.toPrecision(3);
  return significant
    ? `<span class="pval-significant">${formatted}</span>`
    : formatted;
}

/**
 * Format a p-value from mantissa and exponent (Open Targets style).
 */
export function formatPValueMantissaExp(mantissa, exponent) {
  if (mantissa == null || exponent == null) return '–';
  const pval = mantissa * Math.pow(10, exponent);
  return formatPValue(pval);
}

/**
 * Compute numeric p-value from mantissa/exponent.
 */
export function pvalFromMantissaExp(mantissa, exponent) {
  if (mantissa == null || exponent == null) return null;
  return mantissa * Math.pow(10, exponent);
}

/**
 * Format a number to fixed decimals, handling nulls.
 */
export function formatNumber(val, decimals = 3) {
  if (val == null || isNaN(val)) return '–';
  return Number(val).toFixed(decimals);
}
