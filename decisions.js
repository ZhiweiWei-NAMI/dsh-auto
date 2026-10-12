// Conservative byte budget for Jev's documented 32k state + longest-question
// limit. This is a transport bound, not a token or billing measurement.
export const STATE_BYTES = 24000;
const size = value => Buffer.byteLength(JSON.stringify(value));

export function extendTask(task,messages) {
  const requests=messages.filter(message=>message.source.kind==='user')
    .map(message=>message.content.filter(block=>block.type==='text').map(block=>block.text).join('\n'));
  return [task,...requests].filter(Boolean).join('\n\n');
}

export function selectionBatches(task, history) {
  const base = {task, trigger:'selection', history:[]};
  if (size(base) + 1000 >= STATE_BYTES) throw new Error('The complete task exceeds the Jev decision state budget.');
  const batches = [];
  let batch = {...base, history:[]}, sources = new Map();
  const flush = () => {
    if (batch.history.length) batches.push({request:batch, sources});
    batch = {...base, history:[]}; sources = new Map();
  };
  for (const unit of history.filter(unit => !unit.required)) {
    if (size({...base, history:[unit]}) <= STATE_BYTES) {
      if (size({...batch, history:[...batch.history,unit]}) > STATE_BYTES) flush();
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

export async function pressureDecision(decide, task, history, observation, actions) {
  const control = {task,trigger:'pressure',history:[],observation:{...observation,candidateCount:history.length},actions};
  if (size(control) + 1000 >= STATE_BYTES) throw new Error('The complete task exceeds the Jev decision state budget.');
  // Include complete recent evidence when it fits; identify what was withheld
  // from this routing call. Selection, when needed, judges every source.
  const withheld = [];
  for (const unit of history.slice(-3)) {
    const recent = {...unit,required:true};
    if (size({...control,history:[...control.history,recent]}) + 1000 < STATE_BYTES) control.history.push(recent);
    else withheld.push(unit.id);
  }
  control.observation.recentEvidenceOutsideRoutingBudget = withheld;
  const route = await decide(control);
  if (route.action === 'keep') return route;
  if (route.action !== 'select') throw new Error('Jev pressure decision returned an unsupported action.');
  const selected = new Set(history.filter(unit => unit.required).map(unit => unit.id));
  const batches = selectionBatches(task,history);
  for (const {request,sources} of batches) {
    const result = await decide(request);
    for (const id of result.selectedIds) {
      if (!sources.has(id)) throw new Error('Jev returned an unoffered context ID.');
      selected.add(sources.get(id));
    }
  }
  // This is client composition of recorded primitive answers, not invented
  // aggregate usage. Each real call is separately recorded by decide().
  return {...route,selectedIds:history.filter(unit => selected.has(unit.id)).map(unit => unit.id)};
}
