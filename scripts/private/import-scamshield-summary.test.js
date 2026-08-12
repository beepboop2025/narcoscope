import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  OUTPUT_SCHEMA,
  importScamShieldSummary,
  validateScamShieldSummary,
} from './import-scamshield-summary.mjs'

function fixture() {
  return {
    schema_version: 'scamshield-telegram-monitoring-summary/v1',
    producer: 'ScamShield',
    data_classification: 'PRIVATE_ANALYST_REVIEW',
    review_status: 'HUMAN_REVIEW_REQUIRED',
    publication_eligible: false,
    intended_consumers: ['palimpsest_review', 'narcoscope_analyst_import'],
    window: {
      start: '2026-08-12T00:00:00Z',
      end: '2026-08-13T00:00:00Z',
      complete: false,
    },
    sampling_frame: {
      surface: 'configured_public_or_operator_authorized_telegram',
      universal_telegram_coverage: false,
      raw_messages_included: false,
      exact_iocs_included: false,
      source_identifiers_included: false,
    },
    coverage: {
      messages_observed: 50,
      messages_flagged: 4,
      sources_observed: 5,
      collection_errors: 1,
    },
    detections: {
      status: 'AVAILABLE_FOR_REVIEW',
      minimum_messages: 20,
      minimum_sources: 2,
      tier_counts: { CLEAN: 46, WATCH: 2, LIKELY_SCAM: 2 },
      family_counts: { 'advance-fee': 2 },
    },
    limitations: ['Private aggregate requiring human review.'],
  }
}

async function withTemp(run) {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'narcoscope-private-import-'))
  try {
    await run(root)
  } finally {
    await fs.promises.rm(root, { recursive: true, force: true })
  }
}

describe('ScamShield private analyst import', () => {
  it('validates, snapshots, receipts, and deduplicates an aggregate', async () => {
    await withTemp(async (root) => {
      const input = path.join(root, 'summary.json')
      const stateDir = path.join(root, 'state')
      await fs.promises.writeFile(input, JSON.stringify(fixture()))

      const first = await importScamShieldSummary({
        input,
        stateDir,
        now: new Date('2026-08-12T09:15:00Z'),
      })
      const second = await importScamShieldSummary({
        input,
        stateDir,
        now: new Date('2026-08-12T09:20:00Z'),
      })
      expect(first.changed).toBe(true)
      expect(second.changed).toBe(false)

      const current = JSON.parse(await fs.promises.readFile(path.join(stateDir, 'current.json'), 'utf8'))
      expect(current.schema_version).toBe(OUTPUT_SCHEMA)
      expect(current.publication_eligible).toBe(false)
      expect(current.review_state).toBe('PENDING_HUMAN_REVIEW')
      expect(JSON.stringify(current)).not.toContain('source_identifiers_included":true')
      expect(await fs.promises.readdir(path.join(stateDir, 'hourly'))).toEqual(['2026-08-12T09.json'])
      const receipts = (await fs.promises.readFile(path.join(stateDir, 'receipts.jsonl'), 'utf8')).trim().split('\n')
      expect(receipts).toHaveLength(1)
      expect((await fs.promises.stat(path.join(stateDir, 'current.json'))).mode & 0o777).toBe(0o600)
      expect((await fs.promises.stat(stateDir)).mode & 0o777).toBe(0o700)
    })
  })

  it('rejects publication, raw-data, and schema-expansion attempts', () => {
    const publicPayload = fixture()
    publicPayload.publication_eligible = true
    expect(() => validateScamShieldSummary(publicPayload)).toThrow(/publication_eligible/)

    const rawPayload = fixture()
    rawPayload.sampling_frame.raw_messages_included = true
    expect(() => validateScamShieldSummary(rawPayload)).toThrow(/raw_messages_included/)

    const expandedPayload = { ...fixture(), raw_messages: ['should never cross'] }
    expect(() => validateScamShieldSummary(expandedPayload)).toThrow(/keys do not match/)
  })

  it('rejects a symlinked handoff instead of following it', async () => {
    await withTemp(async (root) => {
      const target = path.join(root, 'real-summary.json')
      const input = path.join(root, 'summary.json')
      await fs.promises.writeFile(target, JSON.stringify(fixture()))
      await fs.promises.symlink(target, input)
      await expect(importScamShieldSummary({ input, stateDir: path.join(root, 'state') }))
        .rejects.toThrow(/regular, non-symlink/)
    })
  })

  it('suppresses counts unless the input coverage gate is met', () => {
    const invalid = fixture()
    invalid.coverage.messages_observed = 1
    invalid.coverage.messages_flagged = 1
    invalid.detections.tier_counts = { WATCH: 1 }
    expect(() => validateScamShieldSummary(invalid)).toThrow(/coverage gate/)
  })

  it('keeps private state outside every public collector path', () => {
    const here = path.dirname(fileURLToPath(import.meta.url))
    const collector = fs.readFileSync(
      path.resolve(here, '../../deploy/collector/collect.sh'),
      'utf8',
    )
    expect(collector).not.toContain('/var/lib/narcoscope-analyst')
    expect(collector).not.toContain('scripts/private')
  })

  it('treats a completed oneshot import as a successful install', () => {
    const here = path.dirname(fileURLToPath(import.meta.url))
    const installer = fs.readFileSync(
      path.resolve(here, '../../deploy/private-import/install.sh'),
      'utf8',
    )
    expect(installer).toContain('--property=Result --value')
    expect(installer).not.toContain('systemctl --no-pager --full status')
  })
})
