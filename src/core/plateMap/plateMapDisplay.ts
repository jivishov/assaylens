import { ROLE_LABELS, roleAcceptsAssignmentMetadata, roleAcceptsConcentration, type PlateMapCell, type WellRole } from "./plateMapTypes";

export type PlateMapAssignmentValues = {
  role: WellRole;
  compoundId: string;
  sampleId: string;
  concentrationText: string;
  unit: string;
};

export type PlateMapAssignment = {
  role: WellRole;
  compoundId: string;
  sampleId: string;
  concentration?: number;
  unit: string;
};

export type PlateMapCellDisplay = {
  roleLabel: string;
  details: string[];
  popoverRows: PlateMapDisplayRow[];
  hasMetadata: boolean;
  ariaLabel: string;
};

export type PlateMapDisplayRow = {
  label: string;
  value: string;
};

const ROLE_SHORT_LABELS: Record<WellRole, string> = {
  sample: "Sample",
  growth_control_high_signal: "Growth",
  blank_low_signal: "Blank",
  vehicle_control: "Vehicle",
  sterility_control: "Sterile",
  unused: "Unused"
};

export function parsePlateMapAssignment(values: PlateMapAssignmentValues): PlateMapAssignment {
  if (!roleAcceptsAssignmentMetadata(values.role)) {
    return {
      role: values.role,
      compoundId: "",
      sampleId: "",
      concentration: undefined,
      unit: ""
    };
  }

  const concentrationText = values.concentrationText.trim();
  const concentration = concentrationText && roleAcceptsConcentration(values.role) ? Number(concentrationText) : undefined;
  if (concentrationText && !Number.isFinite(concentration)) {
    throw new Error("Concentration must be numeric.");
  }

  return {
    role: values.role,
    compoundId: values.compoundId.trim(),
    sampleId: values.sampleId.trim(),
    concentration,
    unit: values.unit.trim()
  };
}

export function applyPlateMapAssignment(cell: PlateMapCell, assignment: PlateMapAssignment): PlateMapCell {
  return {
    ...cell,
    role: assignment.role,
    compoundId: assignment.compoundId,
    sampleId: assignment.sampleId,
    concentration: assignment.concentration,
    unit: assignment.unit
  };
}

export function plateMapCellDisplay(cell: PlateMapCell): PlateMapCellDisplay {
  const roleLabel = ROLE_SHORT_LABELS[cell.role];
  const details = compactDetails(cell);
  const popoverRows = fullDetails(cell);
  const ariaParts = [`${cell.well} ${ROLE_LABELS[cell.role]}`, ...popoverRows.map((row) => `${row.label}: ${row.value}`)];

  return {
    roleLabel,
    details,
    popoverRows,
    hasMetadata: popoverRows.length > 0,
    ariaLabel: ariaParts.join(", ")
  };
}

function compactDetails(cell: PlateMapCell): string[] {
  const details = [
    detail("Cmpd", cell.compoundId),
    detail("Samp", cell.sampleId),
    concentrationDetail(cell, "Dose", "Unit")
  ];
  return details.filter((item): item is string => Boolean(item));
}

function fullDetails(cell: PlateMapCell): PlateMapDisplayRow[] {
  const details = [
    row("Compound", cell.compoundId),
    row("Sample", cell.sampleId),
    concentrationRow(cell),
    row("Unit", cell.unit),
    row("Notes", cell.notes ?? "")
  ];
  return details.filter((item): item is PlateMapDisplayRow => Boolean(item));
}

function detail(label: string, value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed ? `${label}: ${trimmed}` : undefined;
}

function row(label: string, value: string): PlateMapDisplayRow | undefined {
  const trimmed = value.trim();
  return trimmed ? { label, value: trimmed } : undefined;
}

function concentrationDetail(cell: PlateMapCell, concentrationLabel: string, unitLabel: string): string | undefined {
  const unit = cell.unit.trim();
  if (Number.isFinite(cell.concentration)) {
    const label = cell.role === "vehicle_control" ? "Vehicle" : concentrationLabel;
    return `${label}: ${String(cell.concentration)}${unit ? ` ${unit}` : ""}`;
  }
  return unit ? `${unitLabel}: ${unit}` : undefined;
}

function concentrationRow(cell: PlateMapCell): PlateMapDisplayRow | undefined {
  if (Number.isFinite(cell.concentration)) {
    return {
      label: cell.role === "vehicle_control" ? "Vehicle concentration" : "Concentration",
      value: String(cell.concentration)
    };
  }
  return undefined;
}
