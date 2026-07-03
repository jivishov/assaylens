export type AssayMode = "xtt_96well_mic" | "agar_spot_growth";

export type RoiRole =
  | "sample"
  | "growth_control_high_signal"
  | "blank_low_signal"
  | "vehicle_control"
  | "sterility_control"
  | "experimental"
  | "control"
  | "background"
  | "unused";

export type RoiQc = {
  validPixelFraction: number;
  highlightFraction: number;
  darkArtifactFraction: number;
  clippedFraction: number;
  partiallyOutsideImage: boolean;
};

export type RoiGeometry = {
  id: string;
  label?: string;
  row: number;
  col: number;
  center: {
    x: number;
    y: number;
  };
  radiusX: number;
  radiusY: number;
  overlayRadiusX?: number;
  overlayRadiusY?: number;
};

export type RoiMapCell = {
  id: string;
  row: number;
  col: number;
  role: RoiRole;
  label?: string;
  notes?: string;
};

export type RoiFeature = {
  roiId: string;
  label: string;
  row: number;
  col: number;
  meanR: number;
  meanG: number;
  meanB: number;
  medianR: number;
  medianG: number;
  medianB: number;
  linearR: number;
  linearG: number;
  linearB: number;
  hsvH: number;
  hsvS: number;
  hsvV: number;
  labL: number;
  labA: number;
  labB: number;
  luminanceMean: number;
  grayDensity: number;
  backgroundCorrectedDensity: number;
  orangeChromaticity: number;
  yellowOrangeLab: number;
  pseudoODBlue: number;
  pseudoODGreenBlue: number;
  selectedSignal?: number;
  qc: RoiQc;
};

export type RoiAnalysis = {
  roiId: string;
  label: string;
  row: number;
  col: number;
  role: RoiRole;
  signal: number;
  feature: RoiFeature;
  map: RoiMapCell;
  qcFlags: string[];
};
