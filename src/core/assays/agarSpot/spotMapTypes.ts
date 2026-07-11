export type SpotRole = "experimental" | "control" | "background" | "unused";

export const SPOT_ROLES: SpotRole[] = ["experimental", "control", "background", "unused"];

export type SpotMapCell = {
  id: string;
  row: number;
  col: number;
  role: SpotRole;
  groupId: string;
  conditionId?: string;
  normalizationGroupId?: string;
  biologicalReplicateId?: string;
  technicalReplicateId?: string;
  relativeInoculum?: number;
  biologicalReplicate?: number;
  technicalReplicate?: number;
  dilutionIndex?: number;
  notes?: string;
};

export const SPOT_ROLE_LABELS: Record<SpotRole, string> = {
  experimental: "Experimental",
  control: "Control",
  background: "Background",
  unused: "Unused"
};

export const SPOT_ROLE_COLORS: Record<SpotRole, string> = {
  experimental: "#0f8a96",
  control: "#188a4d",
  background: "#c88b00",
  unused: "#a5adb8"
};

export function isSpotRole(value: string): value is SpotRole {
  return SPOT_ROLES.includes(value as SpotRole);
}

export function spotId(row: number, col: number): string {
  return `R${row + 1}C${col + 1}`;
}

export function createEmptySpotMap(rows = 4, columns = 6): SpotMapCell[] {
  const cells: SpotMapCell[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < columns; col += 1) {
      cells.push({
        id: spotId(row, col),
        row,
        col,
        role: "unused",
        groupId: "",
        conditionId: "",
        normalizationGroupId: "",
        biologicalReplicateId: "",
        technicalReplicateId: "",
        notes: ""
      });
    }
  }
  return cells;
}

export function resizeSpotMap(current: SpotMapCell[], rows: number, columns: number): SpotMapCell[] {
  const byId = new Map(current.map((cell) => [cell.id, cell]));
  return createEmptySpotMap(rows, columns).map((cell) => {
    const existing = byId.get(cell.id);
    return existing ? { ...cell, ...existing, row: cell.row, col: cell.col, id: cell.id } : cell;
  });
}

export function spotRoleAcceptsMetadata(role: SpotRole): boolean {
  return role === "experimental" || role === "control";
}

export function getSpotCell(spotMap: SpotMapCell[], row: number, col: number): SpotMapCell {
  const cell = spotMap.find((item) => item.row === row && item.col === col);
  if (!cell) {
    throw new Error(`Missing spot-map cell at row ${row}, column ${col}.`);
  }
  return cell;
}
