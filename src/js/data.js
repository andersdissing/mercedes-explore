/**
 * Capability and Flow Card data mappings
 * Extracted from the Homey Mercedes app (drivers/mercedes-vehicle/device.js,
 * lib/precond-status.js and .homeycompose/flow).
 *
 * Mapping format:
 *   id          Homey capability ID
 *   title       Capability title as shown in the Homey app
 *   unit        Unit appended to the Homey value
 *   rawKey      Single vehicle attribute the value is read from
 *   rawKeys     Several attributes: the first one present wins (fallback order),
 *               unless `merge` is set, in which case the transform receives all
 *               present attributes as an object (value derived from several)
 *   transform   (value, key, data) -> value as the Homey app shows it
 *   whenAbsent  (data) -> value the Homey app shows when none of the keys are
 *               present (e.g. average speed defaults to 0)
 *   pushOnly    Attribute is only sent over the Homey app's WebSocket push
 *               connection; the REST vehicleattributes endpoint this tool
 *               reads never carries it
 *   source      Where the value comes from when it is not a vehicle attribute
 *   note        Extra explanation shown under the capability title
 *
 * Attribute lookups are case-insensitive: Mercedes has sent both
 * `precondActive` and `precondactive`, and the Homey app checks both.
 */

// Version of the Homey Mercedes app these mappings were taken from
const HOMEY_APP_VERSION = '1.1.49';

// --- helpers -----------------------------------------------------------------

/** true / 'true' / 1 count as on - the way the Homey status capabilities read booleans */
const isOn = v => v === true || v === 1 || v === 'true' || v === '1';

/** lib/precond-status.js toBool: also positive numbers and numeric strings */
function toBool(value) {
  if (value === true) return true;
  if (typeof value === 'number') return value > 0;
  if (typeof value === 'string') {
    const s = value.trim().toLowerCase();
    if (s === 'true') return true;
    if (s === 'false' || s === '') return false;
    return Number(s) > 0;
  }
  return false;
}

/** minutes from midnight -> HH:MM */
const minutesToTime = m => {
  const n = Number(m);
  return String(Math.floor(n / 60)).padStart(2, '0') + ':' + String(n % 60).padStart(2, '0');
};

const yesNo = b => b ? 'Yes' : 'No';
const activeInactive = b => b ? 'Active' : 'Inactive';

const CHARGING_STATUS_CODES = new Set(['0', '5', '6', '9', '10', '11', '13', '14']);

/** device.js: chargingactive is the direct answer; chargingstatus, then chargingpower, are fallbacks */
function isCharging(value, key) {
  switch (key.toLowerCase()) {
    case 'chargingactive': return value === true || value === 1 || String(value) === 'true';
    case 'chargingstatus': return CHARGING_STATUS_CODES.has(String(value));
    default: return parseFloat(value) > 0;
  }
}

/** Charging state from the whole data object (used by whenAbsent on charging power) */
function chargingFromData(data) {
  for (const key of ['chargingactive', 'chargingstatus', 'chargingpower']) {
    const found = findRawKey(data, key);
    if (found !== undefined) return isCharging(data[found], key);
  }
  return null;
}

/** Case-insensitive attribute lookup; returns the actual key present in data */
function findRawKey(data, key) {
  if (data[key] !== undefined) return key;
  const wanted = key.toLowerCase();
  return Object.keys(data).find(k => k.toLowerCase() === wanted);
}

const WINDOW_STATUS = { 0: 'Unknown', 1: 'Open', 2: 'Closed', 3: 'Airing', 4: 'Running' };
const windowStatus = v => WINDOW_STATUS[v] || String(v);

// Mercedes reports door state as bool, "true"/"false", or a numeric enum (0/2 = closed, 1 = open)
const DOOR_CLOSED = new Set([false, 0, 2, 'false', '0', '2', 'inactive', 'closed']);
const DOOR_OPEN = new Set([true, 1, 'true', '1', 'active', 'open']);
function doorStatus(v) {
  const n = typeof v === 'string' ? v.toLowerCase() : v;
  if (DOOR_OPEN.has(n)) return 'Open';
  if (DOOR_CLOSED.has(n)) return 'Closed';
  return String(v);
}

