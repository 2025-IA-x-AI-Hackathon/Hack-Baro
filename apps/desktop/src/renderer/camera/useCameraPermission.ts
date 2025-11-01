import { useCallback, useEffect, useRef, useState } from "react";
import { IPC_CHANNELS } from "../../shared/ipcChannels";
import { getLogger } from "../../shared/logger";

type ElectronApi = Window["electron"];

export type CameraPermissionState =
  | "unknown"
  | "prompt"
  | "requesting"
  | "granted"
  | "denied"
  | "error";

export type UseCameraPermissionResult = {
  state: CameraPermissionState;
  error: string | null;
  requestPermission: () => Promise<void>;
  openSystemSettings: () => Promise<void>;
  refresh: () => Promise<void>;
};

const logger = getLogger("use-camera-permission", "renderer");

const CAMERA_PERMISSION_NAME = "camera" as PermissionName;

const isDomException = (value: unknown): value is DOMException => {
  return value instanceof DOMException;
};

export const useCameraPermission = (
  electron?: ElectronApi,
): UseCameraPermissionResult => {
  const [state, setState] = useState<CameraPermissionState>("unknown");
  const [error, setError] = useState<string | null>(null);

  const permissionStatusRef = useRef<PermissionStatus | null>(null);
  const previousStateRef = useRef<CameraPermissionState>("unknown");
  const errorRef = useRef<string | null>(null);

  const setPermissionState = useCallback(
    (nextState: CameraPermissionState, message: string | null = null) => {
      previousStateRef.current = nextState;
      errorRef.current = message;
      setState(nextState);
      setError(message);
    },
    [],
  );

  const updateFromPermission = useCallback(
    (status?: PermissionStatus | null) => {
      if (!status) {
        return;
      }

      const previous = previousStateRef.current;

      if (status.state === "granted") {
        setPermissionState("granted", null);
        return;
      }

      if (status.state === "denied") {
        const message =
          previous === "granted" ? "__revoked__" : errorRef.current;
        setPermissionState("denied", message ?? null);
        return;
      }

      setPermissionState("prompt", null);
    },
    [setPermissionState],
  );

  const refresh = useCallback(async () => {
    if (!navigator.mediaDevices) {
      setPermissionState(
        "error",
        "Camera access is not supported in this environment.",
      );
      return;
    }

    if (!navigator.permissions?.query) {
      // Permissions API not available; fall back to prompt state until user interacts.
      if (previousStateRef.current === "unknown") {
        setPermissionState("prompt", null);
      }
      return;
    }

    try {
      let permissionStatus = permissionStatusRef.current;
      if (!permissionStatus) {
        permissionStatus = await navigator.permissions.query({
          name: CAMERA_PERMISSION_NAME,
        });
        permissionStatusRef.current = permissionStatus;
        permissionStatus.onchange = () =>
          updateFromPermission(permissionStatus);
      }

      updateFromPermission(permissionStatus);
    } catch (err) {
      logger.error("Failed to query camera permission:", {
        error: err instanceof Error ? err.message : String(err),
      });
      if (previousStateRef.current === "unknown") {
        setPermissionState("prompt", null);
      }
    }
  }, [setPermissionState, updateFromPermission]);

  useEffect(() => {
    let isMounted = true;

    refresh();

    const handleDeviceChange = () => {
      if (!isMounted) {
        return;
      }
      refresh();
    };

    if (navigator.mediaDevices?.addEventListener) {
      navigator.mediaDevices.addEventListener(
        "devicechange",
        handleDeviceChange,
      );
    }

    return () => {
      isMounted = false;
      if (navigator.mediaDevices?.removeEventListener) {
        navigator.mediaDevices.removeEventListener(
          "devicechange",
          handleDeviceChange,
        );
      }
      const permissionStatus = permissionStatusRef.current;
      if (permissionStatus) {
        permissionStatus.onchange = null;
        permissionStatusRef.current = null;
      }
    };
  }, [refresh]);

  const requestPermission = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setPermissionState(
        "error",
        "Camera access is unavailable. Connect a camera or try again on a supported device.",
      );
      return;
    }

    setPermissionState("requesting", null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          frameRate: { ideal: 30, max: 30 },
        },
        audio: false,
      });

      stream.getTracks().forEach((track) => track.stop());
      setPermissionState("granted", null);
    } catch (err) {
      logger.error("Failed to get camera stream:", {
        error: err instanceof Error ? err.message : String(err),
      });
      if (isDomException(err)) {
        if (err.name === "NotAllowedError") {
          setPermissionState("denied", "__blocked__");
        } else if (err.name === "NotFoundError") {
          setPermissionState(
            "error",
            "No camera device was detected. Connect a camera and try again.",
          );
        } else {
          setPermissionState("error", err.message);
        }
      } else {
        setPermissionState(
          "error",
          "Failed to access the camera. Please try again.",
        );
      }
    } finally {
      refresh();
    }
  }, [refresh, setPermissionState]);

  const openSystemSettings = useCallback(async () => {
    try {
      await electron?.ipcRenderer?.invoke?.(
        IPC_CHANNELS.openCameraPrivacySettings,
      );
    } catch (err) {
      logger.error("Failed to query camera permission:", {
        error: err instanceof Error ? err.message : String(err),
      });
      setPermissionState(
        "error",
        "Unable to open system settings automatically. Please adjust camera permissions manually.",
      );
    }
  }, [electron, setPermissionState]);

  return {
    state,
    error,
    requestPermission,
    openSystemSettings,
    refresh,
  };
};
