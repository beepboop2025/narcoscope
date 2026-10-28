export default function WdrRightsNotice({ title = 'UNODC World Drug Report evidence' }: { title?: string }) {
  return <section className="market-empty" role="status" aria-label="Publication rights restriction">
    <h2>{title}</h2><p><strong>Measurements withheld pending publication permission</strong></p>
    <p>UNODC World Drug Report prices, purity, seizures, treatment and laboratory measurements—and statistics derived from them—are currently available here as source metadata only. The source remains identified; withheld values are not zero, and this does not mean the publisher has no observations.</p>
    <p>Documented permission for this product is required before these measurements can be republished. Retrieval dates, source editions and units remain available in the <a href="/api/v1/markets">research catalog</a>.</p>
    <p><a href="https://www.unodc.org/unodc/en/data-and-analysis/world-drug-report-2026.html">UNODC World Drug Report source</a> · <a href="#drugs">Inspect separately permitted wastewater evidence</a></p>
  </section>
}
