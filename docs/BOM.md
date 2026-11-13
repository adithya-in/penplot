# OpenCNC controller BOM

Bill of materials for the **OpenCNC** controller board: ESP32-WROOM-32 +
2× DRV8825 + MP1584 buck, driving a 2-axis plotter with a servo pen lift.

This board is a separate project from the PenPlot firmware in this repo —
PenPlot drives a 28BYJ-48 machine through an Arduino Nano and ULN2003s. This
BOM is for the NEMA17 / DRV8825 machine.

Prices are **Robu.in, including GST, checked 13 November 2026**. Links go to
the live product page. Stock is stated where it could be verified; `—` means
it was not confirmed at the time of writing.

## PCB components

| Ref | Part | Spec | Qty | Unit ₹ | Total ₹ | Stock | Source |
|---|---|---|---|---|---|---|---|
| U1 | ESP32-WROOM-32 DevKit | 38-pin, socketed | 1 | 449 | 449 | **Out of stock** | [Robu](https://robu.in/product/esp32-38pin-development-board-wifibluetooth-ultra-low-power-consumption-dual-core/) |
| U2, U3 | DRV8825 module | with aluminium heatsink | 2 | 89 | 178 | — | [Robu](https://robu.in/product/drv8825-stepper-motor-driver-with-aluminum-heat-sink/) |
| U4 | Mini MP1584 buck module | 12 V → 5 V, 3 A | 1 | 49 | 49 | In stock | [Robu](https://robu.in/product/mini-mp1584-dc-dc-3a-adjustable-buck-module-india/) |
| C1 | Electrolytic | 1000 µF / 25 V, 10×17 mm, 105 °C | 1 | 5 | 5 | In stock | [Robu](https://robu.in/product/hy1e102m100170cd288-hyncdz-1000uf-25v-55m%CF%89100khz-%C2%B120-1-45a100khz-plugind10xl17mm-aluminum-electrolytic-capacitors-leaded-rohs/) |
| C2, C3 | Electrolytic | 100 µF / 25 V | 2 | 4.64 | 9.28 | **Out of stock** | [Robu](https://robu.in/product/100uf-25v-electrolytic-capacitor-pack-of-10/) |
| C4, C5 | Ceramic disc | 100 nF / 50 V | 2 | 0.85 | 1.70 | — | [Robu](https://robu.in/product/100nf-50v-disc-capacitor/) |
| R1, R2 | Resistor | 10 kΩ, 0805 (FLT pull-up) | 2 | 0.16 | 0.32 | — | [Robu](https://robu.in/product/10k-ohm-1-4w-0805-surface-mount-chip-resistor-pack-of-10/) |
| F1 | Ceramic fuse | 5×20 mm, **T3A** slow-blow | 1 | 6 | 6 | — | Local / Vishaworld |
| — | Fuse holder | 5×20 PCB mount (BF008) | 1 | 18 | 18 | In stock | [Robu](https://robu.in/product/fuse-holder-bf008-108520/) |
| J1 | DC barrel jack | DC-005, 5.5×2.1 mm, PCB mount | 1 | 19 | 19 | In stock | [Robu](https://robu.in/product/dc-005-female-dc-power-jack-supply-socket-5-5x2-1mm/) |
| — | Female header strip | 2.54 mm, 1×40 (for U1 socket) | 1 | 75 | 75 | — | [Robu](https://robu.in/product/1-40-pin-2-54m-straight-long-female-berg-strip-connector-pack-of-5/) |
| — | Male header strip | 2.54 mm, 1×40 (cut for J2–J6) | 1 | 5 | 5 | — | [Robu](https://robu.in/product/2-54mm-1x40-pin-male-single-row-straight-short-header-strip-pack-of-3/) |
| — | Jumper caps | 2.54 mm shunts | 6 | 1.60 | 9.60 | — | [Robu](https://robu.in/product/black-254mm-standard-circuit-board-computer-jumper-cap-shunts-short-circuit-cap/) |
| D1 | Schottky diode | SS34, 3 A (reverse polarity) | 1 | 5 | 5 | — | Local |
| **Components subtotal** | | | | | **₹829.90** | | |

## PCB fabrication

| Item | ₹ |
|---|---|
| 5× 2-layer ~100×65 mm, JLCPCB economy shipping | ~700 |
| 5× 2-layer, DHL express | ~1,800 |

## Totals

| Scenario | Total |
|---|---|
| One board, economy shipping | ~₹1,530 |
| One board, express shipping | ~₹2,630 |
| 5 boards made, all built | ~₹5,300 (₹1,060 each) |

## Out-of-stock items

Two lines were unavailable at Robu when this was written:

- **ESP32-WROOM-32 38-pin (₹449).** Alternatives: the SmartElex ESP32-WROOM-32
  kit, a 30-pin DevKit V1 (needs a different footprint), or wait for restock.
  Any 38-pin WROOM devkit works — the board only needs the 2×19 header grid.
- **100 µF / 25 V (₹4.64).** Any 100 µF 25 V electrolytic works. Prefer low-ESR;
  these sit at the drivers, not at the power entry.

## Notes

- **T3A, not F3A.** The 1000 µF bulk cap draws several amps for a few ms at
  power-on; a fast fuse nuisance-trips.
- **C2/C3 belong at the drivers**, within ~10 mm of each VMOT pin. C1 is bulk
  at the jack and does not replace them.
- **Keep the ESP32 socketed.** It is the part most likely to die from a wiring
  mistake, and it is the most expensive single item here.
- **MP1584 output must be set to 5.0 V before connecting the ESP32.** These
  ship at an arbitrary voltage; measure with no load and adjust the pot.
- **Free shipping over ₹999.** An order at ~₹830 pays ₹60–80 shipping; bundle
  the GT2 belt, pulleys and 2020 extrusion to clear the threshold.
- Heatsinks are included with the DRV8825 modules. They add ~15 mm of height,
  so keep them clear of the ESP32 and the servo.

## Not included

2× NEMA17, servo, 12 V 2 A adaptor (already owned). Mechanicals — 2020
extrusion, MDF base, brackets, GT2 belt and pulleys — are approximately
₹2,300 and belong with the machine build, not this board.
