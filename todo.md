# TODO — Homey Mercedes app

What the Homey app (`C:\code\homey\mercedes`, currently v1.1.49) still needs to implement for the
things this Explorer shows as **Proposed**. When an item ships, drop its `proposed` flag in
`src/js/data.js`, bump `HOMEY_APP_VERSION`, and remove it from here.

---

## 1. Charge flap status — [issue #55](https://github.com/andersdissing/Mercedes-Benz-homey-app/issues/55)

**Request (2026-07-31):** a charge flap capability like the Home Assistant integration has, plus
flow cards *When charge flap opened / closed* and *And charge flap is open / closed*.

### What we know about the data

| | Source | Finding |
|---|---|---|
| Attribute names | HA [mbapi2020 `car.py`](https://github.com/ReneNulschDE/mbapi2020/blob/master/custom_components/mbapi2020/car.py) `DOOR_OPTIONS` | `chargeFlapDCStatus`, `chargeFlapACStatus` (grouped with the doors, not with the electric attributes) |
| HA entities | mbapi2020 `const.py` | `chargeflapacstatus` = binary sensor, device class `door`, flipped (`"0"` → on/open, `"1"` → off/closed); `chargeflapdcstatus` = plain sensor |
| Value enum | [vehicle-info-card `state-mapping.ts`](https://github.com/ngocjohn/vehicle-info-card/blob/main/src/const/state-mapping.ts) `chargeflapdcstatus` | `0` Open, `1` Closed, `2` Pressed (release button pushed, flap unlatched), `3` Unknown |
| Other bindings | openHAB `mercedesme` `Constants.java`, ioBroker `vsu-field-types.js` | openHAB reads only `chargeFlapDCStatus` → channel `charge-flap`; ioBroker types both as `int` |
| Explorer mapping | `src/js/data.js` → `door_charge_flap` | DC flap first, AC flap as fallback, mapped with the enum above |

**Unknowns — resolve before/while implementing**

- [ ] **Does the attribute arrive at all, and over which channel?** HA groups it with the doors, and
      every door attribute the Homey app reads is push-only (WebSocket), never in the REST
      `vehicleattributes` response. Anders' own car does not seem to report it (issue comment
      2026-08-26). The Explorer's *Charge Flap* row now shows *Not reported by vehicle* vs. a value,
      so ask the reporter (@apkanthony) for a fresh Explorer copy with the flap closed **and** open.
      If it only shows up in the Homey app's `[UPDATE]` log and never in the Explorer, mark the
      Explorer row `pushOnly: true`.
- [ ] **DC vs AC.** Most EQ cars have one flap over the CCS inlet (expect `chargeFlapDCStatus`);
      PHEVs have an AC-only inlet (expect `chargeFlapACStatus`). Confirm whether a car ever sends
      both and whether they can disagree; the fallback order DC → AC assumes they don't.
- [ ] **Value `2` ("Flap pressed").** Confirm on a real car whether this appears as a transient
      state between closed and open. Design below treats it as *neither open nor closed* (no
      trigger fires on it).

### Implementation checklist (Homey app repo)

Mirror the existing door / connector patterns — file:line references are for v1.1.49.

- [ ] **Capability definition** — `.homeycompose/capabilities/door_charge_flap.json`, copy of
      `door_trunk.json`: `type: string`, `getable`, not `setable`, `uiComponent: sensor`,
      titles `en: "Charge Flap"`, `nl: "Laadklep"`, `de: "Ladeklappe"`,
      icon `/assets/icons/charge_flap.svg` (already exists; `onoff_connector` and
      `text_connector_status` use it today).
- [ ] **Add the capability to devices**
  - [ ] `drivers/mercedes-vehicle/driver.compose.json` — add `door_charge_flap` after `door_hood` (line ~64) for new pairings.
  - [ ] `drivers/mercedes-vehicle/device.js` `onInit` — `if (!this.hasCapability('door_charge_flap')) await this.addCapability('door_charge_flap')`, next to the `onoff_connector` block (line ~374), so existing devices get it without re-pairing.
- [ ] **Value mapping** — put it in `lib/` so it is unit-testable (same idea as `lib/precond-status.js`), e.g. `lib/charge-flap-status.js`:
      `{ '0': 'Open', '1': 'Closed', '2': 'Flap pressed' }`, anything else → `String(value)` plus a
      `[UPDATE] WARNING: Unrecognized door_charge_flap raw value` log (same as the door loop does).
      Accept number and string input (`0` and `"0"`).
- [ ] **Update handler** — `device.js`, after the door loop (line ~1568), wrapped in `try/catch` like
      the connector block (line ~1254):
  - read `data.chargeFlapDCStatus ?? data.chargeflapdcstatus ?? data.chargeFlapACStatus ?? data.chargeflapacstatus`
        (the parser has delivered both casings for other attributes — see the coupler code).
  - `null` (nil attribute) → set `'Unknown'`, `undefined` → do nothing.
  - `setCapabilityValue('door_charge_flap', status)` with a `[UPDATE] Setting door_charge_flap to: ... (raw: ..., old: ...)` log.
  - on change: `oldStatus !== 'Open' && status === 'Open'` → trigger `charge_flap_opened`;
        `oldStatus !== 'Closed' && status === 'Closed'` → trigger `charge_flap_closed`;
        `'Flap pressed'` fires nothing. Log `[TRIGGER] Charge flap opened/closed`.
- [ ] **Flow cards** (`.homeycompose/flow/`)
  - [ ] `triggers/charge_flap_opened.json` — copy `connector_connected.json`; titles
        `en: "Charge flap was opened"`, `nl: "Laadklep is geopend"`, `de: "Ladeklappe wurde geöffnet"`. No tokens needed.
  - [ ] `triggers/charge_flap_closed.json` — `en: "Charge flap was closed"`, `nl: "Laadklep is gesloten"`, `de: "Ladeklappe wurde geschlossen"`.
  - [ ] `conditions/charge_flap_open.json` — copy `is_connector_connected.json`;
        `title`/`titleFormatted` `en: "Charge flap is !{{open|closed}}"`, `nl: "Laadklep is !{{open|dicht}}"`,
        `de: "Ladeklappe ist !{{offen|geschlossen}}"`; hint *Checks if the charge flap is open.*
- [ ] **Condition run listener** — `driver.js` next to `is_connector_connected` (line ~233):
      `getConditionCard('charge_flap_open').registerRunListener(async args => args.device.isChargeFlapOpen())`,
      and `isChargeFlapOpen()` in `device.js` next to `isConnectorConnected()` (line ~2228):
      `return this.getCapabilityValue('door_charge_flap') === 'Open'` (so `'Flap pressed'` and `'Unknown'` count as *not open*).
- [ ] **Decide: keep it out of the generic door cards.** Do **not** add the flap to `doorMappings`,
      `any_door_open` or the `door_opened`/`door_closed` token list — the flap is open for the whole
      of every charge, which would make *Any door is open* useless for its current users. The
      dedicated cards above are what the issue asks for.
- [ ] **Regenerate `app.json`** — it is built from `.homeycompose/`; never edit it by hand
      (`homey app build` / `homey app validate`).
- [ ] **Tests** — `test/charge-flap-status.test.js` for the mapping (0/1/2, string and number input,
      unknown value, null); extend `test/proto-parser-attributes.test.js` with a `chargeFlapDCStatus`
      `intValue` attribute if the parser needs any change to surface it.
- [ ] **Docs & release**
  - [ ] `README.md` lines 42/44: 19 → 21 trigger cards, 13 → 14 condition cards; add the charge flap to the capability list; mirror in `README.txt` / `README.de.txt` / `README.nl.txt` if they list cards.
  - [ ] `.homeychangelog.json` entry (en/nl/de) for the new version; bump `app.json` + `package.json` version.
- [ ] **Verify on a real car** (per `CLAUDE.md` in the app repo): `npx homey app run --remote` in the
      background, monitor `\[UPDATE\] Setting door_charge_flap|\[TRIGGER\] Charge flap`, open and
      close the flap, and check both triggers fire once each and the condition flips.
- [ ] **Close the loop in this Explorer** — remove `proposed` from `door_charge_flap`,
      `charge_flap_open`, `charge_flap_opened`, `charge_flap_closed` in `src/js/data.js`; set
      `pushOnly` if step 1 showed it never reaches REST; bump `HOMEY_APP_VERSION`; delete this section.

### Timeline

- 2026-07-31 — issue opened by @apkanthony
- 2026-08-02 — raw data (closed + open state) requested from the reporter; not received yet
- 2026-08-26 — Anders: cannot read a charge flap status from his own car
- 2026-08-27 — Explorer shows a *Proposed* **Charge Flap** row and the four flow cards so owners can report whether their car sends `chargeFlapDCStatus` / `chargeFlapACStatus`

---

## 2. Powertrain assessment — [issue #79](https://github.com/andersdissing/Mercedes-Benz-homey-app/issues/79)

**Report:** a GLC 220d — a diesel — shows a battery at 0% and Homey raises low-battery
alerts for it. Every car was paired with `measure_battery` and the driver declared
`energy.batteries`, so a diesel was a battery device by construction.

The fix is [PR #80](https://github.com/andersdissing/Mercedes-Benz-homey-app/pull/80) (app v1.1.50,
**draft, not verified on a real car**): `lib/powertrain.js` classifies the car from what Mercedes
says it can be *commanded* to do — `/v1/vehicle/{vin}/capabilities` and `.../capabilities/commands`,
merged by `api.getVehicleFeatures()` — and the device adds or removes the electric capabilities to
match. Charge/ZEV commands mean electric, auxheat/engine start mean combustion, both mean a plug-in
hybrid (electric), nothing recognised means `unknown`, which keeps every capability but is not
declared battery-powered.

### What the Explorer shows

`src/js/powertrain.js` is a port of that classification, run against the same two endpoints, and the
**Powertrain** panel shows the verdict an owner's car produces plus the commands that produced it.
That is the value to ask a reporter for when a car is classified wrongly — it says whether the car's
command vocabulary is one the markers miss, or whether the endpoints answered at all.

**Unknowns — resolve before/while implementing**

- [ ] **Do both endpoints answer for a normal account?** PR #80 assumes either can 401; that has not
      been seen on a real car yet. A `Failed to fetch capabilities: 401` line in the panel is the
      evidence, and the `unknown` verdict it produces is the one that leaves a diesel alone but also
      leaves it with the electric capabilities.
- [ ] **Does the diesel in #79 classify as `ice`?** It should list `AUXHEAT_*` / `ENGINE_*` and no
      charge command. Ask the reporter for an Explorer screenshot of the panel.
- [ ] **Marker coverage.** `CHARGE`, `CHARGING`, `ZEV`, `MAX_SOC`, `HV_BATTERY` vs. `AUXHEAT`,
      `AUX_HEAT`, `ENGINE_START`, `ENGINE_STOP`, `TANK`, `FUEL`. A car that offers only commands
      outside both lists lands on `unknown`; collect those command names from Explorer reports and
      widen the lists in the Homey app (and here) rather than guessing.

### Implementation checklist

- [ ] **Homey app**: merge PR #80 after verifying on a real car — a diesel loses `measure_battery`
      and raises no alert, a BEV keeps its capabilities, and the **Powertrain** setting overrides
      detection in both directions.
- [ ] **Close the loop in this Explorer** — drop the *Proposed* badge on the Powertrain panel
      (`powertrain-proposed` in `src/index.html`, `POWERTRAIN_ISSUE` in `src/js/powertrain.js`), bump
      `HOMEY_APP_VERSION`, keep `EV_MARKERS` / `ICE_MARKERS` / `EV_CAPABILITIES` in step with
      `lib/powertrain.js`, and delete this section.

### Timeline

- issue #79 opened by the owner of a GLC 220d: petrol/diesel car showing a low battery
- 2026-08-31 — PR #80 opened (draft): `lib/powertrain.js`, powertrain setting, capabilities added
  and removed per verdict
- 2026-08-31 — Explorer shows a *Proposed* **Powertrain** panel running the same classification, so
  owners can report the verdict and the commands behind it
