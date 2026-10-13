// Conservative byte budget for Jev's documented 32k state + longest-question
// limit. This is a transport bound, not a token or billing measurement.
export const STATE_BYTES = 24000;
import {contextQuestions} from './routing.js';
const size = value => Buffer.byteLength(JSON.stringify(value));

export function extendTask(task,messages) {
  const requests=messages.filter(message=>message.source.kind==='user')
    .map(message=>message.content.filter(block=>block.type==='text').map(block=>block.text).join('\n'));
  return [task,...requests].filter(Boolean).join('\n\n');
}

export function selectionBatches(task, history, observation={}) {
  const base = {task, trigger:'selection', history:[], observation};
  if (size(base) + 1000 >= STATE_BYTES) throw new Error('The complete task exceeds the Jev decision state budget.');
  const batches = [];
  let batch = {...base, history:[]}, sources = new Map();
  const flush = () => {
    if (batch.history.length) batches.push({request:batch, sources});
    batch = {...base, history:[]}; sources = new Map();
  };
  for (const unit of history.filter(unit => !unit.required)) {
    if (size({...base, history:[unit]}) <= STATE_BYTES) {
      if (batch.history.length>=32 || size({...batch, history:[...batch.history,unit]}) > STATE_BYTES) flush();
      batch.history.push(unit); sources.set(unit.id, unit.id);
      continue;
    }
    // Judge every part of an oversized source. Any retained part keeps the
    // WHOLE original source in the execution history; its tail is never lost.
    flush();
    const characters = Array.from(unit.text);
    let offset = 0, part = 0;
    while (offset < characters.length) {
      const id = unit.id+'.part.'+(++part);
      let low = 1, high = characters.length-offset, fits = 0;
      while (low <= high) {
        const count = Math.floor((low+high)/2);
        const candidate = {...unit,id,text:characters.slice(offset,offset+count).join('')};
        if (size({...base,history:[candidate]}) <= STATE_BYTES) { fits=count; low=count+1; }
        else high=count-1;
      }
      if (!fits) throw new Error('A context record cannot fit the Jev decision state budget.');
      const candidate = {...unit,id,text:characters.slice(offset,offset+fits).join('')};
      batches.push({request:{...base,history:[candidate]},sources:new Map([[id,unit.id]])});
      offset += fits;
    }
  }
  flush();
  return batches;
}

export async function scoreContext(decide, task, history, owners, observation, confidenceThreshold=0.5) {
  const selected=new Set(history.filter(unit=>unit.required).map(unit=>unit.id));
  const judgments=[];let model;
  for (const {request,sources} of selectionBatches(task,history,observation)) {
    request.questions=contextQuestions(request.history,owners);
    const result=await decide(request);model=result.model;
    for (const [i,unit] of request.history.entries()) {
      const importance=result.answers['importance_'+i],owner=result.answers['owner_'+i];
      const original=sources.get(unit.id);
      const retained=importance.confidence<confidenceThreshold || importance.score>=1 || owner.confidence<confidenceThreshold || owner.choice==='shared';
      if (retained) selected.add(original);
      judgments.push({source:original,part:unit.id,importance,owner,retained});
    }
  }
  return {model,selectedIds:history.filter(unit=>selected.has(unit.id)).map(unit=>unit.id),judgments};
}
