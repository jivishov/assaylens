export const GEMINI_ANCHOR_PROMPT = `You are detecting the geometry of a standard 8-row by 12-column 96-well microplate.

Return only JSON matching the provided schema.

Do not draw on the image. Do not estimate MIC. Do not analyze color intensity.

Find the center points of the four corner wells:
A1, A12, H12, and H1.

Use normalized coordinates from 0 to 1000, where x=0 is the left edge and y=0 is the top edge of the image.

If row/column labels are not readable, infer orientation from the visible plate layout and mark a1Position as uncertain when needed.

Include warnings if the image is rotated, cropped, blurry, annotated, reflective, or if any corner well is partially outside the image.`;
