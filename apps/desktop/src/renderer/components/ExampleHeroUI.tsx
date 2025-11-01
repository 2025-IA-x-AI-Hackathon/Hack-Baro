/* eslint-disable import/prefer-default-export */
import { useState } from 'react';
import { Button, Card, Input } from '@heroui/react';

type ExampleHeroUIProps = {
  onPingMain: () => void;
  onPingWorker: () => void;
};

export function ExampleHeroUI({
  onPingMain,
  onPingWorker,
}: ExampleHeroUIProps) {
  const [name, setName] = useState('');

  return (
    <div className="mt-6 grid gap-4 md:grid-cols-2">
      <Card className="p-6" radius="lg" shadow="sm">
        <h2 className="text-xl font-semibold text-foreground">
          HeroUI Playground
        </h2>
        <p className="mt-1 text-sm text-default-500">
          These components are imported directly from HeroUI.
        </p>
        <div className="mt-4 flex flex-col gap-3">
          <Input
            label="Developer name"
            placeholder="Add your name"
            value={name}
            onValueChange={setName}
            variant="bordered"
            classNames={{
              label: 'font-medium text-default-600',
            }}
          />
          <div className="flex flex-wrap gap-3">
            <Button color="primary" onPress={onPingMain}>
              Ping Main
            </Button>
            <Button color="secondary" variant="bordered" onPress={onPingWorker}>
              Ping Worker
            </Button>
            <Button
              color="success"
              variant="flat"
              isDisabled={!name.length}
              onPress={() => setName('')}
            >
              Clear Name
            </Button>
          </div>
        </div>
      </Card>
      <Card className="p-6 md:h-full" radius="lg" shadow="sm">
        <h2 className="text-xl font-semibold text-foreground">
          Current Settings
        </h2>
        <dl className="mt-4 space-y-2 text-sm text-default-600">
          <div className="flex justify-between">
            <dt>Developer</dt>
            <dd className="font-medium text-foreground">
              {name || 'Anonymous'}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt>HeroUI Loaded</dt>
            <dd className="font-medium text-success">Yes</dd>
          </div>
          <div className="flex justify-between">
            <dt>Actions</dt>
            <dd className="font-medium text-default-500">
              Ping main or worker to send messages
            </dd>
          </div>
        </dl>
      </Card>
    </div>
  );
}
