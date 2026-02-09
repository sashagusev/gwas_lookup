/**
 * GWAS Lookup — Main orchestration.
 *
 * Entry point: handles search flow, variant resolution,
 * parallel data fetching, rendering, and URL state.
 */

import { parseVariantId, toVariantId } from './utils/parse-input.js';
import { resolveRsidBothBuilds, resolvePositionBothBuilds } from './api/dbsnp.js';
import { searchVariant, getVariantDetails, getGeneDiseases, extractTopGenes, extractOmimLinks } from './api/opentargets.js';
import { getEqtls, getGtexVariantUrl, formatTissueName } from './api/gtex.js';
import { getPheWAS, getPheWebVariantUrl } from './api/pheweb.js';
import { getBBJPheWAS, getBBJVariantUrl } from './api/pheweb-bbj.js';
import { getFinnGenPheWAS, getFinnGenVariantUrl } from './api/finngen.js';
import { loadDatasetCatalog, getEqtlCatalogueAssociations, getEqtlCatalogueVariantUrl } from './api/eqtl-catalogue.js';
import { getVepAnnotationByRsid, getVepAnnotationByRegion, extractVepScores } from './api/ensembl-vep.js';
import {
  showLoading, showError, showEmpty, setContent,
  updateSummary, showResults, showGlobalError, hideGlobalError,
  createFreqBars,
} from './ui/render.js';
import {
  createSortableTable, formatPValue,
  pvalFromMantissaExp, formatNumber,
} from './ui/tables.js';

// ── Position parsing regex ───────────────────────────────
const POS_RE = /^(?:chr)?(\d{1,2}|[XY]):(\d+)$/i;

function parsePositionStr(str) {
  const input = str.trim();
  if (!input) return null;
  const m = input.match(POS_RE);
  if (m) return { chr: m[1].toUpperCase(), pos: parseInt(m[2], 10) };
  return null;
}

// ── DOM refs ────────────────────────────────────────────
const searchForm = document.getElementById('search-form');
const rsidInput = document.getElementById('rsid-input');
const positionInput = document.getElementById('position-input');
const buildSelect = document.getElementById('build-select');
const searchButton = document.getElementById('search-button');

// ── Current state ───────────────────────────────────────
let currentVariant = null;  // { chr, pos, ref, alt, rsid, chr37, pos37, ... }
let _hashSetByUs = false;   // prevent re-entrant hashchange

// ── Init ────────────────────────────────────────────────
function init() {
  // Preload eQTL Catalogue dataset metadata (non-blocking)
  loadDatasetCatalog().catch(err => console.warn('Failed to preload eQTL Catalogue metadata:', err));

  searchForm.addEventListener('submit', onSearchSubmit);

  // Clear the other field when user types
  rsidInput.addEventListener('input', () => { positionInput.value = ''; });
  positionInput.addEventListener('input', () => { rsidInput.value = ''; });

  // Example links
  document.querySelectorAll('.example-link').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      if (link.dataset.rsid) {
        rsidInput.value = link.dataset.rsid;
        positionInput.value = '';
        setHash(`rsid=${encodeURIComponent(link.dataset.rsid)}`);
        doSearch({ type: 'rsid', rsid: link.dataset.rsid.toLowerCase() });
      } else if (link.dataset.position) {
        positionInput.value = link.dataset.position;
        rsidInput.value = '';
        const build = link.dataset.build || 'hg38';
        buildSelect.value = build;
        setHash(`pos=${encodeURIComponent(link.dataset.position)}&build=${build}`);
        doSearch({ type: 'position', positionStr: link.dataset.position, build });
      }
    });
  });

  // Section nav scroll
  document.querySelectorAll('.nav-tab').forEach(tab => {
    tab.addEventListener('click', (e) => {
      e.preventDefault();
      const sectionId = `section-${tab.dataset.section}`;
      const section = document.getElementById(sectionId);
      if (section) {
        const navHeight = document.getElementById('section-nav')?.offsetHeight || 0;
        const top = section.getBoundingClientRect().top + window.scrollY - navHeight - 8;
        window.scrollTo({ top, behavior: 'smooth' });
      }
      // Update active state
      document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
    });
  });

  // Sticky nav shadow on scroll
  const nav = document.getElementById('section-nav');
  if (nav) {
    const observer = new IntersectionObserver(
      ([entry]) => {
        nav.classList.toggle('stuck', !entry.isIntersecting);
      },
      { threshold: 1.0 }
    );
    // Create a sentinel element right above the nav
    const sentinel = document.createElement('div');
    sentinel.style.height = '1px';
    sentinel.style.marginBottom = '-1px';
    nav.parentNode.insertBefore(sentinel, nav);
    observer.observe(sentinel);
  }

  // Scroll spy: update active nav tab based on which section is in view
  setupScrollSpy();

  // Handle URL hash on load and on change
  handleHash();
  window.addEventListener('hashchange', handleHash);
}