/** engine_running: enginestate for ICE cars; EVs only send ignitionstate (4 = ready to drive) */
function engineRunning(v, key) {
  if (key.toLowerCase() === 'ignitionstate') return Number(v) === 4;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') {
    const s = v.toUpperCase();
    return s === 'RUNNING' || s === 'ON' || s === '1' || s === 'TRUE';
  }
  return Number(v) === 1;
}

/** Preconditioning runs if any of precondNow / precondActive / precondState says so (lib/precond-status.js) */
const precondRunning = values => Object.values(values).some(toBool);
const PRECOND_KEYS = ['precondNow', 'precondActive', 'precondState'];
const PRECOND_NOTE = 'A manual start (Mercedes me app / Homey) flips precondNow, a departure-time start flips precondActive; Homey ORs all three.';

/** Weekly departure times: consecutive days sharing a time collapse to a range ("Mon-Fri 06:20") */
function weeklyDepartureTimes(entries) {
  if (!Array.isArray(entries) || entries.length === 0) return '';
  const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const sorted = entries
    .filter(e => e.index >= 0 && e.index <= 6 && Number.isFinite(Number(e.minutesFromMidnight)))
    .sort((a, b) => a.index - b.index);
  const groups = [];
  for (const entry of sorted) {
    const time = minutesToTime(entry.minutesFromMidnight);
    const last = groups[groups.length - 1];
    if (last && last.time === time && entry.index === last.end + 1) {
      last.end = entry.index;
    } else {
      groups.push({ start: entry.index, end: entry.index, time });
    }
  }
  return groups
    .map(g => `${dayNames[g.start]}${g.end > g.start ? `-${dayNames[g.end]}` : ''} ${g.time}`)
    .join(', ');
}

/** Max SoC: top-level maxSoc, or the entry for the selected program in chargePrograms */
function maxSoc(v, key, data) {
  if (key.toLowerCase() !== 'chargeprograms') return parseInt(v);
  const selKey = findRawKey(data, 'selectedChargeProgram');
  const selected = selKey !== undefined ? Number(data[selKey]) : 0;
  const match = Array.isArray(v) ? v.find(p => p.chargeProgram === selected) : null;
  return match && match.maxSoc !== undefined ? parseInt(match.maxSoc) : undefined;
}

const GEOFENCE_NOTE = 'Also set from the geofencing violations API, which the Homey app polls separately.';
const PUSH_ONLY_NOTE = 'Only sent over the WebSocket push connection the Homey app holds; the REST vehicleattributes endpoint this tool reads never carries it.';

// --- capabilities (in the order the Homey device lists them) -----------------

