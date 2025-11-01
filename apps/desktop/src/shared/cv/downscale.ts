export type FrameSource =
  | ImageBitmap
  | HTMLVideoElement
  | HTMLCanvasElement
  | OffscreenCanvas;

export type DownscaleResult = {
  bitmap: ImageBitmap;
  width: number;
  height: number;
  sourceWidth: number;
  sourceHeight: number;
  downscaled: boolean;
};

export const calculateDownscaleDimensions = (
  width: number,
  height: number,
  targetShortSide: number,
) => {
  if (width === 0 || height === 0) {
    throw new Error("Cannot downscale frame with zero dimension");
  }

  const shortSide = Math.min(width, height);

  if (shortSide <= targetShortSide) {
    return { width, height, downscaled: false };
  }

  const scale = targetShortSide / shortSide;
  const scaledWidth = Math.round(width * scale);
  const scaledHeight = Math.round(height * scale);

  return {
    width: scaledWidth,
    height: scaledHeight,
    downscaled: true,
  } as const;
};

const getCanvas = (
  width: number,
  height: number,
): OffscreenCanvas | HTMLCanvasElement => {
  if (typeof OffscreenCanvas !== "undefined") {
    return new OffscreenCanvas(width, height);
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
};

const isCanvas2DContext = (
  context: RenderingContext | OffscreenCanvasRenderingContext2D | null,
): context is CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D => {
  return Boolean(context && "drawImage" in context);
};

const drawSourceToCanvas = (
  canvas: OffscreenCanvas | HTMLCanvasElement,
  source: FrameSource,
) => {
  const context = canvas.getContext("2d", {
    alpha: false,
    willReadFrequently: false,
  });

  if (!isCanvas2DContext(context)) {
    throw new Error("Failed to acquire 2D context for downscale canvas");
  }

  context.drawImage(source, 0, 0, canvas.width, canvas.height);
};

const isVideoElement = (source: FrameSource): source is HTMLVideoElement => {
  return "videoWidth" in source && "videoHeight" in source;
};

const isCanvasLike = (
  source: FrameSource,
): source is HTMLCanvasElement | OffscreenCanvas => {
  return "width" in source && "height" in source;
};

export const downscaleFrame = async (
  source: FrameSource,
  targetShortSide = 320,
): Promise<DownscaleResult> => {
  let sourceWidth = 0;
  let sourceHeight = 0;

  if (source instanceof ImageBitmap) {
    sourceWidth = source.width;
    sourceHeight = source.height;
  } else if (isVideoElement(source)) {
    sourceWidth = source.videoWidth || source.width;
    sourceHeight = source.videoHeight || source.height;
  } else if (isCanvasLike(source)) {
    sourceWidth = source.width;
    sourceHeight = source.height;
  }

  if (sourceWidth === 0 || sourceHeight === 0) {
    throw new Error("Frame source has zero width or height");
  }

  const dimensions = calculateDownscaleDimensions(
    sourceWidth,
    sourceHeight,
    targetShortSide,
  );

  if (!dimensions.downscaled && source instanceof ImageBitmap) {
    return {
      bitmap: source,
      width: sourceWidth,
      height: sourceHeight,
      sourceWidth,
      sourceHeight,
      downscaled: false,
    };
  }

  const canvas = getCanvas(dimensions.width, dimensions.height);

  drawSourceToCanvas(canvas, source);

  const bitmap = await createImageBitmap(canvas);

  return {
    bitmap,
    width: dimensions.width,
    height: dimensions.height,
    sourceWidth,
    sourceHeight,
    downscaled: dimensions.downscaled,
  };
};
