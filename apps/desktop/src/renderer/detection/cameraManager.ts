import { getLogger } from "../../shared/logger";
import { getRuntimePreferences } from "../config/runtimePreferences";

const logger = getLogger("camera-manager", "renderer");

export type CameraInitOptions = {
  idealWidth?: number;
  idealHeight?: number;
  idealFrameRate?: number;
  // Prefer Continuity Camera on macOS when available
  // If not provided, defaults to value from URL param `?preferContinuityCamera=1`.
  preferContinuity?: boolean;
  // Explicit deviceId override (takes precedence over preferContinuity)
  deviceId?: string;
};

export class CameraManager {
  private stream: MediaStream | null = null;

  private videoElement: HTMLVideoElement | null = null;

  private isReady = false;

  private previewVisible = false;

  async initialise({
    idealWidth = 640,
    idealHeight = 480,
    idealFrameRate = 30,
    preferContinuity,
    deviceId,
  }: CameraInitOptions = {}): Promise<HTMLVideoElement> {
    if (this.videoElement) {
      return this.videoElement;
    }
    const videoConstraints: MediaTrackConstraints = {};
    videoConstraints.width = { ideal: idealWidth };
    videoConstraints.height = { ideal: idealHeight };
    videoConstraints.frameRate = {
      ideal: idealFrameRate,
      max: idealFrameRate,
    };

    if (deviceId) {
      videoConstraints.deviceId = { exact: deviceId };
    } else {
      videoConstraints.facingMode = "user";
    }

    const constraints: MediaStreamConstraints = {
      video: videoConstraints,
      audio: false,
    };

    logger.info(
      "Requesting camera access",
      constraints.video as Record<string, unknown>,
    );

    try {
      this.stream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch (error) {
      logger.error("Camera access failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }

    const video = document.createElement("video");
    video.autoplay = true;
    video.muted = true;
    video.playsInline = true;
    video.srcObject = this.stream;
    video.style.position = "fixed";
    video.style.opacity = "0";
    video.style.pointerEvents = "none";
    video.style.width = `${idealWidth}px`;
    video.style.height = `${idealHeight}px`;
    document.body.appendChild(video);

    await new Promise<void>((resolve) => {
      const readyHandler = () => {
        video.removeEventListener("loadedmetadata", readyHandler);
        video.play().catch((playError) => {
          logger.warn("Failed to auto-play camera stream", {
            error:
              playError instanceof Error
                ? playError.message
                : String(playError),
          });
        });
        this.isReady = true;
        resolve();
      };

      if (video.readyState >= HTMLMediaElement.HAVE_METADATA) {
        readyHandler();
        return;
      }

      video.addEventListener("loadedmetadata", readyHandler, {
        once: true,
      });
    });

    this.videoElement = video;
    logger.info("Camera stream initialized", {
      width: video.videoWidth,
      height: video.videoHeight,
      frameRate: idealFrameRate,
    });

    this.applyPreviewVisibility();

    // Optionally switch to Continuity Camera if available and preferred
    const preferContinuityEffective =
      typeof preferContinuity === "boolean"
        ? preferContinuity
        : getRuntimePreferences().preferContinuityCamera;

    if (!deviceId && preferContinuityEffective) {
      try {
        await this.trySwitchToContinuity(
          idealWidth,
          idealHeight,
          idealFrameRate,
        );
      } catch (e) {
        logger.warn(
          "Continuity Camera preference failed, keeping current device",
          {
            error: e instanceof Error ? e.message : String(e),
          },
        );
      }
    }

    return video;
  }

  async captureFrame(): Promise<ImageBitmap> {
    if (!this.videoElement || !this.isReady) {
      throw new Error("Camera is not initialized");
    }

    return createImageBitmap(this.videoElement);
  }

  getVideoElement(): HTMLVideoElement | null {
    return this.videoElement;
  }

  getStream(): MediaStream | null {
    return this.stream;
  }

  dispose(): void {
    if (this.videoElement) {
      this.videoElement.pause();
      this.videoElement.srcObject = null;
      if (this.videoElement.parentElement) {
        this.videoElement.parentElement.removeChild(this.videoElement);
      }
      this.videoElement = null;
    }

    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }

    this.isReady = false;
    this.previewVisible = false;
  }

  setPreviewVisibility(visible: boolean): void {
    this.previewVisible = visible;
    this.applyPreviewVisibility();
  }

  private applyPreviewVisibility(): void {
    const video = this.videoElement;
    if (!video) {
      return;
    }

    if (this.previewVisible) {
      video.style.opacity = "1";
      video.style.pointerEvents = "none";
      video.style.bottom = "16px";
      video.style.right = "16px";
      video.style.top = "";
      video.style.left = "";
      video.style.zIndex = "9998";
      video.style.maxWidth = "360px";
      video.style.maxHeight = "240px";
      video.style.width = "320px";
      video.style.height = "240px";
      video.style.borderRadius = "12px";
      video.style.border = "2px solid rgba(255, 255, 255, 0.4)";
      video.style.boxShadow = "0 12px 24px rgba(0, 0, 0, 0.35)";
      video.style.backgroundColor = "#000";
    } else {
      video.style.opacity = "0";
      video.style.pointerEvents = "none";
      video.style.border = "";
      video.style.boxShadow = "";
      video.style.width = "";
      video.style.height = "";
    }
  }

  private async trySwitchToContinuity(
    idealWidth: number,
    idealHeight: number,
    idealFrameRate: number,
  ): Promise<void> {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
      return;
    }

    const devices = await navigator.mediaDevices.enumerateDevices();
    const videoInputs = devices.filter((d) => d.kind === "videoinput");

    const ccCandidate = videoInputs.find((d) =>
      /continuity|iphone/i.test(d.label),
    );
    if (!ccCandidate) {
      return;
    }

    // If current device already matches, do nothing
    const currentTrack = this.stream?.getVideoTracks()[0];
    const currentDeviceId = currentTrack?.getSettings().deviceId;
    if (currentDeviceId && currentDeviceId === ccCandidate.deviceId) {
      logger.info("Already using Continuity Camera", {
        deviceId: currentDeviceId,
      });
      return;
    }

    logger.info("Switching to Continuity Camera", {
      label: ccCandidate.label,
      deviceId: ccCandidate.deviceId,
    });

    // Request a new stream with the Continuity device
    const newStream = await navigator.mediaDevices.getUserMedia({
      video: {
        deviceId: { exact: ccCandidate.deviceId },
        width: { ideal: idealWidth },
        height: { ideal: idealHeight },
        frameRate: { ideal: idealFrameRate, max: idealFrameRate },
      },
      audio: false,
    });

    // Swap streams
    const oldStream = this.stream;
    this.stream = newStream;
    if (this.videoElement) {
      this.videoElement.srcObject = newStream;
      await new Promise<void>((resolve) => {
        const ready = () => {
          this.videoElement?.removeEventListener("loadedmetadata", ready);
          this.videoElement?.play().catch(() => {
            /* ignore */
          });
          resolve();
        };
        this.videoElement?.addEventListener("loadedmetadata", ready, {
          once: true,
        });
      });
    }

    // Stop old tracks to free camera
    oldStream?.getTracks().forEach((t) => {
      try {
        t.stop();
      } catch {
        /* ignore */
      }
    });
  }
}
