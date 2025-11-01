type GuardrailDebugGlobal = {
  __POSELY_DEBUG_GUARDRAILS_VERBOSE__?: boolean;
};

export const setGuardrailDebugEnabled = (enabled: boolean): void => {
  (globalThis as GuardrailDebugGlobal).__POSELY_DEBUG_GUARDRAILS_VERBOSE__ =
    enabled;
};

export const isGuardrailDebugEnabled = (): boolean => {
  return (
    (globalThis as GuardrailDebugGlobal).__POSELY_DEBUG_GUARDRAILS_VERBOSE__ ===
    true
  );
};
