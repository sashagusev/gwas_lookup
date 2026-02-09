/**
 * Open Targets Platform GraphQL API client.
 * Docs: https://platform-docs.opentargets.org/data-access/graphql-api
 */

import { postJSON } from '../utils/fetch-helpers.js';

const OT_API = 'https://api.platform.opentargets.org/api/v4/graphql';

/**
 * Search for a variant by rsid or position. Returns variant ID and basic info.
 * Uses the `search` query which returns `hits` with entity type.
 */
export async function searchVariant(rsid) {
  const query = `
    query VariantSearch($query: String!) {
      search(queryString: $query, entityNames: ["variant"], page: { index: 0, size: 5 }) {
        hits {
          id
          entity
        }
      }
    }
  `;

  const data = await postJSON(OT_API, {
    query,
    variables: { query: rsid },
  });

  const hits = data?.data?.search?.hits;
  if (!hits || hits.length === 0) return [];
  return hits.filter(h => h.entity === 'variant').map(h => h.id);
}

/**
 * Get detailed variant information including transcript consequences,
 * allele frequencies, and credible sets.
 */
export async function getVariantDetails(variantId) {
  const query = `
    query VariantDetails($variantId: String!) {
      variant(variantId: $variantId) {
        id
        rsIds
        chromosome
        position
        referenceAllele
        alternateAllele
        mostSevereConsequence {
          id
          label
        }
        transcriptConsequences {
          aminoAcidChange
          consequenceScore
          isEnsemblCanonical
          transcriptId
          variantConsequences {
            id
            label
          }
          target {
            id
            approvedSymbol
            approvedName
          }
        }
        alleleFrequencies {
          populationName
          alleleFrequency
        }
        credibleSets(studyTypes: [gwas], page: { index: 0, size: 20 }) {
          rows {
            studyLocusId
            study {
              id
              traitFromSource
              publicationFirstAuthor
              publicationDate
              nSamples
              diseases {
                id
                name
              }
            }
            pValueMantissa
            pValueExponent
            beta
            finemappingMethod
          }
          count
        }
      }
    }
  `;

  const data = await postJSON(OT_API, {
    query,
    variables: { variantId },
  });

  return data?.data?.variant || null;
}

/**
 * Get disease associations for a gene (target).
 */
export async function getGeneDiseases(ensemblId) {
  const query = `
    query GeneDiseases($ensemblId: String!) {
      target(ensemblId: $ensemblId) {
        id
        approvedSymbol
        associatedDiseases(page: { index: 0, size: 50 }) {
          rows {
            disease {
              id
              name
              dbXRefs
            }
            score
            datasourceScores {
              id
              score
            }
          }
          count
        }
      }
    }
  `;

  const data = await postJSON(OT_API, {
    query,
    variables: { ensemblId },
  });

  return data?.data?.target || null;
}

/**
 * Extract the most relevant genes from transcript consequences,
 * sorted by consequence severity.
 */
export function extractTopGenes(transcriptConsequences) {
  if (!transcriptConsequences || transcriptConsequences.length === 0) return [];

  const geneMap = new Map();

  for (const tc of transcriptConsequences) {
    if (!tc.target) continue;
    const geneId = tc.target.id;
    const existing = geneMap.get(geneId);
    const score = tc.consequenceScore ?? 0;

    if (!existing || score > existing.score) {
      // variantConsequences is an array; pick the first label
      const consequence = tc.variantConsequences?.[0]?.label || '';
      geneMap.set(geneId, {
        ensemblId: geneId,
        symbol: tc.target.approvedSymbol,
        name: tc.target.approvedName,
        score,
        consequence,
        isCanonical: tc.isEnsemblCanonical || false,
      });
    }
  }

  return Array.from(geneMap.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);
}

/**
 * Extract OMIM IDs from disease dbXRefs.
 * Returns array of { omimId, url }.
 */
export function extractOmimLinks(dbXRefs) {
  if (!dbXRefs || !Array.isArray(dbXRefs)) return [];
  return dbXRefs
    .filter(ref => typeof ref === 'string' && ref.startsWith('OMIM:'))
    .map(ref => {
      const id = ref.replace('OMIM:', '');
      return { omimId: id, url: `https://omim.org/entry/${id}` };
    });
}
