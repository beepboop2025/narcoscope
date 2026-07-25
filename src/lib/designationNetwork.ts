// =============================================================================
// DESIGNATION NETWORK ANALYSIS
// =============================================================================
//
// WHAT GRAPH THIS IS, AND WHY IT ISN'T THE OBVIOUS ONE
// ----------------------------------------------------
// The tempting move with a sanctions list is to draw entity-to-entity edges —
// "these two were designated under the same programme, therefore they are
// connected" — and run centrality over the result to rank people by importance.
// That graph would be fiction. OFAC's public flat file publishes NO
// relationships between designated entities; every such edge would be invented
// by this code, and the network metrics computed over it would be measuring
// nothing but our own join condition. "Garbage in, Garbage out"
// (arXiv:2501.01508) makes precisely this point about covert-network analysis:
// centrality computed on a mis-specified graph is confidently wrong, and here
// the confident wrong answer would be a named private individual ranked as a
// broker.
//
// So this module analyses the graph OFAC actually publishes. Each designated
// entity carries one or more COUNTRIES OF RECORD. An entity recorded in
// several countries is a documented cross-border structure, and it forms an
// edge between those jurisdictions. The nodes are countries, the edges are
// designations, and every edge is a fact Treasury published.
//
// What this answers: which jurisdictions hold the designated networks
// together, which ones bridge otherwise-separate sanctions regimes, and which
// would fragment the graph if the flows through them stopped. Those are
// sanctions-policy questions about places, and they can be answered without
// asserting an unpublished relationship between any two people.

import type { DesignationRecord } from '../types'

export interface JurisdictionNode {
  country: string
  /** Designations recorded in this country. */
  designations: number
  /** Designations here that are ALSO recorded in at least one other country. */
  crossBorderDesignations: number
  /** Distinct countries this one is linked to by a shared designation. */
  degree: number
  /** Distinct OFAC programmes represented among this country's designations. */
  programs: string[]
  /**
   * Betweenness centrality over the jurisdiction graph, normalised 0-1.
   *
   * High betweenness means the country sits on the shortest paths between
   * other jurisdictions — the structural definition of a broker. Read here as
   * "designated structures routinely span this place on their way between
   * others", which is a claim about a country, not about a person.
   */
  betweenness: number
  /**
   * True when removing this country disconnects jurisdictions that were
   * otherwise linked — an articulation point of the designation graph.
   */
  articulationPoint: boolean
}

export interface JurisdictionEdge {
  from: string
  to: string
  /** Designations recorded in both countries. */
  weight: number
  /** Programmes under which those shared designations sit. */
  programs: string[]
}

export interface DesignationNetwork {
  nodes: JurisdictionNode[]
  edges: JurisdictionEdge[]
  /** Entities recorded in 2+ countries — the ones that create every edge here. */
  crossBorderEntities: number
  /** Total designations considered. */
  totalEntities: number
  /**
   * Country-concentration HHI (0-10000) of designations, using the same
   * Herfindahl-Hirschman scale and DOJ/FTC thresholds `intelligence.ts`
   * applies to trafficking corridors. A high value means the designation
   * effort is concentrated in a few jurisdictions.
   */
  concentrationHHI: number
  /** Programmes present in the analysed set. */
  programs: string[]
}

/** Undirected adjacency, country -> linked countries. */
function buildAdjacency(edges: JurisdictionEdge[]): Map<string, Set<string>> {
  const adj = new Map<string, Set<string>>()
  for (const e of edges) {
    if (!adj.has(e.from)) adj.set(e.from, new Set())
    if (!adj.has(e.to)) adj.set(e.to, new Set())
    adj.get(e.from)!.add(e.to)
    adj.get(e.to)!.add(e.from)
  }
  return adj
}

/**
 * Brandes' algorithm for betweenness centrality on an unweighted undirected
 * graph. Unweighted deliberately: edge weight here is "how many designations
 * span this country pair", which is a volume of enforcement attention, not a
 * distance. Treating a heavily-designated pair as "closer" would let the size
 * of a past enforcement campaign dictate the structural reading.
 */
