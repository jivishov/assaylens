import { COLUMNS, ROWS, wellName } from "../geometry/plateGrid";

export type WellRole =
  | "sample"
  | "growth_control"
  | "vehicle_control"
  | "reagent_blank"
  | "sterility_control"
  | "positive_inhibition_control"
  | "legacy_unresolved_blank"
  | "unused";

export const WELL_ROLES: WellRole[] = [
  "sample",
  "growth_control",
  "vehicle_control",
  "reagent_blank",
  "sterility_control",
  "positive_inhibition_control",
  "legacy_unresolved_blank",
  "unused"
];

export type PlateMapCell = {
  well: string;
  row: number;
  col: number;
  role: WellRole;
  compoundId: string;
  sampleId: string;
  concentration?: number;
  unit: string;
  normalizationGroupId: string;
  biologicalReplicateId: string;
  technicalReplicateId: string;
  usesVehicleControl?: boolean;
  notes?: string;
};

export const ROLE_LABELS: Record<WellRole, string> = {
  sample: "Sample",
  growth_control: "Growth control",
  vehicle_control: "Vehicle control",
  reagent_blank: "Reagent blank",
  sterility_control: "Sterility control",
  positive_inhibition_control: "Positive inhibition control",
  legacy_unresolved_blank: "Legacy unresolved blank",
  unused: "Unused"
};

export const ROLE_COLORS: Record<WellRole, string> = {
  sample: "#0f8a96",
  growth_control: "#188a4d",
  vehicle_control: "#6d5bd0",
  reagent_blank: "#c88b00",
  sterility_control: "#34495e",
  positive_inhibition_control: "#a53b70",
  legacy_unresolved_blank: "#9a6b28",
  unused: "#a5adb8"
};

export function isWellRole(value: string): value is WellRole {
  return WELL_ROLES.includes(value as WellRole);
}

export function roleAcceptsAssignmentMetadata(role: WellRole): boolean {
  return role === "sample" || role === "vehicle_control";
}

export function roleAcceptsNormalizationGroup(role: WellRole): boolean {
  return role !== "unused" && role !== "legacy_unresolved_blank";
}

export function roleAcceptsConcentration(role: WellRole): boolean {
  return role === "sample" || role === "vehicle_control";
}

export function createEmptyPlateMap(): PlateMapCell[] {
  const cells: PlateMapCell[] = [];
  for (let row = 0; row < ROWS; row += 1) {
    for (let col = 0; col < COLUMNS; col += 1) {
      cells.push({
        well: wellName(row, col),
        row,
        col,
        role: "unused",
        compoundId: "",
        sampleId: "",
        unit: "",
        normalizationGroupId: "",
        biologicalReplicateId: "",
        technicalReplicateId: "",
        usesVehicleControl: false,
        notes: ""
      });
    }
  }
  return cells;
}

export function cellKey(row: number, col: number): string {
  return `${row}:${col}`;
}

export function getCell(plateMap: PlateMapCell[], row: number, col: number): PlateMapCell {
  const cell = plateMap.find((item) => item.row === row && item.col === col);
  if (!cell) {
    throw new Error(`Missing plate-map cell at row ${row}, column ${col}.`);
  }
  return cell;
}
