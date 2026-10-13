import test from 'node:test';
import assert from 'node:assert/strict';
import {STATE_BYTES,selectionBatches,scoreContext,extendTask} from '../decisions.js';

test('continued user requirements preserve complete tails and update the decision task',()=>{
  const original='Implement the issue while keeping its public API.';
  const request='Detailed constraint. '.repeat(200)+'Keep the Unicode suffix.';
  const updated=extendTask(original,[{source:{kind:'user'},content:[{type:'text',text:request}]},
    {source:{kind:'plugin'},content:[{type:'text',text:'A transient plugin notice.'}]}]);
  assert.ok(updated.startsWith(original));assert.ok(updated.endsWith('Keep the Unicode suffix.'));
  assert.ok(updated.includes(request));assert.ok(!updated.includes('transient plugin'));
});

test('every oversized source part is scored and useful tail preserves the whole source',async()=>{
  const full='实验记录😃\n'.repeat(14000)+'TAIL_REQUIREMENT';
  const history=[{id:'instruction',kind:'user',text:'Keep the public API.',required:true},
    {id:'long',kind:'assistant',text:full,required:false},{id:'old',kind:'tool',text:'Obsolete unrelated evidence',required:false}];
  const batches=selectionBatches('Fix the public API.',history);
  assert.equal(batches.flatMap(b=>b.request.history).filter(x=>x.id.startsWith('long.part.')).map(x=>x.text).join(''),full);
  const result=await scoreContext(async request=>{
    const answers={};
    for(const [i,unit] of request.history.entries()){
      const useful=unit.text.includes('TAIL_REQUIREMENT');
      answers['importance_'+i]={type:'score',score:useful?2:0,confidence:0.9};
      answers['owner_'+i]={type:'choice',choice:useful?'current':'archive',confidence:0.9};
    }
    return {model:'jev-1.13-free',answers};
  },'Fix the public API.',history,{},{});
  assert.deepEqual(result.selectedIds,['instruction','long']);
});

test('no uncertain context score is treated as evidence to discard the source',async()=>{
  const result=await scoreContext(async()=>({model:'jev-1.13-free',answers:{
    importance_0:{score:0.2,confidence:0.1},owner_0:{choice:'archive',confidence:0.9}
  }}),'Task',[{id:'evidence',text:'Potentially essential evidence',required:false}],{},{});
  assert.deepEqual(result.selectedIds,['evidence']);
});

test('a failed primitive request is not retried or replaced with a synthetic keep',async()=>{
  let calls=0;
  await assert.rejects(scoreContext(async()=>{calls++;throw new Error('HTTP 401');},'Task',[{id:'evidence',text:'Source',required:false}],{},{}),/HTTP 401/);
  assert.equal(calls,1);
});
