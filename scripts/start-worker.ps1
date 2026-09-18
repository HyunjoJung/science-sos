$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$stateDir = Join-Path $repoRoot '.secrets'
$pidFile = Join-Path $stateDir 'worker.pid'
if (Test-Path -LiteralPath $pidFile) {
    $workerPid = [int](Get-Content -LiteralPath $pidFile)
    $existing = Get-CimInstance Win32_Process -Filter "ProcessId = $workerPid"
    if ($existing -and $existing.CommandLine -like '*scripts/cursor-worker.mjs*') {
        Write-Output "Cursor worker is already running: $workerPid"
        exit 0
    }
}
$nodePath = (Get-Command node).Source
$worker = Start-Process -FilePath $nodePath -ArgumentList '--env-file=.env.local', 'scripts/cursor-worker.mjs' -WorkingDirectory $repoRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $stateDir 'worker.log') -RedirectStandardError (Join-Path $stateDir 'worker-error.log') -PassThru
Set-Content -LiteralPath $pidFile -Value $worker.Id
Write-Output "Cursor worker started: $($worker.Id). Logs: .secrets/worker.log"
