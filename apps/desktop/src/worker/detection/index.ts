import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { type Logger, getLogger, toErrorPayload } from "../../shared/logger";
import {
  type RiskConfigOverrides,
  type RiskDetectionConfig,
  cloneRiskConfig,
  getRiskDetectionConfig,
  resetRiskDetectionConfig,
  updateRiskDetectionConfig,
} from "../config/detection-config";
import {
  RiskStateMachine,
  type RiskStateMachineOptions,
  type RiskStateSnapshot,
  type RiskTransitionEvent,
  type RiskUpdateInput,
} from "./state-machine";

export type { RiskAssessment } from "./risk-evaluator";
export type {
  RiskStateSnapshot,
  RiskUpdateInput,
  RiskTransitionEvent,
} from "./state-machine";

export type RiskDetectorOptions = {
  config?: RiskDetectionConfig;
  logger?: Logger;
  transitionLogPath?: string;
  stateMachineOptions?: Partial<Omit<RiskStateMachineOptions, "config">>;
};

export type RiskDetectorUpdateInput = RiskUpdateInput;

export class RiskDetector {
  private readonly logger: Logger;

  private readonly machine: RiskStateMachine;

  private readonly transitionLogPath?: string;

  private pendingLogWrite: Promise<void> | null = null;

  private snapshot: RiskStateSnapshot;

  constructor(options: RiskDetectorOptions = {}) {
    const baseConfig = cloneRiskConfig(
      options.config ?? getRiskDetectionConfig(),
    );
    this.logger = options.logger ?? getLogger("risk-detector", "worker");
    this.transitionLogPath = options.transitionLogPath;

    this.machine = new RiskStateMachine({
      config: baseConfig,
      ...(options.stateMachineOptions ?? {}),
      onTransition: (event) => {
        try {
          options.stateMachineOptions?.onTransition?.(event);
        } catch (err) {
          this.logger.warn('Risk transition callback threw', { error: toErrorPayload(err) });
        }
        this.handleTransition(event);
      },
    });

    this.snapshot = this.machine.getSnapshot();
  }

  update(input: RiskDetectorUpdateInput): RiskStateSnapshot {
    this.snapshot = this.machine.update(input);
    return this.snapshot;
  }

  getSnapshot(): RiskStateSnapshot {
    return this.snapshot;
  }

  updateConfig(overrides: RiskConfigOverrides): RiskDetectionConfig {
    const nextConfig = updateRiskDetectionConfig(overrides);
    this.machine.updateConfig(nextConfig);
    return nextConfig;
  }

  resetConfig(): RiskDetectionConfig {
    const config = resetRiskDetectionConfig();
    this.machine.updateConfig(config);
    return config;
  }

  async flushTransitionLogs(): Promise<void> {
    if (this.pendingLogWrite) {
      await this.pendingLogWrite;
    }
  }

  private handleTransition(event: RiskTransitionEvent): void {
    const { from, to, timestamp, snapshot } = event;
    const { assessment, timeInConditions, timeInRecovery } = snapshot;
    const isoTimestamp = new Date(timestamp).toISOString();

    this.logger.info("Risk state transition", {
      from,
      to,
      timestamp,
      isoTimestamp,
      timers: {
        timeInConditions: Number(timeInConditions.toFixed(3)),
        timeInRecovery: Number(timeInRecovery.toFixed(3)),
      },
      assessment: {
        pitch: assessment.pitch,
        pitchDeviation: assessment.pitchDeviation,
        pitchThreshold: assessment.pitchThreshold,
        ehd: assessment.ehd,
        ehdDeviation: assessment.ehdDeviation,
        ehdThreshold: assessment.ehdThreshold,
        dpr: assessment.dpr,
        dprDeviation: assessment.dprDeviation,
        dprThreshold: assessment.dprThreshold,
        signalsAvailable: assessment.signalsAvailable,
        reasons: assessment.reasons,
      },
    });

    if (!this.transitionLogPath) {
      return;
    }

    const logRecord = {
      ts: isoTimestamp,
      tsMs: timestamp,
      from,
      to,
      timeInConditions: Number(timeInConditions.toFixed(3)),
      timeInRecovery: Number(timeInRecovery.toFixed(3)),
      metrics: {
        pitch: assessment.pitch,
        pitchDeviation: assessment.pitchDeviation,
        pitchThreshold: assessment.pitchThreshold,
        ehd: assessment.ehd,
        ehdDeviation: assessment.ehdDeviation,
        ehdThreshold: assessment.ehdThreshold,
        dpr: assessment.dpr,
        dprDeviation: assessment.dprDeviation,
        dprThreshold: assessment.dprThreshold,
      },
      recoveryThresholds: {
        pitch: assessment.pitchRecoveryThreshold,
        ehd: assessment.ehdRecoveryThreshold,
        dpr: assessment.dprRecoveryThreshold,
      },
      signalsAvailable: assessment.signalsAvailable,
      reasons: assessment.reasons,
    };

    const line = `${JSON.stringify(logRecord)}\n`;
    const write = async () => {
      try {
        const targetPath = this.transitionLogPath!;
        await mkdir(dirname(targetPath), { recursive: true });
        await appendFile(targetPath, line, "utf8");
      } catch (error) {
        this.logger.warn("Failed to write risk transition log", {
          error: toErrorPayload(error),
        });
      }
    };

    this.pendingLogWrite = (this.pendingLogWrite ?? Promise.resolve()).then(
      write,
    );
  }
}

export { RiskStateMachine } from "./state-machine";
export { RiskEvaluator } from "./risk-evaluator";

export type {
  RiskDetectionConfig,
  RiskConfigOverrides,
} from "../config/detection-config";

export type { Calibration } from "../scoring/calculator";
export type { MetricValues } from "../../shared/types/metrics";