function betweennessCentrality(adj: Map<string, Set<string>>): Map<string, number> {
  const nodes = [...adj.keys()]
  const centrality = new Map<string, number>(nodes.map((n) => [n, 0]))

  for (const source of nodes) {
    const stack: string[] = []
    const predecessors = new Map<string, string[]>(nodes.map((n) => [n, []]))
    const sigma = new Map<string, number>(nodes.map((n) => [n, 0]))
    const distance = new Map<string, number>(nodes.map((n) => [n, -1]))
    sigma.set(source, 1)
    distance.set(source, 0)

    const queue: string[] = [source]
    while (queue.length > 0) {
      const v = queue.shift() as string
      stack.push(v)
      for (const w of adj.get(v) ?? []) {
        if (distance.get(w) === -1) {
          distance.set(w, (distance.get(v) as number) + 1)
          queue.push(w)
        }
        if (distance.get(w) === (distance.get(v) as number) + 1) {
          sigma.set(w, (sigma.get(w) as number) + (sigma.get(v) as number))
          predecessors.get(w)!.push(v)
        }
      }
    }

    const delta = new Map<string, number>(nodes.map((n) => [n, 0]))
    while (stack.length > 0) {
      const w = stack.pop() as string
      for (const v of predecessors.get(w) ?? []) {
        const contribution =
          ((sigma.get(v) as number) / (sigma.get(w) as number)) * (1 + (delta.get(w) as number))
        delta.set(v, (delta.get(v) as number) + contribution)
      }
      if (w !== source) centrality.set(w, (centrality.get(w) as number) + (delta.get(w) as number))
    }
  }

  // Normalise by the number of ordered pairs excluding the node itself, and
  // halve because every pair is counted from both endpoints in an undirected
  // graph.
  const n = nodes.length
  const scale = n > 2 ? 2 / ((n - 1) * (n - 2)) : 0
  for (const [node, value] of centrality) centrality.set(node, value * scale)
  return centrality
}

/**
 * Articulation points via a standard DFS lowlink search: nodes whose removal
 * increases the number of connected components. These are the jurisdictions
 * that are not merely busy but structurally load-bearing — the graph falls
 * apart without them, which is a different and stronger claim than high degree.
 */
function findArticulationPoints(adj: Map<string, Set<string>>): Set<string> {
  const visited = new Set<string>()
  const discovery = new Map<string, number>()
  const low = new Map<string, number>()
  const parent = new Map<string, string | null>()
  const articulation = new Set<string>()
  let timer = 0

  // Iterative DFS: the recursive form is cleaner but the jurisdiction graph is
  // caller-supplied and a deep chain would blow the stack in a browser tab.
  for (const start of adj.keys()) {
    if (visited.has(start)) continue
    parent.set(start, null)
    let rootChildren = 0
    const stack: Array<{ node: string; iterator: Iterator<string> }> = []
    visited.add(start)
    discovery.set(start, timer)
    low.set(start, timer)
    timer += 1
    stack.push({ node: start, iterator: (adj.get(start) ?? new Set()).values() })

    while (stack.length > 0) {
      const frame = stack[stack.length - 1]
      const next = frame.iterator.next()
      if (next.done) {
        stack.pop()
        const child = frame.node
        const p = parent.get(child) ?? null
        if (p !== null) {
          low.set(p, Math.min(low.get(p) as number, low.get(child) as number))
          if (p !== start && (low.get(child) as number) >= (discovery.get(p) as number)) {
            articulation.add(p)
          }
        }
        continue
      }
      const neighbor = next.value
      if (!visited.has(neighbor)) {
        if (frame.node === start) rootChildren += 1
        parent.set(neighbor, frame.node)
        visited.add(neighbor)
        discovery.set(neighbor, timer)
        low.set(neighbor, timer)
        timer += 1
        stack.push({ node: neighbor, iterator: (adj.get(neighbor) ?? new Set()).values() })
      } else if (neighbor !== parent.get(frame.node)) {
        low.set(frame.node, Math.min(low.get(frame.node) as number, discovery.get(neighbor) as number))
      }
    }

    // The DFS root is an articulation point only if it has 2+ DFS children.
    if (rootChildren > 1) articulation.add(start)
  }

  return articulation
}

