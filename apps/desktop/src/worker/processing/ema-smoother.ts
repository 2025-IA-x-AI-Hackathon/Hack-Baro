const clamp = (value: number, min: number, max: number): number => {
  return Math.min(max, Math.max(min, value));
};

export default class EMASmoother {
  private value: number | null = null;

  update(sample: number, alpha: number): number {
    const clampedAlpha = clamp(alpha, 0, 1);
    if (this.value === null || !Number.isFinite(this.value)) {
      this.value = sample;
      return sample;
    }

    this.value += clampedAlpha * (sample - this.value);
    return this.value;
  }

  reset(): void {
    this.value = null;
  }

  getValue(): number | null {
    return this.value;
  }
}
