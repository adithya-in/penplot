# Flash the 28BYJ-48 GRBL firmware to an Arduino Nano.
#
#   .\flash.ps1                 # auto-detect the board, old bootloader first
#   .\flash.ps1 -Port COM3      # pick a port explicitly
#   .\flash.ps1 -NewBootloader  # for Nanos with the 115200 baud bootloader
#   .\flash.ps1 -Clean          # force a full rebuild
#   .\flash.ps1 -Monitor        # open a 115200 serial monitor after flashing
#
# The firmware source is vendored in .\firmware. GRBL is GPLv3; see
# .\firmware\COPYING. Nothing is downloaded except the Arduino AVR core if it
# is missing.

[CmdletBinding()]
param(
  [string]$Port = '',
  [switch]$NewBootloader,
  [switch]$Clean,
  [switch]$Monitor
)

$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

function Step($text) { Write-Host "`n== $text ==" -ForegroundColor Cyan }
function Note($text) { Write-Host $text -ForegroundColor DarkGray }
function Fail($text) {
  Write-Host "`nERROR: $text" -ForegroundColor Red
  exit 1
}

function Find-Cli {
  $cmd = Get-Command arduino-cli -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $candidates = @(
    (Join-Path $env:LOCALAPPDATA 'Programs\arduino-cli\arduino-cli.exe'),
    (Join-Path $env:ProgramFiles 'arduino-cli\arduino-cli.exe'),
    (Join-Path $env:USERPROFILE 'bin\arduino-cli.exe'),
    (Join-Path $env:USERPROFILE 'scoop\shims\arduino-cli.exe')
  )
  foreach ($path in $candidates) {
    if (Test-Path $path) { return $path }
  }
  return $null
}

$cli = Find-Cli
if (-not $cli) {
  Fail @"
arduino-cli was not found.

Install it, then run this script again:
  winget install --id ArduinoSA.CLI -e

or download a release from https://github.com/arduino/arduino-cli/releases
"@
}

Step 'arduino-cli'
& $cli version
if ($LASTEXITCODE -ne 0) { Fail 'arduino-cli could not start.' }

# ── AVR core ─────────────────────────────────────────────────────────────────
$cores = (& $cli core list 2>$null) -join "`n"
if ($cores -notmatch 'arduino:avr') {
  Step 'Installing the Arduino AVR core (one-time, needs internet)'
  & $cli core update-index
  & $cli core install arduino:avr
  if ($LASTEXITCODE -ne 0) { Fail 'Could not install arduino:avr.' }
}

# ── choose the port ──────────────────────────────────────────────────────────
function Normalise-Port([string]$value) {
  if ($value -match '^\d+$') { return "COM$value" }
  return $value.ToUpperInvariant()
}

if ($Port) {
  $Port = Normalise-Port $Port
  if ($Port -notmatch '^COM\d+$') { Fail "Invalid port '$Port'. Use something like COM3." }
}

if (-not $Port) {
  Step 'Looking for the Nano'
  $entries = @()

  $json = & $cli board list --format json 2>$null
  if ($json) {
    try {
      $parsed = $json | ConvertFrom-Json
      foreach ($item in @($parsed.detected_ports)) {
        $address = $item.port.address
        if (-not $address) { continue }
        if ($item.port.protocol -and $item.port.protocol -ne 'serial') { continue }

        $boards = @($item.matching_boards)
        $names = (@($boards | ForEach-Object { $_.name }) | Where-Object { $_ }) -join ', '
        $fqbns = (@($boards | ForEach-Object { $_.fqbn }) | Where-Object { $_ }) -join ' '
        $score = 0
        if ($names -match 'Nano' -or $fqbns -match 'nano') { $score += 4 }
        if ($address -match '^COM\d+$') { $score += 1 }
        $entries += [pscustomobject]@{
          Port   = $address
          Label  = $item.port.label
          Boards = $names
          Score  = $score
        }
      }
    } catch {
      Note 'Could not parse arduino-cli board list JSON; falling back to COM ports.'
    }
  }

  if (-not $entries.Count) {
    foreach ($name in [System.IO.Ports.SerialPort]::GetPortNames()) {
      $entries += [pscustomobject]@{ Port = $name; Label = 'serial port'; Boards = ''; Score = 0 }
    }
  }

  if (-not $entries.Count) {
    Fail @"
No serial port was detected.

 1. Plug the Nano in with a USB *data* cable (not a charge-only cable).
 2. If Windows does not create a COM port, install the CH340 driver
    (most clones use CH340; originals use FT232).
 3. Close the Arduino IDE, Cura, PuTTY or anything else holding the port.
 4. Run:  arduino-cli board list

Then run this script again.
"@
  }

  $entries = $entries | Sort-Object -Property @{ Expression = 'Score'; Descending = $true }, @{ Expression = 'Port'; Descending = $false }
  if ($entries.Count -eq 1) {
    $Port = $entries[0].Port
    Write-Host "Found $Port ($($entries[0].Label))"
  } else {
    Write-Host ''
    for ($i = 0; $i -lt $entries.Count; $i++) {
      $entry = $entries[$i]
      $extra = if ($entry.Boards) { "  [$($entry.Boards)]" } else { '' }
      Write-Host ("  [{0}] {1}  {2}{3}" -f ($i + 1), $entry.Port, $entry.Label, $extra)
    }
    $answer = Read-Host "`nWhich port is the plotter? [1-$($entries.Count)]"
    $index = 0
    if (-not [int]::TryParse($answer, [ref]$index) -or $index -lt 1 -or $index -gt $entries.Count) {
      Fail 'Invalid selection.'
    }
    $Port = $entries[$index - 1].Port
  }
}

