/**
 * Powertrain assessment.
 *
 * Started as a port of the Homey app's `lib/powertrain.js` (PR #80, for issue
 * #79) and no longer is one: a reporting owner's diesel came back electric
 * here, and the export said why. Two things the command-only rule got wrong,
 * both visible in that one car:
 *
 * 1. ZEV commands are not electric evidence. Mercedes offers
 *    ZEV_PRECONDITIONING_START / _STOP / ZEV_PRECONDITION_CONFIGURE / _SEATS on
 *    combustion cars as remote pre-entry climate - that diesel offers all four,
 *    with `precondNow` and `remoteSettingTemperature` true - so "ZEV" is a
 *    marker of a heater, not of a battery. It is gone from the markers.
 * 2. Commands alone cannot classify every car. On that same diesel every
 *    combustion marker is false too: no auxheat, no remote engine start. With
 *    ZEV dropped it would land on `unknown` - quiet, but still not right.
 *
 * What does decide it is the reading the car sent. `rangeliquid`,
 * `tanklevelpercent` and `tankLevelAdBlue` are values only a car with a fuel
 * tank has; `soc` and `rangeelectric` only a car with a high-voltage battery.
 * The app's premise - that the readings cannot decide this - holds only for
 * *absence*: the parser drops nil attributes, so a missing `soc` says nothing.
 * Presence is proof, and proof beats a guess off a command catalogue.
 *
 * So: readings first, commands second, `unknown` when neither says anything.
 *
 * The Homey app does not do this yet - it ships the command-only rule - so
 * `assessPowertrain()` also reports what that rule would have said, and the
 * panel shows both whenever they disagree. Issue #79 is where that gets fixed
 * in the app; `todo.md` carries what this tool learned for it.
 */

const POWERTRAIN_EV = 'ev';
const POWERTRAIN_ICE = 'ice';
const POWERTRAIN_UNKNOWN = 'unknown';

// The capabilities the powertrain gates. Fuel, AdBlue and auxheat stay on
// every car - they are not part of this verdict.
const EV_CAPABILITIES = [
  'measure_battery',
  'measure_max_soc',
  'measure_range_electric',
  'measure_battery_temperature',
  'measure_charge_power',
  'onoff_charging',
  'onoff_connector',
  'text_charging_status',
  'text_charge_program',
  'text_end_charge_time',
  'text_connector_status'
];

// The two endpoints do not agree on spelling: /capabilities/commands keys the
// map by SCREAMING_SNAKE command names (CHARGE_PROGRAM_CONFIGURE), while
// /capabilities returns a camelCase feature dict. Both are normalised to the
// same shape before matching.
//
// No ZEV here (see the file comment). HVBATTERY is spelled without the
// underscore Mercedes does not send: the commands arrive as
// HVBATTERY_START_CONDITIONING, which `HV_BATTERY` never matched.
const EV_MARKERS = ['CHARGE', 'CHARGING', 'MAX_SOC', 'HV_BATTERY', 'HVBATTERY'];
const ICE_MARKERS = ['AUXHEAT', 'AUX_HEAT', 'ENGINE_START', 'ENGINE_STOP', 'TANK', 'FUEL'];

// What the Homey app's own rule uses today, kept only to show an owner where
// this tool and their Homey device disagree - and why - until #79 lands.
const APP_EV_MARKERS = ['CHARGE', 'CHARGING', 'ZEV', 'MAX_SOC', 'HV_BATTERY'];

// Attributes only one kind of car can send. Presence proves; absence proves
// nothing, because the parser drops attributes the car sent as nil and a car
// that has not woken since pairing sends almost none of them.
const EV_ATTRIBUTES = [
  'soc',
  'rangeelectric',
  'chargingactive',
  'chargingstatus',
  'chargingpower',
  'endofchargetime',
  'maxSoc',
  'selectedChargeProgram',
  'chargeCouplerACStatus',
  'chargeCouplerDCStatus',
  'chargeFlapACStatus',
  'chargeFlapDCStatus',
  'temperaturehvbattery',
  'hvbatterytemperature'
];

// A fuel tank, AdBlue for diesel SCR, and engine oil. A battery-electric car
// has none of them; a plug-in hybrid has both these and the electric ones,
// which is why the electric side is checked first.
const ICE_ATTRIBUTES = [
  'tanklevelpercent',
  'rangeliquid',
  'tankLevelAdBlue',
  'gastanklevelpercent',
  'rangegas',
  'oilLevel'
];

