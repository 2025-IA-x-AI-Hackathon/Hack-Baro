export type RuntimePreferences = {
  preferContinuityCamera: boolean;
};

const parseBooleanFlag = (value: string | null): boolean => {
  if (!value) {
    return false;
  }

  const normalised = value.trim().toLowerCase();
  return normalised === "1" || normalised === "true";
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