const CAPABILITY_MAPPINGS = [
  { id: 'locked', title: 'Locked', rawKey: 'doorlockstatusvehicle', unit: '', transform: v => yesNo(v === 2),
    pushOnly: true, note: 'Raw 2 = locked.' },
  { id: 'measure_battery', title: 'Battery Level', rawKey: 'soc', unit: '%', transform: v => parseInt(v) },
  { id: 'measure_charge_power', title: 'Charging Power', rawKey: 'chargingpower', unit: 'kW', transform: v => parseFloat(v),
    whenAbsent: data => chargingFromData(data) === false ? 0 : undefined,
    note: 'Mercedes sends this as nil when not charging; Homey then resets it to 0.' },
  { id: 'odometer', title: 'Odometer', rawKey: 'odo', unit: 'km', transform: v => parseFloat(v) },
  { id: 'distance_start', title: 'Trip Distance', rawKey: 'distancestart', unit: 'km', transform: v => parseFloat(v) },
  { id: 'distance_electrical', title: 'Electric Trip Distance', rawKey: 'distanceelectricalstart', unit: 'km', transform: v => parseFloat(v) },
  { id: 'driven_time_start', title: 'Driving Time', rawKey: 'driventimestart', unit: 'min', transform: v => parseInt(v) },
  { id: 'average_speed', title: 'Average Speed', rawKey: 'averagespeedstart', unit: 'km/h', transform: v => parseFloat(v),
    whenAbsent: () => 0, note: 'Homey shows 0 when the car is stopped and the attribute is absent.' },
  { id: 'ecoscore_accel', title: 'Eco Score Acceleration', rawKey: 'ecoscoreaccel', unit: '', transform: v => parseInt(v) },
  { id: 'ecoscore_const', title: 'Eco Score Constant', rawKey: 'ecoscoreconst', unit: '', transform: v => parseInt(v) },
  { id: 'ecoscore_freewhl', title: 'Eco Score Freewheel', rawKeys: ['ecoscorefreewhl', 'ecoScoreFreewheel'], unit: '', transform: v => parseInt(v) },
  { id: 'alarm_generic', title: 'Warning Light', unit: '',
    rawKeys: ['warningwashwater', 'warningcoolantlevellow', 'warningbrakefluid', 'warningenginelight'], merge: true,
    transform: values => activeInactive(Object.values(values).some(v => v === true)),
    whenAbsent: () => 'Inactive',
    note: 'Active if any of washer fluid, coolant, brake fluid or engine warning is true.' },
  { id: 'measure_range_electric', title: 'Electric Range', rawKey: 'rangeelectric', unit: 'km', transform: v => parseFloat(v) },
  { id: 'measure_range_liquid', title: 'Fuel Range', rawKey: 'rangeliquid', unit: 'km', transform: v => parseFloat(v) },
  { id: 'measure_fuel', title: 'Fuel Level', rawKey: 'tanklevelpercent', unit: '%', transform: v => parseInt(v) },
  { id: 'measure_adblue_level', title: 'AdBlue Level', rawKey: 'tankLevelAdBlue', unit: '%', transform: v => parseInt(v) },
  { id: 'ignition_on', title: 'Ignition', rawKey: 'ignitionstate', unit: '', transform: v => [1, 2, 4].includes(Number(v)) ? 'On' : 'Off',
    note: 'Raw 0 = lock/off, 1 = radio, 2 = ignition, 4 = start.' },
  { id: 'measure_oil_level', title: 'Oil Level', rawKey: 'oilLevel', unit: '%', transform: v => parseInt(v) },
  { id: 'text_charging_status', title: 'Charging Status', rawKey: 'chargingstatus', unit: '', transform: v => {
    const map = { '0':'Charging','1':'Charging ends','2':'Charge break','3':'Unplugged','4':'Failure','5':'Slow charging','6':'Fast charging','7':'Discharging','8':'Not charging','9':'Slow charging (after trip target)','10':'Charging (after trip target)','11':'Fast charging (after trip target)','12':'Connected','13':'AC charging','14':'DC charging','15':'Battery calibration active','16':'Unknown' };
    return map[String(v)] || String(v);
  }},
  { id: 'text_charge_program', title: 'Charge Program', rawKey: 'selectedChargeProgram', unit: '', transform: v => {
    const map = { '0':'Default','2':'Home','3':'Work' };
    return map[String(v)] || String(v);
  }},
  { id: 'measure_max_soc', title: 'Max Charge Level', rawKeys: ['maxSoc', 'max_soc', 'chargePrograms'], unit: '%', transform: maxSoc,
    note: 'Falls back to the chargePrograms entry for the selected charge program when maxSoc is nil.' },
  { id: 'text_end_charge_time', title: 'End of Charge Time', rawKey: 'endofchargetime', unit: '', transform: minutesToTime,
    note: 'Raw value is minutes since midnight.' },
  { id: 'window_sunroof', title: 'Sunroof Status', rawKey: 'sunroofstatus', unit: '', pushOnly: true, transform: v => {
    const map = { 0:'Closed',1:'Open',2:'Tilted',3:'Running',4:'Anti-Booming',5:'Intermediate',6:'Opening',7:'Closing' };
    return map[v] || String(v);
  }},
  { id: 'text_departure_time', title: 'Departure Time', rawKey: 'departuretime', unit: '', transform: minutesToTime,
    note: 'Raw value is minutes since midnight.' },
  { id: 'text_departure_time_mode', title: 'Departure Time Mode', rawKeys: ['departureTimeMode', 'departuretime_mode'], unit: '', transform: v => {
    const map = { 0:'Inactive',1:'Single',2:'Weekly' };
    return map[v] || String(v);
  }},
  { id: 'measure_latitude', title: 'Latitude', rawKeys: ['positionlat', 'latitude', 'gpsLat'], unit: '°', transform: v => parseFloat(v), note: GEOFENCE_NOTE },
  { id: 'measure_longitude', title: 'Longitude', rawKeys: ['positionlong', 'longitude', 'gpsLon'], unit: '°', transform: v => parseFloat(v), note: GEOFENCE_NOTE },
  { id: 'measure_heading', title: 'Heading', rawKeys: ['positionHeading', 'heading', 'gpsHeading'], unit: '°', transform: v => parseFloat(v) },
  { id: 'text_geofence_last_event', title: 'Last Geofence Event', rawKeys: ['geofenceevent', 'geofence_event', 'lastgeofenceevent'], unit: '', transform: v => String(v), note: GEOFENCE_NOTE },
  { id: 'text_geofence_last_zone', title: 'Last Geofence Zone', rawKeys: ['geofencename', 'geofence_name', 'lastgeofencezone', 'currentzone'], unit: '', transform: v => String(v), note: GEOFENCE_NOTE },
  { id: 'time_geofence_last_event', title: 'Last Geofence Time', rawKeys: [], unit: '', transform: v => v,
    source: 'Geofencing violations API (event time, formatted "DD Mon YYYY HH:MM")',
    note: 'Not part of the vehicle attributes - only available in the Homey app.' },
  { id: 'tire_pressure_bar.tire_fl', title: 'Tire Pressure FL', rawKey: 'tirepressurefrontleft', unit: 'bar', transform: v => parseFloat(v) },
  { id: 'tire_pressure_bar.tire_fr', title: 'Tire Pressure FR', rawKey: 'tirepressurefrontright', unit: 'bar', transform: v => parseFloat(v) },
  { id: 'tire_pressure_bar.tire_rl', title: 'Tire Pressure RL', rawKey: 'tirepressurerearleft', unit: 'bar', transform: v => parseFloat(v) },
  { id: 'tire_pressure_bar.tire_rr', title: 'Tire Pressure RR', rawKey: 'tirepressurerearright', unit: 'bar', transform: v => parseFloat(v) },
  { id: 'window_front_left', title: 'Window Front Left', rawKeys: ['windowstatusfrontleft', 'windowFrontLeftStatus'], unit: '', transform: windowStatus, pushOnly: true },
  { id: 'window_front_right', title: 'Window Front Right', rawKeys: ['windowstatusfrontright', 'windowFrontRightStatus'], unit: '', transform: windowStatus, pushOnly: true },
  { id: 'window_rear_left', title: 'Window Rear Left', rawKeys: ['windowstatusrearleft', 'windowRearLeftStatus'], unit: '', transform: windowStatus, pushOnly: true },
  { id: 'window_rear_right', title: 'Window Rear Right', rawKeys: ['windowstatusrearright', 'windowRearRightStatus'], unit: '', transform: windowStatus, pushOnly: true },
  { id: 'door_front_left', title: 'Door Front Left', rawKeys: ['doorstatusfrontleft', 'doorFrontLeftStatus'], unit: '', transform: doorStatus, pushOnly: true },
  { id: 'door_front_right', title: 'Door Front Right', rawKeys: ['doorstatusfrontright', 'doorFrontRightStatus'], unit: '', transform: doorStatus, pushOnly: true },
  { id: 'door_rear_left', title: 'Door Rear Left', rawKeys: ['doorstatusrearleft', 'doorRearLeftStatus'], unit: '', transform: doorStatus, pushOnly: true },
  { id: 'door_rear_right', title: 'Door Rear Right', rawKeys: ['doorstatusrearright', 'doorRearRightStatus'], unit: '', transform: doorStatus, pushOnly: true },
  { id: 'door_trunk', title: 'Trunk', rawKeys: ['decklidstatus', 'trunkStatus'], unit: '', transform: doorStatus, pushOnly: true },
  { id: 'door_hood', title: 'Hood', rawKeys: ['enginehoodstatus', 'hoodStatus'], unit: '', transform: doorStatus, pushOnly: true },
  { id: 'parking_brake_engaged', title: 'Parking Brake', rawKey: 'parkbrakestatus', unit: '', transform: v => isOn(v) ? 'Engaged' : 'Released' },
  { id: 'alarm_theft', title: 'Theft Alarm', rawKeys: ['theftalarmactive', 'lasttheftwarning'], merge: true, unit: '',
    transform: values => activeInactive(Object.entries(values).some(([k, v]) => k.toLowerCase() === 'theftalarmactive' && (v === true || v === 1))),
    note: 'Updated whenever theftalarmactive or lasttheftwarning is sent; active only if theftalarmactive is true.' },
  { id: 'measure_service_days', title: 'Service Interval', rawKey: 'serviceintervaldays', unit: 'days', transform: v => parseInt(v) },
  { id: 'measure_battery_temperature', title: 'Battery Temperature', unit: '°C', transform: v => parseFloat(v),
    rawKeys: ['temperaturehvbattery', 'hvbatterytemperature', 'ecoelectricbatterytemperature', 'batterytemperature'] },
  { id: 'onoff_precond', title: 'Preconditioning', rawKeys: PRECOND_KEYS, merge: true, unit: '',
    transform: values => activeInactive(precondRunning(values)), note: PRECOND_NOTE },
  { id: 'onoff_auxheat', title: 'Auxiliary Heating', rawKey: 'auxheatactive', unit: '', transform: v => activeInactive(isOn(v)) },
  { id: 'onoff_remote_start', title: 'Remote Start', rawKey: 'remotestartactive', unit: '', transform: v => activeInactive(isOn(v)) },
  { id: 'theft_system_armed', title: 'Theft System', rawKey: 'theftsystemarmed', unit: '', transform: v => isOn(v) ? 'Armed' : 'Disarmed' },
  { id: 'engine_running', title: 'Engine Running', rawKeys: ['enginestate', 'ignitionstate'], unit: '',
    transform: (v, key) => yesNo(engineRunning(v, key)),
    note: 'ICE cars send enginestate; EVs only send ignitionstate, where 4 = ready to drive.' },
  { id: 'climate_active', title: 'Climate Active', rawKeys: PRECOND_KEYS, merge: true, unit: '',
    transform: values => yesNo(precondRunning(values)), note: PRECOND_NOTE },
  // Added dynamically by the device (not in driver.compose.json)
  { id: 'onoff_charging', title: 'Charging', rawKeys: ['chargingactive', 'chargingstatus', 'chargingpower'], unit: '',
    transform: (v, key) => yesNo(isCharging(v, key)),
    note: 'chargingactive is the direct answer; chargingstatus and chargingpower are fallbacks.' },
  { id: 'onoff_connector', title: 'Connector Connected', rawKeys: ['chargeCouplerACStatus', 'chargeCouplerDCStatus'], unit: '',
    transform: v => yesNo(String(v) !== '2') },
  { id: 'text_connector_status', title: 'Connector Status', rawKeys: ['chargeCouplerACStatus', 'chargeCouplerDCStatus'], unit: '', transform: v => {
    const map = { '0':'Connected (locked)','1':'Connected (unlocked)','2':'Disconnected','3':'Error','4':'Charging started' };
    return map[String(v)] || String(v);
  }},
  { id: 'text_weekly_departure_times', title: 'Weekly Departure Times', rawKey: 'weeklySetHU', unit: '', transform: weeklyDepartureTimes,
    note: 'One entry per weekday (Mon = 0), minutes since midnight; consecutive days with the same time collapse to a range.' },
  { id: 'measure_climate_setpoint', title: 'Climate Setpoint', rawKey: 'temperaturePoints', unit: '°C', transform: v => {
    if (!Array.isArray(v) || v.length === 0) return undefined;
    const point = v.find(p => p.zone === 'frontLeft') || v[0];
    return Number(point.temperature);
  }, note: 'Driver-side (frontLeft) zone of the per-zone temperature points.' },
];

