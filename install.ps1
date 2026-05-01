# auto-english-coach installer (Windows / PowerShell)
# Copies skill files and the hook script into ~/.claude/, then prints the
# settings.json snippet to merge by hand.

$ErrorActionPreference = "Stop"
$claudeHome = Join-Path $env:USERPROFILE ".claude"
$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host "Installing auto-english-coach into $claudeHome ..." -ForegroundColor Cyan

# 1. Skill directories
$skills = @("auto-english-coach", "english-reviewer")
foreach ($s in $skills) {
    $dst = Join-Path $claudeHome "skills\$s"
    New-Item -ItemType Directory -Force -Path $dst | Out-Null
    Copy-Item -Path (Join-Path $repoRoot "skills\$s\SKILL.md") -Destination $dst -Force
    Write-Host "  - skill: $s" -ForegroundColor Green
}

# 2. Hook script
$hookDir = Join-Path $claudeHome "hooks"
New-Item -ItemType Directory -Force -Path $hookDir | Out-Null
Copy-Item -Path (Join-Path $repoRoot "hooks\english-coach-prompt-submit.js") -Destination $hookDir -Force
Write-Host "  - hook:  english-coach-prompt-submit.js" -ForegroundColor Green

# 3. Vocab log (only if missing -- don't clobber accumulated data)
$vocabPath = Join-Path $claudeHome "english\vocab.md"
if (-not (Test-Path $vocabPath)) {
    New-Item -ItemType Directory -Force -Path (Split-Path $vocabPath) | Out-Null
    Set-Content -Path $vocabPath -Value "" -Encoding utf8
    Write-Host "  - vocab: created empty vocab.md" -ForegroundColor Green
} else {
    Write-Host "  - vocab: ~/.claude/english/vocab.md already exists, leaving it" -ForegroundColor Yellow
}

# 4. Tell the user how to wire up the hook
Write-Host ""
Write-Host "Done. One manual step left: merge this block into $claudeHome\settings.json under the 'hooks' key." -ForegroundColor Cyan
Write-Host "(If you already have a UserPromptSubmit array there, APPEND; do not replace.)" -ForegroundColor Yellow
Write-Host ""
Get-Content (Join-Path $repoRoot "settings-snippet.json")
Write-Host ""
Write-Host "After saving settings.json, run /hooks in Claude Code to reload." -ForegroundColor Cyan
