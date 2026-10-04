/**
 * Device types and capabilities of M2smart's own ESP32 boards.
 *
 * A board model (in the database hardware catalog, maintained only by M2smart) exposes one or more
 * channels; each channel is one device of a type below and uses one or more of the board's GPIOs.
 * Users never see or change pin assignments.
 *
 * Every value is absolute (e.g. brightness 40), never a relative change, and a command counts as
 * done only when the ESP32 reports that value.
 */

export type CapabilityValue = boolean | number | string;

type CapabilityBase = {
  /** Whether users may send commands for it; false for values the board only reports. */
  writable: boolean;
  unit?: string;
};

export type CapabilityDefinition =
  | (CapabilityBase & { valueType: "boolean" })
  | (CapabilityBase & { valueType: "integer" | "number"; min?: number; max?: number; step?: number })
  | (CapabilityBase & { valueType: "enum"; values: readonly string[] });

export const capabilities = {
  // Outputs (writable).
  power: { valueType: "boolean", writable: true },
  brightness: { valueType: "integer", min: 0, max: 100, step: 1, unit: "%", writable: true },
  pump: { valueType: "boolean", writable: true },
  speed: { valueType: "enum", values: ["off", "low", "high"], writable: true },
  curtain: { valueType: "enum", values: ["open", "closed"], writable: true },
  door: { valueType: "enum", values: ["open", "closed"], writable: true },
  alarm_mode: { valueType: "enum", values: ["disarmed", "armed_home", "armed_away"], writable: true },
  /** A camera records only while it is on; switching it off also stops recording. */
  recording: { valueType: "boolean", writable: true },

  // Inputs and measurements (reported only).
  triggered: { valueType: "boolean", writable: false },
  motion: { valueType: "boolean", writable: false },
  presence: { valueType: "boolean", writable: false },
  contact: { valueType: "enum", values: ["open", "closed"], writable: false },
  leak: { valueType: "boolean", writable: false },
  smoke: { valueType: "boolean", writable: false },
  co_ppm: { valueType: "number", min: 0, unit: "ppm", writable: false },
  co2_ppm: { valueType: "number", min: 0, unit: "ppm", writable: false },
  voc_index: { valueType: "number", min: 0, writable: false },
  humidity: { valueType: "number", min: 0, max: 100, unit: "%", writable: false },
  temperature: { valueType: "number", unit: "°C", writable: false },
  illuminance_lux: { valueType: "number", min: 0, unit: "lx", writable: false },
  power_w: { valueType: "number", min: 0, unit: "W", writable: false },
  energy_kwh: { valueType: "number", min: 0, unit: "kWh", writable: false },
} as const satisfies Record<string, CapabilityDefinition>;

export type CapabilityName = keyof typeof capabilities;
export const capabilityNames = Object.keys(capabilities) as CapabilityName[];

export function isCapabilityName(value: unknown): value is CapabilityName {
  return typeof value === "string" && Object.hasOwn(capabilities, value);
}

/**
 * Device types. `required` capabilities every board channel of that type has; `optional` ones a
 * board model may add (e.g. a humidity sensor that also measures temperature).
 */
export const deviceTypes = {
  switch: { required: ["power"], optional: [] },
  dimmer: { required: ["brightness"], optional: [] },
  socket: { required: ["power"], optional: ["power_w", "energy_kwh"] },
  cooler: { required: ["pump", "speed"], optional: [] },
  fan: { required: ["speed"], optional: [] },
  curtain: { required: ["curtain"], optional: [] },
  garage_door: { required: ["door"], optional: [] },
  alarm: { required: ["alarm_mode", "triggered"], optional: [] },
  motion_sensor: { required: ["motion"], optional: [] },
  presence_sensor: { required: ["presence"], optional: [] },
  contact_sensor: { required: ["contact"], optional: [] },
  leak_sensor: { required: ["leak"], optional: [] },
  smoke_sensor: { required: ["smoke"], optional: [] },
  co_sensor: { required: ["co_ppm"], optional: [] },
  air_quality_sensor: { required: [], optional: ["co2_ppm", "voc_index"] },
  humidity_sensor: { required: ["humidity"], optional: ["temperature"] },
  light_sensor: { required: ["illuminance_lux"], optional: [] },
  pump: { required: ["power"], optional: [] },
  camera: { required: ["power", "recording"], optional: [] },
} as const satisfies Record<string, { required: readonly CapabilityName[]; optional: readonly CapabilityName[] }>;

export type DeviceType = keyof typeof deviceTypes;
export const deviceTypeNames = Object.keys(deviceTypes) as DeviceType[];

export function isDeviceType(value: unknown): value is DeviceType {
  return typeof value === "string" && Object.hasOwn(deviceTypes, value);
}

/** How products are grouped where the user picks one to add. A product's category is that of its first channel. */
export const productCategories = ["lighting", "climate", "openings", "power", "security", "sensors"] as const;
export type ProductCategory = (typeof productCategories)[number];

export const deviceTypeCategory: Readonly<Record<DeviceType, ProductCategory>> = {
  switch: "lighting",
  dimmer: "lighting",
  cooler: "climate",
  fan: "climate",
  curtain: "openings",
  garage_door: "openings",
  socket: "power",
  pump: "power",
  alarm: "security",
  camera: "security",
  motion_sensor: "security",
  presence_sensor: "security",
  contact_sensor: "security",
  leak_sensor: "sensors",
  smoke_sensor: "sensors",
  co_sensor: "sensors",
  air_quality_sensor: "sensors",
  humidity_sensor: "sensors",
  light_sensor: "sensors",
};

/** Whether a device of `type` may have `capability` at all. */
export function allowsCapability(type: DeviceType, capability: CapabilityName): boolean {
  const { required, optional } = deviceTypes[type];
  return (required as readonly string[]).includes(capability) || (optional as readonly string[]).includes(capability);
}

/**
 * Checks a value against a capability definition. Returns an error message, or null when valid.
 * The database trigger `validate_device_command` applies the same rules to stored commands.
 */
export function capabilityValueError(definition: CapabilityDefinition, value: unknown): string | null {
  switch (definition.valueType) {
    case "boolean":
      return typeof value === "boolean" ? null : "expected true or false";
    case "enum":
      return typeof value === "string" && definition.values.includes(value) ? null : `expected one of ${definition.values.join(", ")}`;
    case "integer":
    case "number": {
      if (typeof value !== "number" || !Number.isFinite(value)) return "expected a number";
      if (definition.valueType === "integer" && !Number.isInteger(value)) return "expected a whole number";
      if (definition.min !== undefined && value < definition.min) return `must be at least ${definition.min}`;
      if (definition.max !== undefined && value > definition.max) return `must be at most ${definition.max}`;
      return null;
    }
  }
}

/**
 * Functions a board pin can have in the hardware catalog. Every board has exactly one
 * "setup_button": held 10–15 s it starts pairing, held over 20 s it factory-resets the board.
 */
export const pinFunctions = ["relay", "triac_gate", "zero_cross", "digital_in", "pulse_in", "i2c_sda", "i2c_scl", "uart_rx", "uart_tx", "adc", "setup_button"] as const;
export type PinFunction = (typeof pinFunctions)[number];

/** Built-in photos for homes and rooms (public/images); uploads are not supported yet. */
export const photoPresets = ["living", "exterior", "kitchen", "bedroom"] as const;
export type PhotoPreset = (typeof photoPresets)[number];
