import assert from 'node:assert/strict';
import test from 'node:test';
import { comparisonPlan, parseComparisonArgs, runComparison, comparisonExecutionOk } from './compare-builds.mjs';
import { assessComparison, longNote } from './comparison-fixture.mjs';

test('build comparison previews exactly twelve counterbalanced runs without execution', async () => {
 const plan=comparisonPlan();
 assert.equal(plan.length,12);
 for(const id of new Set(plan.map(row=>row.scenario))) assert.deepEqual(new Set(plan.filter(row=>row.scenario===id).map(row=>row.build)),new Set(['baseline','candidate']));
 const result=await runComparison(parseComparisonArgs(['--baseline-root','.']));
 assert.equal(result.dry_run,true); assert.equal(result.model,'gpt-6-astra'); assert.equal(result.reasoning_effort,'max');
 assert.throws(()=>parseComparisonArgs(['--baseline-root']),/value/);
 assert.throws(()=>parseComparisonArgs(['--baseline-root','.','--execute']),/output-dir/);
});

test('comparison grading rejects absent receipts, version mixing and no-track tool use', () => {
 assert.equal(assessComparison('no-track',[{tool:'tracekeeper.recall'}],'Hello').passed,false);
 assert.equal(assessComparison('auto-closeout',[],'Saved successfully').passed,false);
 const call={tool:'tracekeeper.read_note',arguments:{offset:5},result:{ok:true}};
 assert.equal(assessComparison('read-windows',[call],'amber 30').passed,false);
 assert.equal(assessComparison('changed-note',[],'blue 60').passed,false);
 assert.ok(longNote().length>16384);
 assert.ok(longNote(2).includes('Headmarker: blue'));
});


test('failed or quota-limited execution cannot be counted as a successful comparison run', () => {
 assert.equal(comparisonExecutionOk({exit_code:0,timed_out:false},[{type:'turn.failed'}]),false);
 assert.equal(comparisonExecutionOk({exit_code:1,timed_out:false},[]),false);
 assert.equal(comparisonExecutionOk({exit_code:0,timed_out:true},[]),false);
 assert.equal(comparisonExecutionOk({exit_code:0,timed_out:false},[{type:'turn.completed'}]),true);
});