// Detection is not in the Homey app yet - it is proposed in issue #79 / PR #80.
const POWERTRAIN_ISSUE = 'Detection proposed in GitHub issue #79 / pull request #80 - not in Homey app v'
  + HOMEY_APP_VERSION;

const POWERTRAIN_LABELS = {
  [POWERTRAIN_EV]: 'Electric / plug-in hybrid',
  [POWERTRAIN_ICE]: 'Petrol / diesel',
  [POWERTRAIN_UNKNOWN]: 'Unknown'
};

// What the verdict means for the device in Homey, per state.
const POWERTRAIN_CONSEQUENCES = {
  [POWERTRAIN_EV]: 'A car assessed electric keeps the battery, range and charging capabilities, is '
    + 'declared battery-powered, and the low-battery alert in Homey applies to it.',
  [POWERTRAIN_ICE]: 'A car assessed petrol or diesel has the battery, range and charging '
    + 'capabilities removed and is never declared battery-powered - which is what stops a diesel '
    + 'from sitting at 0% and raising a low-battery alert.',
  [POWERTRAIN_UNKNOWN]: 'Nothing your car reported or accepts says either way: it has sent no fuel '
    + 'or battery reading yet, and its command list carries neither charging nor engine commands - '
    + 'or Mercedes refused both capability endpoints, which happens for some cars. Every capability '
    + 'is then left in place, because removing one would destroy its history and break any flow '
    + 'using it, but the car is not declared battery-powered, so no low-battery alert is raised.'
};

/**
 * `chargeProgramConfigure` and `CHARGE_PROGRAM_CONFIGURE` are the same marker.
 */
function normalizePowertrainKey(key) {
  return String(key)
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .toUpperCase();
}

function matchesPowertrainMarker(key, markers) {
  return markers.some(marker => key === marker || key.startsWith(`${marker}_`) || key.includes(`_${marker}`));
}

/**
 * Which of `names` the car actually reported. Case-insensitive: Mercedes has
 * sent both `precondActive` and `precondactive`, and 0 is a value like any
 * other - `soc` of 0 is a real reading and must count as present.
 */
function powertrainAttributesPresent(attributes, names) {
  if (!attributes || typeof attributes !== 'object') return [];

  const byLowerName = new Map();
  for (const key of Object.keys(attributes)) byLowerName.set(key.toLowerCase(), key);

  return names
    .map(name => byLowerName.get(name.toLowerCase()))
    .filter(key => key !== undefined && attributes[key] !== null && attributes[key] !== undefined);
}

/** Split a merged feature map into the markers each side matched */
function powertrainMarkers(features, evMarkers) {
  const evFeatures = [];
  const iceFeatures = [];
  const offered = [];

  if (features && typeof features === 'object') {
    for (const [rawKey, available] of Object.entries(features)) {
      // A command the car lists as unavailable says nothing about its
      // powertrain - every car is sent the same catalogue.
      if (!available) continue;
      offered.push(rawKey);

      const key = normalizePowertrainKey(rawKey);
      if (matchesPowertrainMarker(key, evMarkers)) evFeatures.push(rawKey);
      else if (matchesPowertrainMarker(key, ICE_MARKERS)) iceFeatures.push(rawKey);
    }
  }

  return { evFeatures: evFeatures.sort(), iceFeatures: iceFeatures.sort(), offered: offered.sort() };
}

/**
 * Classify a car from what it reported and what Mercedes says it accepts.
 *
 * Readings decide when there are any: a car sending a fuel level has a tank, a
 * car sending `soc` has a high-voltage battery, and a plug-in hybrid sends both
 * - so the electric side is checked first, because keeping every capability is
 * the right answer for one. Only a car that has reported nothing either way
 * falls through to its command catalogue, and a car that says nothing there
 * either stays `unknown` rather than being guessed at.
 *
 * @param {Object} features - merged map from api.getVehicleFeatures()
 * @param {Object} [attributes] - the parsed vehicle attributes
 * @returns {{powertrain: string, basis: string, evFeatures: string[],
 *   iceFeatures: string[], evAttributes: string[], iceAttributes: string[],
 *   offered: string[], appPowertrain: string, appEvFeatures: string[]}}
 */
