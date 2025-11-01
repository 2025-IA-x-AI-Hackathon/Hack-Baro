import { parseBooleanFlag } from "../../shared/env";
import { IPC_CHANNELS } from "../../shared/ipcChannels";
import { getLogger } from "../../shared/logger";
import type { MetricValues } from "../../shared/types/metrics";

const logger = getLogger("signal-trace-writer", "renderer");

const electronApi = typeof window !== "undefined" ? window.electron : undefined;
const traceEnabled = parseBooleanFlag(electronApi?.env?.POSELY_SIGNAL_TRACE);
const configuredFile = electronApi?.env?.POSELY_SIGNAL_TRACE_FILE ?? null;

let unavailableLogged = false;

const emitSignalTrace = (metrics: MetricValues): void => {
  if (!traceEnabled) {
    return;
  }
  const ipcRenderer = electronApi?.ipcRenderer;
  if (!ipcRenderer) {
    if (!unavailableLogged) {
      logger.warn(
        "Signal trace requested but ipcRenderer is unavailable; logging disabled",
      );
      unavailableLogged = true;
    }
    return;
  }

  ipcRenderer.sendMessage(IPC_CHANNELS.signalTraceAppend, {
    metrics,
    filePath: configuredFile,
  });
};

export default emitSignalTrace;
