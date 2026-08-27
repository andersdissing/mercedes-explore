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
