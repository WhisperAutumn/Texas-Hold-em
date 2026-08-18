$ErrorActionPreference = "Stop"

$projectRoot = Split-Path $PSScriptRoot -Parent
$distRoot = Join-Path $projectRoot "dist"
$serverRoot = Join-Path $distRoot "River Room Server Client"
$playerRoot = Join-Path $distRoot "River Room Player Client"

if (-not $distRoot.StartsWith($projectRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Invalid distribution path."
}

foreach ($target in @($serverRoot, $playerRoot)) {
  if (Test-Path -LiteralPath $target) {
    Remove-Item -LiteralPath $target -Recurse -Force
  }
  New-Item -ItemType Directory -Path $target -Force | Out-Null
}

$serverApp = Join-Path $serverRoot "app"
$serverRuntime = Join-Path $serverRoot "runtime"
New-Item -ItemType Directory -Path $serverApp, $serverRuntime, (Join-Path $serverApp "data") -Force | Out-Null

Copy-Item -LiteralPath (Join-Path $projectRoot "server.js") -Destination $serverApp
Copy-Item -LiteralPath (Join-Path $projectRoot "public") -Destination $serverApp -Recurse
Copy-Item -LiteralPath (Join-Path $projectRoot "README.md") -Destination $serverRoot
Copy-Item -LiteralPath (Join-Path $projectRoot "data\table-settings.json") -Destination (Join-Path $serverApp "data\table-settings.json") -ErrorAction SilentlyContinue
Copy-Item -LiteralPath "C:\Program Files\nodejs\node.exe" -Destination (Join-Path $serverRuntime "node.exe")
Copy-Item -LiteralPath (Join-Path $projectRoot "desktop\server-client.ps1") -Destination $serverRoot
Copy-Item -LiteralPath (Join-Path $projectRoot "desktop\server-config.ps1") -Destination $serverRoot
Copy-Item -LiteralPath (Join-Path $projectRoot "desktop\River Room Server.cmd") -Destination $serverRoot

Copy-Item -LiteralPath (Join-Path $projectRoot "desktop\player-client.ps1") -Destination $playerRoot
Copy-Item -LiteralPath (Join-Path $projectRoot "desktop\player-launcher.html") -Destination $playerRoot
Copy-Item -LiteralPath (Join-Path $projectRoot "desktop\River Room Player.cmd") -Destination $playerRoot

$serverZip = Join-Path $distRoot "River Room Server Client.zip"
$playerZip = Join-Path $distRoot "River Room Player Client.zip"
foreach ($archive in @($serverZip, $playerZip)) {
  if (Test-Path -LiteralPath $archive) {
    Remove-Item -LiteralPath $archive -Force
  }
}

Push-Location $distRoot
try {
  & tar.exe -a -c -f $serverZip (Split-Path $serverRoot -Leaf)
  if ($LASTEXITCODE -ne 0) { throw "Server client archive failed." }
  & tar.exe -a -c -f $playerZip (Split-Path $playerRoot -Leaf)
  if ($LASTEXITCODE -ne 0) { throw "Player client archive failed." }
} finally {
  Pop-Location
}

Write-Host "Created:"
Write-Host $serverZip
Write-Host $playerZip