function setupScrollSpy() {
  const nav = document.getElementById('section-nav');
  if (!nav) return;

  const tabs = [...nav.querySelectorAll('.nav-tab')];
  const sectionIds = tabs.map(t => `section-${t.dataset.section}`);

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          const idx = sectionIds.indexOf(entry.target.id);
          if (idx !== -1) {
            tabs.forEach(t => t.classList.remove('active'));
            tabs[idx].classList.add('active');
          }
        }
      }
    },
    {
      rootMargin: '-20% 0px -60% 0px',
    }
  );

  // Start observing once sections exist; re-observe when results are shown
  const resultsContainer = document.getElementById('results-container');
  const observeAll = () => {
    for (const id of sectionIds) {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    }
  };

  // Use a MutationObserver to detect when results become visible
  const mo = new MutationObserver(() => {
    if (!resultsContainer.classList.contains('hidden')) {
      observeAll();
    }
  });
  mo.observe(resultsContainer, { attributes: true, attributeFilter: ['class'] });
}

// ── URL hash helpers ─────────────────────────────────────
function setHash(h) {
  _hashSetByUs = true;
  window.location.hash = h;
}

function handleHash() {
  if (_hashSetByUs) { _hashSetByUs = false; return; }
  const hash = window.location.hash.replace(/^#/, '');
  if (!hash) return;

  const params = new URLSearchParams(hash);

  if (params.has('rsid')) {
    const rsid = params.get('rsid');
    rsidInput.value = rsid;
    positionInput.value = '';
    doSearch({ type: 'rsid', rsid: rsid.toLowerCase() });
  } else if (params.has('pos')) {
    const pos = params.get('pos');
    const build = params.get('build') || 'hg38';
    positionInput.value = pos;
    rsidInput.value = '';
    buildSelect.value = build;
    doSearch({ type: 'position', positionStr: pos, build });
  } else if (params.has('variant')) {
    // Legacy format support: #variant=rs7903146 or #variant=chr10:112998590
    const query = params.get('variant');
    if (/^rs\d+$/i.test(query)) {
      rsidInput.value = query;
      positionInput.value = '';
      doSearch({ type: 'rsid', rsid: query.toLowerCase() });
    } else {
      positionInput.value = query;
      rsidInput.value = '';
      doSearch({ type: 'position', positionStr: query, build: 'hg38' });
    }
  }
}

// ── Search handler ──────────────────────────────────────
function onSearchSubmit(e) {
  e.preventDefault();

  const rsid = rsidInput.value.trim();
  const position = positionInput.value.trim();
  const build = buildSelect.value;

  if (rsid) {
    if (!/^rs\d+$/i.test(rsid)) {
      showGlobalError('Invalid rsID format. Expected format: rs7903146');
      return;
    }
    setHash(`rsid=${encodeURIComponent(rsid.toLowerCase())}`);
    doSearch({ type: 'rsid', rsid: rsid.toLowerCase() });
  } else if (position) {
    const posMatch = parsePositionStr(position);
    if (!posMatch) {
      showGlobalError('Invalid position format. Expected: chr10:112998590');
      return;
    }
    setHash(`pos=${encodeURIComponent(position)}&build=${build}`);
    doSearch({ type: 'position', positionStr: position, build });
  } else {
    showGlobalError('Please enter an rsID or a genomic position.');
  }
}

// ── Main search flow ────────────────────────────────────
let _lastSearchId = 0;

async function doSearch(input) {
  const searchId = ++_lastSearchId;

  hideGlobalError();
  setSearchLoading(true);

  // Show results area with loading skeletons
  showResults(true);
  showLoading('vep-content');
  showLoading('annotation-content');
  showLoading('credible-sets-content');
  showLoading('phewas-content');
  showLoading('phewas-finngen-content');
  showLoading('phewas-bbj-content');
  showLoading('eqtl-content');
  showLoading('eqtl-catalogue-content');
  showLoading('gene-disease-content');

  try {
    // Phase 1: Resolve variant via Ensembl/dbSNP
    currentVariant = await resolveVariant(input);

    // Check for stale search
    if (searchId !== _lastSearchId) return;

    if (!currentVariant) {
      showGlobalError('Variant not found. Please check your input and try again.');
      showResults(false);
      document.getElementById('variant-card').classList.add('hidden');
      setSearchLoading(false);
      return;
    }

    // Update summary card
    updateSummary(currentVariant);

    // Phase 2: Parallel data fetch
    fetchAllSections(currentVariant);

  } catch (err) {
    if (searchId !== _lastSearchId) return;
    console.error('Resolution error:', err);
    showGlobalError(`Error resolving variant: ${err.message}`);
    showResults(false);
  } finally {
    if (searchId === _lastSearchId) {
      setSearchLoading(false);
    }
  }
}

// ── Phase 1: Variant resolution via Ensembl/dbSNP ───────
async function resolveVariant(input) {
  let resolved;

  if (input.type === 'rsid') {
    resolved = await resolveRsidBothBuilds(input.rsid);
    if (!resolved.chr38 && !resolved.chr37) return null;
  } else if (input.type === 'position') {
    const posMatch = parsePositionStr(input.positionStr);
    if (!posMatch) return null;
    resolved = await resolvePositionBothBuilds(posMatch.chr, posMatch.pos, input.build);
    if (!resolved) return null;
  } else {
    return null;
  }

  const ref = resolved.ref;
  const alt = resolved.alts?.[0] || null;
  const rsid = resolved.rsid;

  // Build variant ID for Open Targets (always GRCh38)
  let variantId = null;
  if (resolved.chr38 && resolved.pos38 && ref && alt) {
    variantId = toVariantId(resolved.chr38, resolved.pos38, ref, alt);
  }

  // Try to get Open Targets data
  let otData = null;
  if (variantId) {
    otData = await getVariantDetails(variantId).catch(() => null);
  }

  // If no OT data with primary alleles, try searching by rsid
  if (!otData && rsid) {
    const candidateIds = await searchVariant(rsid).catch(() => []);
    if (candidateIds.length > 0) {
      const bestId = candidateIds[0];
      otData = await getVariantDetails(bestId).catch(() => null);
      if (otData && !variantId) {
        variantId = bestId;
      }
    }
  }

  return {
    chr: resolved.chr38 || resolved.chr37,
    pos: resolved.pos38 || resolved.pos37,
    ref,
    alt,
    rsid: rsid || otData?.rsIds?.[0] || null,
    gene: getTopGeneSymbol(otData),
    variantId,
    otData,
    chr37: resolved.chr37 || null,
    pos37: resolved.pos37 || null,
    alternateCandidates: (resolved.alts?.length > 1 && resolved.chr38 && resolved.pos38)
      ? resolved.alts.slice(1).map(a => ({ chr: resolved.chr38, pos: resolved.pos38, ref, alt: a }))
      : [],
  };
}

function getTopGeneSymbol(otData) {
  if (!otData?.transcriptConsequences) return null;
  const genes = extractTopGenes(otData.transcriptConsequences);
  return genes.length > 0 ? genes[0].symbol : null;
}

/**
 * Get all allele combinations to try for a variant (primary + alternates).
 * Returns array of { chr, pos, ref, alt }.
 */
function getAlleleCandidates(variant) {
  const candidates = [{ chr: variant.chr, pos: variant.pos, ref: variant.ref, alt: variant.alt }];
  if (variant.alternateCandidates?.length) {
    for (const alt of variant.alternateCandidates) {
      if (alt.chr === variant.chr && alt.pos === variant.pos) {
        candidates.push(alt);
      }
    }
  }
  return candidates;
}

/**
 * Try a fetch function with each allele candidate until one returns results.
 * The fetchFn should return an array (empty = no data) or throw on error.
 * Returns { data, allele } or { data: [], allele: null }.
 */
async function tryWithAlleleFallback(variant, fetchFn) {
  const candidates = getAlleleCandidates(variant);
  for (const allele of candidates) {
    try {
      const data = await fetchFn(allele);
      if (data && data.length > 0) {
        return { data, allele };
      }
    } catch {
      // Try next candidate
    }
  }
  return { data: [], allele: null };
}

// ── Phase 2: Parallel section fetches ───────────────────
function fetchAllSections(variant) {
  fetchVepScores(variant);
  fetchVariantCard(variant);
  fetchCredibleSets(variant);
  fetchPheWAS(variant);
  fetchPheWASFinnGen(variant);
  fetchPheWASBBJ(variant);
  fetchEqtls(variant);
  fetchEqtlCatalogue(variant);
  fetchGeneDiseases(variant);
}

// ── PheWAS section ──────────────────────────────────────
async function fetchPheWAS(variant) {
  const contentId = 'phewas-content';

  // Update source link
  if (variant.chr && variant.pos && variant.ref && variant.alt) {
    const link = document.getElementById('phewas-source-link');
    link.href = getPheWebVariantUrl(variant.chr, variant.pos, variant.ref, variant.alt);
  }

  if (!variant.ref || !variant.alt) {
    showEmpty(contentId, 'Ref/alt alleles needed for PheWeb lookup. Try searching with an rsID instead.');
    return;
  }

  try {
    const { data: associations, allele } = await tryWithAlleleFallback(variant,
      a => getPheWAS(a.chr, a.pos, a.ref, a.alt));

    if (allele) {
      document.getElementById('phewas-source-link').href =
        getPheWebVariantUrl(allele.chr, allele.pos, allele.ref, allele.alt);
    }

    if (!associations || associations.length === 0) {
      showEmpty(contentId, 'No phenotype associations found in PheWeb for this variant.');
      return;
    }

    // Extract categories for filter dropdown
    const categories = [...new Set(associations.map(a => a.category).filter(Boolean))].sort();

    // Compute numeric p-values for sorting
    const data = associations.map(a => ({
      ...a,
      pval: a.pval ?? (a.mlogp ? Math.pow(10, -a.mlogp) : null),
      trait: a.phenostring || a.pheno || a.phenocode || '–',
      category: a.category || '–',
    }));

    const table = createSortableTable({
      columns: [
        { key: 'trait', label: 'Trait' },
        { key: 'category', label: 'Category' },
        { key: 'pval', label: 'P-value', numeric: true, format: v => formatPValue(v) },
        { key: 'beta', label: 'Beta', numeric: true, format: v => formatNumber(v, 3) },
        { key: 'sebeta', label: 'SE', numeric: true, format: v => formatNumber(v, 3) },
        { key: 'num_cases', label: 'N cases', numeric: true, format: v => v != null ? Number(v).toLocaleString() : '–' },
      ],
      data,
      defaultSortKey: 'pval',
      defaultSortAsc: true,
      categoryOptions: categories.length > 1 ? categories : null,
      categoryKey: 'category',
      filterPlaceholder: 'Filter traits…',
    });

    setContent(contentId, table);
  } catch (err) {
    console.error('PheWAS error:', err);
    showError(contentId, `Failed to load PheWAS data: ${err.message}`, () => fetchPheWAS(variant));
  }
}

// ── BBJ PheWAS section ──────────────────────────────────
async function fetchPheWASBBJ(variant) {
  const contentId = 'phewas-bbj-content';

  if (!variant.ref || !variant.alt) {
    showEmpty(contentId, 'Alleles needed for Biobank Japan lookup.');
    return;
  }

  if (!variant.pos37 || !variant.chr37) {
    showEmpty(contentId, 'Could not resolve GRCh37 coordinates for this variant.');
    return;
  }

  try {
    const grch37 = { chr: variant.chr37, pos: variant.pos37 };

    // Try allele candidates with GRCh37 position
    const { data: associations, allele } = await tryWithAlleleFallback(variant,
      a => getBBJPheWAS(`${grch37.chr}:${grch37.pos}-${a.ref}-${a.alt}`));

    if (allele) {
      const bbjVariant = `${grch37.chr}:${grch37.pos}-${allele.ref}-${allele.alt}`;
      document.getElementById('phewas-bbj-source-link').href = getBBJVariantUrl(bbjVariant);
    }

    if (!associations || associations.length === 0) {
      showEmpty(contentId, 'No phenotype associations found in Biobank Japan for this variant.');
      return;
    }

    const categories = [...new Set(associations.map(a => a.category).filter(Boolean))].sort();

    const data = associations.map(a => ({
      ...a,
      pval: a.pval ?? (a.mlogp ? Math.pow(10, -a.mlogp) : null),
      trait: a.phenostring || a.pheno || a.phenocode || '–',
      category: a.category || '–',
    }));

    const table = createSortableTable({
      columns: [
        { key: 'trait', label: 'Trait' },
        { key: 'category', label: 'Category' },
        { key: 'pval', label: 'P-value', numeric: true, format: v => formatPValue(v) },
        { key: 'beta', label: 'Beta', numeric: true, format: v => formatNumber(v, 3) },
        { key: 'sebeta', label: 'SE', numeric: true, format: v => formatNumber(v, 3) },
        { key: 'num_cases', label: 'N cases', numeric: true, format: v => v != null ? Number(v).toLocaleString() : '–' },
      ],
      data,
      defaultSortKey: 'pval',
      defaultSortAsc: true,
      categoryOptions: categories.length > 1 ? categories : null,
      categoryKey: 'category',
      filterPlaceholder: 'Filter traits…',
    });

    setContent(contentId, table);
  } catch (err) {
    console.error('BBJ PheWAS error:', err);
    showError(contentId, `Failed to load Biobank Japan data: ${err.message}`, () => fetchPheWASBBJ(variant));
  }
}

// ── FinnGen PheWAS section ───────────────────────────────
async function fetchPheWASFinnGen(variant) {
  const contentId = 'phewas-finngen-content';

  // Update source link
  if (variant.chr && variant.pos && variant.ref && variant.alt) {
    document.getElementById('phewas-finngen-source-link').href =
      getFinnGenVariantUrl(variant.chr, variant.pos, variant.ref, variant.alt);
  }

  if (!variant.ref || !variant.alt) {
    showEmpty(contentId, 'Ref/alt alleles needed for FinnGen lookup.');
    return;
  }

  try {
    const { data: associations, allele } = await tryWithAlleleFallback(variant,
      a => getFinnGenPheWAS(a.chr, a.pos, a.ref, a.alt));

    if (allele) {
      document.getElementById('phewas-finngen-source-link').href =
        getFinnGenVariantUrl(allele.chr, allele.pos, allele.ref, allele.alt);
    }

    if (!associations || associations.length === 0) {
      showEmpty(contentId, 'No phenotype associations found in FinnGen for this variant.');
      return;
    }

    const categories = [...new Set(associations.map(a => a.category).filter(Boolean))].sort();

    const data = associations.map(a => ({
      ...a,
      pval: a.pval ?? (a.mlogp != null ? Math.pow(10, -a.mlogp) : null),
      trait: a.phenostring || a.phenocode || '–',
      category: a.category || '–',
    }));

    const table = createSortableTable({
      columns: [
        { key: 'trait', label: 'Trait' },
        { key: 'category', label: 'Category' },
        { key: 'pval', label: 'P-value', numeric: true, format: v => formatPValue(v) },
        { key: 'beta', label: 'Beta', numeric: true, format: v => formatNumber(v, 3) },
        { key: 'sebeta', label: 'SE', numeric: true, format: v => formatNumber(v, 3) },
        { key: 'n_case', label: 'N cases', numeric: true, format: v => v != null ? Number(v).toLocaleString() : '–' },
      ],
      data,
      defaultSortKey: 'pval',
      defaultSortAsc: true,
      categoryOptions: categories.length > 1 ? categories : null,
      categoryKey: 'category',
      filterPlaceholder: 'Filter traits…',
    });

    setContent(contentId, table);
  } catch (err) {
    console.error('FinnGen PheWAS error:', err);
    showError(contentId, `Failed to load FinnGen data: ${err.message}`, () => fetchPheWASFinnGen(variant));
  }
}

// ── eQTL section ────────────────────────────────────────
async function fetchEqtls(variant) {
  const contentId = 'eqtl-content';

  // Update source link
  if (variant.rsid) {
    document.getElementById('eqtl-source-link').href = getGtexVariantUrl(variant.rsid);
  }

  if (!variant.chr || !variant.pos || !variant.ref || !variant.alt) {
    showEmpty(contentId, 'Full variant coordinates (chr:pos:ref:alt) needed for GTEx eQTL lookup.');
    return;
  }

  try {
    const { data: eqtls } = await tryWithAlleleFallback(variant,
      a => getEqtls({ chr: a.chr, pos: a.pos, ref: a.ref, alt: a.alt }));

    if (!eqtls || eqtls.length === 0) {
      showEmpty(contentId, 'No significant eQTLs found in GTEx for this variant.');
      return;
    }

    const data = eqtls.map(e => ({
      gene: e.geneSymbol || e.gencodeId || '–',
      geneId: e.gencodeId || '',
      tissue: formatTissueName(e.tissueSiteDetailId),
      tissueSiteDetailId: e.tissueSiteDetailId || '',
      pval: e.pValue ?? null,
      nes: e.nes ?? null,
    }));

    const table = createSortableTable({
      columns: [
        { key: 'gene', label: 'Gene' },
        { key: 'tissue', label: 'Tissue' },
        { key: 'pval', label: 'P-value', numeric: true, format: v => formatPValue(v) },
        { key: 'nes', label: 'NES', numeric: true, format: v => formatNumber(v, 3) },
      ],
      data,
      defaultSortKey: 'pval',
      defaultSortAsc: true,
      filterPlaceholder: 'Filter by gene or tissue…',
    });

    setContent(contentId, table);
  } catch (err) {
    console.error('eQTL error:', err);
    showError(contentId, `Failed to load eQTL data: ${err.message}`, () => fetchEqtls(variant));
  }
}

// ── eQTL Catalogue section ───────────────────────────────
async function fetchEqtlCatalogue(variant) {
  const contentId = 'eqtl-catalogue-content';

  if (variant.rsid) {
    document.getElementById('eqtl-catalogue-source-link').href = getEqtlCatalogueVariantUrl(variant.rsid);
  }

  if (!variant.rsid) {
    showEmpty(contentId, 'rsid needed for eQTL Catalogue lookup.');
    return;
  }

  try {
    const associations = await getEqtlCatalogueAssociations(variant.rsid);

    if (!associations || associations.length === 0) {
      showEmpty(contentId, 'No eQTL associations found in the eQTL Catalogue for this variant.');
      return;
    }

    // Build gene symbol map from Open Targets data if available
    const geneSymbolMap = new Map();
    if (variant.otData?.transcriptConsequences) {
      for (const tc of variant.otData.transcriptConsequences) {
        if (tc.target?.id && tc.target?.approvedSymbol) {
          geneSymbolMap.set(tc.target.id, tc.target.approvedSymbol);
        }
      }
    }

    // Resolve gene IDs to symbols where possible
    for (const assoc of associations) {
      const symbol = geneSymbolMap.get(assoc.gene);
      if (symbol) {
        assoc.geneSymbol = symbol;
      } else {
        // Shorten Ensembl ID for display
        assoc.geneSymbol = assoc.gene;
      }
    }

    // Extract unique studies/tissues for filter
    const tissues = [...new Set(associations.map(a => a.tissueLabel).filter(Boolean))].sort();

    const table = createSortableTable({
      columns: [
        { key: 'geneSymbol', label: 'Gene' },
        { key: 'tissueLabel', label: 'Tissue' },
        { key: 'studyLabel', label: 'Study' },
        { key: 'pvalue', label: 'P-value', numeric: true, format: v => formatPValue(v) },
        { key: 'beta', label: 'Beta', numeric: true, format: v => formatNumber(v, 3) },
        { key: 'se', label: 'SE', numeric: true, format: v => formatNumber(v, 3) },
      ],
      data: associations,
      defaultSortKey: 'pvalue',
      defaultSortAsc: true,
      initialLimit: 10,
      categoryOptions: tissues.length > 1 ? tissues : null,
      categoryKey: 'tissueLabel',
      filterPlaceholder: 'Filter by gene, tissue, or study…',
    });

    setContent(contentId, table);
  } catch (err) {
    console.error('eQTL Catalogue error:', err);
    showError(contentId, `Failed to load eQTL Catalogue data: ${err.message}`, () => fetchEqtlCatalogue(variant));
  }
}

// ── VEP Scores section ──────────────────────────────────
async function fetchVepScores(variant) {
  const contentId = 'vep-content';

  // Update source link
  if (variant.rsid) {
    document.getElementById('vep-source-link').href =
      `https://www.ensembl.org/Homo_sapiens/Variation/Explore?v=${variant.rsid}`;
  } else if (variant.chr && variant.pos) {
    document.getElementById('vep-source-link').href =
      `https://www.ensembl.org/Homo_sapiens/Tools/VEP`;
  }

  try {
    let vepResult;
    if (variant.rsid) {
      vepResult = await getVepAnnotationByRsid(variant.rsid);
    } else if (variant.chr && variant.pos && variant.alt) {
      vepResult = await getVepAnnotationByRegion(variant.chr, variant.pos, variant.alt);
    }

    if (!vepResult) {
      showEmpty(contentId, 'No VEP annotations available for this variant.');
      return;
    }

    const scores = extractVepScores(vepResult, variant.alt);
    renderVepScores(contentId, scores);
  } catch (err) {
    console.error('VEP error:', err);
    showError(contentId, `Failed to load VEP annotations: ${err.message}`, () => fetchVepScores(variant));
  }
}

function renderVepScores(contentId, scores) {
  const container = document.createElement('div');
  container.className = 'vep-badges';

  const badges = [
    { name: 'CADD', value: scores.cadd.phred, fmt: v => v.toFixed(1), tip: 'Combined annotation dependent depletion (Phred)' },
    { name: 'AlphaMissense', value: scores.alphaMissense.score, fmt: v => v.toFixed(3), tip: 'Deep learning missense pathogenicity', cls: scores.alphaMissense.class },
    { name: 'REVEL', value: scores.revel, fmt: v => v.toFixed(3), tip: 'Rare exome variant ensemble learner' },
    { name: 'SpliceAI', value: scores.spliceAI.maxDS, fmt: v => v.toFixed(3), tip: 'Max delta score across splice types' },
    { name: 'Enformer', value: scores.enformer.sad, fmt: v => v.toExponential(1), tip: 'Sum of absolute differences (SAD)' },
    { name: 'EVE', value: scores.eve.score, fmt: v => v.toFixed(3), tip: 'Evolutionary variant effect', cls: scores.eve.class },
  ];

  for (const b of badges) {
    const el = document.createElement('span');
    const avail = b.value != null;
    let colorClass = '';
    if (avail && b.cls) {
      colorClass = ' ' + classifyScore(b.cls);
    }
    el.className = `vep-badge${avail ? '' : ' unavailable'}${colorClass}`;
    el.title = b.tip;
    el.innerHTML = `<span class="vep-badge-name">${b.name}</span> <span class="vep-badge-value">${avail ? b.fmt(b.value) : '–'}</span>`;
    container.appendChild(el);
  }

  setContent(contentId, container);
}

function classifyScore(cls) {
  if (!cls) return '';
  const lower = cls.toLowerCase();
  if (lower.includes('pathogenic') || lower === 'uncertain') return 'pathogenic';
  if (lower.includes('benign') || lower === 'likely_benign') return 'benign';
  if (lower.includes('ambiguous')) return 'ambiguous';
  return 'ambiguous';
}

// ── Variant Card annotation (consequences + allele freqs) ──
async function fetchVariantCard(variant) {
  const contentId = 'annotation-content';

  // Update source link
  if (variant.variantId) {
    document.getElementById('annotation-source-link').href =
      `https://platform.opentargets.org/variant/${variant.variantId}`;
  }

  // Use cached OT data if available, otherwise fetch
  let otData = variant.otData;
  if (!otData && variant.variantId) {
    try {
      otData = await getVariantDetails(variant.variantId);
    } catch (err) {
      console.error('Annotation fetch error:', err);
      showError(contentId, `Failed to load variant annotation: ${err.message}`, () => fetchVariantCard(variant));
      return;
    }
  }

  if (!otData) {
    showEmpty(contentId, 'No annotation data available from Open Targets for this variant.');
    return;
  }

  renderAnnotation(contentId, otData);
}

function renderAnnotation(contentId, otData) {
  const container = document.createElement('div');
  container.className = 'annotation-panels';

  // ── Gene Consequences (left panel) ──
  const msc = otData.mostSevereConsequence;
  const mscLabel = typeof msc === 'string' ? msc : msc?.label;
  const genes = extractTopGenes(otData.transcriptConsequences || []);

  const conseqCard = document.createElement('div');
  conseqCard.className = 'annotation-card';

  const conseqTitle = document.createElement('div');
  conseqTitle.className = 'annotation-card-title';
  conseqTitle.textContent = 'Gene Consequences';
  conseqCard.appendChild(conseqTitle);

  // Highlighted most severe consequence + primary gene
  if (mscLabel) {
    const highlight = document.createElement('div');
    highlight.className = 'consequence-highlight';
    const genePart = genes.length > 0
      ? ` <span class="consequence-gene">${genes[0].symbol}</span>`
      : '';
    highlight.innerHTML = formatConsequence(mscLabel) + genePart;
    conseqCard.appendChild(highlight);
  }

  // Additional gene consequences
  if (genes.length > (mscLabel ? 1 : 0)) {
    const val = document.createElement('div');
    val.className = 'annotation-card-value';
    const startIdx = mscLabel ? 1 : 0;
    const parts = [];
    for (const g of genes.slice(startIdx, 5)) {
      const conseq = g.consequence ? ` <small>${formatConsequence(g.consequence)}</small>` : '';
      parts.push(`<span class="consequence-tag">${g.symbol}</span>${conseq}`);
    }
    val.innerHTML = parts.join('<br>');
    conseqCard.appendChild(val);
  }

  container.appendChild(conseqCard);

  // ── Allele frequencies (right panel) ──
  const freqCard = document.createElement('div');
  freqCard.className = 'annotation-card';

  const freqTitle = document.createElement('div');
  freqTitle.className = 'annotation-card-title';
  freqTitle.textContent = 'Allele Frequencies';
  freqCard.appendChild(freqTitle);

  if (otData.alleleFrequencies && otData.alleleFrequencies.length > 0) {
    freqCard.appendChild(createFreqBars(otData.alleleFrequencies));
  } else {
    const empty = document.createElement('span');
    empty.className = 'empty-state';
    empty.style.padding = '8px 0';
    empty.textContent = 'No allele frequency data available.';
    freqCard.appendChild(empty);
  }

  container.appendChild(freqCard);

  setContent(contentId, container);
}

// ── Credible Sets section (separate panel) ──────────────
async function fetchCredibleSets(variant) {
  const contentId = 'credible-sets-content';

  // Update source link on badge
  if (variant.variantId) {
    const link = document.getElementById('credible-sets-source-link');
    if (link) link.href = `https://platform.opentargets.org/variant/${variant.variantId}`;
  }

  // Use cached OT data if available, otherwise fetch
  let otData = variant.otData;
  if (!otData && variant.variantId) {
    try {
      otData = await getVariantDetails(variant.variantId);
    } catch (err) {
      console.error('Credible sets fetch error:', err);
      showError(contentId, `Failed to load credible sets: ${err.message}`, () => fetchCredibleSets(variant));
      return;
    }
  }

  if (!otData) {
    showEmpty(contentId, 'No credible sets data available from Open Targets for this variant.');
    return;
  }

  const credSets = otData.credibleSets;
  if (!credSets?.rows || credSets.rows.length === 0) {
    showEmpty(contentId, 'No GWAS credible sets found for this variant.');
    return;
  }

  const credData = credSets.rows.map(r => {
    const diseaseName = r.study?.diseases?.[0]?.name;
    return {
      trait: r.study?.traitFromSource || diseaseName || '–',
      author: r.study?.publicationFirstAuthor || '–',
      year: r.study?.publicationDate ? r.study.publicationDate.substring(0, 4) : '',
      pval: pvalFromMantissaExp(r.pValueMantissa, r.pValueExponent),
      beta: r.beta,
      nSamples: r.study?.nSamples,
      studyId: r.study?.id,
      method: r.finemappingMethod || '',
    };
  });

  const credTable = createSortableTable({
    columns: [
      { key: 'trait', label: 'Trait' },
      { key: 'author', label: 'Author', format: (v, row) => row.year ? `${v} (${row.year})` : v },
      { key: 'pval', label: 'P-value', numeric: true, format: v => formatPValue(v) },
      { key: 'beta', label: 'Beta', numeric: true, format: v => formatNumber(v, 3) },
      { key: 'nSamples', label: 'N', numeric: true, format: v => v != null ? Number(v).toLocaleString() : '–' },
      { key: 'method', label: 'Method' },
    ],
    data: credData,
    defaultSortKey: 'pval',
    defaultSortAsc: true,
    filterPlaceholder: 'Filter credible sets…',
  });

  setContent(contentId, credTable);
}

function formatConsequence(str) {
  if (!str) return '';
  return str
    .replace(/_/g, ' ')
    .replace(/SO[:\d]+/g, '')
    .trim()
    .replace(/\b\w/g, c => c.toUpperCase());
}

// ── Gene-Disease section ────────────────────────────────
async function fetchGeneDiseases(variant) {
  const contentId = 'gene-disease-content';

  // Get top genes from annotation
  let genes = [];
  if (variant.otData?.transcriptConsequences) {
    genes = extractTopGenes(variant.otData.transcriptConsequences);
  }

  if (genes.length === 0) {
    // If we don't have annotation yet, try fetching it
    if (variant.variantId) {
      try {
        const otData = await getVariantDetails(variant.variantId);
        if (otData?.transcriptConsequences) {
          genes = extractTopGenes(otData.transcriptConsequences);
        }
      } catch {
        // ignore
      }
    }
  }

  if (genes.length === 0) {
    showEmpty(contentId, 'No gene consequences available to query gene-disease associations.');
    return;
  }

  // Fetch disease associations for top genes in parallel
  try {
    const results = await Promise.allSettled(
      genes.slice(0, 5).map(g => getGeneDiseases(g.ensemblId))
    );

    const geneResults = [];
    for (let i = 0; i < results.length; i++) {
      if (results[i].status === 'fulfilled' && results[i].value) {
        geneResults.push({
          gene: genes[i],
          data: results[i].value,
        });
      }
    }

    if (geneResults.length === 0) {
      showEmpty(contentId, 'No gene-disease associations found.');
      return;
    }

    renderGeneDiseases(contentId, geneResults);
  } catch (err) {
    console.error('Gene-disease error:', err);
    showError(contentId, `Failed to load gene-disease data: ${err.message}`, () => fetchGeneDiseases(variant));
  }
}

function renderGeneDiseases(contentId, geneResults) {
  const container = document.createElement('div');

  // Gene pills
  const pills = document.createElement('div');
  pills.className = 'gene-pills';

  let activeGeneIdx = 0;

  geneResults.forEach((gr, idx) => {
    const pill = document.createElement('button');
    pill.className = `gene-pill${idx === 0 ? ' active' : ''}`;
    pill.textContent = gr.gene.symbol;
    pill.addEventListener('click', () => {
      activeGeneIdx = idx;
      pills.querySelectorAll('.gene-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      renderDiseaseTable();
    });
    pills.appendChild(pill);
  });

  container.appendChild(pills);

  // Table container
  const tableContainer = document.createElement('div');
  tableContainer.id = 'gene-disease-table';
  container.appendChild(tableContainer);

  function renderDiseaseTable() {
    const gr = geneResults[activeGeneIdx];
    const diseases = gr.data.associatedDiseases?.rows || [];

    if (diseases.length === 0) {
      tableContainer.innerHTML = '<div class="empty-state">No disease associations for this gene.</div>';
      return;
    }

    const data = diseases.map(d => {
      const omimLinks = extractOmimLinks(d.disease?.dbXRefs);
      return {
        disease: d.disease?.name || '–',
        diseaseId: d.disease?.id || '',
        score: d.score ?? null,
        omimLinks,
        omimDisplay: omimLinks.length > 0
          ? omimLinks.map(o => `<a href="${o.url}" target="_blank" rel="noopener">${o.omimId}</a>`).join(', ')
          : '–',
      };
    });

    const table = createSortableTable({
      columns: [
        { key: 'disease', label: 'Disease',
          format: (v, row) => row.diseaseId
            ? `<a href="https://platform.opentargets.org/disease/${row.diseaseId}" target="_blank" rel="noopener">${v}</a>`
            : v
        },
        { key: 'score', label: 'Score', numeric: true, format: v => formatNumber(v, 3) },
        { key: 'omimDisplay', label: 'OMIM', format: v => v },
      ],
      data,
      defaultSortKey: 'score',
      defaultSortAsc: false,
      initialLimit: 10,
      filterPlaceholder: 'Filter diseases…',
    });

    tableContainer.innerHTML = '';
    tableContainer.appendChild(table);
  }

  renderDiseaseTable();
  setContent(contentId, container);
}

// ── Helpers ─────────────────────────────────────────────
function setSearchLoading(loading) {
  searchButton.disabled = loading;
  searchButton.innerHTML = loading
    ? '<span class="spinner"></span>'
    : 'Search';
}

// ── Start ───────────────────────────────────────────────
init();
