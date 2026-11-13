# OpenCNC — technical reference

Complete technical description of the OpenCNC pen plotter: an ESP32-based
CoreXY machine with two NEMA17 steppers, DRV8825 drivers and a hobby servo
pen lift, running [FluidNC](https://github.com/bdring/FluidNC).

**Status:** design reference. The electronics are specified against the
DRV8825, MP1584 and ESP32 datasheets; the machine has not been built yet, so
the speed and calibration figures below are targets, not measurements.

Companion documents:

- [`BOM.md`](BOM.md) — component list with current Robu.in prices
- [`README.md`](../README.md) — the browser app that generates the G-code

---

## 1. Summary

| | |
|---|---|
| Machine | 2-axis CoreXY pen plotter |
| Working area | **340 × 460 mm** (A3 portrait) |
| Frame | 2020 T-slot aluminium, 520 × 400 mm footprint |
| Motors | 2× NEMA17, 1.8°, 200 steps/rev |
| Drivers | 2× DRV8825, 1/16 microstepping, 1.0 A |
| Controller | ESP32-WROOM-32, 38-pin DevKitC |
| Firmware | FluidNC, `kinematics: CoreXY` |
| Pen lift | Hobby servo on the Z axis, 0–5 mm virtual travel |
| Drive | GT2 belt, 6 mm, 2 mm pitch, 20T pulleys |
| Resolution | **0.0125 mm/step** (80 steps/mm) |
| Power | 12 V, 3 A recommended (2 A minimum) |

## 2. Architecture

```
 ┌──────────────┐   WiFi / USB     ┌─────────────────────────┐
 │  Browser     │ ───────────────► │  ESP32-WROOM-32         │
 │  (PenPlot or │   GRBL protocol  │  FluidNC                │
 │   any sender)│ ◄─────────────── │  CoreXY planner         │
 └──────────────┘                  └────┬───────────┬────────┘
                                        │ STEP/DIR  │ PWM
                                   ┌────▼────┐  ┌───▼────┐
                                   │ DRV8825 │  │ Servo  │
                                   │   A     │  │ pen    │
                                   ├─────────┤  │ lift   │
                                   │ DRV8825 │  └────────┘
                                   │   B     │
                                   └────┬────┘
                                        │
                              ┌─────────▼──────────┐
                              │ CoreXY belt loop   │
                              │ X gantry + Y rail  │
                              └────────────────────┘
```

The ESP32 does no trajectory maths beyond the planner: FluidNC converts
Cartesian moves into the two motor vectors, and the hardware step generator
(RMT engine) emits pulses. The servo is a virtual Z axis.

## 3. Electrical

### 3.1 Power tree

```
12 V 3 A ──► fuse T3A ──► [1000 µF bulk] ──┬── DRV8825 A  VMOT [100 µF + 100 nF]
   adaptor                                 ├── DRV8825 B  VMOT [100 µF + 100 nF]
                                           └── MP1584 ──► 5 V ──┬── ESP32 5V pin
                                                                 ├── servo 5 V [1000 µF]
                                                                 └── microSD / logic
```

| Rail | Source | Load |
|---|---|---|
| 12 V | adaptor | 2× DRV8825 VMOT |
| 5 V | MP1584 module, set to 5.00 V | ESP32 devkit, servo |
| 3.3 V | ESP32 devkit's own regulator | DRV8825 VDD, FLT pull-ups |

Typical draw: 1.5–2.1 A at 12 V with both motors energised.

### 3.2 ESP32 pin map

38-pin DevKitC, standard GPIO numbering. Pins chosen to avoid the flash bus
(6–11), input-only pins (34–39), strapping pins (0, 2, 12, 15) and UART0
(1, 3).

| Function | GPIO | Notes |
|---|---|---|
| Motor A STEP (`x.motor0`) | **26** | |
| Motor A DIR | **27** | |
| Motor B STEP (`y.motor0`) | **32** | |
| Motor B DIR | **33** | |
| Shared driver enable | **25** | active LOW |
| Servo PWM (Z axis) | **13** | 50 Hz |
| X limit switch | **16** | internal pull-up |
| Y limit switch | **17** | internal pull-up |
| DRV8825 VDD | 3V3 | logic only, a few mA |
| Power in | 5V pin | from MP1584 |

In CoreXY the motors are **not** X and Y. Motor A and motor B each contribute
to both axes; FluidNC assigns them to `x.motor0` and `y.motor0` respectively.

### 3.3 DRV8825 configuration

Each module, by silkscreen name:

| Pin | Connect to |
|---|---|
| VMOT | +12 V, 100 µF + 100 nF to GND within 10 mm |
| GND (×2) | star ground at the PSU |
| VDD | ESP32 3V3 |
| EN | GPIO 25 (both drivers) or GND |
| M0 | GND |
| M1 | GND |
| M2 | **3V3** |
| RST | 3V3 |
| SLP | 3V3 (bridge RST–SLP) |
| STEP | A: GPIO 26 · B: GPIO 32 |
| DIR | A: GPIO 27 · B: GPIO 33 |
| FLT | 10 kΩ pull-up to 3V3 (open-drain, active low, optional to a GPIO) |
| 1A / 1B | motor coil 1 |
| 2A / 2B | motor coil 2 |

**Microstepping (M0/M1/M2):**

| Mode | M0 | M1 | M2 |
|---|---|---|---|
| 1/8 | 1 | 1 | 0 |
| **1/16** | **0** | **0** | **1** |
| 1/32 | 1 | 0 | 1 |

**Current limit:** `I_limit = Vref / (5 × 0.1 Ω) = 2 × Vref`

| Current | Vref |
|---|---|
| 0.9 A | 0.45 V |
| 1.0 A | 0.50 V |
| 1.2 A | 0.60 V |

Set 0.45–0.50 V. A pen plotter needs almost no torque, and a lower current
keeps a 2 A adaptor inside its limit. Measure at the pot wiper against GND,
12 V applied, **motors disconnected**.

### 3.4 Servo (Z axis)

The servo is mapped across a virtual 5 mm Z axis:

| Z | Pulse | Action |
|---|---|---|
| Z0 | 1000 µs | pen down |
| Z2.5 | 1500 µs | pen up (2.5 mm lift) |
| Z5 | 2000 µs | park / pen change |

`steps_per_mm: 100`, `max_travel_mm: 5`, so 0.05 mm of Z equals 10 µs of pulse.
Swap `min_pulse_us`/`max_pulse_us` if the horn moves the wrong way.

Power the servo from the **5 V rail with a 1000 µF bulk capacitor** near the
connector. An SG90 stalling will otherwise brown out the ESP32 mid-plot.

Add a dwell after each pen change:

```gcode
G1 Z0 F3000
G4 P0.2        ; servo settle
```

### 3.5 Limit switches

Normally-open microswitch, COM to GND, NO to the GPIO. FluidNC enables the
internal pull-up, so the pin reads high when open and low when pressed.

```gcode
limit_neg_pin: gpio.16:low
```

Fit a 100 nF capacitor from each GPIO to GND if the switch leads exceed
~30 cm; stepper noise on long unshielded wires causes phantom triggers.

### 3.6 Protection

| Part | Purpose |
|---|---|
| T3A ceramic fuse, 5×20 | short-circuit protection |
| SS34 Schottky in series | reverse-polarity protection (~0.45 V drop at 2 A) |
| 1000 µF / 25 V at input | bulk reservoir |
| 100 µF + 100 nF per driver | local decoupling, prevents step loss |
| 10 kΩ on FLT | open-drain pull-up |

## 4. Firmware

FluidNC v3 or later on a classic ESP32 (v4 required only for ESP32-S3).
Flash from <https://install.fluidnc.com>, then join the `FluidNC` access point
and upload the config through the WebUI.

```yaml
name: "OpenCNC A3"
board: esp32dev

stepping:
  engine: RMT
  idle_ms: 255
  pulse_us: 2
  dir_delay_us: 1
  disable_delay_us: 0

kinematics:
  corexy:

axes:
  shared_stepper_disable_pin: gpio.25:low

  x:
    steps_per_mm: 80
    max_rate_mm_per_min: 3000
    acceleration_mm_per_sec2: 400
    max_travel_mm: 310
    soft_limits: false
    homing:
      cycle: 1
      positive_direction: false
      mpos_mm: 0
      feed_mm_per_min: 500
      seek_mm_per_min: 2000
      settle_ms: 250
    motor0:
      limit_neg_pin: gpio.16:low
      stepstick:
        step_pin: gpio.26
        direction_pin: gpio.27
        microsteps: 16

  y:
    steps_per_mm: 80
    max_rate_mm_per_min: 3000
    acceleration_mm_per_sec2: 400
    max_travel_mm: 430
    soft_limits: false
    homing:
      cycle: 2
      positive_direction: false
      mpos_mm: 0
      feed_mm_per_min: 500
      seek_mm_per_min: 2000
      settle_ms: 250
    motor0:
      limit_neg_pin: gpio.17:low
      stepstick:
        step_pin: gpio.32
        direction_pin: gpio.33
        microsteps: 16

  z:
    steps_per_mm: 100
    max_rate_mm_per_min: 3000
    acceleration_mm_per_sec2: 1000
    max_travel_mm: 5
    soft_limits: false
    homing:
      cycle: 3
      positive_direction: false
      mpos_mm: 0
    motor0:
      rc_servo:
        output_pin: gpio.13
        pwm_hz: 50
        min_pulse_us: 1000
        max_pulse_us: 2000
        timer_ms: 20
```

**Homing notes.** CoreXY cannot home X and Y in the same pass — each logical
axis move drives both motors. Put every axis on its own `cycle`. With no
switches fitted, set `cycle: -1` and origin manually with `G92`.

**Steps/mm derivation.** 20T GT2 pulley = 40 mm/rev. 200 steps/rev × 16
microsteps = 3200 steps/rev. 3200 ÷ 40 = **80 steps/mm**. Change
`microsteps` to 32 and this becomes 160.

## 5. Mechanics

### 5.1 Frame

2020 T-slot, bolted to a 6 mm MDF baseboard. The baseboard is structural —
it converts four open profiles into a closed box and is what keeps the frame
square.

| Part | Length | Qty |
|---|---|---|
| Y rails (left/right) | 520 mm | 2 |
| Front/rear cross members | 400 mm | 2 |
| X gantry beam | 380 mm | 1 |
| **Total** | **2.22 m** | buy 3 m |

Footprint 520 × 400 mm. Corner brackets on **two faces** at every joint; a
single bracket on a T-slot joint creeps under belt tension.

### 5.2 CoreXY belt path

Two closed loops, one per motor, both moving the same carriage. Motor A is
mounted at the rear-left, motor B at the rear-right. Each loop passes over
four idlers and terminates on the carriage.

Two rules that decide whether it works:

1. **The loops must cross in different Z planes.** Stack the pulleys with a
   3–5 mm spacer, or the belts rub.
2. **Belt plane close to the beam centreline.** An offset belt applies a
   twisting moment to the 2020, which shows up as skew, not sag.

Belt length ≈ `2 × (X + Y) + allowance` per loop ≈ 1.65 m, so **5 m** covers
both with waste.

### 5.3 Motion and pen lift

- 4× smooth idlers, 20T, 5 mm bore
- GT2 belt 6 mm, 2 mm pitch
- Printed sliders on plain T-slot (cheapest) or mini V-wheels on V-slot
- Pen arm kept under ~80 mm and supported at both ends; a long unsupported
  cantilever is the real source of pressure variation, not beam deflection

### 5.4 Structural note

Beam deflection is not the problem people expect. At 380 mm span with a 400 g
toolhead:

```
δ = P·L³ / (48·E·I) = 4 × 380³ / (48 × 68900 × 7000) ≈ 0.010 mm
```

That is 30× smaller than a 0.3 mm pen line, and it is static and repeatable.
Twist and joint slip matter far more than bending.

## 6. Performance

| Parameter | Value |
|---|---|
| Resolution | 0.0125 mm/step |
| Realistic draw speed | 3,000–6,000 mm/min |
| Rapid | 6,000–10,000 mm/min |
| Acceleration | 400–800 mm/s² |
| Junction deviation | 0.05–0.1 mm |
| MCU step-rate headroom | ~6–12× unused |

The controller is never the bottleneck. FluidNC's step generator reaches
250–500 kHz; this machine uses 4–8 kHz at plotting speeds.

**What actually limits speed:**

1. **Servo dwell** — `G4 P0.2` twice per path. On a 3,000-path plot that is
   20 minutes of pure waiting. This dominates.
2. **Acceleration through short segments** — SVG curves flattened to 0.15 mm
   become thousands of vertices, each a potential deceleration.
3. **Motor torque at 12 V** — coil inductance starves current at speed. A 24 V
   supply roughly doubles usable speed; the MP1584 and DRV8825 both accept it.
4. **Pen behaviour** — fine liners thin out or skip above ~150–200 mm/s.

## 7. Software chain

The machine speaks GRBL-compatible G-code, so any sender works.

**Option A — PenPlot (this repo).** Browser app over Web Serial. Compatible
commands: `G0/G1`, `G4 P`, `G10 L20 P1`, `$J=`, `$X`, and the realtime
characters `?`, `!`, `~`, `0x18`. Pen up/down is a `Z` move, which maps
directly onto the servo axis.

Two changes needed for this machine:

- `settings.js`: `steps 80`, `travel {x:310, y:430}`, `maxRate 3000`,
  `accel 400`, `pen {up:2.5, down:0}`
- Kinematics must be set in FluidNC's YAML, not through the app

**Option B — vpype pipeline.**

```bash
vpype read art.svg linemerge linesimplify reloop linesort \
     write --profile plotter art.gcode
```

`linesort` and `linesimplify` reduce both travel distance and the number of
decelerations, which matters more than feed rate.

## 8. Commissioning

Ordered so that a failure is cheap to find.

1. **Power only.** 12 V in, no motors. Confirm 5.00 V at the MP1584 output and
   3.3 V at the ESP32.
2. **Set Vref.** 0.45–0.50 V on both drivers, motors disconnected.
3. **Flash FluidNC.** Upload the YAML, confirm no config errors in the
   console, check `$Config/Dump`.
4. **Bench-test motors.** Free-spinning, no belt. Jog ±10 mm. Confirm
   direction and that neither driver is silent (silent = disabled).
5. **Assemble the frame.** Square it diagonally to under 1 mm before
   tensioning belts.
6. **Fit belts.** `G0 X50` must move only X. Diagonal motion means one
   motor's direction is inverted.
7. **Servo.** Tune pulse widths so Z0 touches paper and Z2.5 clears by 2–3 mm.
   Run 20 down/up cycles and confirm the touchdown point repeats.
8. **Calibrate.** Plot a 100 mm square, measure, adjust `steps_per_mm`.
   A parallelogram means belt tension, not steps.
9. **Plot artwork.**

## 9. Calibration

| Symptom | Cause | Fix |
|---|---|---|
| Both axes too long/short by same factor | steps/mm | adjust `steps_per_mm` |
| X and Y differ | pulley tooth count or microstep jumpers | verify 20T and M0/M1/M2 |
| Parallelogram instead of square | belt tension asymmetry | re-tension both loops |
| Rounded corners at speed | acceleration too low | raise `acceleration_mm_per_sec2` |
| Lines wander on long moves | missed steps | lower current? no — raise Vref or lower acceleration |
| Pen pressure varies across the bed | baseboard not flat | MDF, shim the frame feet |
| Random pauses, ESP32 resets | supply sag or servo brownout | bulk caps, lower driver current |

## 10. Safety and failure modes

- **Never disconnect a motor with power on.** The inductive kick destroys
  DRV8825s instantly.
- **Star ground.** Motor return current must not pass through the ESP32's
  ground pin.
- **Set Vref before connecting motors.** A pot at maximum delivers 2× the
  intended current.
- **FLT low at idle** means a real fault: check VMOT present, Vref not zero,
  RST/SLP high.
- **Both drivers silent and cold** normally means EN is high, SLP is floating,
  or the 12 V rail is dead.

## 11. Known limitations

| Limitation | Impact |
|---|---|
| 12 V / 2 A adaptor | marginal with two NEMA17s; set 0.9 A per motor |
| DRV8825 is non-silent | audible buzz; TMC2209 would be quieter |
| Printed sliders | 0.2–0.5 mm of play; fine for sketches, not precision art |
| No closed-loop feedback | a missed step is permanent for that plot |
| Servo Z | no force control; pen pressure is set mechanically |
| 25 V bulk cap | do not reuse on a 24 V build — use 35 V |

## 12. Bill of materials

See [`BOM.md`](BOM.md). Components only: **≈ ₹830** at Nov 2026 Robu prices,
or **≈ ₹1,530** including a 5-piece PCB order.
