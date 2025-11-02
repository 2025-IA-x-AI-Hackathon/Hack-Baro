import { Card } from "@heroui/react";
import { useState } from "react";
import type { EngineTick } from "../../shared/types/engine-output";

type ExampleHeroUIProps = {
  onPingMain: () => void;
  onPingWorker: () => void;
  engineTick?: EngineTick | null;
};

export default function ExampleHeroUI({
  onPingMain,
  onPingWorker,
  engineTick = null,
}: ExampleHeroUIProps) {
  const [name, setName] = useState("");
  const postureSummary = engineTick
    ? `${engineTick.zone} • ${engineTick.score.toFixed(1)}`
    : "No engine data yet";
  const postureState = engineTick?.state ?? "—";

  return (
    <div className="mt-6 grid gap-4 md:grid-cols-2">
      <Card className="p-6 md:h-full" radius="lg" shadow="sm">
        <h2 className="text-foreground text-xl font-semibold">
          Current Settings
        </h2>
        <dl className="text-default-600 mt-4 space-y-2 text-sm">
          <div className="flex justify-between">
            <dt>Developer</dt>
            <dd className="text-foreground font-medium">
              {name || "Anonymous"}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt>HeroUI Loaded</dt>
            <dd className="text-success font-medium">Yes</dd>
          </div>
          <div className="flex justify-between">
            <dt>Actions</dt>
            <dd className="text-default-500 font-medium">
              Ping main or worker to send messages
            </dd>
          </div>
          <div className="flex justify-between">
            <dt>Engine Zone</dt>
            <dd className="text-foreground font-medium">{postureSummary}</dd>
          </div>
          <div className="flex justify-between">
            <dt>Engine State</dt>
            <dd className="text-default-500 font-medium">{postureState}</dd>
          </div>
        </dl>
      </Card>
    </div>
  );
}
