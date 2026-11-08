# Firmware

This folder contains the GRBL firmware that runs on the Arduino Nano, vendored
so the flasher works offline.

## Provenance

- Upstream project:
  [TGit-Tech/GRBL-28byj-48](https://github.com/TGit-Tech/GRBL-28byj-48)
- Base: **GRBL 1.1f** (build 20170131) by Sungeun K. Jeon / Gnea Research LLC
- Licence: **GNU GPLv3** — see [`COPYING`](COPYING)
- Changes: pin mapping, virtual ports and the 8-state half-step coil sequence
  for three 28BYJ-48 motors through ULN2003 drivers.

The firmware is **not** a stock GRBL step/dir build. In `stepper.c` the ISR
writes the four coil phases of each axis directly:

| Axis | Port | Pins | Coil order |
| --- | --- | --- | --- |
| X | `PORTD` | D2, D3, D4, D5 | IN1…IN4 |
| Y | `PORTC` | A0, A1, A2, A3 | IN1…IN4 |
| Z | `PORTB` | D8, D9, D12, D13 | IN1…IN4 |

`cpu_map_atmega328p.h` declares virtual `VPORT*`/`VDDR*` registers so the normal
GRBL step/direction code does not fight the coil writes on the real ports.
The stock GRBL limit-switch and spindle pins are therefore unavailable; this
plotter uses no limit switches.

## Layout

```
firmware/
  COPYING                              GPLv3 text
  lib/grbl/                            GRBL source as an Arduino library
    config.h                           selects DEFAULTS_GENERIC + ATmega328P
    defaults.h                         machine profile (modified)
    cpu_map/cpu_map_atmega328p.h       pin map / virtual ports
    stepper.c                          28BYJ-48 coil sequence
    ...
  sketch/grblUpload/
    grblUpload.ino                     empty sketch that pulls in GRBL
    license.txt                        upstream MIT notice for the sketch
```

## Local modification

`lib/grbl/defaults.h` was changed in the `DEFAULTS_GENERIC` block to match
`js/settings.js` so a freshly flashed board is usable without typing settings
by hand:

| Setting | Value |
| --- | --- |
| `DEFAULT_X/Y_STEPS_PER_MM` | 51.2 |
| `DEFAULT_Z_STEPS_PER_MM` | 100.0 |
| `DEFAULT_X/Y_MAX_RATE` | 600 mm/min |
| `DEFAULT_Z_MAX_RATE` | 200 mm/min |
| `DEFAULT_X/Y_ACCELERATION` | 50 mm/s² |
| `DEFAULT_Z_ACCELERATION` | 100 mm/s² |
| `DEFAULT_X/Y_MAX_TRAVEL` | 150 mm |
| `DEFAULT_Z_MAX_TRAVEL` | 15 mm |
| `DEFAULT_STEPPER_IDLE_LOCK_TIME` | 255 (keep coils energised) |
| `DEFAULT_JUNCTION_DEVIATION` | 0.05 mm |
| `DEFAULT_DIRECTION_INVERT_MASK` | `(1<<Y_AXIS)` → `$3=2` (Y motor is mounted in reverse) |

`lib/grbl/config.h` keeps `DEFAULTS_GENERIC`, `CPU_MAP_ATMEGA328P` and
`BAUD_RATE 115200`. Homing, hard limits and variable spindle remain off.

`lib/grbl/stepper.c` also has a bug fix from the upstream fork. It used to run
`st.exec_block->direction_bits ^= dir_port_invert_mask` **inside the step ISR**,
so a non-zero `$3` mask flipped the direction on every step pulse and the axis
only vibrated. The mask is now applied to a local copy, so `$3` inverts an axis
correctly. This is why Y can be inverted in settings/firmware instead of
re-wiring the motor.

These are **starting values**. Calibrate steps/mm and pen heights from the
website; press **Apply** to write the result to EEPROM. Reflashing the firmware
restores these defaults (`$RST=*` also does).

> `DEFAULT_STEPPER_IDLE_LOCK_TIME 255` holds the motors after a move. This stops
> the pen from drifting, but the motors and drivers stay warm. Set `$1=25` (or
> untick **Hold motors** and press **Apply**) if you prefer them to relax.

## Build

```powershell
arduino-cli compile `
  --fqbn arduino:avr:nano:cpu=atmega328old `
  --libraries firmware\lib `
  --build-path .build `
  firmware\sketch\grblUpload
```

Output:

```
Sketch uses 29910 bytes (97%) of program storage space. Maximum is 30720 bytes.
Global variables use 1554 bytes (75%) of dynamic memory, leaving 494 bytes.
```

The low-memory warning is expected for this fork on an ATmega328P.

## Upload

```powershell
arduino-cli upload -p COM3 `
  --fqbn arduino:avr:nano:cpu=atmega328old `
  --build-path .build `
  firmware\sketch\grblUpload
```

Or simply run `..\flash.bat` / `..\flash.ps1`, which handles port discovery,
compiling and the old/new bootloader fallback.

After flashing, a 115200-baud terminal should show:

```
Grbl 1.1f ['$' for help]
ok
```

## Licence

GRBL is free software under the GNU GPLv3. You may redistribute and/or modify
it under those terms. There is **no warranty**. If you distribute a board with
this firmware, or a modified version of it, you must provide the corresponding
source under the GPLv3 — this folder is that source. See [`COPYING`](COPYING).
