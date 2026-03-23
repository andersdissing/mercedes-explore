/**
 * Capability and Flow Card data mappings
 * Extracted from the Homey Mercedes app
 */

// Capability mappings: raw API key -> capability display info
const CAPABILITY_MAPPINGS = [
  { id: 'locked', title: 'Locked', rawKey: 'doorlockstatusvehicle', unit: '', transform: v => v === 2 ? 'Yes' : 'No' },
  { id: 'measure_battery', title: 'Battery Level', rawKey: 'soc', unit: '%', transform: v => parseInt(v) },
  { id: 'measure_charge_power', title: 'Charging Power', rawKey: 'chargingpower', unit: 'kW', transform: v => parseFloat(v) },
  { id: 'onoff_charging', title: 'Charging', rawKey: 'chargingpower', unit: '', transform: v => parseFloat(v) > 0 ? 'Yes' : 'No' },
  { id: 'measure_range_electric', title: 'Electric Range', rawKey: 'rangeelectric', unit: 'km', transform: v => parseFloat(v) },
  { id: 'measure_range_liquid', title: 'Fuel Range', rawKey: 'rangeliquid', unit: 'km', transform: v => parseFloat(v) },
  { id: 'measure_fuel', title: 'Fuel Level', rawKey: 'tanklevelpercent', unit: '%', transform: v => parseInt(v) },
  { id: 'measure_adblue_level', title: 'AdBlue Level', rawKey: 'tankLevelAdBlue', unit: '%', transform: v => parseInt(v) },
  { id: 'odometer', title: 'Odometer', rawKey: 'odo', unit: 'km', transform: v => parseFloat(v) },
  { id: 'onoff.ignition', title: 'Ignition', rawKey: 'ignitionstate', unit: '', transform: v => ['0','1','2','4'].includes(String(v)) ? 'On' : 'Off' },
  { id: 'onoff.engine', title: 'Engine Running', rawKey: 'enginestate', unit: '', transform: v => (v === true || v === 'RUNNING') ? 'Yes' : 'No' },
  { id: 'onoff.climate', title: 'Climate Active', rawKey: 'precondActive', unit: '', transform: v => v === true ? 'Yes' : 'No' },
  { id: 'tire_pressure_bar.tire_fl', title: 'Tire Pressure FL', rawKey: 'tirepressurefrontleft', unit: 'bar', transform: v => v },
  { id: 'tire_pressure_bar.tire_fr', title: 'Tire Pressure FR', rawKey: 'tirepressurefrontright', unit: 'bar', transform: v => v },
  { id: 'tire_pressure_bar.tire_rl', title: 'Tire Pressure RL', rawKey: 'tirepressurerearleft', unit: 'bar', transform: v => v },
  { id: 'tire_pressure_bar.tire_rr', title: 'Tire Pressure RR', rawKey: 'tirepressurerearright', unit: 'bar', transform: v => v },
  { id: 'distance_start', title: 'Trip Distance', rawKey: 'distancestart', unit: 'km', transform: v => parseFloat(v) },
  { id: 'distance_electrical', title: 'Electric Trip Distance', rawKey: 'distanceelectricalstart', unit: 'km', transform: v => parseFloat(v) },
  { id: 'driven_time_start', title: 'Driving Time', rawKey: 'driventimestart', unit: 'min', transform: v => parseInt(v) },
  { id: 'average_speed', title: 'Average Speed', rawKey: 'averagespeedstart', unit: 'km/h', transform: v => parseFloat(v) },
  { id: 'ecoscore_accel', title: 'Eco Score Acceleration', rawKey: 'ecoscoreaccel', unit: '', transform: v => parseInt(v) },
  { id: 'ecoscore_const', title: 'Eco Score Constant', rawKey: 'ecoscoreconst', unit: '', transform: v => parseInt(v) },
  { id: 'ecoscore_freewhl', title: 'Eco Score Freewheel', rawKey: 'ecoscorefreewhl', unit: '', transform: v => parseInt(v) },
  { id: 'alarm_generic', title: 'Warning Light', rawKey: 'warningwashwater', unit: '', transform: v => v === true ? 'Active' : 'Inactive' },
  { id: 'measure_oil_level', title: 'Oil Level', rawKey: 'oilLevel', unit: '%', transform: v => parseInt(v) },
  { id: 'text_charging_status', title: 'Charging Status', rawKey: 'chargingstatus', unit: '', transform: v => {
    const map = { '0':'Charging','1':'Charging ends','2':'Charge break','3':'Unplugged','4':'Failure','5':'Slow charging','6':'Fast charging','7':'Discharging','8':'Not charging','9':'Slow charging (after trip)','10':'Charging (after trip)','11':'Fast charging (after trip)','12':'Connected','13':'AC charging','14':'DC charging','15':'Battery calibration','16':'Unknown' };
    return map[String(v)] || String(v);
  }},
  { id: 'text_connector_status', title: 'Connector Status', rawKey: 'chargeCouplerACStatus', unit: '', transform: v => {
    const map = { '0':'Connected (locked)','1':'Connected (unlocked)','2':'Disconnected','3':'Error','4':'Charging started' };
    return map[String(v)] || String(v);
  }},
  { id: 'onoff_connector', title: 'Connector Connected', rawKey: 'chargeCouplerACStatus', unit: '', transform: v => String(v) !== '2' ? 'Yes' : 'No' },
  { id: 'text_charge_program', title: 'Charge Program', rawKey: 'selectedChargeProgram', unit: '', transform: v => {
    const map = { '0':'Default','2':'Home','3':'Work' };
    return map[String(v)] || String(v);
  }},
  { id: 'measure_max_soc', title: 'Max Charge Level', rawKey: 'maxSoc', unit: '%', transform: v => parseInt(v) },
  { id: 'text_end_charge_time', title: 'End of Charge Time', rawKey: 'endofchargetime', unit: '', transform: v => {
    const m = parseInt(v);
    return String(Math.floor(m/60)).padStart(2,'0') + ':' + String(m%60).padStart(2,'0');
  }},
  { id: 'window_sunroof', title: 'Sunroof Status', rawKey: 'sunroofstatus', unit: '', transform: v => {
    const map = { 0:'Closed',1:'Open',2:'Tilted',3:'Running',4:'Anti-Booming',5:'Intermediate',6:'Opening',7:'Closing' };
    return map[v] || String(v);
  }},
  { id: 'text_departure_time', title: 'Departure Time', rawKey: 'departuretime', unit: '', transform: v => {
    const m = Number(v);
    return String(Math.floor(m/60)).padStart(2,'0') + ':' + String(m%60).padStart(2,'0');
  }},
  { id: 'text_departure_time_mode', title: 'Departure Time Mode', rawKey: 'departureTimeMode', unit: '', transform: v => {
    const map = { 0:'Inactive',1:'Single',2:'Weekly' };
    return map[v] || String(v);
  }},
  { id: 'window_front_left', title: 'Window Front Left', rawKey: 'windowstatusfrontleft', unit: '', transform: v => {
    const map = { 0:'Unknown',1:'Open',2:'Closed',3:'Airing',4:'Running' };
    return map[v] || String(v);
  }},
  { id: 'window_front_right', title: 'Window Front Right', rawKey: 'windowstatusfrontright', unit: '', transform: v => {
    const map = { 0:'Unknown',1:'Open',2:'Closed',3:'Airing',4:'Running' };
    return map[v] || String(v);
  }},
  { id: 'window_rear_left', title: 'Window Rear Left', rawKey: 'windowstatusrearleft', unit: '', transform: v => {
    const map = { 0:'Unknown',1:'Open',2:'Closed',3:'Airing',4:'Running' };
    return map[v] || String(v);
  }},
  { id: 'window_rear_right', title: 'Window Rear Right', rawKey: 'windowstatusrearright', unit: '', transform: v => {
    const map = { 0:'Unknown',1:'Open',2:'Closed',3:'Airing',4:'Running' };
    return map[v] || String(v);
  }},
  { id: 'door_front_left', title: 'Door Front Left', rawKey: 'doorstatusfrontleft', unit: '', transform: v => v === true ? 'Open' : 'Closed' },
  { id: 'door_front_right', title: 'Door Front Right', rawKey: 'doorstatusfrontright', unit: '', transform: v => v === true ? 'Open' : 'Closed' },
  { id: 'door_rear_left', title: 'Door Rear Left', rawKey: 'doorstatusrearleft', unit: '', transform: v => v === true ? 'Open' : 'Closed' },
  { id: 'door_rear_right', title: 'Door Rear Right', rawKey: 'doorstatusrearright', unit: '', transform: v => v === true ? 'Open' : 'Closed' },
  { id: 'door_trunk', title: 'Trunk', rawKey: 'decklidstatus', unit: '', transform: v => v === true ? 'Open' : 'Closed' },
  { id: 'door_hood', title: 'Hood', rawKey: 'enginehoodstatus', unit: '', transform: v => v === true ? 'Open' : 'Closed' },
  { id: 'parking_brake_engaged', title: 'Parking Brake', rawKey: 'parkbrakestatus', unit: '', transform: v => (v === true || v === 1) ? 'Engaged' : 'Released' },
  { id: 'measure_service_days', title: 'Service Interval', rawKey: 'serviceintervaldays', unit: 'days', transform: v => parseInt(v) },
  { id: 'measure_battery_temperature', title: 'Battery Temperature', rawKey: 'temperaturehvbattery', unit: '\u00b0C', transform: v => parseFloat(v) },
  { id: 'onoff_precond', title: 'Preconditioning', rawKey: 'precondactive', unit: '', transform: v => (v === true || v === 1) ? 'Active' : 'Inactive' },
  { id: 'onoff_auxheat', title: 'Auxiliary Heating', rawKey: 'auxheatactive', unit: '', transform: v => (v === true || v === 1) ? 'Active' : 'Inactive' },
  { id: 'onoff_remote_start', title: 'Remote Start', rawKey: 'remotestartactive', unit: '', transform: v => (v === true || v === 1) ? 'Active' : 'Inactive' },
  { id: 'theft_system_armed', title: 'Theft System', rawKey: 'theftsystemarmed', unit: '', transform: v => (v === true || v === 1) ? 'Armed' : 'Disarmed' },
  { id: 'alarm_theft', title: 'Theft Alarm', rawKey: 'theftalarmactive', unit: '', transform: v => (v === true || v === 1) ? 'Active' : 'Inactive' },
  { id: 'measure_latitude', title: 'Latitude', rawKey: 'positionlat', unit: '\u00b0', transform: v => parseFloat(v) },
  { id: 'measure_longitude', title: 'Longitude', rawKey: 'positionlong', unit: '\u00b0', transform: v => parseFloat(v) },
  { id: 'measure_heading', title: 'Heading', rawKey: 'positionHeading', unit: '\u00b0', transform: v => parseFloat(v) },
  { id: 'text_geofence_last_zone', title: 'Last Geofence Zone', rawKey: 'geofencename', unit: '', transform: v => String(v) },
  { id: 'text_geofence_last_event', title: 'Last Geofence Event', rawKey: 'geofenceevent', unit: '', transform: v => String(v) },
];

