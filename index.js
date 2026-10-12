import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
import z from '@deepseek-ai/schemastery';
import BasicCompactionEngine from '@deepseek-ai/dsh-compaction-basic';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { toolPairingBalancedBefore, toolPairingBalancedAfter } from '@deepseek-ai/dsh-compaction';
import { pressureDecision,extendTask } from './decisions.js';

export const name = 'magpie-auto';
export const inject = ['llm', 'tokenMeter', 'sessions', 'subagents', 'tools', 'agents'];
export const Config = z.object({
  mode: z.union(['auto', 'single', 'native']).default('auto'),
  endpoint: z.string().default('http://127.0.0.1:3435/v1/auto/decide'),
  maxChildren: z.number().step(1).min(0).default(2),
  maxConcurrent: z.number().step(1).min(1).default(2),
  pressureTokens: z.number().min(1024).default(24000),
  retainTokens: z.number().min(1024).default(8000),
  recordFile: z.string(),
});

const delegation = new Set(['subagent', 'subagent_fork']);
const text = message => message.content.filter(b => b.type === 'text').map(b => b.text).join('\n');

// Extends dsh's compaction transaction; adds no agent execution runtime.
export function apply(ctx, config) {
  const roots = new Map();
  const budgets = new Map(), childParents = new Map();
  const rootOf = agent => agent.session.header.parentSession ?? agent.session.id;
  const budget = id => {
    if (!budgets.has(id)) budgets.set(id, {children:0, active:0, pending:new Set()});
    return budgets.get(id);
  };
  const record = value => {
    if (config.recordFile) fs.appendFileSync(config.recordFile, JSON.stringify({at: new Date().toISOString(), ...value})+'\n', {mode: 0o600});
  };
  async function decide(agent, request, signal) {
    const started = performance.now();
    const response = await fetch(config.endpoint, {
      method: 'POST', headers: {'Content-Type':'application/json', 'Authorization':'Bearer magpie', 'User-Agent':'dsh-auto'},
      body: JSON.stringify({sessionId: agent.session.id, ...request}), signal,
    });
    const result = await response.json();
    record({kind:'jev', session:agent.session.id, trigger:request.trigger, httpStatus:response.status, wallMs:performance.now()-started, ...result});
    if (!response.ok) throw new Error(`Magpie Jev decision failed (HTTP ${response.status}): ${typeof result.error === 'string' ? result.error : JSON.stringify(result.error ?? result)}`);
    return result;
  }

  ctx.tools.guard(execution => {
    if (!delegation.has(execution.name)) return;
    if (config.mode === 'single') return 'This task permits one main agent only.';
    if (config.mode === 'auto') return 'Jev controls collaboration for this task; use the supplied native child results.';
    if (!execution.agent) return 'Delegation requires a native dsh agent.';
    const state = budget(rootOf(execution.agent));
    if (state.children + state.pending.size >= config.maxChildren || state.active + state.pending.size >= config.maxConcurrent) return 'Task subagent resource limit reached.';
    state.pending.add(execution.callId);
  });
  ctx.on('tools/result', (execution,result) => {
    if (delegation.has(execution.name) && execution.agent) {
      budget(rootOf(execution.agent)).pending.delete(execution.callId);
      if (config.mode === 'native') record({kind:'native_child_tool_result',parent:execution.agent.session.id,
        callId:execution.callId,tool:execution.name,isError:result.isError,value:result.value,error:result.error});
    }
  });
  ctx.on('subagent/start', info => {
    const child = ctx.agents.get(info.id);
    if (!child) throw new Error('Auto requires the native in-process child provider.');
    const parent = rootOf(child), state = budget(parent);
    childParents.set(info.id, parent); state.children++; state.active++;
    if (state.pending.size) state.pending.delete(state.pending.values().next().value);
    record({kind:'child_start', ...info, parent, active:state.active});
  });
  ctx.on('subagent/end', info => {
    const parent = childParents.get(info.id);
    if (parent === undefined) throw new Error('Child ended without a recorded native start.');
    const state = budget(parent); state.active--;
    record({kind:'child_end', ...info, parent, active:state.active});
  });

  const prepared = new Map(), nextPressure = new Map();
  const render = m => m.role+':\n'+m.content.map(b => b.type === 'text' || b.type === 'reasoning' ? b.text : JSON.stringify(b)).join('\n');
  class JevCompaction extends BasicCompactionEngine {
    async summarize(input, agent) {
      const plan = prepared.get(agent.session.id);
      if (!plan) throw new Error('Compaction requires a prepared Jev selection.');
      // No second model call; native dsh owns validation, provenance and replacement.
      return {summary:plan.summary, provider:'opencode-console', model:plan.model};
    }
  }
  const compactor = config.mode === 'auto' ? new JevCompaction(ctx, {auto:false, compactionRetries:0, maxOverflowRetries:0}) : undefined;

  ctx.on('agent/pre-step', async (payload, next) => {
    const {agent, signal, messages} = payload;
    const isChild = agent.session.header.parentSession !== undefined;
    if (roots.has(agent.session.id)) roots.set(agent.session.id,extendTask(roots.get(agent.session.id),messages));
    else if (isChild) roots.set(agent.session.id,messages.map(text).join('\n'));
    if (!isChild && !roots.has(agent.session.id)) {
      const task = messages.map(text).join('\n');
      roots.set(agent.session.id, task);
      record({kind:'root_start', session:agent.session.id});
      if (config.mode === 'auto') {
        const actions = {single:'One main coding agent. Best for a small sequential fix.'};
        if (config.maxChildren - budget(agent.session.id).children >= 1) actions.review = 'An independent read-only investigator inspects the issue, code, and likely regression tests before the main agent implements the fix.';
        if (config.maxChildren - budget(agent.session.id).children >= 2 && config.maxConcurrent >= 2) actions.parallel = 'Two independent read-only investigators work concurrently: one locates the cause, one examines edge cases and regression tests. Best when these investigations are substantial and separable.';
        const result = await decide(agent, {task, trigger:'task_start', history:[], actions}, signal);
        if (result.action !== 'single') {
          const roles = result.action === 'parallel' ? ['Find the cause and relevant implementation.', 'Find edge cases and an appropriate regression test.'] : ['Independently investigate the cause, edge cases, and regression tests.'];
          const runs = [];
          try {
            for (const role of roles) {
              const run = await ctx.subagents.start('spawn', {
                parent:agent, signal, label:role, maxDepth:1,
                prompt:[{type:'text', text:`${task}\n\nYour responsibility: ${role}\nRead-only investigation: do not edit any files. You share the workspace with the main agent; do not undo its work. Return concrete findings and test commands.`}],
                agentOptions:{provider:agent.options.provider, model:agent.options.model},
              });
              runs.push(run);
            }
            const outcomes = await Promise.all(runs.map(run => run.result));
            const notes = outcomes.map((outcome, i) => {
              record({kind:'child_collected', parent:agent.session.id, role:roles[i], stopReason:outcome.stopReason});
              if (outcome.stopReason !== 'completed') throw new Error(`Native child failed: ${JSON.stringify(outcome.stopReason)}`);
              return roles[i]+'\n'+outcome.output.filter(b => b.type === 'text').map(b => b.text).join('\n');
            });
            const admitted = await next();
            if (admitted.kind === 'reject') return admitted;
            return {...admitted, messages:[...admitted.messages, createUserMessage({content:[{type:'text', text:'Collected independent investigation results:\n'+notes.join('\n\n')}], source:{kind:'plugin',plugin:'dsh-auto'}})]};
          } finally { await Promise.all(runs.map(run => run.dispose())); }
        }
      }
    }
    if (compactor && agent.session.requestHeader() !== undefined) {
      const measured = ctx.tokenMeter.measure(agent.session);
      if (measured.totalTokens >= Math.max(config.pressureTokens, nextPressure.get(agent.session.id) ?? config.pressureTokens)) {
        const nodes = [...agent.session.surface.nodes];
        let start = 2, end = nodes.length-1, kept = 0;
        while (end >= start && kept < config.retainTokens) { kept += measured.nodes[end].tokens; end--; }
        while (start <= end && !toolPairingBalancedBefore(agent.session, nodes[start])) start++;
        while (end >= start && !toolPairingBalancedAfter(agent.session, nodes[end])) end--;
        if (end > start) {
          const region = nodes.slice(start, end+1).map(seq => ({seq, message:agent.session.deriveEventMessage(agent.session.eventAt(seq))})).filter(x => x.message !== null);
          const history = region.map(x => ({id:'event_'+x.seq, kind:x.message.role, text:JSON.stringify(x.message), required:x.message.source.kind === 'user'}));
          const usage = agent.session.snapshotEvents().toReversed().find(e => e.data?.usage !== undefined)?.data.usage;
          const task = roots.get(agent.session.id) ?? region.filter(x => x.message.source.kind === 'user').map(x => text(x.message)).join('\n');
          const decision = await pressureDecision(request => decide(agent,request,signal),task,history,
            {nativeUsage:usage, estimatedContextTokens:measured.totalTokens,contextWindow:agent.session.requestContext()?.contextWindow},
            {keep:'Keep current history unchanged to preserve its warmed prefix cache when the context still fits.',
             select:'Omit clearly irrelevant old evidence only when the reduction justifies losing cache reuse from the first replaced history token. Retain all explicit instructions and complete useful results.'});
          const selected = new Set(decision.selectedIds);
          const summary = region.filter(x => selected.has('event_'+x.seq)).map(x => ({type:'text',text:render(x.message)}));
          const shadowedTokens = measured.nodes.slice(start,end+1).reduce((sum,node) => sum+node.tokens,0);
          const estimated = summary.length ? ctx.tokenMeter.estimateMessage(createUserMessage({content:summary,source:{kind:'plugin',plugin:'dsh-auto'}}))+200 : 0;
          // A keep decision and an unhelpful reduction are explicit no-ops, not failures.
          if (decision.action === 'keep' || !summary.length || estimated >= shadowedTokens) {
            record({kind:'context_kept', session:agent.session.id, reason:decision.action === 'keep' ? 'Jev chose stable history' : 'No useful balanced reduction', estimatedContextTokens:measured.totalTokens});
            nextPressure.set(agent.session.id, measured.totalTokens+8000);
          } else {
            prepared.set(agent.session.id,{summary,model:decision.model});
            try {
              const result = await compactor.compactRegion(nodes[start],nodes[end],agent,signal);
              record({kind:'context_replaced',session:agent.session.id,start:nodes[start],end:nodes[end],sourceCount:result.shadowedSeqs.length});
            } finally { prepared.delete(agent.session.id); }
          }
        }
      }
    }
    return next();
  });
}
