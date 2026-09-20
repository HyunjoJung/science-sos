$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$stateDir = Join-Path $repoRoot '.secrets'
$pidFile = Join-Path $stateDir 'trial-worker.pid'
if (Test-Path -LiteralPath $pidFile) {
    $trialWorkerId = [int](Get-Content -LiteralPath $pidFile)
    $existing = Get-CimInstance Win32_Process -Filter "ProcessId = $trialWorkerId"
    if ($existing -and $existing.CommandLine -like '*scripts/trial-worker.mjs*') {
        Write-Output "Trial worker is already running: $trialWorkerId"
        exit 0
    }
}
$nodePath = (Get-Command node).Source
New-Item -ItemType Directory -Path $stateDir -Force | Out-Null
$trialWorker = Start-Process -FilePath $nodePath -ArgumentList '--env-file=.env.local', 'scripts/trial-worker.mjs' -WorkingDirectory $repoRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $stateDir 'trial-worker.log') -RedirectStandardError (Join-Path $stateDir 'trial-worker-error.log') -PassThru
Set-Content -LiteralPath $pidFile -Value $trialWorker.Id
Write-Output "Trial worker started: $($trialWorker.Id). Logs: .secrets/trial-worker.log"
