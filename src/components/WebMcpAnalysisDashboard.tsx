import { useEffect, type ComponentProps } from "react";
import { AnalysisDashboard as BaseAnalysisDashboard } from "./AnalysisDashboard";

type Props = ComponentProps<typeof BaseAnalysisDashboard> & {
  selectedSeriesKey?: string;
  onSelectedSeriesKeyChange?: (key: string) => void;
  reviewNotice?: string;
};

export function WebMcpAnalysisDashboard({ selectedSeriesKey, onSelectedSeriesKeyChange, reviewNotice, ...baseProps }: Props) {
  useEffect(() => {
    if (!selectedSeriesKey) return;
    const select = document.querySelector<HTMLSelectElement>(".plot-selector select");
    if (select && [...select.options].some((option) => option.value === selectedSeriesKey) && select.value !== selectedSeriesKey) {
      select.value = selectedSeriesKey;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    }
    onSelectedSeriesKeyChange?.(selectedSeriesKey);
  }, [onSelectedSeriesKeyChange, selectedSeriesKey, baseProps.result]);

  return (
    <>
      {reviewNotice && <div className="error-banner" role="status">{reviewNotice}</div>}
      <BaseAnalysisDashboard {...baseProps} />
    </>
  );
}
