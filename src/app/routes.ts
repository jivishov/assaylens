export type WorkflowStep = "image" | "wells" | "plateMap" | "analysis" | "report";

export const workflowSteps: Array<{
  id: WorkflowStep;
  label: string;
  shortLabel: string;
}> = [
  { id: "image", label: "Image", shortLabel: "Image" },
  { id: "wells", label: "Wells", shortLabel: "Wells" },
  { id: "plateMap", label: "Plate Map", shortLabel: "Map" },
  { id: "analysis", label: "Analysis", shortLabel: "Analysis" },
  { id: "report", label: "Report", shortLabel: "Report" }
];
