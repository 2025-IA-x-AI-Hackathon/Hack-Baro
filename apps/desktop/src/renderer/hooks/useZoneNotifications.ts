import { useCallback, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { getLogger } from "../../shared/logger";
import type { EngineTick } from "../../shared/types/engine-output";
import type { ScoreZone } from "../../shared/types/score";

type NotificationType = "red" | "yellowFromGreen" | "yellowDwell";

type NotificationScheduleState = {
  start: number | null;
  nextIndex: number;
};

type NotificationSchedules = Record<
  NotificationType,
  NotificationScheduleState
>;

const logger = getLogger("zone-notifications", "renderer");

const MINUTE_IN_MS = 60_000;

const RED_ZONE_SCHEDULE_MINUTES = [1, 3, 5, 7, 9, 11] as const;
const YELLOW_FROM_GREEN_SCHEDULE_MINUTES = [3, 5, 7, 9, 11] as const;
const YELLOW_DWELL_SCHEDULE_MINUTES = [5, 7, 9, 11] as const;

const createInitialSchedules = (): NotificationSchedules => ({
  red: { start: null, nextIndex: 0 },
  yellowFromGreen: { start: null, nextIndex: 0 },
  yellowDwell: { start: null, nextIndex: 0 },
});

const isNotificationSupported = (): boolean =>
  typeof window !== "undefined" && "Notification" in window;

const ensurePermission = async (): Promise<NotificationPermission> => {
  if (!isNotificationSupported()) {
    return "denied";
  }

  const currentPermission = Notification.permission;
  if (currentPermission !== "default") {
    return currentPermission;
  }

  try {
    return await Notification.requestPermission();
  } catch (error) {
    logger.warn("Requesting notification permission failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return Notification.permission;
  }
};

export const useZoneNotifications = (engineTick: EngineTick | null): void => {
  const { t } = useTranslation();

  const permissionRef = useRef<NotificationPermission>(
    isNotificationSupported() ? Notification.permission : "denied",
  );
  const schedulesRef = useRef<NotificationSchedules>(createInitialSchedules());
  const lastZoneRef = useRef<ScoreZone | null>(null);

  const formatDuration = useCallback(
    (minutes: number): string => {
      if (minutes === 1) {
        return t("notifications.duration.single", { minutes });
      }
      return t("notifications.duration.plural", { minutes });
    },
    [t],
  );

  const notify = useCallback(
    (type: NotificationType, minutes: number): boolean => {
      if (!isNotificationSupported()) {
        return false;
      }
      if (permissionRef.current === "default") {
        void ensurePermission().then((value) => {
          permissionRef.current = value;
        });
        return false;
      }
      if (permissionRef.current !== "granted") {
        return false;
      }

      const titles: Record<NotificationType, string> = {
        red: t("notifications.titles.red"),
        yellowFromGreen: t("notifications.titles.yellow"),
        yellowDwell: t("notifications.titles.yellow"),
      };

      const bodies: Record<NotificationType, string> = {
        red: t("notifications.body.red", {
          duration: formatDuration(minutes),
        }),
        yellowFromGreen: t("notifications.body.yellowFromGreen", {
          duration: formatDuration(minutes),
        }),
        yellowDwell: t("notifications.body.yellow", {
          duration: formatDuration(minutes),
        }),
      };

      try {
        const notification = new Notification(titles[type], {
          body: bodies[type],
          silent: false,
        });

        notification.onclick = () => {
          window.focus?.();
        };

        return true;
      } catch (error) {
        logger.warn("Unable to show notification", {
          type,
          error: error instanceof Error ? error.message : String(error),
        });
        return false;
      }
    },
    [formatDuration, t],
  );

  useEffect(() => {
    if (!isNotificationSupported()) {
      return;
    }

    let isMounted = true;

    void ensurePermission().then((value) => {
      if (isMounted) {
        permissionRef.current = value;
      }
    });

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!engineTick) {
      return;
    }

    const { zone, t: tickTimestamp } = engineTick;
    const timestamp = Number.isFinite(tickTimestamp)
      ? tickTimestamp
      : Date.now();
    const previousZone = lastZoneRef.current;
    const schedules = schedulesRef.current;

    if (previousZone !== zone) {
      if (zone === "RED") {
        schedules.red = { start: timestamp, nextIndex: 0 };
      } else if (previousZone === "RED") {
        schedules.red = { start: null, nextIndex: 0 };
      }

      if (zone === "YELLOW") {
        schedules.yellowDwell = { start: timestamp, nextIndex: 0 };
        if (previousZone === "GREEN") {
          schedules.yellowFromGreen = { start: timestamp, nextIndex: 0 };
        } else {
          schedules.yellowFromGreen = { start: null, nextIndex: 0 };
        }
      } else if (previousZone === "YELLOW") {
        schedules.yellowDwell = { start: null, nextIndex: 0 };
        schedules.yellowFromGreen = { start: null, nextIndex: 0 };
      } else {
        schedules.yellowFromGreen = { start: null, nextIndex: 0 };
      }
    }

    lastZoneRef.current = zone;

    const maybeTrigger = (
      type: NotificationType,
      start: number | null,
      nextIndex: number,
      scheduleMinutes: readonly number[],
    ) => {
      if (start === null) {
        return nextIndex;
      }

      if (nextIndex >= scheduleMinutes.length) {
        return nextIndex;
      }

      const minutes = scheduleMinutes[nextIndex];
      if (minutes === undefined) {
        return nextIndex;
      }

      const elapsed = timestamp - start;
      if (elapsed < minutes * MINUTE_IN_MS) {
        return nextIndex;
      }

      if (permissionRef.current === "default") {
        if (isNotificationSupported()) {
          permissionRef.current = Notification.permission;
        }
        if (permissionRef.current === "default") {
          return nextIndex;
        }
      }

      if (permissionRef.current !== "granted") {
        return nextIndex;
      }

      const delivered = notify(type, minutes);
      if (!delivered) {
        return nextIndex;
      }

      return nextIndex + 1;
    };

    schedules.red.nextIndex = maybeTrigger(
      "red",
      schedules.red.start,
      schedules.red.nextIndex,
      RED_ZONE_SCHEDULE_MINUTES,
    );

    if (zone === "YELLOW") {
      schedules.yellowFromGreen.nextIndex = maybeTrigger(
        "yellowFromGreen",
        schedules.yellowFromGreen.start,
        schedules.yellowFromGreen.nextIndex,
        YELLOW_FROM_GREEN_SCHEDULE_MINUTES,
      );

      schedules.yellowDwell.nextIndex = maybeTrigger(
        "yellowDwell",
        schedules.yellowDwell.start,
        schedules.yellowDwell.nextIndex,
        YELLOW_DWELL_SCHEDULE_MINUTES,
      );
    }
  }, [engineTick, notify]);
};
