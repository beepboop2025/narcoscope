// Synthetic contract fixture; never part of public/data or a served response.
export function observatoryFixture() {
  const clock = '2026-09-08T14:00:00Z'
  const dataset = (id, title, path, download, source_group, visibility, coverage) => ({ id, title, path, download, source_group, visibility, coverage, status: 'available', clock, description: 'Fixture coverage for the reviewed evidence collection.' })
  return {
    schema: 'palimpsest.china-evidence-observatory-summary.v1', generated_at: clock,
    source_url: 'https://www.palimpsest.info/china/evidence/', input_sha256: 'a'.repeat(64),
    datasets: [
      dataset('nbs-history', 'Official economic histories', '/readings/china-economic-history-analysis-latest.json', '/readings/china-economic-history.csv', 'nbs_official_statistics', 'public', { comparable_series: 12 }),
      dataset('mirror-trade', 'EU trade declarations', '/readings/china-mirror-trade-latest.json', '/readings/china-mirror-trade-history.csv', 'eurostat_eu_reported_trade', 'public', { rows: 100 }),
      dataset('publication-watch', 'Official publication watch', '/readings/china-publication-watch-latest.json', '/readings/china-publication-watch-latest.json', 'official_document_observation', 'metadata_public', { watched_documents: 36 }),
      dataset('external-accounts', 'External account collection', '/readings/china-external-accounts-latest.json', '/readings/china-external-accounts-latest.json', 'safe_official_statistics', 'numeric_data_private', { workbooks_retained: 2, numeric_observations_private: 100, public_numeric_observations: 0 }),
    ],
    findings: [
      { id: 'nbs:fixture', title: 'Industry cash-flow comparison', text: 'Fixture official statistical comparison.', interpretation: 'Repeated publications are not independent sources.', evidence_class: 'official_statistical_comparison', source_urls: ['https://www.stats.gov.cn/english/PressRelease/'], data_path: '/readings/china-economic-history-analysis-latest.json', region: 'china' },
      { id: 'trade:fixture', title: 'European trade and regional demand', text: 'Fixture external trade comparison.', interpretation: 'National trade does not identify a district or project.', evidence_class: 'externally_reported_trade', source_urls: ['https://ec.europa.eu/eurostat/databrowser/view/DS-045409/default/table?lang=en'], data_path: '/readings/china-mirror-trade-latest.json', region: 'regional', evidence_series: ['EU27_2020:PK:TOTAL:eu_imports_from_partner'] },
    ],
    methodology_cases: [{ id: 'fixture-method', title: 'A changed unemployment denominator', event_date: '2024-01-17', claim: 'Fixture historical announcement with retained official evidence.', interpretation: 'Compare consistent populations across the break.', source_ids: ['nbs-youth-definition'], source_urls: ['https://www.stats.gov.cn/sj/zxfb/202401/t20240117_1946641.html'], evidence_status: 'captured', capture_ids: ['b'.repeat(64)] }],
    use_policy: { concealment_inference: 'not_established_by_gaps_or_disagreement', actor_inference: 'prohibited', private_numeric_data: 'excluded', missing_values: 'unavailable_not_zero' },
  }
}
