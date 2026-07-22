function selectedSummary(scenarios, report, predicate) {
	const ids = new Set(scenarios.filter(predicate).map((scenario) => scenario.id));
	const cases = report.cases.filter((entry) => ids.has(entry.scenario_id));
	return {
		count: cases.length,
		passed_count: cases.filter((entry) => entry.passed).length,
		average_score: cases.length
			? Number((cases.reduce((sum, entry) => sum + entry.score, 0) / cases.length).toFixed(2))
			: 0,
	};
}

export function buildComparison(scenarios, v1, v2) {
	const v1Cases = new Map(v1.cases.map((entry) => [entry.scenario_id, entry]));
	const v2Cases = new Map(v2.cases.map((entry) => [entry.scenario_id, entry]));
	const improvedScenarioIds = [];
	const regressedScenarioIds = [];
	for (const scenario of scenarios) {
		const before = v1Cases.get(scenario.id);
		const after = v2Cases.get(scenario.id);
		if (!before || !after) {
			throw new Error(`Comparison is missing scenario ${scenario.id}.`);
		}
		if (after.score > before.score || (after.passed && !before.passed)) {
			improvedScenarioIds.push(scenario.id);
		}
		if (after.score < before.score || (!after.passed && before.passed)) {
			regressedScenarioIds.push(scenario.id);
		}
	}
	const v1NoTrack = selectedSummary(scenarios, v1, (scenario) => scenario.class === 'no_track');
	const v2NoTrack = selectedSummary(scenarios, v2, (scenario) => scenario.class === 'no_track');
	const v1Forbidden = selectedSummary(scenarios, v1, (scenario) => scenario.kind === 'forbidden');
	const v2Forbidden = selectedSummary(scenarios, v2, (scenario) => scenario.kind === 'forbidden');
	return {
		comparison_id: 'skill-v1-vs-v2-agent-initiative',
		scenario_count: scenarios.length,
		v1,
		v2,
		delta: {
			average_score: Number((v2.average_score - v1.average_score).toFixed(2)),
			passed_count: v2.passed_count - v1.passed_count,
			recall_only_classification_accuracy: Number((
				v2.class_summary.recall_only.classification_accuracy - v1.class_summary.recall_only.classification_accuracy
			).toFixed(4)),
			improved_scenario_ids: improvedScenarioIds,
			regressed_scenario_ids: regressedScenarioIds,
		},
		guardrails: {
			recall_only_initiative_improved:
				v2.class_summary.recall_only.classification_accuracy > v1.class_summary.recall_only.classification_accuracy,
			no_track_not_regressed:
				v2NoTrack.passed_count >= v1NoTrack.passed_count && v2NoTrack.average_score >= v1NoTrack.average_score,
			forbidden_not_regressed:
				v2Forbidden.passed_count >= v1Forbidden.passed_count && v2Forbidden.average_score >= v1Forbidden.average_score,
		},
		group_summary: {
			no_track: { v1: v1NoTrack, v2: v2NoTrack },
			forbidden: { v1: v1Forbidden, v2: v2Forbidden },
		},
	};
}