export function buildDesignationNetwork(
  records: DesignationRecord[],
  options: { program?: string } = {},
): DesignationNetwork {
  const scoped = options.program
    ? records.filter((r) => r.programs.includes(options.program as string))
    : records

  const designationsByCountry = new Map<string, number>()
  const crossBorderByCountry = new Map<string, number>()
  const programsByCountry = new Map<string, Set<string>>()
  const edgeMap = new Map<string, { from: string; to: string; weight: number; programs: Set<string> }>()
  let crossBorderEntities = 0

  for (const record of scoped) {
    const countries = [...new Set(record.countries)].sort()
    if (countries.length === 0) continue

    for (const country of countries) {
      designationsByCountry.set(country, (designationsByCountry.get(country) ?? 0) + 1)
      if (!programsByCountry.has(country)) programsByCountry.set(country, new Set())
      for (const p of record.programs) programsByCountry.get(country)!.add(p)
      if (countries.length > 1) {
        crossBorderByCountry.set(country, (crossBorderByCountry.get(country) ?? 0) + 1)
      }
    }

    if (countries.length < 2) continue
    crossBorderEntities += 1
    // One edge per unordered country pair this entity is recorded in.
    for (let i = 0; i < countries.length; i += 1) {
      for (let j = i + 1; j < countries.length; j += 1) {
        const key = `${countries[i]} ${countries[j]}`
        const existing = edgeMap.get(key)
        if (existing) {
          existing.weight += 1
          for (const p of record.programs) existing.programs.add(p)
        } else {
          edgeMap.set(key, {
            from: countries[i],
            to: countries[j],
            weight: 1,
            programs: new Set(record.programs),
          })
        }
      }
    }
  }

  const edges: JurisdictionEdge[] = [...edgeMap.values()]
    .map((e) => ({ from: e.from, to: e.to, weight: e.weight, programs: [...e.programs].sort() }))
    .sort((a, b) => b.weight - a.weight)

  const adjacency = buildAdjacency(edges)
  const betweenness = betweennessCentrality(adjacency)
  const articulationPoints = findArticulationPoints(adjacency)

  const nodes: JurisdictionNode[] = [...designationsByCountry.entries()]
    .map(([country, designations]) => ({
      country,
      designations,
      crossBorderDesignations: crossBorderByCountry.get(country) ?? 0,
      degree: adjacency.get(country)?.size ?? 0,
      programs: [...(programsByCountry.get(country) ?? [])].sort(),
      betweenness: Math.round((betweenness.get(country) ?? 0) * 10000) / 10000,
      articulationPoint: articulationPoints.has(country),
    }))
    .sort((a, b) => b.betweenness - a.betweenness || b.designations - a.designations)

  const totalDesignationSlots = [...designationsByCountry.values()].reduce((s, v) => s + v, 0)
  let concentrationHHI = 0
  if (totalDesignationSlots > 0) {
    for (const count of designationsByCountry.values()) {
      const share = count / totalDesignationSlots
      concentrationHHI += share * share * 10_000
    }
  }

  return {
    nodes,
    edges,
    crossBorderEntities,
    totalEntities: scoped.length,
    concentrationHHI: Math.round(concentrationHHI),
    programs: [...new Set(scoped.flatMap((r) => r.programs))].sort(),
  }
}

/**
 * Splits a query or a name into lowercase alphanumeric tokens.
 *
 * Word ORDER has to stop mattering, because OFAC writes people as
 * "SURNAME, Given" and nobody types that. A plain substring search for
 * "Chao Wei" misses the record whose alias is literally "WEI, Chao" — which
 * makes the alias table, the single most useful thing in this dataset,
 * unreachable to anyone searching a name the way it is normally written.
 */
function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0)
}

/**
 * Case- and word-order-insensitive search across designation names AND
 * OFAC-published aliases. A record matches when EVERY query token appears in
 * the candidate string, so "Chao Wei", "wei chao" and "WEI, Chao" all reach
 * the same record.
 *
 * Still exact per token: no fuzzy matching, no edit distance, no inferred
 * identity merging. The only equivalences that link two different names are
 * the ones OFAC itself published in its alias table, so a match can never
 * assert a relationship Treasury did not.
 */
export function searchDesignations(
  records: DesignationRecord[],
  query: string,
  limit = 25,
): Array<DesignationRecord & { matchedAlias: string | null }> {
  if (query.trim().length < 2) return []
  const tokens = tokenize(query)
  if (tokens.length === 0) return []

  const matches = (candidate: string): boolean => {
    const haystack = candidate.toLowerCase()
    return tokens.every((t) => haystack.includes(t))
  }

  const results: Array<DesignationRecord & { matchedAlias: string | null }> = []
  for (const record of records) {
    if (matches(record.name)) {
      results.push({ ...record, matchedAlias: null })
    } else {
      const alias = record.aliases.find(matches)
      if (alias) results.push({ ...record, matchedAlias: alias })
    }
    if (results.length >= limit) break
  }
  return results
}
