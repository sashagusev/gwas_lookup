/**
 * PheWeb UKB-TOPMed API client.
 * Endpoint: https://pheweb.org/UKB-TOPMed/api/variant/{chr}:{pos}-{ref}-{alt}
 */

import { fetchJSON } from '../utils/fetch-helpers.js';

const PHEWEB_BASE = 'https://pheweb.org/UKB-TOPMed';

/**
 * Fetch phenotype associations for a variant.
 * @param {string} chr
 * @param {number} pos
 * @param {string} ref
 * @param {string} alt
 * @returns {Promise<Array>}  Array of phenotype association objects
 */
export async function getPheWAS(chr, pos, ref, alt) {
  // PheWeb uses format: chr:pos-ref-alt
  const variantStr = `${chr}:${pos}-${ref}-${alt}`;
  const url = `${PHEWEB_BASE}/api/variant/${variantStr}`;
  const data = await fetchJSON(url);

  // PheWeb returns an object with `phenos` array
  if (Array.isArray(data)) return data;
  if (data?.phenos) return data.phenos;
  return [];
}

/**
 * Build a link to the PheWeb variant page.
 */
export function getPheWebVariantUrl(chr, pos, ref, alt) {
  return `${PHEWEB_BASE}/variant/${chr}:${pos}-${ref}-${alt}`;
}

/**
 * Category color mapping for PheWAS plot-style grouping.
 */
const CATEGORY_COLORS = {
  'endocrine/metabolic': '#e6550d',
  'cardiovascular': '#e7298a',
  'respiratory': '#66a61e',
  'neurological': '#7570b3',
  'musculoskeletal': '#d95f02',
  'digestive': '#1b9e77',
  'genitourinary': '#a6761d',
  'hematopoietic': '#666666',
  'neoplasms': '#e41a1c',
  'mental disorders': '#984ea3',
  'sense organs': '#ff7f00',
  'infectious diseases': '#a65628',
  'dermatologic': '#f781bf',
  'injuries & poisonings': '#999999',
};

export function getCategoryColor(category) {
  if (!category) return '#888';
  const key = category.toLowerCase();
  for (const [cat, color] of Object.entries(CATEGORY_COLORS)) {
    if (key.includes(cat)) return color;
  }
  return '#888';
}
