/**
 * Main application orchestrator
 */

let auth = null;
let api = null;
let parser = null;
let currentVehicles = [];
let currentVehicleData = {};
let currentPowertrain = null;

/**
 * Append a timestamped message to the progress log
 */
function progressLog(message) {
  const log = document.getElementById('progress-log');
  if (!log) return;

  const now = new Date();
  const time = now.toLocaleTimeString('en-GB', { hour12: false });
  const entry = document.createElement('div');
  entry.className = 'log-entry';
  entry.textContent = `[${time}] ${message}`;
  log.appendChild(entry);
  log.scrollTop = log.scrollHeight;
}

/**
 * Handle login form submission
 */
async function handleLogin(e) {
  e.preventDefault();

  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;
  const region = document.getElementById('region').value;

  if (!email || !password) {
    progressLog('Please enter both email and password');
    return;
  }

  const loginBtn = document.getElementById('login-btn');
  loginBtn.disabled = true;
  loginBtn.textContent = 'Logging in...';

  try {
    // Initialize auth
    auth = new MercedesAuth(region);
    sessionStorage.setItem('mercedes_region', region);
    progressLog(`Logging in to ${region}...`);

    // Login
    await auth.login(email, password);

    // Initialize API + parser
    api = new MercedesAPI(auth);
    parser = new ProtoParser();
    await parser.initialize();

    // Fetch vehicles
    const vehicles = await api.getVehicles();
    currentVehicles = vehicles;

    if (vehicles.length === 0) {
      progressLog('No vehicles found on this account');
      loginBtn.disabled = false;
      loginBtn.textContent = 'Login';
      return;
    }

    // Show vehicle selector and auto-select first vehicle
    showVehicleSelector(vehicles);

    const firstVin = vehicles[0].vin || vehicles[0].fin || vehicles[0];
    document.getElementById('vehicle-select').value = firstVin;
    await loadVehicleData(firstVin);

  } catch (error) {
    progressLog(`Login failed: ${error.message}`);
    loginBtn.disabled = false;
    loginBtn.textContent = 'Login';
  }
}

/**
 * Show vehicle selector dropdown
 */
function showVehicleSelector(vehicles) {
  const section = document.getElementById('vehicle-section');
  const select = document.getElementById('vehicle-select');

  select.innerHTML = '<option value="">Select a vehicle...</option>';

  for (const v of vehicles) {
    const vin = v.vin || v.fin || v;
    const model = v.salesDesignation || v.modelName || vin;
    const plate = v.licensePlate || '';
    const label = plate ? `${model} (${plate})` : `${model} (${vin})`;

    const option = document.createElement('option');
    option.value = vin;
    option.textContent = label;
    select.appendChild(option);
  }

  section.classList.remove('hidden');

  // Hide login section
  document.getElementById('login-section').classList.add('logged-in');
}

/**
 * Handle vehicle selection
 */
async function handleVehicleSelect(e) {
  const vin = e.target.value;
  if (!vin) return;
  await loadVehicleData(vin);
}

/**
 * Refresh data for the currently selected vehicle
 */
async function handleRefresh() {
  const vin = document.getElementById('vehicle-select').value;
  if (!vin) {
    progressLog('No vehicle selected');
    return;
  }
  progressLog('Refreshing vehicle data...');
  await loadVehicleData(vin);
}

/**
 * Load vehicle data and render tables
 */
async function loadVehicleData(vin) {
  const dataSection = document.getElementById('data-section');
  const loading = document.getElementById('loading');

  loading.classList.remove('hidden');
  dataSection.classList.add('hidden');

  try {
    // Fetch vehicle data (protobuf)
    const arrayBuffer = await api.getVehicleData(vin);

    // Parse protobuf
    progressLog('Parsing vehicle data...');
    const vepUpdate = parser.parseVEPUpdate(arrayBuffer);
    const vehicleData = parser.extractVehicleData(vepUpdate);
    currentVehicleData = vehicleData;

    progressLog(`VIN: ${vehicleData.vin || vin}`);
    progressLog(`Data fields: ${Object.keys(vehicleData).length}`);

    // Render tables
    renderCapabilitiesTable(vehicleData);
    renderUnmappedTable(vehicleData);
    renderFlowsTable();

    // Show data section
    dataSection.classList.remove('hidden');
    progressLog('Data loaded successfully');

    // The powertrain verdict comes from two further endpoints, and neither
    // they nor the panel may cost the tables: assessed once the data section
    // is already up, and unable to fail the load around it.
    await loadPowertrain(vin);

  } catch (error) {
    progressLog(`Failed to load vehicle data: ${error.message}`);
  } finally {
    loading.classList.add('hidden');
  }
}

