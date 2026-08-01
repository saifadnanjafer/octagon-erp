#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const repo = process.cwd();
const autopilot = path.join(repo, 'docs', 'autopilot');
const validStatuses = new Set(['PENDING', 'READY', 'IN_PROGRESS', 'COMPLETE', 'PARTIAL', 'BLOCKED', 'HUMAN_REQUIRED']);

function fail(message) {
  throw new Error(`AUTOPILOT_VALIDATION_FAILED: ${message}`);
}

function readJson(name) {
  try {
    return JSON.parse(fs.readFileSync(path.join(autopilot, name), 'utf8'));
  } catch (error) {
    fail(`${name} is not valid JSON (${error.message})`);
  }
}

function git(...args) {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function completionIsPublished(task) {
  const completion = task.completion;
  if (!completion || !completion.commit || !completion.branch || !completion.remote_commit) return false;
  if (completion.commit !== completion.remote_commit) return false;
  try {
    const remoteRef = `refs/remotes/origin/${completion.branch}`;
    git('rev-parse', '--verify', remoteRef);
    execFileSync('git', ['merge-base', '--is-ancestor', completion.commit, remoteRef], { cwd: repo, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function main() {
  const queue = readJson('QUEUE.json');
  const state = readJson('STATE.json');
  if (queue.schema_version !== 1 || state.schema_version !== 1) fail('unsupported schema version');
  if (queue.mode !== 'SUPERVISED' || state.mode !== 'SUPERVISED') fail('only SUPERVISED mode is allowed');
  if (!Array.isArray(queue.tasks) || queue.tasks.length === 0) fail('queue has no tasks');
  const byId = new Map();
  for (const task of queue.tasks) {
    if (!task.id || byId.has(task.id)) fail(`duplicate or missing task id (${task.id || 'unknown'})`);
    if (!validStatuses.has(task.status)) fail(`${task.id} has invalid status`);
    if (!Array.isArray(task.depends_on)) fail(`${task.id} dependencies must be an array`);
    if (!task.prompt_path || !fs.existsSync(path.join(repo, task.prompt_path))) fail(`${task.id} prompt is missing`);
    byId.set(task.id, task);
  }
  for (const task of queue.tasks) {
    for (const dependency of task.depends_on) {
      if (!byId.has(dependency)) fail(`${task.id} references missing dependency ${dependency}`);
    }
    if (task.status === 'COMPLETE' && !completionIsPublished(task)) {
      fail(`${task.id} is COMPLETE without reachable published completion evidence`);
    }
  }
  if (state.active_task !== null && !byId.has(state.active_task)) fail('active_task is not in queue');
  const eligible = queue.tasks.find((task) => task.status === 'READY' || (task.status === 'PENDING' && task.depends_on.every((id) => byId.get(id).status === 'COMPLETE' && completionIsPublished(byId.get(id))))) || null;
  process.stdout.write(`${JSON.stringify({ valid: true, chapter_status: state.chapter_status, eligible_task: eligible?.id ?? null, required_human_decision: state.required_human_decision === true }, null, 2)}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
