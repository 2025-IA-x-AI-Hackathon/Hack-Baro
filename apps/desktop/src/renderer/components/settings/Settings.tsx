import {
  Button,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  Checkbox,
  Slider,
} from "@heroui/react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { IPC_CHANNELS } from "../../../shared/ipcChannels";
import { getLogger } from "../../../shared/logger";

const logger = getLogger("settings", "renderer");

function Settings() {
  const { t } = useTranslation(["common"]);
  const [launchAtStartup, setLaunchAtStartup] = useState(false);
  const [sensitivity, setSensitivity] = useState(50);
  const [isLoading, setIsLoading] = useState(true);

  // Load initial settings on mount
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const { electron } = window;
        if (!electron?.ipcRenderer) {
          logger.error("IPC renderer not available");
          return;
        }

        // Get launch at startup setting
        const launchAtStartupValue = (await electron.ipcRenderer.invoke(
          IPC_CHANNELS.getSetting,
          "launchAtStartup",
        )) as string | undefined;
        if (launchAtStartupValue === "true") {
          setLaunchAtStartup(true);
        }

        // Get sensitivity setting
        const sensitivityValue = (await electron.ipcRenderer.invoke(
          IPC_CHANNELS.getSetting,
          "sensitivity",
        )) as string | undefined;
        if (sensitivityValue) {
          const parsedSensitivity = parseInt(String(sensitivityValue), 10);
          if (!Number.isNaN(parsedSensitivity)) {
            setSensitivity(parsedSensitivity);
          }
        }

        setIsLoading(false);
      } catch (error) {
        logger.error("Failed to load settings", {
          error: error instanceof Error ? error.message : String(error),
        });
        setIsLoading(false);
      }
    };

    loadSettings().catch((err) => {
      logger.error("Unexpected error loading settings", { error: err });
    });
  }, []);

  const handleLaunchAtStartupChange = useCallback(async (checked: boolean) => {
    try {
      const { electron } = window;
      if (!electron?.ipcRenderer) {
        logger.error("IPC renderer not available");
        return;
      }

      setLaunchAtStartup(checked);
      await electron.ipcRenderer.invoke(
        IPC_CHANNELS.setSetting,
        "launchAtStartup",
        checked ? "true" : "false",
      );
      logger.info(`Launch at startup setting saved: ${checked}`);
    } catch (error) {
      logger.error("Failed to save launch at startup setting", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }, []);

  const handleSensitivityChange = useCallback(async (value: number) => {
    try {
      const { electron } = window;
      if (!electron?.ipcRenderer) {
        logger.error("IPC renderer not available");
        return;
      }

      setSensitivity(value);
      await electron.ipcRenderer.invoke(
        IPC_CHANNELS.setSetting,
        "sensitivity",
        String(value),
      );
      logger.info(`Sensitivity setting saved: ${value}`);
    } catch (error) {
      logger.error("Failed to save sensitivity setting", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }, []);

  const handleReCalibrate = useCallback(async () => {
    try {
      const { electron } = window;
      if (!electron?.ipcRenderer) {
        logger.error("IPC renderer not available");
        return;
      }

      logger.info("Requesting re-calibration");
      await electron.ipcRenderer.invoke(IPC_CHANNELS.reCalibrate);
    } catch (error) {
      logger.error("Failed to trigger re-calibration", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }, []);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-amber-300 via-rose-500 to-indigo-700">
        <Card className="w-full max-w-md bg-white/10 backdrop-blur">
          <CardBody className="text-center text-white">
            <p>{t("settings.loading", "Loading settings...")}</p>
          </CardBody>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-amber-300 via-rose-500 to-indigo-700 px-4 py-12">
      <Card className="w-full max-w-md bg-white/10 backdrop-blur">
        <CardHeader className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold text-white">
            {t("settings.title", "Settings")}
          </h1>
          <p className="text-sm text-white/70">
            {t("settings.description", "Configure your Posely preferences")}
          </p>
        </CardHeader>
        <CardBody className="flex flex-col gap-6">
          <div className="flex flex-col gap-4">
            <Checkbox
              isSelected={launchAtStartup}
              onValueChange={(checked) => {
                handleLaunchAtStartupChange(checked).catch((err) => {
                  logger.error("Error in launch at startup handler", {
                    error: err,
                  });
                });
              }}
              classNames={{
                label: "text-white",
              }}
            >
              {t("settings.launchAtStartup", "Launch at startup")}
            </Checkbox>

            <div className="flex flex-col gap-2">
              <span className="text-sm text-white">
                {t("settings.sensitivity", "Sensitivity")}
              </span>
              <Slider
                value={sensitivity}
                onChange={(value) => {
                  if (typeof value === "number") {
                    handleSensitivityChange(value).catch((err) => {
                      logger.error("Error in sensitivity handler", {
                        error: err,
                      });
                    });
                  }
                }}
                minValue={0}
                maxValue={100}
                step={1}
                classNames={{
                  track: "bg-white/20",
                  filler: "bg-primary",
                  thumb: "bg-white",
                  label: "text-white",
                  value: "text-white",
                }}
                showTooltip
                getValue={(value) => {
                  if (typeof value === "number") {
                    return `${value}`;
                  }
                  return String(value);
                }}
              />
            </div>
          </div>
        </CardBody>
        <CardFooter className="flex justify-between">
          <Button
            color="primary"
            variant="bordered"
            onPress={() => {
              handleReCalibrate().catch((err) => {
                logger.error("Error in re-calibrate handler", { error: err });
              });
            }}
          >
            {t("settings.reCalibrate", "Re-calibrate Posture")}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}

export default Settings;
