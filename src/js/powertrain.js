/**
 * Powertrain assessment - a port of the Homey app's `lib/powertrain.js`
 * (Mercedes-Benz-homey-app PR #80, for issue #79).
 *
 * The car never says whether it is electric or combustion: the vehicle
 * attributes carry no powertrain field, and a missing `soc` proves nothing
 * because the parser drops nil attributes. What decides it is what Mercedes
 * says the car *can be told to do* - `/v1/vehicle/{vin}/capabilities` and
 * `.../capabilities/commands`. Charge and ZEV commands mean electric, auxheat
 * and engine start mean combustion, both mean a plug-in hybrid, which resolves
 * to electric because keeping every capability is the right answer for one.
 *
 * This file runs the same classification here so an owner can see the verdict
 * their car produces - the value behind a diesel showing a battery at 0% - and
 * which of their car's commands produced it, without reading a Homey log.
 *
 * Keep in step with `lib/powertrain.js` in the Homey app: the markers and the
 * EV capability list below are copied from it verbatim.
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
const EV_MARKERS = ['CHARGE', 'CHARGING', 'ZEV', 'MAX_SOC', 'HV_BATTERY'];
const ICE_MARKERS = ['AUXHEAT', 'AUX_HEAT', 'ENGINE_START', 'ENGINE_STOP', 'TANK', 'FUEL'];

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
  [POWERTRAIN_EV]: 'Your car offers at least one charging command, so the Homey app treats it as '
    + 'battery-powered: it keeps the battery, range and charging capabilities, and the low-battery '
    + 'alert in Homey applies to it.',
  [POWERTRAIN_ICE]: 'Your car offers engine and auxiliary-heating commands but no charging command, '
    + 'so the Homey app removes the battery, range and charging capabilities and never reports it '
    + 'as battery-powered - this is what stops a diesel from sitting at 0% and raising a '
    + 'low-battery alert.',
  [POWERTRAIN_UNKNOWN]: 'Mercedes did not tell this tool what your car can be commanded to do - both '
    + 'capability endpoints are refused for some cars. The Homey app then leaves every capability '
    + 'in place, because removing one would destroy its history and break any flow using it, but it '
    + 'still does not declare the car battery-powered, so no low-battery alert is raised.'
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
 * Classify a car from the merged feature map (featureName -> boolean).
 *
 * Same rule as the Homey app - any electric marker wins, even alongside
 * auxheat and engine start, because that combination is a plug-in hybrid -
 * but it also reports the feature names that decided it, which the Homey app
 * only writes to its log.
 *
 * @param {Object} features
 * @returns {{powertrain: string, evFeatures: string[], iceFeatures: string[], offered: string[]}}
 */
function assessPowertrain(features) {
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
      if (matchesPowertrainMarker(key, EV_MARKERS)) evFeatures.push(rawKey);
      else if (matchesPowertrainMarker(key, ICE_MARKERS)) iceFeatures.push(rawKey);
    }
  }

  let powertrain = POWERTRAIN_UNKNOWN;
  if (evFeatures.length) powertrain = POWERTRAIN_EV;
  else if (iceFeatures.length) powertrain = POWERTRAIN_ICE;

  offered.sort();
  evFeatures.sort();
  iceFeatures.sort();

  return { powertrain, evFeatures, iceFeatures, offered };
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

  const { powertrain, evFeatures, iceFeatures, offered } = assessment;

  labelEl.textContent = POWERTRAIN_LABELS[powertrain];
  labelEl.className = `badge badge-powertrain badge-powertrain-${powertrain}`;
  meaningEl.textContent = POWERTRAIN_CONSEQUENCES[powertrain];

  const deciding = evFeatures.length ? evFeatures : iceFeatures;
  const kind = evFeatures.length ? 'electric' : 'combustion';

  const parts = [];
  if (deciding.length) {
    parts.push(`<div class="note"><strong>Decided by ${deciding.length} ${kind} command(s):</strong> `
      + deciding.map(f => `<code>${escapeHtml(f)}</code>`).join(', ') + '</div>');
  }
  if (evFeatures.length && iceFeatures.length) {
    parts.push('<div class="note">Your car also offers combustion commands ('
      + iceFeatures.map(f => `<code>${escapeHtml(f)}</code>`).join(', ')
      + ') - that combination is a plug-in hybrid, and the app keeps the electric capabilities for it.</div>');
  }
  if (!deciding.length) {
    parts.push(`<div class="note">Mercedes listed ${offered.length} available command(s) for your car, `
      + 'none of which the app recognises as electric or combustion.</div>');
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

  const { powertrain, evFeatures, iceFeatures } = assessment;
  lines.push(`Verdict: ${POWERTRAIN_LABELS[powertrain]} (${powertrain})`);
  lines.push(`Matched electric markers: ${evFeatures.join(', ') || '(none)'}`);
  lines.push(`Matched combustion markers: ${iceFeatures.join(', ') || '(none)'}`);
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
