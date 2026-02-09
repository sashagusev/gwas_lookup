/**
 * EBI eQTL Catalogue API client.
 * Docs: https://www.ebi.ac.uk/eqtl/api/docs
 *
 * Uses v3 global associations endpoint + v2 dataset metadata.
 */

import { fetchJSON } from '../utils/fetch-helpers.js';

const API_V2 = 'https://www.ebi.ac.uk/eqtl/api/v2';
const API_V3 = 'https://www.ebi.ac.uk/eqtl/api/v3';

/** Cached dataset metadata: Map<dataset_id, metadata> */
let datasetCache = null;
let datasetCachePromise = null;

/**
 * Load and cache the full dataset catalog.
 * Called once on app init; subsequent calls return the cached map.
 * @returns {Promise<Map<string, object>>}
 */
export async function loadDatasetCatalog() {
  if (datasetCache) return datasetCache;
  if (datasetCachePromise) return datasetCachePromise;

  datasetCachePromise = (async () => {
    const map = new Map();
    let start = 0;
    const size = 1000;

    while (true) {
      const url = `${API_V2}/datasets?size=${size}&start=${start}`;
      const rows = await fetchJSON(url, { timeout: 20_000 });
      if (!Array.isArray(rows) || rows.length === 0) break;

      for (const ds of rows) {
        map.set(ds.dataset_id, {
          datasetId: ds.dataset_id,
          studyId: ds.study_id,
          studyLabel: ds.study_label,
          sampleGroup: ds.sample_group,
          tissueId: ds.tissue_id,
          tissueLabel: ds.tissue_label,
          conditionLabel: ds.condition_label,
          quantMethod: ds.quant_method,
          sampleSize: ds.sample_size,
        });
      }

      if (rows.length < size) break;
      start += size;
    }

    datasetCache = map;
    return map;
  })();

  return datasetCachePromise;
}

/**
 * Fetch eQTL associations for a variant from the eQTL Catalogue.
 * Queries v3 global endpoint, paginates, joins with dataset metadata,
 * and filters to gene expression (quant_method === "ge").
 *
 * @param {string} rsid  e.g. "rs7903146"
 * @returns {Promise<Array>}  Enriched association objects
 */
export async function getEqtlCatalogueAssociations(rsid) {
  const catalog = await loadDatasetCatalog();

  const allResults = [];
  let start = 0;
  const size = 1000;
  const maxPages = 5; // safety cap

  for (let page = 0; page < maxPages; page++) {
    const url = `${API_V3}/associations?rsid=${encodeURIComponent(rsid)}&size=${size}&start=${start}`;
    const rows = await fetchJSON(url, { timeout: 20_000 });
    if (!Array.isArray(rows) || rows.length === 0) break;
    allResults.push(...rows);
    if (rows.length < size) break;
    start += size;
  }

  // Join with metadata and filter to gene expression
  const enriched = [];
  for (const assoc of allResults) {
    const meta = catalog.get(assoc.dataset_id);
    // Filter: only gene expression quantification
    if (meta?.quantMethod !== 'ge') continue;

    enriched.push({
      gene: assoc.gene_id,
      rsid: assoc.rsid,
      chromosome: assoc.chromosome,
      position: assoc.position,
      ref: assoc.ref,
      alt: assoc.alt,
      pvalue: assoc.pvalue,
      beta: assoc.beta,
      se: assoc.se,
      datasetId: assoc.dataset_id,
      studyId: assoc.study_id,
      studyLabel: meta?.studyLabel || assoc.study_id || '–',
      tissueLabel: meta?.tissueLabel || meta?.sampleGroup || '–',
      conditionLabel: meta?.conditionLabel || '',
      sampleSize: meta?.sampleSize || null,
    });
  }

  return enriched;
}

/**
 * Build a link to the eQTL Catalogue variant page.
 */
export function getEqtlCatalogueVariantUrl(rsid) {
  return `https://www.ebi.ac.uk/eqtl/Variants/${rsid}`;
}
