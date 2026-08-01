[CmdletBinding()]
param(
    [string]$RepoPath = '',
    [ValidateSet('None', 'Claude', 'Kimi')]
    [string]$Provider = 'None',
    [switch]$Launch
)

$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($RepoPath)) {
    $RepoPath = Split-Path -Path $PSScriptRoot -Parent
}

function Invoke-GitValue {
    param([string[]]$Arguments)
    $value = & git @Arguments 2>&1
    if ($LASTEXITCODE -ne 0) { throw "git $($Arguments -join ' ') failed: $value" }
    return ($value | Out-String).Trim()
}

$repo = (Resolve-Path -LiteralPath $RepoPath).Path
if ($repo -match 'octagon-erp-commercial-vnext|telegram') { throw 'Refusing an excluded repository/worktree.' }
Push-Location -LiteralPath $repo
try {
    $topLevel = Invoke-GitValue @('rev-parse', '--show-toplevel')
    if ((Resolve-Path -LiteralPath $topLevel).Path -ne $repo) { throw 'RepoPath must be the exact Git worktree root.' }
    $branch = Invoke-GitValue @('branch', '--show-current')
    if ($branch -eq 'main') { throw 'Refusing to operate on main.' }
    $dirty = & git status --porcelain=v1
    if ($dirty) { throw "Controller worktree is dirty. Inspect and recover manually; no reset, clean, restore, or stash was performed.`n$dirty" }
    $foreignDirty = @()
    $worktreePaths = (& git worktree list --porcelain) | Where-Object { $_ -like 'worktree *' } | ForEach-Object { $_.Substring(9) }
    foreach ($worktreePath in $worktreePaths) {
        $resolvedWorktree = (Resolve-Path -LiteralPath $worktreePath).Path
        if ($resolvedWorktree -eq $repo) { continue }
        if ($resolvedWorktree -match 'telegram') { continue }
        $worktreeDirty = & git -C $resolvedWorktree status --porcelain=v1
        if ($worktreeDirty) { $foreignDirty += "$resolvedWorktree`n$worktreeDirty" }
    }
    if ($foreignDirty.Count -gt 0) {
        throw "Unknown dirty worktree detected outside the controller. It was not modified, cleaned, stashed, or committed.`n$($foreignDirty -join "`n")"
    }
    & git fetch origin --prune
    if ($LASTEXITCODE -ne 0) { throw 'git fetch origin --prune failed.' }
    $head = Invoke-GitValue @('rev-parse', 'HEAD')
    $upstream = Invoke-GitValue @('rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}')
    $upstreamSha = Invoke-GitValue @('rev-parse', '@{u}')
    $remoteSha = (& git ls-remote origin "refs/heads/$branch").Split("`t")[0]
    if (-not $remoteSha -or $head -ne $upstreamSha -or $head -ne $remoteSha) { throw "Publication gate failed: HEAD=$head upstream=$upstreamSha remote=$remoteSha" }
    $validation = & node scripts/autopilot/validate-autopilot.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Autopilot queue/state validation failed.' }
    $snapshot = $validation | ConvertFrom-Json
    Write-Host "Verified $branch at $head (upstream and remote equal)."
    if ($snapshot.required_human_decision -or $snapshot.chapter_status -eq 'HUMAN_REQUIRED') {
        Write-Host 'STOP: human decision required. Read docs/autopilot/CURRENT_HANDOFF.md and BLOCKERS.md.'
        exit 0
    }
    if (-not $snapshot.eligible_task) { Write-Host 'STOP: no dependency-safe eligible task.'; exit 0 }
    $task = (Get-Content -Raw docs/autopilot/QUEUE.json | ConvertFrom-Json).tasks | Where-Object id -eq $snapshot.eligible_task
    $runtime = Join-Path $repo 'docs/autopilot/runtime'
    New-Item -ItemType Directory -Force -Path $runtime | Out-Null
    $context = Join-Path $runtime 'next-task-context.md'
    @"
# Supervised Octagon continuation

Selected task: $($task.id) — $($task.title)
Branch: $branch
Commit: $head
Prompt: $($task.prompt_path)

Read AGENTS.md and docs/autopilot/AUTOPILOT_PROTOCOL.md before taking action.
This context does not authorize state changes or bypass any human gate.
"@ | Set-Content -LiteralPath $context -Encoding utf8
    Write-Host "Prepared $($task.id). Context: $context"
    if (-not $Launch) { exit 0 }
    if ($Provider -eq 'None') { throw 'Specify -Provider Claude or -Provider Kimi with -Launch.' }
    if ($Provider -eq 'Claude') { & claude --permission-mode plan "Read $context and produce only a safe execution plan." }
    if ($Provider -eq 'Kimi') { & kimi --plan --prompt "Read $context and produce only a safe execution plan." }
    if ($LASTEXITCODE -ne 0) { throw "$Provider exited with code $LASTEXITCODE" }
} finally {
    Pop-Location
}
