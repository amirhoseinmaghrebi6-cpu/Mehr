<#
  Flashes a factory batch, one board after another (docs/factory.md). For each board of the
  batch's manifest that is not flashed yet: connect it, press Enter; it gets the production
  firmware (firmware/dist/<board>) and its own factory partition, and is written to flashed.csv.

  .\firmware\factory\flash-batch.ps1 -Batch <batch folder> -Board t2 -Port COM5
#>
param(
  [Parameter(Mandatory = $true)][string]$Batch,
  [Parameter(Mandatory = $true)][ValidateSet("devkit", "t1", "t2", "t3", "t4", "r8", "sk", "do", "pm")][string]$Board,
  [Parameter(Mandatory = $true)][string]$Port,
  [string]$Esptool = "$env:LOCALAPPDATA\Arduino15\packages\esp32\tools\esptool_py\4.5.1\esptool.exe"
)
$ErrorActionPreference = "Stop"
$Chip = if ($Board -in @("devkit", "r8")) { "esp32" } else { "esp32c3" }
$dist = Join-Path $PSScriptRoot "..\dist\$Board"
if (-not (Test-Path (Join-Path $dist "flash_args"))) { throw "Build the production firmware first: sh firmware/build.sh $Board" }
if (-not (Test-Path $Esptool)) { throw "esptool not found at $Esptool (pass -Esptool)" }
$flashed = Join-Path $Batch "flashed.csv"
$done = @{}
if (Test-Path $flashed) { Get-Content $flashed | ForEach-Object { $done[($_ -split ",")[0]] = $true } }
$boards = Import-Csv (Join-Path $Batch "manifest.csv") | Where-Object { -not $done[$_.hardware_uid] }
$left = @($boards).Count
foreach ($board in $boards) {
  $image = Join-Path $Batch "$($board.hardware_uid).bin"
  if (-not (Test-Path $image)) { throw "$image is missing: run firmware/factory/make-bins.sh first" }
  Read-Host "[$left left] Connect a $($board.model) board to $Port, then press Enter to flash it as $($board.hardware_uid)"
  Push-Location $dist
  try {
    & $Esptool --chip $Chip -p $Port -b 460800 write_flash "@flash_args" 0xF000 $image
    if ($LASTEXITCODE -ne 0) { throw "Flashing failed; the board is not marked flashed. Check the cable and try again." }
  } finally { Pop-Location }
  Add-Content $flashed "$($board.hardware_uid),$(Get-Date -Format s)"
  Write-Host "Flashed $($board.hardware_uid). Label the board with this id." -ForegroundColor Green
  $left--
}
Write-Host "The batch is flashed. Delete the batch folder: it holds the boards' secrets." -ForegroundColor Yellow
