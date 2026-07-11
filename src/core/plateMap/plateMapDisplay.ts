import { ROLE_LABELS, roleAcceptsAssignmentMetadata, roleAcceptsConcentration, roleAcceptsNormalizationGroup, type PlateMapCell, type WellRole } from "./plateMapTypes";

export type PlateMapAssignmentValues = {
  role: WellRole;
  compoundId: string;
  sampleId: string;
  concentrationText: string;
  unit: string;
  normalizationGroupId?: string;
  biologicalReplicateId?: string;
  technicalReplicateId?: string;
  usesVehicleControl?: boolean;
};

export type PlateMapAssignment = {
  role: WellRole;
  compoundId: string;
  sampleId: string;
  concentration?: number;
  unit: string;
  normalizationGroupId?: string;
  biologicalReplicateId?: string;
  technicalReplicateId?: string;
  usesVehicleControl?: boolean;
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
  growth_control: "Growth",
  vehicle_control: "Vehicle",
  reagent_blank: "Reagent blank",
  sterility_control: "Sterile",
  positive_inhibition_control: "Positive inhibition",
  legacy_unresolved_blank: "Legacy blank?",
  unused: "Unused"
};

export function parsePlateMapAssignment(values: PlateMapAssignmentValues): PlateMapAssignment {
  if (!roleAcceptsNormalizationGroup(values.role)) {
    return {
      role: values.role,
      compoundId: "",
      sampleId: "",
      concentration: undefined,
      unit: "",
      normalizationGroupId: "",
      biologicalReplicateId: "",
      technicalReplicateId: "",
      usesVehicleControl: false
    };
  }

  const acceptsMetadata = roleAcceptsAssignmentMetadata(values.role);
  const concentrationText = values.concentrationText.trim();
  const concentration = concentrationText && roleAcceptsConcentration(values.role) ? Number(concentrationText) : undefined;
  if (concentrationText && roleAcceptsConcentration(values.role) && !Number.isFinite(concentration)) {
    throw new Error("Concentration must be numeric.");
  }

  return {
    role: values.role,
    compoundId: acceptsMetadata ? values.compoundId.trim() : "",
    sampleId: acceptsMetadata ? values.sampleId.trim() : "",
    concentration,
    unit: acceptsMetadata ? values.unit.trim() : "",
    normalizationGroupId: values.normalizationGroupId?.trim() ?? "",
    biologicalReplicateId: values.role === "sample" ? values.biologicalReplicateId?.trim() ?? "" : "",
    technicalReplicateId: values.role === "sample" ? values.technicalReplicateId?.trim() ?? "" : "",
    usesVehicleControl: values.role === "sample" ? Boolean(values.usesVehicleControl) : false
  };
}

export function applyPlateMapAssignment(cell: PlateMapCell, assignment: PlateMapAssignment): PlateMapCell {
  return {
    ...cell,
    role: assignment.role,
    compoundId: assignment.compoundId,
    sampleId: assignment.sampleId,
    concentration: assignment.concentration,
    unit: assignment.unit,
    normalizationGroupId: assignment.normalizationGroupId ?? "",
    biologicalReplicateId: assignment.biologicalReplicateId ?? "",
    technicalReplicateId: assignment.technicalReplicateId ?? "",
    usesVehicleControl: assignment.usesVehicleControl ?? false
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
    row("Normalization group", cell.normalizationGroupId),
    row("Biological replicate", cell.biologicalReplicateId),
    row("Technical replicate", cell.technicalReplicateId),
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
