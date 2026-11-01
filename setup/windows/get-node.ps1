# Gets Node.js (what Syntaz runs on) when this PC doesn't have it: the current LTS from nodejs.org, checked against
# nodejs.org's checksums, unpacked into %LOCALAPPDATA%\Syntaz\node. No installer, no admin rights.
# Prints the path to node.exe.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$dir = Join-Path $env:LOCALAPPDATA 'Syntaz\node'
$exe = Join-Path $dir 'node.exe'
if (Test-Path $exe) { $exe; exit 0 }
$arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }
$lts = (Invoke-RestMethod 'https://nodejs.org/dist/index.json' | Where-Object { $_.lts } | Select-Object -First 1).version
$name = "node-$lts-win-$arch"
$tmp = Join-Path $env:TEMP "$name.zip"
Invoke-WebRequest "https://nodejs.org/dist/$lts/$name.zip" -OutFile $tmp
$sums = (Invoke-WebRequest "https://nodejs.org/dist/$lts/SHASUMS256.txt").Content
$want = ($sums -split "`n" | Where-Object { $_ -match " $name\.zip$" }) -replace '\s.*', ''
if ((Get-FileHash $tmp -Algorithm SHA256).Hash.ToLower() -ne $want.Trim().ToLower()) { Remove-Item $tmp; throw 'The Node.js download did not match its checksum.' }
$unpack = Join-Path $env:LOCALAPPDATA 'Syntaz\node-unpack'
if (Test-Path $unpack) { Remove-Item $unpack -Recurse -Force }
Expand-Archive $tmp -DestinationPath $unpack
New-Item -ItemType Directory -Force (Split-Path $dir) | Out-Null
Move-Item (Join-Path $unpack $name) $dir
Remove-Item $unpack -Recurse -Force; Remove-Item $tmp
$exe
