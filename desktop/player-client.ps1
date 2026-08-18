$ErrorActionPreference = "Stop"

$launcherPath = Join-Path $PSScriptRoot "player-launcher.html"
if (-not (Test-Path -LiteralPath $launcherPath)) {
  Add-Type -AssemblyName PresentationFramework
  [System.Windows.MessageBox]::Show("The player client page was not found.", "River Room") | Out-Null
  exit 1
}

$edgeCandidates = @(
  "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
  "C:\Program Files\Microsoft\Edge\Application\msedge.exe"
)
$edgePath = $edgeCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
$launcherUrl = ([System.Uri]$launcherPath).AbsoluteUri

if ($edgePath) {
  $profileRoot = Join-Path $env:LOCALAPPDATA "RiverRoom\PlayerClient"
  New-Item -ItemType Directory -Path $profileRoot -Force | Out-Null
  Start-Process -FilePath $edgePath -ArgumentList @("--app=$launcherUrl", "--user-data-dir=$profileRoot", "--no-first-run") | Out-Null
} else {
  Start-Process $launcherPath
}