// Flow card mappings
const FLOW_ACTIONS = [
  { id: 'lock_vehicle', title: 'Lock vehicle', description: 'Locks all vehicle doors' },
  { id: 'unlock_vehicle', title: 'Unlock vehicle', description: 'Unlocks all vehicle doors (requires PIN)' },
  { id: 'start_climate', title: 'Start climate control', description: 'Starts climate control (ZEV precond for EV/PHEV, aux heat for ICE)' },
  { id: 'stop_climate', title: 'Stop climate control', description: 'Stops climate control' },
  { id: 'start_precond', title: 'Start preconditioning', description: 'Starts electric climate control (preconditioning)' },
  { id: 'stop_precond', title: 'Stop preconditioning', description: 'Stops electric climate control (preconditioning)' },
  { id: 'start_engine', title: 'Start engine', description: 'Starts the engine (requires PIN)' },
  { id: 'stop_engine', title: 'Stop engine', description: 'Stops the engine' },
  { id: 'flash_lights', title: 'Flash lights', description: 'Flashes the vehicle lights' },
  { id: 'sound_horn', title: 'Sound horn', description: 'Sounds the horn (modes: horn_light, horn_only, panic)' },
  { id: 'open_windows', title: 'Open windows', description: 'Opens all windows (requires PIN)' },
  { id: 'close_windows', title: 'Close windows', description: 'Closes all windows' },
  { id: 'open_sunroof', title: 'Open sunroof', description: 'Opens the sunroof (requires PIN)' },
  { id: 'close_sunroof', title: 'Close sunroof', description: 'Closes the sunroof' },
  { id: 'tilt_sunroof', title: 'Tilt sunroof', description: 'Tilts the sunroof for ventilation' },
  { id: 'start_charging', title: 'Resume charging', description: 'Resumes vehicle charging' },
  { id: 'stop_charging', title: 'Pause charging', description: 'Pauses vehicle charging' },
  { id: 'refresh_data', title: 'Refresh vehicle data', description: 'Manually refreshes all vehicle data from API' },
  { id: 'send_route', title: 'Send route to car', description: 'Sends a destination to the navigation system (args: title, lat, lon)' },
  { id: 'configure_departure_time', title: 'Set departure time', description: 'Sets departure time for preconditioning (args: hour, minute, mode)' },
  { id: 'configure_max_soc', title: 'Set maximum charge level', description: 'Sets max battery charge level (args: max_soc %, charge_program)' },
  { id: 'configure_seat_heating', title: 'Configure seat heating', description: 'Enables/disables seat heating per seat for preconditioning' },
  { id: 'configure_temperature', title: 'Set cabin temperature', description: 'Sets target temperature for climate control (16-28\u00b0C)' },
];

