/**
 * Mercedes-Benz REST API Client (Browser version)
 * All requests go through /api/proxy
 */

class MercedesAPI {
  constructor(auth) {
    this.auth = auth;
    this.endpoints = auth.endpoints;
    this.sessionId = crypto.randomUUID().toUpperCase();
  }

  async _getHeaders() {
    const accessToken = await this.auth.getAccessToken();

    return {
      'Authorization': `Bearer ${accessToken}`,
      'X-SessionId': this.sessionId,
      'X-TrackingId': crypto.randomUUID().toUpperCase(),
      'X-ApplicationName': 'mycar-store-ece',
      'ris-application-version': '1.65.1 (3174)',
      'ris-os-name': 'ios',
      'ris-os-version': '26.3',
      'ris-sdk-version': '4.4.2',
      'X-Locale': 'en-GB',
      'Content-Type': 'application/json; charset=UTF-8',
      'Accept': 'application/json',
      'User-Agent': 'Mercedes-Benz/3174 CFNetwork/3860.400.22 Darwin/25.3.0'
    };
  }

  /**
   * Get list of vehicles assigned to the account
   */
  async getVehicles() {
    progressLog('Fetching vehicle list...');
    const headers = await this._getHeaders();
    const url = `${this.endpoints.rest}/v2/vehicles`;

    const response = await proxyFetch(url, { method: 'GET', headers });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Failed to fetch vehicles: ${response.status} - ${text}`);
    }

    const data = await response.json();
    const vehicles = data.assignedVehicles || [];
    progressLog(`Found ${vehicles.length} vehicle(s)`);
    if (vehicles.length > 0) {
      progressLog(`Vehicle keys: ${Object.keys(vehicles[0]).join(', ')}`);
    }
    return vehicles;
  }

  /**
   * Get vehicle data (protobuf binary)
   */
  async getVehicleData(vin) {
    progressLog(`Fetching vehicle data for ${vin}...`);
    const headers = await this._getHeaders();

    // Widget endpoint for vehicle attributes
    const widgetUrl = this.endpoints.rest.replace('bff.emea-prod', 'widget.emea-prod')
                                          .replace('bff.amap-prod', 'widget.amap-prod')
                                          .replace('bff.cn-prod', 'widget.cn-prod');
    const url = `${widgetUrl}/v1/vehicle/${vin}/vehicleattributes`;

    const response = await proxyFetch(url, { method: 'GET', headers });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Failed to fetch vehicle data: ${response.status} - ${text}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    progressLog(`Received ${arrayBuffer.byteLength} bytes of vehicle data`);
    return arrayBuffer;
  }

  /**
   * Get vehicle capabilities
   */
  async getVehicleCapabilities(vin) {
    progressLog(`Fetching capabilities for ${vin}...`);
    return await this._getJson(`${this.endpoints.rest}/v1/vehicle/${vin}/capabilities`, 'capabilities');
  }

  /**
   * Get the commands the vehicle accepts
   */
  async getVehicleCommandCapabilities(vin) {
    progressLog(`Fetching command capabilities for ${vin}...`);
    return await this._getJson(`${this.endpoints.rest}/v1/vehicle/${vin}/capabilities/commands`, 'command capabilities');
  }

  /**
   * Merged feature map (featureName -> isAvailable) from /capabilities and
   * /capabilities/commands - the map the Homey app's powertrain logic reads
   * (`api.getVehicleFeatures()` in the Homey app).
   *
   * Both endpoints are best-effort: they answer 401 for some cars, and the
   * Homey app carries on with whatever it got. The reason each one failed is
   * returned alongside, because "no features at all" is exactly the case the
   * powertrain panel has to explain rather than silently call unknown.
   *
   * Both endpoints' answers are returned as they arrived, next to the merged
   * map built from them. The merge is lossy in the one place that decides a
   * verdict - `isAvailable` is overwritten for CHARGE_PROGRAM_CONFIGURE below -
   * so a wrong verdict cannot be explained from the merged map alone, and the
   * export an owner sends is the only look anyone gets at their car.
   *
   * @returns {Promise<{features: Object, errors: string[],
   *   capabilityFeatures: Object|null, commands: Array|null}>}
   */
  async getVehicleFeatures(vin) {
    const features = {};
    const errors = [];
    let capabilityFeatures = null;
    let commands = null;

    try {
      const capabilities = await this.getVehicleCapabilities(vin);
      if (capabilities && capabilities.features) {
        capabilityFeatures = capabilities.features;
        Object.assign(features, capabilities.features);
      }
    } catch (error) {
      errors.push(error.message);
      progressLog(`Vehicle capabilities not available: ${error.message}`);
    }

    try {
      const commandCapabilities = await this.getVehicleCommandCapabilities(vin);
      if (commandCapabilities && Array.isArray(commandCapabilities.commands)) {
        commands = commandCapabilities.commands.map(command => ({
          commandName: command.commandName,
          isAvailable: Boolean(command.isAvailable),
          parameters: (command.parameters || []).map(p => p.parameterName).filter(Boolean)
        }));

        for (const command of commandCapabilities.commands) {
          features[command.commandName] = Boolean(command.isAvailable);

          // CHARGE_PROGRAM_CONFIGURE is only useful to the Homey app if it
          // exposes a MAX_SOC parameter
          if (command.commandName === 'CHARGE_PROGRAM_CONFIGURE') {
            const parameters = command.parameters || [];
            features.CHARGE_PROGRAM_CONFIGURE = parameters.some(p => p.parameterName === 'MAX_SOC');
          }
        }
      }
    } catch (error) {
      errors.push(error.message);
      progressLog(`Vehicle command capabilities not available: ${error.message}`);
    }

    return { features, errors, capabilityFeatures, commands };
  }

  async _getJson(url, what) {
    const headers = await this._getHeaders();
    const response = await proxyFetch(url, { method: 'GET', headers });

    if (!response.ok) {
      throw new Error(`Failed to fetch ${what}: ${response.status}`);
    }

    return await response.json();
  }
}