// --- flow cards ----------------------------------------------------------------

const FLOW_ACTIONS = [
  { id: 'lock_vehicle', title: 'Lock vehicle', description: 'Locks all vehicle doors.' },
  { id: 'unlock_vehicle', title: 'Unlock vehicle', description: 'Unlocks all vehicle doors. Requires PIN to be configured in device settings.' },
  { id: 'start_climate', title: 'Start climate control', description: 'Starts climate control (ZEV preconditioning for EV/PHEV, auxiliary heating for ICE).' },
  { id: 'stop_climate', title: 'Stop climate control', description: 'Stops climate control.' },
  { id: 'start_precond', title: 'Start preconditioning', description: 'Starts the electric climate control (preconditioning) for the vehicle. Works best when plugged in.' },
  { id: 'stop_precond', title: 'Stop preconditioning', description: 'Stops the electric climate control (preconditioning) for the vehicle.' },
  { id: 'start_engine', title: 'Start engine', description: 'Starts the engine. Requires PIN to be configured in device settings.' },
  { id: 'stop_engine', title: 'Stop engine', description: 'Stops the engine.' },
  { id: 'flash_lights', title: 'Flash lights', description: 'Flashes the vehicle lights.' },
  { id: 'sound_horn', title: 'Sound horn', description: "Sounds the vehicle's horn. Use with care as this may disturb others.", args: 'mode (horn_light | horn_only | panic)' },
  { id: 'open_windows', title: 'Open windows', description: 'Opens all windows. Requires PIN to be configured in device settings.' },
  { id: 'close_windows', title: 'Close windows', description: 'Closes all windows.' },
  { id: 'open_sunroof', title: 'Open sunroof', description: 'Opens the sunroof. Requires PIN configuration in device settings.' },
  { id: 'close_sunroof', title: 'Close sunroof', description: 'Closes the sunroof.' },
  { id: 'tilt_sunroof', title: 'Tilt sunroof', description: 'Tilts/lifts the sunroof for ventilation.' },
  { id: 'start_charging', title: 'Resume charging', description: 'Resumes vehicle charging. Command no longer supported by the Mercedes API.', deprecated: true },
  { id: 'stop_charging', title: 'Pause charging', description: 'Pauses vehicle charging. Command no longer supported by the Mercedes API.', deprecated: true },
  { id: 'refresh_data', title: 'Refresh vehicle data', description: 'Manually refresh all vehicle data from the Mercedes API.' },
  { id: 'send_route', title: 'Send route to car', description: "Sends a destination to the vehicle's navigation system.", args: 'title (text), latitude (number), longitude (number)' },
  { id: 'configure_departure_time', title: 'Set departure time', description: 'Configures the departure time for preconditioning. The vehicle will be ready at this time.', args: 'hour (0-23), minute (0-59), mode (0 = disabled | 1 = single | 2 = weekly)' },
  { id: 'configure_max_soc', title: 'Set maximum charge level', description: 'Sets the maximum battery charge level (state of charge) for the vehicle, via a WebSocket command for the selected charge program.', args: 'max_soc (30-100 %)' },
  { id: 'configure_seat_heating', title: 'Configure seat heating', description: 'Enables or disables seat heating for each seat during preconditioning.', args: 'front_left, front_right, rear_left, rear_right (checkbox)' },
  { id: 'configure_temperature', title: 'Set cabin temperature', description: "Sets the target temperature for the vehicle's climate control (shown in the Climate Setpoint capability).", args: 'temperature (16-28 °C)' },
];

