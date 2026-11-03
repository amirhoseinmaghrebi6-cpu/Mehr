/**
 * The home's energy use (GET /v1/properties/:propertyId/energy), from its energy meters (one per
 * phase), added together. Hours are the last 7 days, days (the home's calendar days) the last 12
 * months; a period with no use or no meter is left out. Power and voltage right now are the
 * meters' own states.
 */
export interface EnergyUse {
  /** The start of the hour (ISO time) or the day ("YYYY-MM-DD" in the home's time zone). */
  start: string;
  kwh: number;
}

export interface EnergyResponse {
  hours: EnergyUse[];
  days: EnergyUse[];
}
