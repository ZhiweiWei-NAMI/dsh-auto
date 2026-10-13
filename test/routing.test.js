import test from 'node:test';
import assert from 'node:assert/strict';
import {selectDelegation} from '../routing.js';
const profiles=[{id:'general/high',routeId:'general'},{id:'review/high',routeId:'review'}];
const answer={independent:{noul:0.95},useful:{score:1.9,confidence:0.9},fit_0:{score:1.8,confidence:0.8},fit_1:{score:1.8,confidence:0.8}};
const weights={quality:1,latency:0.5,usage:0.5,cache:1};
test('configured initial preferences affect the chosen eligible native profile',()=>{
  assert.equal(selectDelegation(answer,profiles,[],{weights,routeWeights:{general:1,review:0}},{canCreate:true}).profile.routeId,'general');
  assert.equal(selectDelegation(answer,profiles,[],{weights,routeWeights:{general:0,review:1}},{canCreate:true}).profile.routeId,'review');
});
test('ambiguous benefit does not start expensive investigation',()=>{
  const uncertain={...answer,useful:{score:1.8,confidence:0.09}};
  assert.equal(selectDelegation(uncertain,profiles,[],null,{canCreate:true}).action,'main');
});
test('a matching continuing conversation can be reused when new child slots are exhausted',()=>{
  const result=selectDelegation({...answer,reuse_0:{score:1.95,confidence:0.9}},profiles,[{id:'existing'}],null,{canCreate:false});
  assert.equal(result.action,'reuse');assert.equal(result.child.id,'existing');
});
