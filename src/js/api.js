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
    const headers = await this._getHeaders();
    const url = `${this.endpoints.rest}/v1/vehicle/${vin}/capabilities`;

    const response = await proxyFetch(url, { method: 'GET', headers });

    if (!response.ok) {
      throw new Error(`Failed to fetch capabilities: ${response.status}`);
    }

    return await response.json();
  }
}
