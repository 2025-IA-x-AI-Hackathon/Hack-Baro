import {
  Button,
  Card,
  CardBody,
  CardHeader,
  Checkbox,
  Slider,
} from "@heroui/react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { IPC_CHANNELS } from "../../../shared/ipcChannels";
import { getLogger } from "../../../shared/logger";

const logger = getLogger("settings-component", "renderer");

const toErrorPayload = (error: unknown) => ({
  error: error instanceof Error ? error.message : String(error),
  stack: error instanceof Error ? error.stack : undefined,
});

export function Settings() {
  const { t } = useTranslation(["common"]);
  const [electron, setElectron] = useState<typeof window.electron | null>(null);

  const [launchAtStartup, setLaunchAtStartup] = useState(false);
  const [sensitivity, setSensitivity] = useState(50);
  const [isLoading, setIsLoading] = useState(true);
  const [electronCheckAttempts, setElectronCheckAttempts] = useState(0);

  // Wait for electron to be available with retry logic
  useEffect(() => {
    const maxAttempts = 50; // 50 * 100ms = 5 seconds max
    
    const checkElectron = () => {
      if (window.electron) {
        logger.info("Electron API found", { attempts: electronCheckAttempts + 1 });
        setElectron(window.electron);
        setIsLoading(false);
        return true;
      }
      return false;
    };

    // Check immediately
    if (checkElectron()) {
      return;
    }

    // Check repeatedly
    const interval = setInterval(() => {
      if (checkElectron()) {
        clearInterval(interval);
        return;
      }

      setElectronCheckAttempts(prev => {
        const newAttempts = prev + 1;
        if (newAttempts >= maxAttempts) {
          logger.error("Electron API not available after max attempts", { 
            attempts: newAttempts,
            windowElectron: typeof window.electron
          });
          setIsLoading(false);
          clearInterval(interval);
        }
        return newAttempts;
      });
    }, 100);

    return () => clearInterval(interval);
  }, [electronCheckAttempts]);

  // Fetch initial settings on mount
  useEffect(() => {
    if (!electron) {
      return;
    }

    const fetchSettings = async () => {
      try {
        setIsLoading(true);

        // Fetch launch at startup setting
        const launchResult = await electron.ipcRenderer.invoke(
          IPC_CHANNELS.getSetting,
          "launchAtStartup",
        );
        if (launchResult === "true") {
          setLaunchAtStartup(true);
        }

        // Fetch sensitivity setting
        const sensitivityResult = await electron.ipcRenderer.invoke(
          IPC_CHANNELS.getSetting,
          "sensitivity",
        );
        if (sensitivityResult) {
          const parsedSensitivity = parseInt(sensitivityResult, 10);
          if (!isNaN(parsedSensitivity)) {
            setSensitivity(parsedSensitivity);
          }
        }

        logger.info("Settings loaded successfully", {
          launchAtStartup: launchResult,
          sensitivity: sensitivityResult,
        });
      } catch (error) {
        logger.error("Failed to load settings", toErrorPayload(error));
      } finally {
        setIsLoading(false);
      }
    };

    fetchSettings();
  }, [electron]);

  // Handle launch at startup toggle
  const handleLaunchAtStartupChange = async (checked: boolean) => {
    if (!electron) return;
    
    try {
      setLaunchAtStartup(checked);
      await electron.ipcRenderer.invoke(
        IPC_CHANNELS.setSetting,
        "launchAtStartup",
        String(checked),
      );
      logger.info("Launch at startup setting updated", { value: checked });
    } catch (error) {
      logger.error(
        "Failed to update launch at startup setting",
        toErrorPayload(error),
      );
      // Revert on error
      setLaunchAtStartup(!checked);
    }
  };

  // Handle sensitivity slider change
  const handleSensitivityChange = async (value: number | number[]) => {
    if (!electron) return;
    
    const newValue = Array.isArray(value) ? value[0] : value;
    if (newValue === undefined) return;
    
    try {
      setSensitivity(newValue);
      await electron.ipcRenderer.invoke(
        IPC_CHANNELS.setSetting,
        "sensitivity",
        String(newValue),
      );
      logger.info("Sensitivity setting updated", { value: newValue });
    } catch (error) {
      logger.error("Failed to update sensitivity setting", toErrorPayload(error));
    }
  };

  // Handle re-calibrate button click
  const handleReCalibrate = async () => {
    if (!electron) return;
    
    try {
      logger.info("Re-calibration requested");
      await electron.ipcRenderer.invoke(IPC_CHANNELS.reCalibrate);
    } catch (error) {
      logger.error("Failed to trigger re-calibration", toErrorPayload(error));
    }
  };

  if (!electron) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100">
        <Card className="w-full max-w-md">
          <CardBody className="py-8 text-center">
            <p className="text-red-600">Electron API not available</p>
          </CardBody>
        </Card>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100">
        <Card className="w-full max-w-md">
          <CardBody className="py-8 text-center">
            <p className="text-slate-600">Loading settings...</p>
          </CardBody>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-8">
      <div className="mx-auto w-full max-w-2xl">
        <Card className="shadow-lg">
          <CardHeader className="flex flex-col gap-2 border-b border-slate-200 bg-white px-6 py-4">
            <h1 className="text-2xl font-semibold text-slate-800">
              {t("settings.title", "Settings")}
            </h1>
            <p className="text-sm text-slate-600">
              {t(
                "settings.description",
                "Configure your application preferences",
              )}
            </p>
          </CardHeader>

          <CardBody className="space-y-6 bg-white px-6 py-6">
            {/* Launch at Startup */}
            <div className="space-y-2">
              <Checkbox
                isSelected={launchAtStartup}
                onValueChange={handleLaunchAtStartupChange}
                classNames={{
                  label: "text-slate-700 font-medium",
                }}
              >
                {t("settings.launchAtStartup", "Launch at startup")}
              </Checkbox>
              <p className="pl-7 text-sm text-slate-500">
                {t(
                  "settings.launchAtStartupDescription",
                  "Automatically start the application when you log in",
                )}
              </p>
            </div>

            {/* Sensitivity Slider */}
            <div className="space-y-3">
              <label className="block text-sm font-medium text-slate-700">
                {t("settings.sensitivity", "Sensitivity")}
              </label>
              <Slider
                size="sm"
                step={1}
                minValue={0}
                maxValue={100}
                value={sensitivity}
                onChange={handleSensitivityChange}
                className="max-w-full"
                classNames={{
                  track: "bg-slate-200",
                  filler: "bg-blue-500",
                  thumb: "bg-white border-2 border-blue-500",
                }}
              />
              <div className="flex justify-between text-xs text-slate-500">
                <span>{t("settings.sensitivityLow", "Low")}</span>
                <span className="font-medium text-slate-700">{sensitivity}</span>
                <span>{t("settings.sensitivityHigh", "High")}</span>
              </div>
              <p className="text-sm text-slate-500">
                {t(
                  "settings.sensitivityDescription",
                  "Adjust how sensitive the posture detection should be",
                )}
              </p>
            </div>

            {/* Re-calibrate Button */}
            <div className="space-y-3 border-t border-slate-200 pt-6">
              <h3 className="text-sm font-medium text-slate-700">
                {t("settings.calibration", "Calibration")}
              </h3>
              <p className="text-sm text-slate-500">
                {t(
                  "settings.calibrationDescription",
                  "Re-calibrate your posture baseline if you've changed your desk setup",
                )}
              </p>
              <Button
                color="primary"
                variant="flat"
                onPress={handleReCalibrate}
                className="mt-2"
              >
                {t("settings.reCalibrate", "Re-calibrate Posture")}
              </Button>
            </div>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