const FLOW_CONDITIONS = [
  { id: 'is_locked', title: 'Vehicle is locked / unlocked', description: 'Checks if the vehicle doors are locked.' },
  { id: 'is_engine_running', title: 'Engine is running / stopped', description: 'Checks if the vehicle engine is running.' },
  { id: 'is_charging', title: 'Vehicle is charging / not charging', description: 'Checks if the vehicle is currently charging.' },
  { id: 'is_connector_connected', title: 'Connector is connected / not connected', description: 'Checks if the charge connector is currently plugged in.' },
  { id: 'tire_pressure_ok', title: 'Tire pressure is OK / too low', description: 'Checks if all tire pressures are within acceptable range (>= 2.0 bar).' },
  { id: 'windows_closed', title: 'All windows are closed / open', description: 'Checks if all vehicle windows are closed.' },
  { id: 'any_door_open', title: 'Any door is open / closed', description: 'Checks if any door (including trunk and hood) is open.' },
  { id: 'is_preconditioning', title: 'Preconditioning is active / inactive', description: "Checks if the vehicle's preconditioning/climate control is currently active." },
  { id: 'sunroof_open', title: 'Sunroof is open / closed', description: 'Checks if the sunroof is open or tilted.' },
  { id: 'warning_active', title: 'Warning light is active / inactive', description: 'Checks if any warning light (washer fluid, coolant, brake fluid, engine) is active.' },
  { id: 'battery_level', title: 'Battery level is above / is below threshold', description: 'Checks if the battery level is above or below a specified percentage.', args: 'threshold (0-100 %)' },
  { id: 'is_auxheat_active', title: 'Auxiliary heating is / is not active', description: 'Checks if auxiliary heating is currently active.' },
  { id: 'is_in_geofence', title: 'Vehicle is / is not in geofence zone', description: 'Checks if the vehicle is currently inside a specified geofence zone.', args: 'zone_name (text)' },
];