const FLOW_CONDITIONS = [
  { id: 'is_locked', title: 'Vehicle is locked/unlocked', description: 'Checks if vehicle doors are locked' },
  { id: 'is_engine_running', title: 'Engine is running/stopped', description: 'Checks if the engine is running' },
  { id: 'is_charging', title: 'Vehicle is charging/not charging', description: 'Checks if the vehicle is currently charging' },
  { id: 'is_connector_connected', title: 'Connector is connected/not connected', description: 'Checks if the charge connector is plugged in' },
  { id: 'tire_pressure_ok', title: 'Tire pressure is OK/too low', description: 'Checks if all tire pressures are >= 2.0 bar' },
  { id: 'windows_closed', title: 'All windows are closed/open', description: 'Checks if all vehicle windows are closed' },
  { id: 'any_door_open', title: 'Any door is open/closed', description: 'Checks if any door (incl. trunk, hood) is open' },
  { id: 'is_preconditioning', title: 'Preconditioning is active/inactive', description: 'Checks if preconditioning/climate control is active' },
  { id: 'sunroof_open', title: 'Sunroof is open/closed', description: 'Checks if the sunroof is open or tilted' },
  { id: 'warning_active', title: 'Warning light is active/inactive', description: 'Checks if any warning light is active' },
  { id: 'battery_level', title: 'Battery level is above/below threshold', description: 'Checks if battery level is above or below a percentage' },
  { id: 'is_auxheat_active', title: 'Auxiliary heating is active/inactive', description: 'Checks if auxiliary heating is active' },
  { id: 'is_in_geofence', title: 'Vehicle is in geofence zone', description: 'Checks if vehicle is inside a geofence zone' },
];

