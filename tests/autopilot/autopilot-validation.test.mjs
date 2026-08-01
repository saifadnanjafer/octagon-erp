import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

test('autopilot queue and state validate against actual Git refs', () => {
  const output = execFileSync('node', ['scripts/autopilot/validate-autopilot.mjs'], { encoding: 'utf8' });
  const result = JSON.parse(output);
  assert.equal(result.valid, true);
  assert.equal(result.eligible_task, 'BUILD-03');
  assert.equal(result.required_human_decision, false);
});

test('supervised runner contains no unattended or destructive command', () => {
  const script = execFileSync('powershell', ['-NoProfile', '-Command', "Get-Content -Raw scripts/continue-next-octagon-task.ps1"], { encoding: 'utf8' });
  for (const forbidden of ['--yolo', '--auto', 'bypassPermissions', 'git reset --hard', 'git clean', 'push --force', 'MaxRounds']) {
    assert.equal(script.includes(forbidden), false, `forbidden runner token: ${forbidden}`);
  }
  assert.match(script, /--permission-mode plan/);
  assert.match(script, /kimi --plan/);
  assert.match(script, /gh auth status/);
  assert.match(script, /\[switch\]\$Publish/);
  assert.match(script, /\[ValidateRange\(1, 10\)\]/);
  assert.match(script, /\$MaxTasks = 10/);
  assert.match(script, /Prepared batch/);
  assert.match(script, /git merge-base --is-ancestor/);
  assert.match(script, /Post-push SHA equality failed/);
});

test('supervised runner parses in PowerShell without executing', () => {
  const command = "$ErrorActionPreference='Stop'; try { [void][scriptblock]::Create((Get-Content -Raw scripts/continue-next-octagon-task.ps1)); 'PowerShell parse: PASS' } catch { Write-Error $_; exit 1 }";
  const output = execFileSync('powershell', ['-NoProfile', '-Command', command], { encoding: 'utf8' });
  assert.match(output, /PowerShell parse: PASS/);
});
