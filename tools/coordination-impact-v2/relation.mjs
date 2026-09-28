// Deterministic relation calculation only. Authentication is mandatory in core.mjs.
// This module never emits a trusted receipt or a human/bot/intent classification.
const check = (ok, reason) => { if (!ok) throw Error(reason); };
const cmp = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const key = (...parts) => JSON.stringify(parts);
const popcount = mask => { let n = 0; for (; mask; mask &= mask - 1n) n++; return n; };
const intersect = (set, neighbors) => new Set([...set].filter(v => neighbors.has(v)));

export function repeatedCohorts(latest, targets, policy) {
  const active = latest.filter(o => o.action.value !== 'none');
  const actors = [...new Set(active.map(o => o.action.actor))].sort();
  check(actors.length <= policy.maxActiveActors, 'ACTOR_BUDGET');
  const actorIndex = new Map(actors.map((a, i) => [a, i]));
  const targetIds = targets.map(t => t.id).sort();
  const targetIndex = new Map(targetIds.map((t, i) => [t, i]));
  const groups = new Map(), cells = new Map(), pairs = new Map(), broadContexts = [];
  for (const o of active) {
    const k = key(o.action.targetId, o.action.value);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(o); cells.set(key(o.action.actor, o.action.targetId), o);
  }
  let comparisons = 0;
  for (const [, list] of [...groups].sort(([a], [b]) => cmp(a, b))) {
    list.sort((a, b) => a.receivedAt - b.receivedAt || cmp(a.action.actor, b.action.actor));
    const broad = []; let right = 0, lastRight = 0, widest;
    for (let left = 0; left < list.length; left++) {
      while (right < list.length && list[right].receivedAt - list[left].receivedAt <= policy.coincidenceMs) right++;
      if (right === lastRight) continue;
      lastRight = right;
      const count = right - left;
      if (count >= policy.minClusterActors && policy.broadDenominator * count >= policy.broadNumerator * actors.length) {
        broad.push([list[left].receivedAt, list[right - 1].receivedAt]);
        if (!widest || count > widest.count) widest = { left, right, count };
      }
    }
    if (widest) broadContexts.push({ targetId: list[0].action.targetId, value: list[0].action.value,
      actorCount: widest.count, activeActors: actors.length,
      eventIds: list.slice(widest.left, widest.right).map(o => o.action.id).sort(),
      from: list[widest.left].receivedAt, to: list[widest.right - 1].receivedAt });
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const gapMs = list[j].receivedAt - list[i].receivedAt;
      if (gapMs > policy.coincidenceMs) break;
      check(++comparisons <= policy.maxComparisons, 'COMPARISON_BUDGET');
      // A sample-wide response has no contrast to isolate a particular group.
      if (broad.some(([from, to]) => list[i].receivedAt >= from && list[j].receivedAt <= to)) continue;
      const observations = [list[i], list[j]].sort((a, b) => cmp(a.action.actor, b.action.actor));
      const indexes = observations.map(o => actorIndex.get(o.action.actor)), k = key(...indexes);
      if (!pairs.has(k)) {
        check(pairs.size < policy.maxPairs, 'PAIR_BUDGET');
        pairs.set(k, { indexes, mask: 0n, evidence: [] });
      }
      const pair = pairs.get(k), targetId = list[i].action.targetId;
      pair.mask |= 1n << BigInt(targetIndex.get(targetId));
      pair.evidence.push({ targetId, eventIds: observations.map(o => o.action.id), gapMs });
    }
  }
  const edges = [...pairs.values()].filter(p => p.evidence.length >= policy.minSharedTargets);
  check(edges.length <= policy.maxEdges, 'EDGE_BUDGET');
  const adjacency = actors.map(() => new Set()), edgeMap = new Map();
  for (const edge of edges) {
    const [a, b] = edge.indexes;
    adjacency[a].add(b); adjacency[b].add(a); edgeMap.set(key(a, b), edge);
  }
  const edgeAt = (a, b) => edgeMap.get(key(Math.min(a, b), Math.max(a, b)));
  const masks = new Set(); let triangleTests = 0;
  for (let a = 0; a < actors.length; a++) for (const b of adjacency[a]) if (b > a)
    for (const c of adjacency[b]) if (c > b && adjacency[a].has(c)) {
      check(++triangleTests <= policy.maxTriangleTests, 'TRIANGLE_BUDGET');
      const mask = edgeAt(a, b).mask & edgeAt(a, c).mask & edgeAt(b, c).mask;
      if (popcount(mask) >= policy.minSharedTargets) masks.add(mask);
      check(masks.size <= policy.maxWitnessSets, 'WITNESS_BUDGET');
    }
  // Close under intersection: extra targets shared by different subgroups must
  // not hide the common repeated targets of their larger cohort.
  const witnessSets = [...masks]; let witnessIntersections = 0;
  for (let i = 0; i < witnessSets.length; i++) for (let j = 0; j < i; j++) {
    check(++witnessIntersections <= policy.maxWitnessIntersections, 'INTERSECTION_BUDGET');
    const mask = witnessSets[i] & witnessSets[j];
    if (popcount(mask) >= policy.minSharedTargets && !masks.has(mask)) {
      check(masks.size < policy.maxWitnessSets, 'WITNESS_BUDGET');
      masks.add(mask); witnessSets.push(mask);
    }
  }
  const patterns = new Map(); let cliqueSearchSteps = 0;
  for (const witnessMask of witnessSets.sort((a, b) => a < b ? -1 : a > b ? 1 : 0)) {
    const graph = actors.map(() => new Set());
    for (const edge of edges) if ((edge.mask & witnessMask) === witnessMask) {
      const [a, b] = edge.indexes; graph[a].add(b); graph[b].add(a);
    }
    // Bounded Bron-Kerbosch with pivoting: every returned cohort shares the
    // SAME targets, direction and <=60 s span, not merely a connecting path.
    function visit(selected, possible, excluded) {
      check(++cliqueSearchSteps <= policy.maxCliqueSearchSteps, 'SEARCH_BUDGET');
      check(selected.length <= policy.maxClusterActors, 'CLUSTER_ACTOR_BUDGET');
      if (selected.length + possible.size < policy.minClusterActors) return;
      if (!possible.size && !excluded.size) {
        const indexes = [...selected].sort((a, b) => a - b), id = key(...indexes);
        if (patterns.has(id)) return;
        let commonMask = edgeAt(indexes[0], indexes[1]).mask;
        for (let i = 0; i < indexes.length; i++) for (let j = i + 1; j < indexes.length; j++) commonMask &= edgeAt(indexes[i], indexes[j]).mask;
        check(patterns.size < policy.maxPatterns, 'PATTERN_BUDGET');
        patterns.set(id, { indexes, commonMask, support: (indexes.length - 1) * (popcount(commonMask) - 1) });
        return;
      }
      let pivot, degree = -1;
      for (const v of [...possible, ...excluded]) {
        const d = [...possible].filter(w => graph[v].has(w)).length;
        if (d > degree) { pivot = v; degree = d; }
      }
      for (const v of [...possible].filter(w => pivot === undefined || !graph[pivot].has(w)).sort((a, b) => a - b)) {
        visit([...selected, v], intersect(possible, graph[v]), intersect(excluded, graph[v]));
        possible.delete(v); excluded.add(v);
      }
    }
    visit([], new Set(graph.flatMap((neighbors, i) => neighbors.size >= policy.minClusterActors - 1 ? [i] : [])), new Set());
  }
  const all = [...patterns.values()];
  const supported = all.filter(p => p.support >= policy.minRepeatSupport);
  // Suppression requires a shared core of >=3 members AND >=50% more support.
  // A small support advantage must not erase a comparably supported cohort
  // when some of its members also share extra targets. Ambiguous overlaps stay
  // explicit; their independent impacts must not be summed.
  const retained = [];
  supported.sort((a, b) => b.support - a.support || cmp(key(...a.indexes), key(...b.indexes)));
  for (const p of supported) {
    if (!retained.some(q => policy.dominanceDenominator * q.support >= policy.dominanceNumerator * p.support
      && p.indexes.filter(a => q.indexes.includes(a)).length >= policy.minClusterActors
      && p.indexes.filter(a => !q.indexes.includes(a)).length < policy.minClusterActors)) retained.push(p);
  }
  retained.sort((a, b) => cmp(key(...a.indexes.map(i => actors[i])), key(...b.indexes.map(i => actors[i]))));
  check(retained.length <= policy.maxClusters, 'CLUSTER_BUDGET');
  const clusters = retained.map(p => {
    const members = p.indexes.map(i => actors[i]);
    const commonTargets = targetIds.filter((_, i) => p.commonMask & (1n << BigInt(i)));
    const witnesses = commonTargets.map(targetId => {
      const events = members.map(a => cells.get(key(a, targetId)));
      return { targetId, value: events[0].action.value, eventIds: events.map(o => o.action.id),
        spanMs: Math.max(...events.map(o => o.receivedAt)) - Math.min(...events.map(o => o.receivedAt)) };
    });
    const evidenceEdges = [];
    for (let i = 0; i < p.indexes.length; i++) for (let j = i + 1; j < p.indexes.length; j++) {
      const edge = edgeAt(p.indexes[i], p.indexes[j]);
      evidenceEdges.push({ actors: [members[i], members[j]], evidence: edge.evidence.filter(e => commonTargets.includes(e.targetId)) });
    }
    return { actors: members, witnesses, support: p.support, edges: evidenceEdges };
  });
  const occurrences = new Map();
  for (const c of clusters) for (const a of c.actors) occurrences.set(a, (occurrences.get(a) ?? 0) + 1);
  return { activeActors: actors.length, comparisons, triangleTests, witnessIntersections, cliqueSearchSteps,
    qualifyingPairCount: edges.length, weakPatternCount: all.length - supported.length,
    suppressedPatterns: supported.length - retained.length,
    overlappingActors: [...occurrences.values()].filter(n => n > 1).length,
    broadContexts, contextRequired: all.length > supported.length
      || new Set(broadContexts.map(c => c.targetId)).size >= policy.minSharedTargets, clusters };
}