const FLOW_TRIGGERS = [
  { id: 'vehicle_locked', title: 'Vehicle was locked', description: 'Triggers when the vehicle is locked' },
  { id: 'vehicle_unlocked', title: 'Vehicle was unlocked', description: 'Triggers when the vehicle is unlocked' },
  { id: 'charging_started', title: 'Charging started', description: 'Triggers when charging starts (token: charging_power kW)' },
  { id: 'charging_stopped', title: 'Charging stopped', description: 'Triggers when charging stops' },
  { id: 'charging_completed', title: 'Charging completed', description: 'Triggers when charging completes (token: battery_level)' },
  { id: 'connector_connected', title: 'Charger was connected', description: 'Triggers when the charger is plugged in' },
  { id: 'connector_disconnected', title: 'Charger was disconnected', description: 'Triggers when the charger is unplugged' },
  { id: 'engine_started', title: 'Engine was started', description: 'Triggers when the engine starts' },
  { id: 'engine_stopped', title: 'Engine was stopped', description: 'Triggers when the engine stops' },
  { id: 'door_opened', title: 'A door was opened', description: 'Triggers when any door is opened (token: door name)' },
  { id: 'door_closed', title: 'A door was closed', description: 'Triggers when any door is closed (token: door name)' },
  { id: 'window_opened', title: 'A window was opened', description: 'Triggers when any window is opened (token: window name)' },
  { id: 'window_closed', title: 'A window was closed', description: 'Triggers when any window is closed (token: window name)' },
  { id: 'low_battery', title: 'Battery is low', description: 'Triggers when battery drops below 20% (token: battery_level)' },
  { id: 'warning_light_activated', title: 'Warning light activated', description: 'Triggers when a warning light turns on' },
  { id: 'vehicle_alarm', title: 'Vehicle alarm triggered', description: 'Triggers on theft alarm (token: reason)' },
  { id: 'geofence_entered', title: 'Vehicle entered geofence zone', description: 'Triggers on geofence entry (token: zone_name)' },
  { id: 'geofence_left', title: 'Vehicle left geofence zone', description: 'Triggers on geofence exit (token: zone_name)' },
];
