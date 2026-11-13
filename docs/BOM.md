# Bill of materials

This repository covers **two different machines**. They are not variations of
each other — different motors, different drivers, different firmware.

| Project | Motors | Drivers | Firmware |
|---|---|---|---|
| **PenPlot** | 3× 28BYJ-48 (5 V unipolar) | 3× ULN2003 | GRBL 1.1f on Arduino Nano (vendored in `firmware/`) |
| **OpenCNC** | 2× NEMA17 (12 V bipolar) | 2× DRV8825 | FluidNC on ESP32 |

Prices checked November 2026, GST included where applicable. Stock is stated
where it could be verified; `—` means it was not confirmed.

---

# Project 1 — PenPlot

ESP32 plus three 28BYJ-48 steppers driven through ULN2003 Darlington arrays.
X and Y move the gantry, Z lifts the pen — there is no servo on this machine.

## Electronics

| Ref | Part | Spec | Qty | Unit ₹ | Total ₹ | Stock | Source |
|---|---|---|---|---|---|---|---|
| U1 | ESP32 dev board | 30/38-pin, ESP32-WROOM-32 | 1 | 422 | 422 | In stock | [Robocraze](https://robocraze.com/products/esp32-development-board) |
| M1–M3 | 28BYJ-48 stepper | 5 V unipolar, with ULN2003 module | 3 | 85 | 255 | In stock | [Robocraze](https://robocraze.com/products/5v-stepper-motor) |
| U2–U4 | ULN2003 IC | DIP-16, 7-channel Darlington | 3 | 17 | 51 | — | [Robu](https://robu.in/product/uln2003-hlf-darlington-transistor-arrays-ic/) |
| — | DIP-16 sockets | | 3 | 5 | 15 | — | Local |
| PS1 | 5 V power supply | 2 A, DC jack | 1 | 188 | 188 | In stock | [Robu](https://robu.in/product/orange-5v-2a-power-supply-with-dual-pin-dc-plug-adapter/) |
| J1 | DC jack | DC-005, 5.5×2.1 mm | 1 | 19 | 19 | In stock | [Robu](https://robu.in/product/dc-005-female-dc-power-jack-supply-socket-5-5x2-1/) |
| — | Motor connectors | 5-pin headers, 3 off | 3 | 10 | 30 | — | Local |
| — | Decoupling + bulk caps | 100 nF ×3, 470 µF ×1 | — | — | 20 | — | Local |
| — | Hookup wire, ferrules | | 1 | 80 | 80 | — | Local |
| **Electronics subtotal** | | | | | **₹1,080** | | |

## PCB

| Item | ₹ |
|---|---|
| 5× 2-layer, ~70×50 mm, JLCPCB economy shipping | ~700 |
| Perfboard alternative (no custom PCB) | ~60 |

## PenPlot totals

| Build | ₹ |
|---|---|
| Custom PCB, one board built | **≈ 1,780** |
| Perfboard / use the ULN2003 modules that ship with the motors | **≈ 1,140** |

## Notes on the PenPlot list

- **Firmware mismatch — read this first.** The firmware vendored in
  `firmware/` is **GRBL 1.1f for an Arduino Nano (ATmega328P)**. It will not
  run on an ESP32. Two valid builds:

  | Build | Controller | Firmware |
  |---|---|---|
  | As shipped | Arduino Nano | `firmware/` in this repo |
  | ESP32 variant | ESP32 | **FluidNC with unipolar support** — mainline FluidNC is step/dir only, so use a ULN2003 fork such as [openBrushograph/FluidNC-Z-Offset](https://github.com/openBrushograph/FluidNC-Z-Offset) |

  If you buy the ESP32 listed above, budget for that fork; the GRBL hex in this
  repo cannot be flashed to it.

- **The 28BYJ-48 already ships with a ULN2003 module.** At ₹85 from
  Robocraze the driver board is included, so the three bare ULN2003 ICs
  (₹51) are only needed if you are building the drivers into your own PCB.
  Buying both is redundant — pick one:

  | Path | Cost | Notes |
  |---|---|---|
  | Use the included modules | ₹0 extra | Modules plug into headers, replaceable |
  | Bare ICs on your PCB | ₹51 + PCB | Smaller, cleaner, one board |

- **ULN2003 wiring.** Each IC drives one motor: four inputs from the ESP32,
  four outputs to the motor coils. Pin 9 (COM) goes to **+5 V** — it is the
  common cathode of the internal flyback diodes. Leaving COM floating is the
  usual reason a hand-built ULN2003 stage kills itself on the first step.

- **Motor common wire.** The 28BYJ-48's red lead is the centre tap and goes to
  **+5 V**, not to ground. The ULN2003 sinks each phase to ground.

- **Power.** Three motors at ~0.24 A plus the ESP32 is under 1 A; a 5 V 2 A
  supply leaves headroom. Do not power the motors from the ESP32's 5 V pin.

- **Do not swap in a DRV8825 here.** The 28BYJ-48 is unipolar; DRV8825 is a
  bipolar driver and cannot sequence the coils.

---

# Project 2 — OpenCNC

ESP32 plus two NEMA17 steppers through DRV8825 modules, with a hobby servo
pen lift, running FluidNC in CoreXY. Separate machine, separate PCB.

## Electronics

| Ref | Part | Spec | Qty | Unit ₹ | Total ₹ | Stock | Source |
|---|---|---|---|---|---|---|---|
| U1 | ESP32-WROOM-32 DevKit | 38-pin, socketed | 1 | 449 | 449 | **Out of stock** | [Robu](https://robu.in/product/esp32-38pin-development-board-wifibluetooth-ultra-low-power-consumption-dual-core/) |
| U2, U3 | DRV8825 module | with aluminium heatsink | 2 | 89 | 178 | — | [Robu](https://robu.in/product/drv8825-stepper-motor-driver-with-aluminum-heat-sink/) |
| U4 | Mini MP1584 buck module | 12 V → 5 V, 3 A | 1 | 49 | 49 | In stock | [Robu](https://robu.in/product/mini-mp1584-dc-dc-3a-adjustable-buck-module-india/) |
| C1 | Electrolytic | 1000 µF / 25 V, 10×17 mm | 1 | 5 | 5 | In stock | [Robu](https://robu.in/product/hy1e102m100170cd288-hyncdz-1000uf-25v-55m%CF%89100khz-%C2%B120-1-45a100khz-plugind10xl17mm-aluminum-electrolytic-capacitors-leaded-rohs/) |
| C2, C3 | Electrolytic | 100 µF / 25 V | 2 | 4.64 | 9.28 | **Out of stock** | [Robu](https://robu.in/product/100uf-25v-electrolytic-capacitor-pack-of-10/) |
| C4, C5 | Ceramic | 100 nF / 50 V | 2 | 0.85 | 1.70 | — | [Robu](https://robu.in/product/100nf-50v-disc-capacitor/) |
| R1, R2 | Resistor | 10 kΩ (FLT pull-up) | 2 | 0.16 | 0.32 | — | [Robu](https://robu.in/product/10k-ohm-1-4w-0805-surface-mount-chip-resistor-pack-of-10/) |
| F1 | Ceramic fuse | 5×20 mm, T3A slow-blow | 1 | 6 | 6 | — | Local |
| — | Fuse holder | 5×20 PCB mount | 1 | 18 | 18 | In stock | [Robu](https://robu.in/product/fuse-holder-bf008-108520/) |
| J1 | DC jack | DC-005, 5.5×2.1 mm | 1 | 19 | 19 | In stock | [Robu](https://robu.in/product/dc-005-female-dc-power-jack-supply-socket-5-5x2-1mm/) |
| — | Female header | 2.54 mm, 1×40 | 1 | 75 | 75 | — | [Robu](https://robu.in/product/1-40-pin-2-54m-straight-long-female-berg-strip-connector-pack-of-5/) |
| — | Male header | 2.54 mm, 1×40 | 1 | 5 | 5 | — | [Robu](https://robu.in/product/2-54mm-1x40-pin-male-single-row-straight-short-header-strip-pack-of-3/) |
| — | Jumper caps | 2.54 mm | 6 | 1.60 | 9.60 | — | [Robu](https://robu.in/product/black-254mm-standard-circuit-board-computer-jumper-cap-shunts-short-circuit-cap/) |
| D1 | Schottky | SS34, 3 A | 1 | 5 | 5 | — | Local |
| **Electronics subtotal** | | | | | **₹829.90** | | |

## PCB and totals

| Item | ₹ |
|---|---|
| Electronics | 829.90 |
| 5× 2-layer, ~100×65 mm, economy shipping | ~700 |
| **One board built** | **≈ 1,530** |

Mechanicals for this machine — 2020 extrusion, GT2 belts, pulleys, MDF base —
are **not** included here and are approximately ₹2,900–3,700 depending on
whether the extrusion is bought locally or from Robu.

## Notes on the OpenCNC list

- **T3A, not F3A.** The 1000 µF bulk cap draws several amps for a few ms at
  power-on.
- **C2/C3 belong at the drivers**, within ~10 mm of each VMOT pin.
- **MP1584 output must be set to 5.0 V before connecting the ESP32.**
- **ESP32 38-pin is out of stock at Robu.** Any 38-pin WROOM devkit works.
- **DRV8825 only drives bipolar motors.** Not interchangeable with the
  PenPlot list.

---

## What the two projects share

Nothing electrical. Both use an ESP32 and a 5 V/12 V supply, and that is the
extent of it. Do not mix the BOM lines:

| | PenPlot | OpenCNC |
|---|---|---|
| Motor | 28BYJ-48, 5 V, unipolar, 5-wire | NEMA17, 12 V, bipolar, 4-wire |
| Driver | ULN2003 (Darlington sink) | DRV8825 (chopper) |
| Control interface | 4 GPIO per motor | STEP/DIR |
| Pen lift | third stepper (Z) | servo |
| Firmware | GRBL 1.1f, Nano | FluidNC, ESP32 |
| Supply | 5 V, 2 A | 12 V, 3 A |