function assessPowertrain(features, attributes) {
  const { evFeatures, iceFeatures, offered } = powertrainMarkers(features, EV_MARKERS);
  const evAttributes = powertrainAttributesPresent(attributes, EV_ATTRIBUTES);
  const iceAttributes = powertrainAttributesPresent(attributes, ICE_ATTRIBUTES);

  let powertrain = POWERTRAIN_UNKNOWN;
  let basis = 'none';

  if (evAttributes.length) {
    powertrain = POWERTRAIN_EV;
    basis = 'reading';
  } else if (iceAttributes.length) {
    powertrain = POWERTRAIN_ICE;
    basis = 'reading';
  } else if (evFeatures.length) {
    powertrain = POWERTRAIN_EV;
    basis = 'command';
  } else if (iceFeatures.length) {
    powertrain = POWERTRAIN_ICE;
    basis = 'command';
  }

  // What the Homey app's shipped rule makes of the same car, so a disagreement
  // is visible here rather than discovered as a battery on a diesel.
  const app = powertrainMarkers(features, APP_EV_MARKERS);
  let appPowertrain = POWERTRAIN_UNKNOWN;
  if (app.evFeatures.length) appPowertrain = POWERTRAIN_EV;
  else if (app.iceFeatures.length) appPowertrain = POWERTRAIN_ICE;

  return {
    powertrain,
    basis,
    evFeatures,
    iceFeatures,
    evAttributes,
    iceAttributes,
    offered,
    appPowertrain,
    appEvFeatures: app.evFeatures
  };
}

/**
 * Which capabilities the Homey app puts on the device for this verdict.
 *
 * @param {string} powertrain
 * @returns {{add: string[], remove: string[], batteries: boolean}}
 */
function powertrainCapabilityPlan(powertrain) {
  const keepEv = powertrain !== POWERTRAIN_ICE;

  return {
    add: keepEv ? [...EV_CAPABILITIES] : [],
    remove: keepEv ? [] : [...EV_CAPABILITIES],
    batteries: powertrain === POWERTRAIN_EV
  };
}

/**
 * Render the powertrain panel: the verdict, what it means, and the commands
 * that produced it.
 *
 * @param {{powertrain: string, evFeatures: string[], iceFeatures: string[], offered: string[]}} assessment
 * @param {string[]} [errors] - why a capability endpoint could not be read
 */
function renderPowertrain(assessment, errors = []) {
  const proposedEl = document.getElementById('powertrain-proposed');
  if (proposedEl) proposedEl.title = POWERTRAIN_ISSUE;

  const labelEl = document.getElementById('powertrain-label');
  const meaningEl = document.getElementById('powertrain-meaning');
  const evidenceEl = document.getElementById('powertrain-evidence');
  if (!labelEl || !meaningEl || !evidenceEl) return;

  const { powertrain, basis, evFeatures, iceFeatures, evAttributes, iceAttributes, offered,
    appPowertrain, appEvFeatures } = assessment;

  labelEl.textContent = POWERTRAIN_LABELS[powertrain];
  labelEl.className = `badge badge-powertrain badge-powertrain-${powertrain}`;
  meaningEl.textContent = POWERTRAIN_CONSEQUENCES[powertrain];

  const codes = names => names.map(n => `<code>${escapeHtml(n)}</code>`).join(', ');
  const parts = [];

  if (basis === 'reading') {
    const decided = evAttributes.length ? evAttributes : iceAttributes;
    const only = evAttributes.length
      ? 'values only a car with a high-voltage battery sends'
      : 'values only a car with a fuel tank sends';
    parts.push(`<div class="note"><strong>Decided by what your car reported:</strong> ${codes(decided)} - ${only}.</div>`);
    if (evAttributes.length && iceAttributes.length) {
      parts.push(`<div class="note">It reports fuel as well (${codes(iceAttributes)}) - that is a plug-in `
        + 'hybrid, and keeping every capability is the right answer for one.</div>');
    }
  } else if (basis === 'command') {
    const decided = evFeatures.length ? evFeatures : iceFeatures;
    const kind = evFeatures.length ? 'electric' : 'combustion';
    parts.push(`<div class="note"><strong>Your car has reported no fuel or battery reading yet, so this `
      + `is read from ${decided.length} ${kind} command(s) Mercedes says it accepts:</strong> ${codes(decided)}.</div>`);
  } else {
    parts.push(`<div class="note">Your car has reported no fuel or battery reading, and of the `
      + `${offered.length} command(s) Mercedes lists for it, none is a charging or engine command.</div>`);
  }

  // The panel used to speak for the Homey app. It cannot while the app still
  // reads ZEV preconditioning - a heater every diesel has - as electric.
  if (appPowertrain !== powertrain) {
    parts.push('<div class="note other-source"><strong>Your Homey device may disagree.</strong> The app '
      + `assesses this car as <em>${escapeHtml(POWERTRAIN_LABELS[appPowertrain])}</em>`
      + (appEvFeatures.length ? ` (from ${codes(appEvFeatures)})` : '')
      + ' - it reads the command list only, and counts ZEV preconditioning as electric even though '
      + 'petrol and diesel cars offer it for remote climate. Tracked in GitHub issue #79.</div>');
  }

  for (const error of errors) {
    parts.push(`<div class="note other-source">${escapeHtml(error)}</div>`);
  }

  const plan = powertrainCapabilityPlan(powertrain);
  if (plan.remove.length) {
    parts.push('<div class="note"><strong>Capabilities the app removes from this car:</strong> '
      + plan.remove.map(c => `<code>${escapeHtml(c)}</code>`).join(', ') + '</div>');
  }

  evidenceEl.innerHTML = parts.join('');
}

