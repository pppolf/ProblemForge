import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreGroups, scoreExpectation, groupOrder, interactionVerdict } from './index.ts';
import type { SandboxResult } from '@problemforge/judge-adapter';

test('fixed-point group weights and transitive dependencies are hand-computable; CE never matches score expectation',()=>{
  const member=(id:string)=>({testId:id,revisionId:id,weight:1});
  const groups=[{id:'small',points:20,aggregation:'ALL' as const,members:[member('1')],dependencies:[],extraValidatorIds:[]},{id:'middle',points:30,aggregation:'WEIGHTED' as const,members:[member('2'),member('3')],dependencies:['small'],extraValidatorIds:[]},{id:'large',points:50,aggregation:'ALL' as const,members:[member('4')],dependencies:['middle'],extraValidatorIds:[]}];
  const cases=['AC','AC','WA','AC'].map((verdict,i)=>({revisionId:String(i+1),verdict}));
  const scored=scoreGroups('s',groups,cases);
  assert.equal(scored.totalScoreMilli,35000);assert.deepEqual(scored.groups.map(g=>[g.rawScoreMilli,g.scoreMilli]),[[20000,20000],[15000,15000],[50000,0]]);
  assert.throws(()=>groupOrder(groups.map((g,i)=>i===0?{...g,dependencies:['large']}:g)),/环/);
  const ce=scoreGroups('s',groups,cases.map(c=>({...c,verdict:'CE'})));
  assert.equal(scoreExpectation({role:'WRONG_SOLUTION',expectedVerdicts:['WA'],expectedScore:{total:{min:0,max:0},groups:[]}},ce,['CE']).passed,false);
  const thirds=[{...groups[1],points:1,dependencies:[],members:[member('1'),member('2'),member('3')]}];
  assert.equal(scoreGroups('s',thirds,[{revisionId:'1',verdict:'AC'}]).totalScoreMilli,333);
});
test('interaction preserves real tool rejection and resource attribution over peer cleanup',()=>{
  const result=(status='Accepted',exitStatus=0):SandboxResult=>({status,exitStatus,time:1,memory:1,runTime:1});
  assert.equal(interactionVerdict(result('Signalled',9),result('Nonzero Exit Status',1),result(),{kind:'EOF',direction:'INTERACTOR_TO_CONTESTANT'}).verdict,'WA');
  assert.equal(interactionVerdict(result('Time Limit Exceeded',9),result('Nonzero Exit Status',2),result()).verdict,'TLE');
  assert.equal(interactionVerdict(result('Signalled',9),result('Nonzero Exit Status',2),result(),{kind:'IDLE'}).verdict,'TLE');
  assert.equal(interactionVerdict(result(),result('Nonzero Exit Status',3),result()).verdict,'TOOL_ERROR');
  assert.equal(interactionVerdict(result(),result('Nonzero Exit Status',1),result('Signalled',11),{kind:'INTERACTOR_EXIT',exitCode:1}).verdict,'INFRA_ERROR');
});
