/**
 * DOM rendering helpers: loading states, error states, cards.
 */

/**
 * Show a loading skeleton in a section.
 */
export function showLoading(sectionId) {
  const el = document.getElementById(sectionId);
  if (!el) return;
  el.innerHTML = `
    <div class="skeleton-table">
      <div class="skeleton-row"></div>
      <div class="skeleton-row"></div>
      <div class="skeleton-row"></div>
      <div class="skeleton-row"></div>
      <div class="skeleton-row"></div>
    </div>
  `;
}

/**
 * Show an error state with a retry button.
 * @param {string} sectionId  Content element id
 * @param {string} message    Error message to display
 * @param {function} onRetry  Callback for retry button
 */
export function showError(sectionId, message, onRetry) {
  const el = document.getElementById(sectionId);
  if (!el) return;

  const wrapper = document.createElement('div');
  wrapper.className = 'section-error';

  const msg = document.createElement('span');
  msg.className = 'error-message';
  msg.textContent = message;
  wrapper.appendChild(msg);

  if (onRetry) {
    const btn = document.createElement('button');
    btn.className = 'retry-button';
    btn.textContent = 'Retry';
    btn.addEventListener('click', onRetry);
    wrapper.appendChild(btn);
  }

  el.innerHTML = '';
  el.appendChild(wrapper);
}

/**
 * Show an empty state message.
 */
export function showEmpty(sectionId, message = 'No data available for this variant.') {
  const el = document.getElementById(sectionId);
  if (!el) return;
  el.innerHTML = `<div class="empty-state">${message}</div>`;
}

/**
 * Set content of a section to a DOM element.
 */
export function setContent(sectionId, element) {
  const el = document.getElementById(sectionId);
  if (!el) return;
  el.innerHTML = '';
  if (typeof element === 'string') {
    el.innerHTML = element;
  } else {
    el.appendChild(element);
  }
}

/**
 * Update the variant summary card.
 */
export function updateSummary({ rsid, chr, pos, ref, alt, gene, pos37, chr37 }) {
  const summary = document.getElementById('variant-card');
  summary.classList.remove('hidden');

  document.getElementById('summary-rsid').textContent = rsid || '–';
  document.getElementById('summary-alleles').textContent =
    ref && alt ? `${ref}>${alt}` : '';

  const geneEl = document.getElementById('summary-gene');
  if (gene) {
    geneEl.textContent = gene;
    geneEl.classList.remove('hidden');
  } else {
    geneEl.textContent = '';
    geneEl.classList.add('hidden');
  }

  // Positions (now inline in the summary card row)
  document.getElementById('summary-position-38').textContent =
    chr && pos ? `chr${chr}:${pos}` : '–';

  const pos37El = document.getElementById('summary-position-37');
  pos37El.textContent =
    (chr37 || chr) && pos37 ? `chr${chr37 || chr}:${pos37}` : '–';
}

/**
 * Show/hide the main results container and nav.
 */
export function showResults(visible) {
  const container = document.getElementById('results-container');
  const nav = document.getElementById('section-nav');
  const card = document.getElementById('variant-card');
  if (visible) {
    container.classList.remove('hidden');
    nav.classList.remove('hidden');
    if (card) card.classList.remove('hidden');
  } else {
    container.classList.add('hidden');
    nav.classList.add('hidden');
    if (card) card.classList.add('hidden');
  }
}

/**
 * Show a global error banner.
 */
export function showGlobalError(message) {
  const banner = document.getElementById('error-banner');
  banner.textContent = message;
  banner.classList.remove('hidden');
}

/**
 * Hide the global error banner.
 */
export function hideGlobalError() {
  const banner = document.getElementById('error-banner');
  banner.classList.add('hidden');
  banner.textContent = '';
}

/**
 * Create an allele frequency bar visualization.
 */
export function createFreqBars(frequencies) {
  const container = document.createElement('div');

  if (!frequencies || frequencies.length === 0) {
    container.innerHTML = '<span class="empty-state" style="padding:8px 0">No allele frequency data available.</span>';
    return container;
  }

  // Target populations with display labels
  const popMap = [
    { key: 'nfe_adj', label: 'European (NF)' },
    { key: 'eas_adj', label: 'East Asian' },
    { key: 'sas_adj', label: 'South Asian' },
    { key: 'mid_adj', label: 'Middle Eastern' },
    { key: 'afr_adj', label: 'African' },
  ];

  const freqByName = new Map(frequencies.map(f => [f.populationName, f.alleleFrequency]));
  const popsToShow = popMap
    .filter(p => freqByName.has(p.key))
    .map(p => ({ label: p.label, key: p.key, af: freqByName.get(p.key) }));

  if (popsToShow.length === 0) {
    // Fallback: show first 5 with raw names
    for (const freq of frequencies.slice(0, 5)) {
      popsToShow.push({ label: freq.populationName || 'Unknown', key: freq.populationName, af: freq.alleleFrequency });
    }
  }

  for (const pop of popsToShow) {
    const row = document.createElement('div');
    row.className = 'freq-bar-container';

    const label = document.createElement('span');
    label.className = 'freq-bar-label';
    label.textContent = pop.label;
    label.title = pop.key;

    const track = document.createElement('div');
    track.className = 'freq-bar-track';

    const fill = document.createElement('div');
    fill.className = 'freq-bar-fill';
    const pct = Math.min((pop.af || 0) * 100, 100);
    fill.style.width = `${pct}%`;
    track.appendChild(fill);

    const value = document.createElement('span');
    value.className = 'freq-bar-value';
    value.textContent = pop.af != null
      ? (pop.af < 0.001
        ? pop.af.toExponential(1)
        : pop.af.toFixed(4))
      : '–';

    row.appendChild(label);
    row.appendChild(track);
    row.appendChild(value);
    container.appendChild(row);
  }

  return container;
}
