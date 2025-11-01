import { parseBooleanFlag } from "../../shared/env";

export type RuntimePreferences = {
  preferContinuityCamera: boolean;
};

export const getRuntimePreferences = (
  search: string = window.location.search,
): RuntimePreferences => {
  try {
    const params = new URLSearchParams(search);
    const preferContinuityCamera = parseBooleanFlag(
      params.get("preferContinuityCamera"),
    );

    return {
      preferContinuityCamera,
    };
  } catch {
    return {
      preferContinuityCamera: false,
    };
  }
};

export const shouldPreferContinuityCamera = (
  search: string = window.location.search,
) => {
  return getRuntimePreferences(search).preferContinuityCamera;
};
