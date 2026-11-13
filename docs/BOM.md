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

## Mechanical parts

2020 T-slot frame, CoreXY belt drive, printed sliders, A3 portrait working
area. Robu prices are current; local items are market estimates.

| Part | Spec | Qty | Unit ₹ | Total ₹ | Source |
|---|---|---|---|---|---|
| 2020 T-slot extrusion | 500 mm lengths | 5 | 239 | 1195 | [Robu](https://robu.in/product/easymech-20x20-t-slot-aluminium-extrusion-profile-500-mm/) |
| MDF baseboard | 6 mm, 600 × 500 | 1 | 250 | 250 | Local |
| Corner brackets | 2020 external L, 2-face | 8 | 25 | 200 | Local / Amazon |
| M5 T-nuts | 10-pack, sliding | 4 | 22 | 88 | [Robu](https://robu.in/product/easymech-sliding-m5-t-nut-for-20x20-aluminium-profile-10-pcs/) |
| M3 T-nuts + screws | set | 1 | 150 | 150 | Local |
| M3/M5 fastener assortment | socket head | 1 | 250 | 250 | Local |
| GT2 drive pulley | 20T, **5 mm bore**, 2-pack | 1 | 126 | 126 | [Robu](https://robu.in/product/aluminum-gt2-timing-pulley-for-6mm-belt-20-tooth-5mm-bore-2pcs/) |
| GT2 smooth idler | 20T, 5 mm bore, 2-pack | 2 | 160 | 320 | [Robu](https://robu.in/product/aluminum-gt2-timing-idler-pulley-6mm-belt-20-tooth-5mm-bore-2pcs/) |
| GT2 belt | 6 mm, 2 mm pitch, 10 m | 1 | 635 | 635 | [Robu](https://robu.in/product/10m-gt2-width-6mm-black-open-timing-belt-for-3d-printer/) |
| 625ZZ bearings | 5×16×5, 4-pack (printed idlers) | 2 | 65 | 130 | Robu |
| Springs | pen lift, 3×15 mm | 4 | 10 | 40 | Local |
| Cable ties + spiral wrap | | 1 | 80 | 80 | Local |
| PLA filament | ~200 g of printed parts | 1 | 300 | 300 | Local |
| **Mechanical subtotal** | | | | **₹3,764** | |

### Cutting the frame cost

Robu extrusion is **₹478/m**. A local aluminium dealer or IndiaMART supplier
sells 2020 T-slot at **₹180–250/m**, so 2.5 m is ₹450–625 instead of ₹1,195 —
**saves ₹570–745**.

Two other savings:

| Change | Saves |
|---|---|
| Local extrusion instead of Robu | ₹570–745 |
| Skip 625ZZ bearings if the idler packs include them | ₹130 |
| Print the corner brackets instead of buying | ₹200 |

**Realistic mechanical total: ₹2,900–3,200** with local extrusion.

## PCB fabrication

| Item | ₹ |
|---|---|
| 5× 2-layer ~100×65 mm, JLCPCB economy shipping | ~700 |
| 5× 2-layer, DHL express | ~1,800 |

## Totals

| Scenario | Electronics + PCB | Mechanicals | Grand total |
|---|---|---|---|
| Robu extrusion, economy PCB shipping | ₹1,530 | ₹3,764 | **₹5,294** |
| Local extrusion, economy PCB shipping | ₹1,530 | ₹2,900 | **₹4,430** |
| Local extrusion + printed brackets + no spare bearings | ₹1,530 | ₹2,470 | **₹4,000** |
| 5 boards built, local extrusion | ₹1,060/board | ₹2,900 | **₹3,960** |


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

2× NEMA17, servo and the 12 V adaptor are assumed already owned (~₹1,400 if
bought new). Everything else — electronics, PCB and mechanicals — is covered
above.