/**
 * The powertrain assessment as text, for the clipboard exports.
 *
 * A wrong verdict is only diagnosable from what the two endpoints actually
 * answered: the merged map has already lost `isAvailable` for
 * CHARGE_PROGRAM_CONFIGURE (`api.getVehicleFeatures()` overwrites it with
 * whether a MAX_SOC parameter is declared), so a car classified electric off
 * that one key looks identical in the merged map to a car that really can
 * charge. Both endpoints therefore go into the export as they arrived, and an
 * owner sending one export answers the question without being asked for more.
 *
 * @param {Object} [state] - what loadPowertrain() kept from the assessment
 * @returns {string}
 */
function powertrainExportText(state) {
  const lines = ['', '=== Powertrain assessment ==='];

  if (!state) {
    lines.push('Not assessed - no vehicle data loaded in this session.', '');
    return lines.join('\n');
  }

  const { assessment, capabilityFeatures, commands, errors = [] } = state;

  if (!assessment) {
    lines.push('Not assessed: ' + (errors.join('; ') || 'unknown reason'), '');
    return lines.join('\n');
  }

  const { powertrain, basis, evFeatures, iceFeatures, evAttributes, iceAttributes,
    appPowertrain, appEvFeatures } = assessment;
  lines.push(`Verdict: ${POWERTRAIN_LABELS[powertrain]} (${powertrain})`);
  lines.push(`Decided by: ${basis}`);
  lines.push(`Electric attributes reported: ${(evAttributes || []).join(', ') || '(none)'}`);
  lines.push(`Combustion attributes reported: ${(iceAttributes || []).join(', ') || '(none)'}`);
  lines.push(`Matched electric markers: ${evFeatures.join(', ') || '(none)'}`);
  lines.push(`Matched combustion markers: ${iceFeatures.join(', ') || '(none)'}`);
  lines.push(`Homey app's own rule would say: ${POWERTRAIN_LABELS[appPowertrain]} (${appPowertrain})`
    + (appEvFeatures && appEvFeatures.length ? ` from ${appEvFeatures.join(', ')}` : ''));
  for (const error of errors) lines.push(`Endpoint error: ${error}`);

  lines.push('', '--- /v1/vehicle/{vin}/capabilities -> features ---');
  if (capabilityFeatures) {
    const keys = Object.keys(capabilityFeatures).sort();
    if (!keys.length) lines.push('(empty)');
    for (const key of keys) lines.push(`${key} = ${JSON.stringify(capabilityFeatures[key])}`);
  } else {
    lines.push('(not returned for this vehicle)');
  }

  // isAvailable and the parameter names both matter: they are the two halves
  // the merge collapses into one boolean.
  lines.push('', '--- /v1/vehicle/{vin}/capabilities/commands ---');
  if (commands) {
    if (!commands.length) lines.push('(empty)');
    for (const command of [...commands].sort((a, b) => a.commandName.localeCompare(b.commandName))) {
      const params = command.parameters.length ? command.parameters.join(',') : '-';
      lines.push(`${command.commandName} isAvailable=${command.isAvailable} parameters=${params}`);
    }
  } else {
    lines.push('(not returned for this vehicle)');
  }

  lines.push('', '--- merged feature map the verdict was read from ---');
  const merged = state.features || {};
  const mergedKeys = Object.keys(merged).sort();
  if (!mergedKeys.length) lines.push('(empty)');
  for (const key of mergedKeys) lines.push(`${key} = ${merged[key] === true}`);

  lines.push('');
  return lines.join('\n');
}
