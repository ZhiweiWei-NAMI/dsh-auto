import test from 'node:test';
import assert from 'node:assert/strict';
import {STATE_BYTES,selectionBatches,pressureDecision} from '../decisions.js';

test('all oversized Unicode source content is judged and a useful tail keeps the whole source',async()=>{
  const full = '实验记录😃\n'.repeat(14000)+'TAIL_REQUIREMENT';
  const history = [{id:'instruction',kind:'user',text:'Do not alter the required API.',required:true},
    {id:'long',kind:'assistant',text:full,required:false},{id:'old',kind:'tool',text:'unrelated evidence',required:false}];
  const batches = selectionBatches('Fix the required API.',history);
  const parts = batches.flatMap(batch=>batch.request.history).filter(unit=>unit.id.startsWith('long.part.'));
  assert.equal(parts.map(unit=>unit.text).join(''),full);
  for (const {request} of batches) assert.ok(Buffer.byteLength(JSON.stringify(request))<=STATE_BYTES);
  const requests=[];
  const result=await pressureDecision(async request=>{
    requests.push(request);
    if (request.actions) return {action:'select',selectedIds:[],model:'jev-1.13-free'};
    return {selectedIds:request.history.filter(unit=>unit.text.includes('TAIL_REQUIREMENT')).map(unit=>unit.id)};
  },'Fix the required API.',history,{estimatedContextTokens:100000},{keep:'Keep',select:'Select'});
  assert.deepEqual(result.selectedIds,['instruction','long']);
  assert.ok(requests.length>2);
});

test('keeping the warmed prefix uses one small real decision request',async()=>{
  const history=[{id:'large',kind:'assistant',text:'x'.repeat(180000),required:false}];
  let calls=0;
  const result=await pressureDecision(async request=>{
    calls++;
    assert.ok(Buffer.byteLength(JSON.stringify(request))<STATE_BYTES);
    assert.equal(request.task,'Complete original task.');
    assert.deepEqual(request.observation.recentEvidenceOutsideRoutingBudget,['large']);
    return {action:'keep',selectedIds:[],model:'jev-1.13-free'};
  },'Complete original task.',history,{estimatedContextTokens:80000},{keep:'Keep',select:'Select'});
  assert.equal(calls,1);assert.equal(result.action,'keep');
});

test('a failed primitive decision is not retried or replaced with a synthetic keep',async()=>{
  let calls=0;
  await assert.rejects(pressureDecision(async()=>{calls++;throw new Error('HTTP 401');},'Task',[],{},
    {keep:'Keep',select:'Select'}),/HTTP 401/);
  assert.equal(calls,1);
});
