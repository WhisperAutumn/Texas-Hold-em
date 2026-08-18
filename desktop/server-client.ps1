$ErrorActionPreference = "Stop"

$packageRoot = $PSScriptRoot
$configPath = Join-Path $packageRoot "server-config.ps1"
if (Test-Path -LiteralPath $configPath) {
  . $configPath
}
$packagedApp = Join-Path $packageRoot "app\server.js"
if (Test-Path -LiteralPath $packagedApp) {
  $appRoot = Join-Path $packageRoot "app"
  $nodePath = Join-Path $packageRoot "runtime\node.exe"
} else {
  $appRoot = Split-Path $PSScriptRoot -Parent
  $nodePath = ""
}

$port = 3000
if ($env:PORT -match "^\d+$") {
  $port = [int]$env:PORT
}
$serverUrl = "http://localhost:$port/server"
$healthUrl = "http://localhost:$port/api/state"
$serverProcess = $null
$ownsServer = $false

function Test-RiverRoomServer {
  try {
    $response = Invoke-WebRequest -Uri $healthUrl -UseBasicParsing -TimeoutSec 1
    return $response.StatusCode -eq 200
  } catch {
    return $false
  }
}

if (-not (Test-RiverRoomServer)) {
  if (-not $nodePath -or -not (Test-Path -LiteralPath $nodePath)) {
    $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
    if (-not $nodeCommand) {
      Add-Type -AssemblyName PresentationFramework
      [System.Windows.MessageBox]::Show("Node.js runtime was not found. The server client cannot start.", "River Room") | Out-Null
      exit 1
    }
    $nodePath = $nodeCommand.Source
  }

  $logsRoot = Join-Path $appRoot "logs"
  New-Item -ItemType Directory -Path $logsRoot -Force | Out-Null
  $serverProcess = Start-Process -FilePath $nodePath -ArgumentList @("server.js") -WorkingDirectory $appRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logsRoot "server-output.log") -RedirectStandardError (Join-Path $logsRoot "server-error.log") -PassThru
  $ownsServer = $true

  for ($attempt = 0; $attempt -lt 40 -and -not (Test-RiverRoomServer); $attempt += 1) {
    Start-Sleep -Milliseconds 250
  }

  if (-not (Test-RiverRoomServer)) {
    if ($serverProcess -and -not $serverProcess.HasExited) {
      Stop-Process -Id $serverProcess.Id -Force
    }
    Add-Type -AssemblyName PresentationFramework
    [System.Windows.MessageBox]::Show("Server startup failed. Check the logs folder for details.", "River Room") | Out-Null
    exit 1
  }
}

$edgeCandidates = @(
  "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
  "C:\Program Files\Microsoft\Edge\Application\msedge.exe"
)
$edgePath = $edgeCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1

try {
  if ($edgePath) {
    $profileRoot = Join-Path $env:LOCALAPPDATA "RiverRoom\ServerClient"
    New-Item -ItemType Directory -Path $profileRoot -Force | Out-Null
    $window = Start-Process -FilePath $edgePath -ArgumentList @("--app=$serverUrl", "--user-data-dir=$profileRoot", "--no-first-run") -PassThru
    $window.WaitForExit()
  } else {
    Start-Process $serverUrl
    Add-Type -AssemblyName PresentationFramework
    [System.Windows.MessageBox]::Show("The server is running. Closing this message will exit the server client.", "River Room") | Out-Null
  }
} finally {
  if ($ownsServer -and $serverProcess -and -not $serverProcess.HasExited) {
    Stop-Process -Id $serverProcess.Id -Force
  }
}
