import { parseNumericEnv } from "../env";
import type { GuardrailOverrides } from "../types/guardrails";

const buildGuardrailOverridesFromRecord = (
  source: Record<string, string | undefined>,
): GuardrailOverrides => {
  const read = (key: string, min: number, max: number): number | undefined => {
    const v = parseNumericEnv(source[key] ?? null, { min, max });
    return v === null ? undefined : v;
  };

  const yawEnter = read("POSELY_GUARDRAIL_YAW_ENTER_DEG", 0, 180);
  const yawExit = read("POSELY_GUARDRAIL_YAW_EXIT_DEG", 0, 180);
  const yawEnterSeconds = read("POSELY_GUARDRAIL_YAW_ENTER_SECONDS", 0, 10);
  const yawExitSeconds = read("POSELY_GUARDRAIL_YAW_EXIT_SECONDS", 0, 10);

  const rollEnter = read("POSELY_GUARDRAIL_ROLL_ENTER_DEG", 0, 180);
  const rollExit = read("POSELY_GUARDRAIL_ROLL_EXIT_DEG", 0, 180);
  const rollEnterSeconds = read("POSELY_GUARDRAIL_ROLL_ENTER_SECONDS", 0, 10);
  const rollExitSeconds = read("POSELY_GUARDRAIL_ROLL_EXIT_SECONDS", 0, 10);

  const faceThreshold = read("POSELY_GUARDRAIL_CONF_FACE_THRESHOLD", 0, 1);
  const poseThreshold = read("POSELY_GUARDRAIL_CONF_POSE_THRESHOLD", 0, 1);
  const confEnterSeconds = read("POSELY_GUARDRAIL_CONF_ENTER_SECONDS", 0, 10);
  const confExitSeconds = read("POSELY_GUARDRAIL_CONF_EXIT_SECONDS", 0, 10);

  const illumThreshold = read("POSELY_GUARDRAIL_ILLUM_THRESHOLD", 0, 1);
  const illumEnterSeconds = read("POSELY_GUARDRAIL_ILLUM_ENTER_SECONDS", 0, 10);
  const illumExitSeconds = read("POSELY_GUARDRAIL_ILLUM_EXIT_SECONDS", 0, 10);

  const overrides: GuardrailOverrides = {};
  if (
    yawEnter !== undefined ||
    yawExit !== undefined ||
    yawEnterSeconds !== undefined ||
    yawExitSeconds !== undefined
  ) {
    overrides.yaw = {
      enterThreshold: yawEnter,
      exitThreshold: yawExit,
      enterSeconds: yawEnterSeconds,
      exitSeconds: yawExitSeconds,
    };
  }
  if (
    rollEnter !== undefined ||
    rollExit !== undefined ||
    rollEnterSeconds !== undefined ||
    rollExitSeconds !== undefined
  ) {
    overrides.roll = {
      enterThreshold: rollEnter,
      exitThreshold: rollExit,
      enterSeconds: rollEnterSeconds,
      exitSeconds: rollExitSeconds,
    };
  }
  if (
    faceThreshold !== undefined ||
    poseThreshold !== undefined ||
    confEnterSeconds !== undefined ||
    confExitSeconds !== undefined
  ) {
    overrides.confidence = {
      faceThreshold,
      poseThreshold,
      enterSeconds: confEnterSeconds,
      exitSeconds: confExitSeconds,
    };
  }
  if (
    illumThreshold !== undefined ||
    illumEnterSeconds !== undefined ||
    illumExitSeconds !== undefined
  ) {
    overrides.illumination = {
      illuminationThreshold: illumThreshold,
      enterSeconds: illumEnterSeconds,
      exitSeconds: illumExitSeconds,
    };
  }

  return overrides;
};

export default buildGuardrailOverridesFromRecord;
