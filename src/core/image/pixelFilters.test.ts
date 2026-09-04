import { describe, expect, it } from "vitest";
import { classifyPixel, summarizePixelClasses } from "./pixelFilters";

describe("classifyPixel", () => {
  it("retains deeply chromatic red pixels as valid XTT signal", () => {
    const pixel = classifyPixel(185, 22, 0);

    expect(pixel).toEqual({
      valid: true,
      highlight: false,
      darkArtifact: false,
      clipped: true
    });
  });

  it("still rejects neutral highlights and near-black artifacts", () => {
    expect(classifyPixel(253, 250, 251).valid).toBe(false);
    expect(classifyPixel(12, 4, 1).valid).toBe(false);
  });

  it("reports chromatic channel clipping without lowering valid-pixel coverage", () => {
    const qc = summarizePixelClasses([
      classifyPixel(185, 22, 0),
      classifyPixel(194, 25, 1),
      classifyPixel(176, 20, 0)
    ], 0);

    expect(qc.validPixelFraction).toBe(1);
    expect(qc.clippedFraction).toBe(1);
  });
});
