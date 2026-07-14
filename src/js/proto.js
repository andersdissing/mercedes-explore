/**
 * Mercedes Protocol Buffer Parser (Browser version)
 * Uses protobufjs loaded from CDN
 */

class ProtoParser {
  constructor() {
    this.root = null;
    this.VEPUpdate = null;
    this.initialized = false;
  }

  async initialize() {
    if (this.initialized) return;

    progressLog('Loading protobuf schema...');

    this.root = await protobuf.load('proto/vehicle-events.proto');
    this.VEPUpdate = this.root.lookupType('proto.VEPUpdate');

    this.initialized = true;
    progressLog('Protobuf parser ready');
  }

  /**
   * Parse binary protobuf data into VEPUpdate message
   */
  parseVEPUpdate(buffer) {
    if (!this.initialized) throw new Error('Protobuf parser not initialized');

    const uint8Array = new Uint8Array(buffer);
    const message = this.VEPUpdate.decode(uint8Array);

    return this.VEPUpdate.toObject(message, {
      longs: Number,
      enums: String,
      bytes: String,
      defaults: true,
      arrays: true,
      objects: true,
      oneofs: true
    });
  }

  /**
   * Extract vehicle data from VEPUpdate into simple key-value format
   */
  extractVehicleData(vepUpdate) {
    if (!vepUpdate || !vepUpdate.attributes) {
      return {};
    }

    const vehicleData = {
      vin: vepUpdate.vin,
      timestamp: vepUpdate.emitTimestampInMs || vepUpdate.emitTimestamp,
      full_update: vepUpdate.fullUpdate
    };

    for (const [key, attribute] of Object.entries(vepUpdate.attributes)) {
      let value = null;

      // Special handling for tire pressure - convert kPa to bar
      // Mercedes numeric values (intValue/doubleValue) are in kPa (e.g., 290 kPa = 2.9 bar)
      // displayValue is already in bar (e.g., "2.9")
      if (key.includes('tirepressure')) {
        if (attribute.doubleValue !== undefined && attribute.doubleValue !== null) {
          value = attribute.doubleValue / 100; // kPa to bar
        } else if (attribute.intValue !== undefined && attribute.intValue !== null) {
          value = attribute.intValue / 100; // kPa to bar
        } else if (attribute.displayValue) {
          const match = attribute.displayValue.match(/[\d.]+/);
          if (match) {
            value = parseFloat(match[0]); // already in bar
          } else {
            value = attribute.displayValue;
          }
        }
      } else {
        // Standard priority: intValue > boolValue > stringValue > doubleValue > displayValue
        if (attribute.intValue !== undefined && attribute.intValue !== null) {
          value = attribute.intValue;
        } else if (attribute.boolValue !== undefined && attribute.boolValue !== null) {
          value = attribute.boolValue;
        } else if (attribute.stringValue !== undefined && attribute.stringValue !== null) {
          value = attribute.stringValue;
        } else if (attribute.doubleValue !== undefined && attribute.doubleValue !== null) {
          value = attribute.doubleValue;
        } else if (attribute.displayValue && attribute.displayValue !== "") {
          value = attribute.displayValue;
        }
      }

      if (value !== null && value !== undefined) {
        vehicleData[key] = value;
      }

      // Store display value separately if different
      if (attribute.displayValue && attribute.displayValue !== "" && attribute.displayValue !== value) {
        vehicleData[`${key}_display`] = attribute.displayValue;
      }
    }

    progressLog(`Extracted ${Object.keys(vehicleData).length} vehicle data fields`);
    return vehicleData;
  }
}
