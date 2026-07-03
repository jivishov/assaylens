import type { ImageMetadata, ImageSource } from "../types";
import { inspectInputImage } from "./imageQc";

export const ACCEPTED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/heic", "image/heif"];

export type LoadedImage = {
  file: File;
  url: string;
  bitmap: ImageBitmap;
  imageData: ImageData;
  metadata: ImageMetadata;
};

type LoadImageOptions = {
  source?: ImageSource;
};

export async function loadImageFile(file: File, options: LoadImageOptions = {}): Promise<LoadedImage> {
  if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
    throw new Error("Use a PNG, JPEG, WEBP, or browser-supported HEIC/HEIF image.");
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch (error) {
    if (file.type === "image/heic" || file.type === "image/heif") {
      throw new Error("This browser cannot decode HEIC/HEIF. Export the plate photo as PNG or JPEG.");
    }
    throw error;
  }

  const canvas =
    typeof OffscreenCanvas !== "undefined"
      ? new OffscreenCanvas(bitmap.width, bitmap.height)
      : Object.assign(document.createElement("canvas"), {
          width: bitmap.width,
          height: bitmap.height
        });
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Canvas image decoding is unavailable in this browser.");
  }
  ctx.drawImage(bitmap, 0, 0);
  const imageData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  const source = options.source ?? "upload";
  const inputQc = inspectInputImage(imageData, { source });

  return {
    file,
    url: URL.createObjectURL(file),
    bitmap,
    imageData,
    metadata: {
      name: file.name,
      type: file.type,
      width: bitmap.width,
      height: bitmap.height,
      size: file.size,
      lastModified: file.lastModified,
      source,
      backgroundClass: inputQc.backgroundClass,
      captureQuality: inputQc.captureQuality,
      warnings: inputQc.warnings,
      warningCodes: inputQc.warningCodes
    }
  };
}
