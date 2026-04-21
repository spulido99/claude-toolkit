#Requires -Version 7.0

<#
.SYNOPSIS
    Test harness for dynamodb-design skill retrieval.

.DESCRIPTION
    Runs every scenario in tests/scenarios.txt in two phases:
      RED   — without the skill loaded (baseline)
      GREEN — with only dev-patterns loaded via --plugin-dir

    Writes per-scenario results + diffs to a timestamped results directory
    under $env:TEMP. A human reviews the diffs against success criteria in
    the design spec.

    Isolation strategy:
      RED phase uses --disable-slash-commands (documented as "Disable all
      skills" in `claude -p --help`). If that flag proves insufficient in a
      given environment (i.e., it only disables slash invocation, not
      auto-discovery), fall back to pointing --plugin-dir at an empty
      directory and using --setting-sources project so user-level plugin
      settings do not load.

.NOTES
    IMPORTANT: Do not run this script from inside an active Claude Code
    session. `claude -p` spawned from within another Claude Code session
    deadlocks on interactive prompts (OAuth, permissions, etc.). Run from a
    plain PowerShell window.

    Requires PowerShell 7.0+ and `claude`, `git` on PATH.
#>

$ErrorActionPreference = 'Stop'

# Resolve paths relative to this script
# PSScriptRoot = .../plugins/dev-patterns/skills/dynamodb-design/scripts
# Go up 3 levels to reach plugins/dev-patterns
$pluginDir = (Get-Item (Join-Path $PSScriptRoot '..\..\..')).FullName
$scenariosFile = Join-Path $PSScriptRoot '..\tests\scenarios.txt'

$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$resultsDir = Join-Path $env:TEMP "dynamodb-design-skill-test-$timestamp"
$workspace = Join-Path $env:TEMP "dynamodb-design-skill-workspace-$timestamp"

# Create result + workspace directories
foreach ($sub in 'red', 'green', 'diff') {
    New-Item -ItemType Directory -Force -Path (Join-Path $resultsDir $sub) | Out-Null
}
New-Item -ItemType Directory -Force -Path $workspace | Out-Null

# Sanity checks
if (-not (Test-Path -LiteralPath $scenariosFile)) {
    Write-Error "Scenarios file not found at $scenariosFile"
    exit 1
}
$skillRoot = Join-Path $pluginDir 'skills\dynamodb-design'
if (-not (Test-Path -LiteralPath $skillRoot -PathType Container)) {
    Write-Error "dynamodb-design skill directory not found at $skillRoot"
    exit 1
}

# Verify required commands
foreach ($cmd in 'claude', 'git') {
    if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
        Write-Error "Required command '$cmd' not found on PATH"
        exit 1
    }
}

# Load scenarios (skip blank lines)
$scenarios = Get-Content -LiteralPath $scenariosFile | Where-Object { $_.Trim() -ne '' }

Write-Host "Running $($scenarios.Count) scenarios"
Write-Host "Results: $resultsDir"
Write-Host "Workspace: $workspace"
Write-Host ''

Push-Location $workspace
try {
    for ($i = 0; $i -lt $scenarios.Count; $i++) {
        $idx = '{0:D2}' -f ($i + 1)
        $promptText = $scenarios[$i]
        Write-Host "=== Scenario $idx ==="
        Write-Host "Prompt: $promptText"

        $redFile = Join-Path $resultsDir "red\scenario-$idx.txt"
        $greenFile = Join-Path $resultsDir "green\scenario-$idx.txt"
        $diffFile = Join-Path $resultsDir "diff\scenario-$idx.diff"

        Write-Host "  RED phase..."
        try {
            & claude -p --disable-slash-commands $promptText *>&1 |
                Out-File -LiteralPath $redFile -Encoding utf8
        } catch {
            $_.Exception.Message | Out-File -LiteralPath $redFile -Encoding utf8 -Append
        }

        Write-Host "  GREEN phase..."
        try {
            # --add-dir authorizes read access to the plugin's reference files.
            # Without it, claude -p cannot read skills/*/references/*.md even
            # though the plugin is loaded via --plugin-dir.
            & claude -p `
                --plugin-dir $pluginDir `
                --add-dir $pluginDir `
                --setting-sources project `
                $promptText *>&1 |
                Out-File -LiteralPath $greenFile -Encoding utf8
        } catch {
            $_.Exception.Message | Out-File -LiteralPath $greenFile -Encoding utf8 -Append
        }

        # Use `git diff --no-index` for a portable unified diff on Windows.
        # Exit code 1 means differences found (not an error); suppress the throw.
        try {
            & git diff --no-index --text -- $redFile $greenFile *>&1 |
                Out-File -LiteralPath $diffFile -Encoding utf8
        } catch {
            # git diff --no-index returns exit 1 when files differ; that's expected.
            # Only log unexpected failures.
            if ($LASTEXITCODE -gt 1) {
                $_.Exception.Message | Out-File -LiteralPath $diffFile -Encoding utf8 -Append
            }
        }

        $redBytes = (Get-Item -LiteralPath $redFile).Length
        $greenBytes = (Get-Item -LiteralPath $greenFile).Length
        Write-Host "  RED:   $redBytes bytes"
        Write-Host "  GREEN: $greenBytes bytes"
        Write-Host ''
    }
}
finally {
    Pop-Location
}

Write-Host 'All scenarios complete.'
Write-Host "Review diffs at: $(Join-Path $resultsDir 'diff')"