const FLOW_TRIGGERS = [
  { id: 'vehicle_locked', title: 'Vehicle was locked', description: 'Triggers when the vehicle is locked.', deprecated: true },
  { id: 'vehicle_unlocked', title: 'Vehicle was unlocked', description: 'Triggers when the vehicle is unlocked.', deprecated: true },
  { id: 'charging_started', title: 'Charging started', description: 'Triggers when charging starts.', tokens: 'charging_power (kW)' },
  { id: 'charging_stopped', title: 'Charging stopped', description: 'Triggers when charging stops.' },
  { id: 'charging_completed', title: 'Charging completed', description: 'Triggers when the charging status changes to "Charging ends".', tokens: 'battery_level (%)' },
  { id: 'connector_connected', title: 'Charger was connected', description: 'Triggers when the charger is plugged in.' },
  { id: 'connector_disconnected', title: 'Charger was disconnected', description: 'Triggers when the charger is unplugged.' },
  { id: 'engine_started', title: 'Engine was started', description: 'Triggers when the engine starts.' },
  { id: 'engine_stopped', title: 'Engine was stopped', description: 'Triggers when the engine stops.' },
  { id: 'door_opened', title: 'A door was opened', description: 'Triggers when any door (including trunk and hood) is opened.', tokens: 'door (front_left, front_right, rear_left, rear_right, trunk, hood)' },
  { id: 'door_closed', title: 'A door was closed', description: 'Triggers when any door (including trunk and hood) is closed.', tokens: 'door (front_left, front_right, rear_left, rear_right, trunk, hood)' },
  { id: 'window_opened', title: 'A window was opened', description: 'Triggers when any window is opened or set to airing.', tokens: 'window (front_left, front_right, rear_left, rear_right)' },
  { id: 'window_closed', title: 'A window was closed', description: 'Triggers when any window is closed.', tokens: 'window (front_left, front_right, rear_left, rear_right)' },
  { id: 'low_battery', title: 'Battery is low', description: 'Triggers when the battery level drops below 20%.', tokens: 'battery_level (%)' },
  { id: 'warning_light_activated', title: 'Warning light activated', description: 'Triggers when a warning light (washer fluid, coolant, brake fluid, engine) turns on.' },
  { id: 'vehicle_alarm', title: 'Vehicle alarm triggered', description: 'Triggers when the theft alarm activates.', tokens: 'reason (last theft warning reason)' },
  { id: 'geofence_entered', title: 'Vehicle entered geofence zone', description: 'Triggers when the geofencing API reports the vehicle entering a zone.', tokens: 'zone_name' },
  { id: 'geofence_left', title: 'Vehicle left geofence zone', description: 'Triggers when the geofencing API reports the vehicle leaving a zone.', tokens: 'zone_name' },
  { id: 'command_failed', title: 'Vehicle command failed', description: 'Triggers when the car reports that a command did not complete. Mercedes confirms this about 12 seconds after the command is sent, which is after the action card has already finished, so this is how a late failure becomes visible.', tokens: 'command, reason' },
];
