import test from 'node:test';
import assert from 'node:assert/strict';
import {selectDelegation,validateJevAnswers} from '../routing.js';
const profiles=[{id:'general/high',routeId:'general'},{id:'review/high',routeId:'review'}];
const answer={independent:{noul:0.95},useful:{score:1.9,confidence:0.9},fit_0:{score:1.8,confidence:0.8},fit_1:{score:1.8,confidence:0.8}};
const weights={quality:1,latency:0.5,usage:0.5,cache:1};
test('configured initial preferences affect the chosen eligible native profile',()=>{
  assert.equal(selectDelegation(answer,profiles,[],{weights,routeWeights:{general:1,review:0}},{canCreate:true}).profile.routeId,'general');
  assert.equal(selectDelegation(answer,profiles,[],{weights,routeWeights:{general:0,review:1}},{canCreate:true}).profile.routeId,'review');
  assert.equal(selectDelegation(answer,profiles,[],{weights,routeWeights:{general:0.5}},{canCreate:true}).profile.routeId,'general');
  const inheritedNames=[{id:'constructor/high',routeId:'constructor'},{id:'toString/high',routeId:'toString'}];
  assert.deepEqual(selectDelegation(answer,inheritedNames,[],{weights,routeWeights:{}},{canCreate:true}).ranking.map(x=>x.weightedScore),[1.8,1.8]);
});
test('an explicitly invalid route preference is a configuration error, not a default',()=>{
  for (const routeWeights of [{general:'high'},{general:-0.1},{general:1.5},{general:null}])
    assert.throws(()=>selectDelegation(answer,profiles,[],{weights,routeWeights},{canCreate:true}),/routeWeights\.general/);
});
test('direct Jev answers require valid primitive fields',()=>{
  const questions={useful:{type:'score',criteria:['a','b','c']},independent:{type:'noul'},
    fit_0:{type:'score',criteria:['a','b','c']},owner:{type:'choice',criteria:{current:'c',archive:'a'}}};
  assert.equal(validateJevAnswers(questions,{useful:{type:'score',score:1.9,confidence:0.9},
    independent:{type:'noul',noul:0.95},fit_0:{type:'score',score:1.8,confidence:0.8},owner:{type:'choice',choice:'current',confidence:0.9}}),null);
  assert.match(validateJevAnswers(questions,{useful:{type:'score',score:1.9},independent:{type:'noul',noul:0.95},
    fit_0:{type:'score',score:1.8,confidence:0.8},owner:{type:'choice',choice:'current',confidence:0.9}}),/useful: missing or invalid confidence/);
  assert.match(validateJevAnswers(questions,{useful:{type:'score',score:1.9,confidence:0.9},independent:{type:'noul',noul:2},
    fit_0:{type:'score',score:1.8,confidence:0.8},owner:{type:'choice',choice:'current',confidence:0.9}}),/independent: missing or invalid noul/);
  assert.match(validateJevAnswers(questions,{useful:{type:'score',score:1.9,confidence:0.9},independent:{type:'noul',noul:0.95},
    fit_0:{type:'score',score:1.8,confidence:0.8},owner:{type:'choice',choice:'other',confidence:0.9}}),/owner: choice was not offered/);
  assert.match(validateJevAnswers({owner:{type:'choice',criteria:{shared:'Shared evidence'}}},
    {owner:{type:'choice',choice:['shared'],confidence:0.9}}),/owner: choice was not offered/);

});
test('ambiguous benefit does not start expensive investigation',()=>{
  const uncertain={...answer,useful:{score:1.8,confidence:0.09}};
  assert.equal(selectDelegation(uncertain,profiles,[],null,{canCreate:true}).action,'main');
});
test('a matching continuing conversation can be reused when new child slots are exhausted',()=>{
  const result=selectDelegation({...answer,reuse_0:{score:1.95,confidence:0.9}},profiles,[{id:'existing'}],null,{canCreate:false});
  assert.equal(result.action,'reuse');assert.equal(result.child.id,'existing');
});
