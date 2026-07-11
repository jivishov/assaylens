export type CanonicalConcentration = {
  value: number;
  unit: "ug/mL";
};

const MASS_CONCENTRATION_UNITS: Record<string, number> = {
  "ug/ml": 1,
  "µg/ml": 1,
  "μg/ml": 1,
  "mg/l": 1,
  "mg/ml": 1000,
  "g/l": 1000
};

export function canonicalizeConcentration(value: number, unit: string): CanonicalConcentration | undefined {
  const factor = MASS_CONCENTRATION_UNITS[normalizeUnit(unit)];
  if (!Number.isFinite(value) || value <= 0 || factor == null) return undefined;
  return { value: value * factor, unit: "ug/mL" };
}

export function concentrationUnitsAreCompatible(units: string[]): boolean {
  const populated = units.map((unit) => unit.trim()).filter(Boolean);
  return populated.length > 0 && populated.every((unit) => MASS_CONCENTRATION_UNITS[normalizeUnit(unit)] != null);
}

function normalizeUnit(unit: string): string {
  return unit.trim().toLowerCase().replaceAll("µ", "u").replaceAll("μ", "u");
}
