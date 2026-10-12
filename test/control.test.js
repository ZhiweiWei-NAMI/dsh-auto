import test from 'node:test';
import assert from 'node:assert/strict';
import {apply} from '../index.js';

function composition(mode) {
  const handlers = new Map();
  let guard;
  const ctx = {tools:{guard(fn){guard=fn;}}, on(name,fn){handlers.set(name,fn);}};
  apply(ctx,{mode,maxChildren:2,maxConcurrent:2,pressureTokens:24000,retainTokens:8000});
  return {guard,handlers};
}

test('ordinary native tool executions remain usable in single-agent mode',()=>{
  const {guard}=composition('single');
  assert.equal(guard({name:'bash',arguments:{command:'python -m unittest'},callId:'call-1'}),undefined);
  assert.match(guard({name:'subagent',arguments:{},callId:'call-2'}),/main agent only/);
});

test('native delegation reservations share a task limit and release on failure',()=>{
  const {guard,handlers}=composition('native');
  const agent={session:{id:'root',header:{}}};
  const first={name:'subagent',callId:'first',agent};
  const second={name:'subagent_fork',callId:'second',agent};
  assert.equal(guard(first),undefined);
  assert.equal(guard(second),undefined);
  assert.match(guard({name:'subagent',callId:'third',agent}),/limit reached/);
  handlers.get('tools/result')(first,{isError:true});
  assert.equal(guard({name:'subagent',callId:'replacement',agent}),undefined);
  const unrelated={session:{id:'other-task',header:{}}};
  assert.equal(guard({name:'subagent',callId:'other',agent:unrelated}),undefined);
});
