export const createDetectionWorker = () =>
  new Worker(new URL("../../worker/inference-worker.ts", import.meta.url), {
    type: "module",
  });
