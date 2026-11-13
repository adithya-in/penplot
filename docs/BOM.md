# PenPlot — bill of materials

ESP32 plus three 28BYJ-48 steppers driven through ULN2003 Darlington arrays.
X and Y move the gantry, Z lifts the pen — there is no servo on this machine.

The other machine in this organisation, **OpenCNC** (NEMA17 + DRV8825 + servo),
lives at <https://github.com/adithya-in/opencnc> with its own BOM.

Prices checked November 2026, GST included where applicable. Stock is stated
where it could be verified; `—` means it was not confirmed.

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

## Totals

| Build | ₹ |
|---|---|
| Custom PCB, one board built | **≈ 1,780** |
| Perfboard / use the ULN2003 modules that ship with the motors | **≈ 1,140** |

## Notes

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
  bipolar driver and cannot sequence the coils. That hardware belongs to
  [OpenCNC](https://github.com/adithya-in/opencnc).
