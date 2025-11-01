import { clamp } from "../env";

export type CpuUsage = {
  user: number;
  system: number;
};

export type CpuSample = {
  instant: number;
  average: number;
};

type Clock = () => number;

type UsageProvider = () => CpuUsage;

type CpuMonitorOptions = {
  clock?: Clock;
  usageProvider?: UsageProvider;
  cpuCount?: number;
  maxSamples?: number;
};

const MICROSECONDS_IN_MILLISECOND = 1000;
const DEFAULT_CPU_COUNT = 4;
const ZERO_CPU_USAGE: CpuUsage = {
  user: 0,
  system: 0,
};

const normalizeCpuCount = (value: unknown): number | null => {
  if (value === null || value === undefined) {
    return null;
  }

  const numeric = Number(value);

  if (!Number.isFinite(numeric) || numeric <= 0) {
    return null;
  }

  return Math.max(1, Math.floor(numeric));
};

const detectCpuCount = (override?: number): number => {
  const explicit = normalizeCpuCount(override);
  if (explicit) {
    return explicit;
  }

  if (
    typeof navigator !== "undefined" &&
    typeof navigator.hardwareConcurrency === "number"
  ) {
    const fromNavigator = normalizeCpuCount(navigator.hardwareConcurrency);
    if (fromNavigator) {
      return fromNavigator;
    }
  }

  if (typeof process !== "undefined") {
    const fromEnv =
      normalizeCpuCount(process.env?.NUMBER_OF_PROCESSORS) ??
      normalizeCpuCount(process.env?.NUM_CPUS);
    if (fromEnv) {
      return fromEnv;
    }
  }

  return DEFAULT_CPU_COUNT;
};

const createDefaultUsageProvider = (): UsageProvider => {
  if (
    typeof process !== "undefined" &&
    typeof process.cpuUsage === "function"
  ) {
    return () => process.cpuUsage();
  }

  return () => ZERO_CPU_USAGE;
};

export class CpuMonitor {
  private readonly clock: Clock;

  private readonly usageProvider: UsageProvider;

  private readonly cpuCount: number;

  // Maximum number of samples to retain for averaging
  // This helps to limit memory usage and keep the average responsive
  private readonly maxSamples: number;

  private lastUsage: CpuUsage;

  private lastSampleAt: number;

  private samples: Array<{ timestamp: number; value: number }> = [];

  constructor(options: CpuMonitorOptions = {}) {
    this.clock =
      options.clock ??
      (() =>
        typeof performance !== "undefined" ? performance.now() : Date.now());
    this.usageProvider = options.usageProvider ?? createDefaultUsageProvider();
    this.cpuCount = detectCpuCount(options.cpuCount);
    this.maxSamples = Math.max(options.maxSamples ?? 10, 1);

    this.lastUsage = this.usageProvider();
    this.lastSampleAt = this.clock();
  }

  sample(now = this.clock()): CpuSample {
    const currentUsage = this.usageProvider();
    const deltaUser = currentUsage.user - this.lastUsage.user;
    const deltaSystem = currentUsage.system - this.lastUsage.system;
    this.lastUsage = currentUsage;

    const elapsedMs = Math.max(now - this.lastSampleAt, 1);
    this.lastSampleAt = now;

    const totalMicros = Math.max(deltaUser + deltaSystem, 0);
    const utilization =
      (totalMicros / MICROSECONDS_IN_MILLISECOND / elapsedMs / this.cpuCount) *
      100;
    const instant = clamp(utilization, 0, 100);

    this.samples.push({ timestamp: now, value: instant });
    if (this.samples.length > this.maxSamples) {
      this.samples.splice(0, this.samples.length - this.maxSamples);
    }

    const average = this.computeAverage();
    return { instant, average } satisfies CpuSample;
  }

  getAverage(): number {
    return this.computeAverage();
  }

  clear(): void {
    this.samples = [];
    this.lastUsage = this.usageProvider();
    this.lastSampleAt = this.clock();
  }

  private computeAverage(): number {
    if (this.samples.length === 0) {
      return 0;
    }
    const total = this.samples.reduce((sum, sample) => sum + sample.value, 0);
    return clamp(total / this.samples.length, 0, 100);
  }
}

export default CpuMonitor;
