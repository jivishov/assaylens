import { COLUMNS, ROWS, wellName } from "../geometry/plateGrid";

export type WellRole =
  | "sample"
  | "growth_control_high_signal"
  | "blank_low_signal"
  | "vehicle_control"
  | "sterility_control"
  | "unused";

export const WELL_ROLES: WellRole[] = [
  "sample",
  "growth_control_high_signal",
  "blank_low_signal",
  "vehicle_control",
  "sterility_control",
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
  notes?: string;
};

export const ROLE_LABELS: Record<WellRole, string> = {
  sample: "Sample",
  growth_control_high_signal: "Growth/high-signal control",
  blank_low_signal: "Blank/no-growth control",
  vehicle_control: "Vehicle control",
  sterility_control: "Sterility control",
  unused: "Unused"
};

export const ROLE_COLORS: Record<WellRole, string> = {
  sample: "#0f8a96",
  growth_control_high_signal: "#188a4d",
  blank_low_signal: "#c88b00",
  vehicle_control: "#6d5bd0",
  sterility_control: "#34495e",
  unused: "#a5adb8"
};

export function isWellRole(value: string): value is WellRole {
  return WELL_ROLES.includes(value as WellRole);
}

export function roleAcceptsAssignmentMetadata(role: WellRole): boolean {
  return role === "sample" || role === "vehicle_control";
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