# ── compile ──────────────────────────────────────────────────────────────────
$fqbnOld = 'arduino:avr:nano:cpu=atmega328old'
$fqbnNew = 'arduino:avr:nano:cpu=atmega328'
$fqbn = if ($NewBootloader) { $fqbnNew } else { $fqbnOld }

$build = Join-Path $root '.build'
$lib = Join-Path $root 'firmware\lib'
$sketch = Join-Path $root 'firmware\sketch\grblUpload'

if (-not (Test-Path (Join-Path $lib 'grbl\grbl.h'))) {
  Fail 'firmware\lib\grbl is missing. Keep the firmware folder next to this script.'
}

Step 'Compiling GRBL for the Nano'
if ($Clean -and (Test-Path $build)) {
  Note 'Removing .build for a clean rebuild.'
  Remove-Item -Recurse -Force $build
}
& $cli compile --fqbn $fqbn --libraries $lib --build-path $build $sketch 2>&1 |
  ForEach-Object { Write-Host $_ }

$hex = Join-Path $build 'grblUpload.ino.hex'
if (-not (Test-Path $hex)) {
  Fail @"
Compilation failed. Common causes:
  - firmware\lib\grbl is incomplete
  - the arduino:avr core is outdated  (arduino-cli core upgrade arduino:avr)
  - the sketch path contains unusual characters
"@
}

$size = (Get-Item $hex).Length
Note "Build OK: $hex ($size bytes)"

# ── upload (fall back to the other bootloader) ───────────────────────────────
function Invoke-Grbl([string]$serialPort, [string[]]$commands, [int]$settle = 900) {
  $sp = New-Object System.IO.Ports.SerialPort $serialPort,115200,'None',8,'One'
  $sp.NewLine = "`r`n"
  $sp.ReadTimeout = 900
  $sp.DtrEnable = $false
  $sp.RtsEnable = $false
  try {
    $sp.Open()
    Start-Sleep -Milliseconds $settle
    $sp.DiscardInBuffer()
    $text = ''
    foreach ($cmd in $commands) {
      $sp.Write($cmd + "`r`n")
      Start-Sleep -Milliseconds 700
      $text += $sp.ReadExisting()
    }
    return $text
  } finally {
    if ($sp.IsOpen) { $sp.Close() }
    $sp.Dispose()
  }
}

$attempts = @($fqbn)
if ($NewBootloader) { $attempts += $fqbnOld } else { $attempts += $fqbnNew }

$ok = $false
$used = ''
foreach ($tryFqbn in $attempts) {
  Step "Uploading to $Port ($tryFqbn)"
  $output = & $cli upload -p $Port --fqbn $tryFqbn --build-path $build $sketch 2>&1
  $output | ForEach-Object { Write-Host $_ }
  if ($LASTEXITCODE -eq 0) {
    $ok = $true
    $used = $tryFqbn
    break
  }
  Note 'That upload attempt failed; trying the other bootloader setting…'
}

if (-not $ok) {
  Fail @"
Upload failed.

  - Close the Arduino IDE / serial monitor and any other program using $Port.
    If the penplot website is open, click Disconnect in it first.
  - Try the other bootloader explicitly:
        .\flash.ps1 -Port $Port -NewBootloader
  - If the board is not a genuine Nano, select the right board in the Arduino IDE
    once and note its processor setting.
  - Some CH340 clones need the CH340 driver from wch-ic.com.
"@
}

# ── verify + set the Y direction ─────────────────────────────────────────────
Step 'Verifying the controller'
$probe = ''
for ($i = 0; $i -lt 5; $i++) {
  Start-Sleep -Milliseconds 900
  try {
    $probe = Invoke-Grbl $Port @('$$') 1200
    if ($probe -match '\$3=') { break }
  } catch { }
}

if ($probe -match '\$3=(\d+)') {
  $mask = [int]$matches[1]
  Note ('GRBL responds at 115200. Direction mask: $3=' + $mask)
  if (($mask -band 2) -eq 0) {
    $newMask = $mask -bor 2
    $after = Invoke-Grbl $Port @(('$3=' + $newMask), '$$') 800
    if ($after -match '\$3=(\d+)') {
      Note ('Set $3=' + $matches[1] + ' - Y is inverted for this plotter.')
    } else {
      Note 'Could not set $3 automatically. Tick Invert Y in the app and press Apply.'
    }
  } else {
    Note 'Y inversion ($3 bit 1) is already set.'
  }
} else {
  Note 'The board was flashed but did not answer the serial check.'
  Note 'Close anything else using the port, then reconnect from the website.'
}

Write-Host ''
Write-Host 'GRBL is on the Nano.' -ForegroundColor Green
Write-Host "Uploaded with: $used" -ForegroundColor DarkGray
Write-Host ''
Write-Host 'Next:' -ForegroundColor Cyan
Write-Host '  1. Wire the three ULN2003 boards (X: D2-D5, Y: A0-A3, Z: D8,D9,D12,D13).'
Write-Host '  2. Use a separate 5 V >= 2 A supply for the motors; join the grounds.'
Write-Host '  3. Open https://adithya-in.github.io/penplot/ in desktop Chrome or Edge.'
Write-Host '     (Or double-click start.bat to use the local copy.)'
Write-Host '  4. Click Connect Nano and choose this COM port.'
Write-Host '  5. Press Settings -> Apply once (keeps Invert Y on, writes $3=2).'
Write-Host '  6. Jog to the bottom-left paper corner, press "Zero here", and set pen heights.'

if ($Monitor) {
  Step "Serial monitor on $Port (Ctrl+C to exit)"
  & $cli monitor -p $Port -c baudrate=115200
}
