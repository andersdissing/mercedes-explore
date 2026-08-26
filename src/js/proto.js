/**
 * Mercedes Protocol Buffer Parser (Browser version)
 * Uses protobufjs loaded from CDN
 *
 * Mirrors lib/proto/parser.js in the Homey Mercedes app: the same schema and
 * the same value-extraction rules, so the raw values shown here are the ones
 * the Homey device actually works from.
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

    let nilCount = 0;
    const unreadable = [];

    for (const [key, attribute] of Object.entries(vepUpdate.attributes)) {
      let value = null;
      let unit = null;

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
        // Standard priority: intValue > boolValue > stringValue > doubleValue > structured values > displayValue
        if (attribute.intValue !== undefined && attribute.intValue !== null) {
          value = attribute.intValue;
        } else if (attribute.boolValue !== undefined && attribute.boolValue !== null) {
          value = attribute.boolValue;
        } else if (attribute.stringValue !== undefined && attribute.stringValue !== null) {
          value = attribute.stringValue;
        } else if (attribute.doubleValue !== undefined && attribute.doubleValue !== null) {
          value = attribute.doubleValue;
        } else if (attribute.temperaturePointsValue) {
          // One entry per cabin zone (feeds measure_climate_setpoint)
          value = (attribute.temperaturePointsValue.temperaturePoints || []).map(point => ({
            zone: point.zone || '',
            temperature: point.temperatureInCelsius,
            displayValue: point.displayValue || '',
          }));
        } else if (attribute.weeklySetHuValue) {
          // One entry per weekday, minutes from midnight (feeds text_weekly_departure_times)
          value = (attribute.weeklySetHuValue.entries || []).map(entry => ({
            index: entry.index || 0,
            minutesFromMidnight: entry.minutesFromMidnight,
          }));
        } else if (attribute.weeklyProfileValue) {
          // Meaning of the fields is not established; passed through as-is
          const profile = attribute.weeklyProfileValue;
          value = {
            unknown2: profile.unknown2,
            unknown3: profile.unknown3,
            unknown4: profile.unknown4,
            unknown5: profile.unknown5,
            entries: (profile.entries || []).map(entry => ({
              unknown1: entry.unknown1,
              unknown4: entry.unknown4 || '',
              unknown6: entry.unknown6,
              unknown7: entry.unknown7 ? entry.unknown7.value : null,
              unknown8: entry.unknown8 ? entry.unknown8.value : null,
              unknown9: entry.unknown9 ? entry.unknown9.value : null,
            })),
          };
        } else if (attribute.precondStateValue) {
          // Field 1 is omitted when false (proto3), so absent means idle
          value = attribute.precondStateValue.activationState === true;
        } else if (attribute.tcuConnectionStateLowChannel !== undefined
                   && attribute.tcuConnectionStateLowChannel !== null) {
          value = attribute.tcuConnectionStateLowChannel;
        } else if (attribute.chargeProgramsValue) {
          // One entry per charge program, each with its own max SoC (feeds measure_max_soc)
          value = (attribute.chargeProgramsValue.chargeProgramParameters || []).map(program => ({
            chargeProgram: program.chargeProgram || 0,
            maxSoc: program.maxSoc,
          }));
        } else if (attribute.displayValue && attribute.displayValue !== "") {
          value = attribute.displayValue;
        }
      }

      if (attribute.pressureUnit !== undefined) {
        unit = attribute.pressureUnit;
      } else if (attribute.temperatureUnit !== undefined) {
        unit = attribute.temperatureUnit;
      }

      if (value !== null && value !== undefined) {
        vehicleData[key] = value;
      } else if (attribute.attributeType === 'nilValue' || attribute.nilValue !== undefined) {
        // The car sent the attribute without a value - it never reaches the Homey device
        nilCount++;
      } else {
        unreadable.push(`${key} (${attribute.attributeType || 'no type'})`);
      }

      // Store display value separately if different
      if (attribute.displayValue && attribute.displayValue !== "" && attribute.displayValue !== value) {
        vehicleData[`${key}_display`] = attribute.displayValue;
      }

      if (unit) {
        vehicleData[`${key}_unit`] = unit;
      }
    }

    progressLog(`Extracted ${Object.keys(vehicleData).length} vehicle data fields`);
    if (nilCount > 0) {
      progressLog(`${nilCount} attribute(s) sent as nil (no value) - skipped, same as the Homey app`);
    }
    if (unreadable.length > 0) {
      progressLog(`No value read for: ${unreadable.join(', ')}`);
    }
    return vehicleData;
  }
}
