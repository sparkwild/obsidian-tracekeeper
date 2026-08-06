"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deriveMemoryGovernance = deriveMemoryGovernance;
exports.resolveMemoryLifecycle = resolveMemoryLifecycle;
function deriveMemoryGovernance(input) {
    if (!Number.isSafeInteger(input.evidence_count) || input.evidence_count < 0) {
        throw new Error('evidence_count must be a non-negative safe integer.');
    }
    const requestedAuthority = input.proposed_authority ?? 'agent';
    const requestedConfidence = input.proposed_confidence ?? 'uncertain';
    const authority = input.human_approved
        ? 'user'
        : input.source_backed
            ? 'source'
            : 'agent';
    let confidence_level = 'uncertain';
    if (input.human_approved && input.evidence_count > 0 && requestedConfidence === 'verified') {
        confidence_level = 'verified';
    }
    else if (input.evidence_count > 0
        && (input.source_backed || requestedConfidence === 'supported' || requestedConfidence === 'verified')) {
        confidence_level = 'supported';
    }
    else if (requestedConfidence !== 'uncertain') {
        confidence_level = 'inferred';
    }
    return {
        authority,
        confidence_level,
        downgraded: authority !== requestedAuthority || confidence_level !== requestedConfidence,
    };
}
function resolveMemoryLifecycle(input) {
    if (!Number.isSafeInteger(input.generation) || input.generation < 0) {
        throw new Error('Memory lifecycle generation must be a non-negative safe integer.');
    }
    const now = normalizeNow(input.now);
    const staleAfterDays = normalizeStaleAfterDays(input.staleAfterDays);
    const ordered = [...input.records].sort(compareMemoryRecords);
    const issues = [];
    const byId = new Map();
    const duplicateIds = new Set();
    for (const record of ordered) {
        if (byId.has(record.memory_id))
            duplicateIds.add(record.memory_id);
        else
            byId.set(record.memory_id, record);
    }
    for (const memoryId of [...duplicateIds].sort()) {
        issues.push({
            code: 'duplicate_memory_id',
            memory_ids: [memoryId],
            message: `Memory id is duplicated: ${memoryId}`,
        });
    }
    const resolutions = new Map();
    for (const record of ordered) {
        if (resolutions.has(record.memory_id))
            continue;
        resolutions.set(record.memory_id, {
            record,
            state: initialState(record, now),
            reasons: new Set(initialReasons(record, now)),
        });
    }
    for (const memoryId of duplicateIds)
        markState(resolutions.get(memoryId), 'review', 'duplicate_memory_id');
    const supersedes = new Map();
    for (const resolution of resolutions.values()) {
        const record = resolution.record;
        for (const targetId of record.supersedes) {
            const target = byId.get(targetId);
            if (!target) {
                issues.push(relationIssue('dangling_supersedes', record.memory_id, targetId));
                markState(resolution, 'review', 'dangling_supersedes');
                continue;
            }
            if (!sameClaim(record, target)) {
                issues.push(relationIssue('cross_claim_relation', record.memory_id, targetId));
                markState(resolution, 'review', 'cross_claim_supersedes');
                continue;
            }
            const targets = supersedes.get(record.memory_id) ?? [];
            targets.push(targetId);
            supersedes.set(record.memory_id, targets);
        }
        for (const targetId of record.contradicts) {
            const target = byId.get(targetId);
            if (!target) {
                issues.push(relationIssue('dangling_contradicts', record.memory_id, targetId));
                markState(resolution, 'review', 'dangling_contradicts');
                continue;
            }
            if (!sameClaim(record, target)) {
                issues.push(relationIssue('cross_claim_relation', record.memory_id, targetId));
                markState(resolution, 'review', 'cross_claim_contradicts');
                continue;
            }
            markState(resolution, 'disputed', 'explicit_contradiction');
            markState(resolutions.get(targetId), 'disputed', 'explicit_contradiction');
        }
    }
    for (const cycle of findSupersessionCycles(supersedes)) {
        issues.push({
            code: 'supersession_cycle',
            memory_ids: cycle,
            message: `Supersession cycle detected: ${cycle.join(' -> ')}`,
        });
        for (const memoryId of cycle)
            markState(resolutions.get(memoryId), 'review', 'supersession_cycle');
    }
    for (const [successorId, targetIds] of supersedes) {
        const successor = resolutions.get(successorId);
        if (!successor || successor.state === 'review' || successor.state === 'retracted')
            continue;
        for (const targetId of targetIds) {
            const target = resolutions.get(targetId);
            if (target && target.state !== 'review' && target.state !== 'retracted') {
                markState(target, 'superseded', `superseded_by:${successorId}`);
            }
        }
    }
    const groups = groupByClaim([...resolutions.values()]);
    for (const group of groups.values()) {
        const candidates = group.filter((row) => row.state === 'current');
        if (candidates.length <= 1)
            continue;
        const ids = candidates.map((row) => row.record.memory_id).sort();
        issues.push({
            code: 'duplicate_current',
            memory_ids: ids,
            message: `Multiple current records have no accepted relationship: ${ids.join(', ')}`,
        });
        for (const row of candidates)
            markState(row, 'disputed', 'duplicate_current');
    }
    if (staleAfterDays !== null) {
        const cutoff = now.getTime() - staleAfterDays * 86400000;
        for (const row of resolutions.values()) {
            const verifiedAt = row.record.last_verified_at;
            if (verifiedAt && Date.parse(verifiedAt) < cutoff) {
                issues.push({
                    code: 'stale_verification',
                    memory_ids: [row.record.memory_id],
                    message: `Memory verification is older than ${staleAfterDays} days.`,
                });
                row.reasons.add('stale_verification');
            }
        }
    }
    const rows = [...resolutions.values()].map(freezeResolution).sort(compareResolvedRows);
    const legacy = [...(input.legacy ?? [])]
        .map((projection) => ({
        projection,
        effective_state: 'legacy_unkeyed',
        reasons: ['missing_claim_key'],
    }))
        .sort((left, right) => left.projection.path.localeCompare(right.projection.path));
    return {
        generation: input.generation,
        resolved_at: now.toISOString(),
        records: rows,
        legacy,
        current: rows.filter((row) => row.effective_state === 'current'),
        history: rows.filter((row) => row.effective_state === 'superseded' || row.effective_state === 'retracted'),
        conflicts: rows.filter((row) => row.effective_state === 'disputed' || row.effective_state === 'review'),
        issues: dedupeIssues(issues),
    };
}
function initialState(record, now) {
    if (record.declared_state === 'retracted')
        return 'retracted';
    if (record.declared_state === 'review')
        return 'review';
    if (record.declared_state === 'disputed')
        return 'disputed';
    if (record.valid_from && Date.parse(record.valid_from) > now.getTime())
        return 'review';
    if (record.valid_to && Date.parse(record.valid_to) < now.getTime())
        return 'superseded';
    return 'current';
}
function initialReasons(record, now) {
    if (record.declared_state !== 'active')
        return [`declared_${record.declared_state}`];
    if (record.valid_from && Date.parse(record.valid_from) > now.getTime())
        return ['not_yet_valid'];
    if (record.valid_to && Date.parse(record.valid_to) < now.getTime())
        return ['validity_ended'];
    return [];
}
function sameClaim(left, right) {
    return left.scope === right.scope
        && left.project_id === right.project_id
        && left.claim_key === right.claim_key;
}
function groupByClaim(rows) {
    const groups = new Map();
    for (const row of rows) {
        const key = claimGroupKey(row.record.scope, row.record.project_id, row.record.claim_key);
        const group = groups.get(key) ?? [];
        group.push(row);
        groups.set(key, group);
    }
    return groups;
}
function claimGroupKey(scope, projectId, claimKey) {
    return `${scope}\u0000${projectId ?? ''}\u0000${claimKey}`;
}
function markState(row, state, reason) {
    if (!row)
        return;
    const priority = {
        current: 0,
        superseded: 1,
        disputed: 2,
        retracted: 3,
        review: 4,
        legacy_unkeyed: 5,
    };
    if (priority[state] >= priority[row.state])
        row.state = state;
    row.reasons.add(reason);
}
function relationIssue(code, memoryId, reference) {
    return {
        code,
        memory_ids: [memoryId],
        reference,
        message: `${code.replace(/_/g, ' ')}: ${memoryId} -> ${reference}`,
    };
}
function findSupersessionCycles(graph) {
    const state = new Map();
    const stack = [];
    const cycles = new Map();
    const visit = (node) => {
        state.set(node, 1);
        stack.push(node);
        for (const target of graph.get(node) ?? []) {
            if ((state.get(target) ?? 0) === 0)
                visit(target);
            else if (state.get(target) === 1) {
                const start = stack.lastIndexOf(target);
                const cycle = stack.slice(start).sort();
                cycles.set(cycle.join('\u0000'), cycle);
            }
        }
        stack.pop();
        state.set(node, 2);
    };
    for (const node of [...graph.keys()].sort())
        if ((state.get(node) ?? 0) === 0)
            visit(node);
    return [...cycles.values()].sort((left, right) => left.join().localeCompare(right.join()));
}
function freezeResolution(row) {
    return {
        record: row.record,
        effective_state: row.state,
        reasons: [...row.reasons].sort(),
    };
}
function compareMemoryRecords(left, right) {
    return left.memory_id.localeCompare(right.memory_id)
        || left.path.localeCompare(right.path);
}
function compareResolvedRows(left, right) {
    return Date.parse(right.record.observed_at) - Date.parse(left.record.observed_at)
        || left.record.memory_id.localeCompare(right.record.memory_id)
        || left.record.path.localeCompare(right.record.path);
}
function dedupeIssues(issues) {
    const unique = new Map();
    for (const issue of issues) {
        const key = `${issue.code}\u0000${[...issue.memory_ids].sort().join(',')}\u0000${issue.reference ?? ''}`;
        unique.set(key, { ...issue, memory_ids: [...issue.memory_ids].sort() });
    }
    return [...unique.values()].sort((left, right) => left.code.localeCompare(right.code)
        || left.memory_ids.join().localeCompare(right.memory_ids.join())
        || (left.reference ?? '').localeCompare(right.reference ?? ''));
}
function normalizeNow(value) {
    const parsed = value ? new Date(value) : new Date();
    if (Number.isNaN(parsed.getTime()))
        throw new Error('Memory lifecycle now must be a valid timestamp.');
    return parsed;
}
function normalizeStaleAfterDays(value) {
    if (value === undefined)
        return null;
    if (!Number.isSafeInteger(value) || value < 1) {
        throw new Error('staleAfterDays must be a positive safe integer.');
    }
    return value;
}