/**
 * Assess the powertrain the way the Homey app does, and show the verdict
 */
async function loadPowertrain(vin) {
  const card = document.getElementById('powertrain-card');
  currentPowertrain = null;

  // js/powertrain.js is not there: an index.html cached from before the panel
  // existed still loads this app.js, and asking it for a verdict would
  // otherwise throw where the caller reads as "failed to load vehicle data".
  if (typeof assessPowertrain !== 'function') {
    if (card) card.classList.add('hidden');
    progressLog('Powertrain not assessed: js/powertrain.js did not load - reload the page (Ctrl+F5)');
    return;
  }

  try {
    progressLog('Assessing powertrain from vehicle capabilities...');
    const { features, errors, capabilityFeatures, commands } = await api.getVehicleFeatures(vin);

    // The readings decide when the car has sent any, so the parsed attributes
    // go in beside the command list.
    const assessment = assessPowertrain(features, currentVehicleData);

    // Kept for the exports: an owner reporting a wrong verdict sends what the
    // endpoints answered, not just the verdict itself.
    currentPowertrain = { assessment, features, capabilityFeatures, commands, errors };

    renderPowertrain(assessment, errors);
    progressLog(`Powertrain assessed as: ${POWERTRAIN_LABELS[assessment.powertrain]}`);
  } catch (error) {
    // The tables are already on screen and stay there; only the verdict is lost.
    if (card) card.classList.add('hidden');
    currentPowertrain = { errors: [error.message] };
    progressLog(`Powertrain not assessed: ${error.message}`);
  }
}

/**
 * Initialize the app
 */
document.addEventListener('DOMContentLoaded', () => {
  // The build the browser actually has. A page holding an older js/app.js than
  // the one just deployed looks exactly like a deploy that did not happen, and
  // this line is what tells the two apart without opening devtools.
  const build = (typeof PROXY_CONFIG !== 'undefined' && PROXY_CONFIG.build) || 'unknown';
  progressLog(`Mercedes-Benz Data Explorer ready (build ${build})`);
  const versionEl = document.getElementById('homey-app-version');
  if (versionEl) versionEl.textContent = 'v' + HOMEY_APP_VERSION;

  // Login form
  document.getElementById('login-form').addEventListener('submit', handleLogin);

  // Vehicle selector
  document.getElementById('vehicle-select').addEventListener('change', handleVehicleSelect);

  // Copy buttons
  document.getElementById('copy-everything-btn').addEventListener('click', copyEverythingToClipboard);
  document.getElementById('copy-btn').addEventListener('click', copyTableToClipboard);
  document.getElementById('copy-raw-btn').addEventListener('click', copyRawDataToClipboard);
  document.getElementById('copy-raw-api-btn').addEventListener('click', copyRawApiToClipboard);

  // Refresh button
  document.getElementById('refresh-btn').addEventListener('click', handleRefresh);

  // Restore existing session (survives page refresh within the same tab)
  const storedToken = sessionStorage.getItem('mercedes_token');
  const storedRegion = sessionStorage.getItem('mercedes_region');
  if (storedToken && storedRegion) {
    progressLog('Restoring existing session...');
    restoreSession(storedRegion);
  }
});

/**
 * Restore a previous session from sessionStorage
 */
async function restoreSession(region) {
  try {
    auth = new MercedesAuth(region);
    auth.token = JSON.parse(sessionStorage.getItem('mercedes_token'));
    api = new MercedesAPI(auth);
    parser = new ProtoParser();
    await parser.initialize();

    const vehicles = await api.getVehicles();
    currentVehicles = vehicles;

    if (vehicles.length === 0) {
      progressLog('No vehicles found');
      return;
    }

    showVehicleSelector(vehicles);
    const firstVin = vehicles[0].vin || vehicles[0].fin || vehicles[0];
    document.getElementById('vehicle-select').value = firstVin;
    await loadVehicleData(firstVin);
  } catch (e) {
    progressLog('Session expired, please login again');
    sessionStorage.removeItem('mercedes_token');
    sessionStorage.removeItem('mercedes_region');
  }
}
