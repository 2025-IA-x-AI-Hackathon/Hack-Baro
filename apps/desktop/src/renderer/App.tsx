import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  HeroUIProvider,
  Button,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  Code,
  Link,
} from '@heroui/react';

import icon from '../../assets/icon.svg';
import './styles/globals.css';
import { IPC_CHANNELS } from '../shared/ipcChannels';
import { getLogger } from '../shared/logger';
import { ExampleHeroUI } from './components/ExampleHeroUI';
import { OnboardingWizard } from './components/onboarding/OnboardingWizard';
import { LanguageSwitcher } from './components/LanguageSwitcher';

type ElectronApi = Window['electron'];

type IpcArgs = unknown[];

type MessageState = {
  value: string;
  isDefault: boolean;
};

const logger = getLogger('renderer-app', 'renderer');

const formatPayload = (payload: unknown): string => {
  if (payload === undefined) {
    return 'undefined';
  }
  if (payload === null) {
    return 'null';
  }
  if (typeof payload === 'string') {
    return payload;
  }
  if (typeof payload === 'object') {
    try {
      return JSON.stringify(payload, null, 2);
    } catch {
      return Object.prototype.toString.call(payload);
    }
  }

  if (
    typeof payload === 'number' ||
    typeof payload === 'boolean' ||
    typeof payload === 'bigint'
  ) {
    return String(payload);
  }

  if (typeof payload === 'symbol') {
    return payload.description ? `Symbol(${payload.description})` : 'Symbol()';
  }

  if (typeof payload === 'function') {
    return `Function(${payload.name ?? 'anonymous'})`;
  }

  return Object.prototype.toString.call(payload);
};

const createDefaultState = (value: string): MessageState => ({
  value,
  isDefault: true,
});

const markAsCustom = (value: string): MessageState => ({
  value,
  isDefault: false,
});

function IntegrationDashboard({ electron }: { electron: ElectronApi }) {
  const { t } = useTranslation(['common']);
  const channels = useMemo(() => electron.channels ?? IPC_CHANNELS, [electron]);
  const { ipcRenderer } = electron;

  const defaults = useMemo(
    () => ({
      waitingForPing: t('status.waitingForPing'),
      waitingForWorker: t('status.waitingForWorker'),
      workerBooting: t('status.workerBooting'),
      noWorkerResponse: t('status.noWorkerResponse'),
      noPayload: t('status.noPayload'),
      mainProcess: t('status.mainProcess'),
      workerStatus: t('status.workerStatus'),
      workerResponse: t('status.workerResponse'),
      title: t('app.title'),
      tagline: t('app.tagline'),
      pingMain: t('actions.pingMain'),
      pingWorker: t('actions.pingWorker'),
      documentationTitle: t('cards.documentation.title'),
      documentationBody: t('cards.documentation.body'),
      turborepoTitle: t('cards.turborepo.title'),
      turborepoBody: t('cards.turborepo.body'),
    }),
    [t],
  );

  const [mainResponse, setMainResponse] = useState<MessageState>(() =>
    createDefaultState(defaults.waitingForPing),
  );
  const [workerStatus, setWorkerStatus] = useState<MessageState>(() =>
    createDefaultState(defaults.workerBooting),
  );
  const [workerResponse, setWorkerResponse] = useState<MessageState>(() =>
    createDefaultState(defaults.noWorkerResponse),
  );

  useEffect(() => {
    setMainResponse((previous) =>
      previous.isDefault
        ? createDefaultState(defaults.waitingForPing)
        : previous,
    );
  }, [defaults.waitingForPing]);

  useEffect(() => {
    setWorkerStatus((previous) =>
      previous.isDefault
        ? createDefaultState(defaults.workerBooting)
        : previous,
    );
  }, [defaults.workerBooting]);

  useEffect(() => {
    setWorkerResponse((previous) =>
      previous.isDefault
        ? createDefaultState(defaults.noWorkerResponse)
        : previous,
    );
  }, [defaults.noWorkerResponse]);

  const formatIpcArgs = useCallback(
    (args: IpcArgs): string => {
      if (args.length === 0) {
        return defaults.noPayload;
      }
      if (args.length === 1) {
        return formatPayload(args[0]);
      }
      return formatPayload(args);
    },
    [defaults.noPayload],
  );

  useEffect(() => {
    const disposePing = ipcRenderer.on(
      channels.rendererPing,
      (...args: unknown[]) => {
        setMainResponse(markAsCustom(formatIpcArgs(args)));
      },
    );

    const disposeWorkerStatus = ipcRenderer.on(
      channels.workerStatus,
      (...args: unknown[]) => {
        setWorkerStatus(markAsCustom(formatIpcArgs(args)));
      },
    );

    const disposeWorkerResponse = ipcRenderer.on(
      channels.workerResponse,
      (...args: unknown[]) => {
        setWorkerResponse(markAsCustom(formatIpcArgs(args)));
      },
    );

    ipcRenderer.sendMessage(channels.workerRequest, {
      requestedAt: new Date().toISOString(),
      reason: 'initial-status-check',
    });

    return () => {
      disposePing?.();
      disposeWorkerStatus?.();
      disposeWorkerResponse?.();
    };
  }, [channels, formatIpcArgs, ipcRenderer]);

  const sendPing = useCallback(() => {
    setMainResponse(createDefaultState(defaults.waitingForPing));
    ipcRenderer.sendMessage(channels.rendererPing, {
      requestedAt: new Date().toISOString(),
      source: 'renderer',
    });
  }, [channels.rendererPing, defaults.waitingForPing, ipcRenderer]);

  const pingWorker = useCallback(() => {
    setWorkerResponse(createDefaultState(defaults.waitingForWorker));
    ipcRenderer.sendMessage(channels.workerRequest, {
      requestedAt: new Date().toISOString(),
      source: 'renderer',
    });
  }, [channels.workerRequest, defaults.waitingForWorker, ipcRenderer]);

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-6 rounded-3xl bg-white/10 p-8 text-left shadow-2xl backdrop-blur">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-1 items-center gap-6">
            <img
              alt="Posely icon"
              className="h-20 w-20 rounded-2xl border border-white/40 shadow-xl"
              src={icon}
            />
            <div>
              <h1 className="text-3xl font-semibold text-white md:text-4xl">
                {defaults.title}
              </h1>
              <p className="mt-2 max-w-2xl text-base text-white/85 md:text-lg">
                {defaults.tagline}
              </p>
            </div>
          </div>
          <LanguageSwitcher />
        </div>
        <div className="flex flex-wrap gap-3">
          <Button color="primary" size="lg" onPress={sendPing}>
            {defaults.pingMain}
          </Button>
          <Button
            color="secondary"
            size="lg"
            variant="bordered"
            onPress={pingWorker}
          >
            {defaults.pingWorker}
          </Button>
        </div>
      </header>

      <section className="flex justify-center">
        <OnboardingWizard />
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <Card className="bg-black/30 text-left backdrop-blur-lg">
          <CardHeader className="flex flex-col gap-1 text-white">
            <span className="text-sm uppercase tracking-wide text-white/60">
              {defaults.mainProcess}
            </span>
            <h2 className="text-lg font-semibold text-white">Main Process</h2>
          </CardHeader>
          <CardBody>
            <Code className="whitespace-pre-wrap break-words text-sm">
              {mainResponse.value}
            </Code>
          </CardBody>
        </Card>
        <Card className="bg-black/30 text-left backdrop-blur-lg">
          <CardHeader className="flex flex-col gap-1 text-white">
            <span className="text-sm uppercase tracking-wide text-white/60">
              {defaults.workerStatus}
            </span>
            <h2 className="text-lg font-semibold text-white">Worker Status</h2>
          </CardHeader>
          <CardBody>
            <Code className="whitespace-pre-wrap break-words text-sm">
              {workerStatus.value}
            </Code>
          </CardBody>
        </Card>
        <Card className="bg-black/30 text-left backdrop-blur-lg">
          <CardHeader className="flex flex-col gap-1 text-white">
            <span className="text-sm uppercase tracking-wide text-white/60">
              {defaults.workerResponse}
            </span>
            <h2 className="text-lg font-semibold text-white">
              Worker Response
            </h2>
          </CardHeader>
          <CardBody>
            <Code className="whitespace-pre-wrap break-words text-sm">
              {workerResponse.value}
            </Code>
          </CardBody>
        </Card>
      </section>

      <ExampleHeroUI onPingMain={sendPing} onPingWorker={pingWorker} />

      <section className="grid gap-4 md:grid-cols-2">
        <Card className="bg-white/10 backdrop-blur text-left">
          <CardHeader className="flex items-start justify-between gap-4">
            <h3 className="text-xl font-semibold text-white">
              {defaults.documentationTitle}
            </h3>
            <Link
              color="primary"
              href="https://electron-react-boilerplate.js.org/"
              isExternal
              underline="always"
            >
              Docs
            </Link>
          </CardHeader>
          <CardBody className="text-sm text-white/80">
            {defaults.documentationBody}
          </CardBody>
          <CardFooter className="text-xs text-white/60">
            Explore Electron React Boilerplate resources.
          </CardFooter>
        </Card>
        <Card className="bg-white/10 backdrop-blur text-left">
          <CardHeader className="flex items-start justify-between gap-4">
            <h3 className="text-xl font-semibold text-white">
              {defaults.turborepoTitle}
            </h3>
            <Link
              color="primary"
              href="https://turborepo.org/docs"
              isExternal
              underline="always"
            >
              Turborepo
            </Link>
          </CardHeader>
          <CardBody className="text-sm text-white/80">
            {defaults.turborepoBody}
          </CardBody>
          <CardFooter className="text-xs text-white/60">
            Learn how Turborepo powers the build pipeline.
          </CardFooter>
        </Card>
      </section>

      <Card>
        <CardHeader>
          <h2 className="text-lg font-bold">
            {t('cards.documentation.title')}
          </h2>
        </CardHeader>
        <CardBody>
          <p>{defaults.documentationBody}</p>
        </CardBody>
        <CardFooter>
          <Link
            href="https://www.electronjs.org/docs/latest/"
            target="_blank"
            aria-label="Electron"
          >
            {t('actions.getStarted')}
          </Link>
        </CardFooter>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="text-lg font-bold">
            {t('cards.errorMonitoring.title', 'Error Monitoring (Live Sentry)')}
          </h2>
        </CardHeader>
        <CardBody>
          <p>
            {t(
              'cards.errorMonitoring.body',
              'These actions raise real errors using your configured Sentry project. Use them to validate instrumentation across processes and clear the events afterwards.',
            )}
          </p>
        </CardBody>
        <CardFooter className="flex justify-end space-x-2">
          <Button
            color="danger"
            onClick={() => {
              throw new Error('Intentional Renderer Error');
            }}
          >
            {t('actions.triggerRendererError', 'Trigger Renderer Error')}
          </Button>
          <Button
            color="danger"
            onClick={() => {
              ipcRenderer
                .invoke(channels.TRIGGER_MAIN_ERROR)
                .catch((error: unknown) => {
                  logger.error(
                    'Failed to trigger main process error from renderer',
                    {
                      error:
                        error instanceof Error ? error.message : String(error),
                      stack: error instanceof Error ? error.stack : undefined,
                    },
                  );
                });
            }}
          >
            {t('actions.triggerMainError', 'Trigger Main Error')}
          </Button>
          <Button
            color="danger"
            onClick={() =>
              ipcRenderer.sendMessage(channels.TRIGGER_WORKER_ERROR)
            }
          >
            {t('actions.triggerWorkerError', 'Trigger Worker Error')}
          </Button>
        </CardFooter>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="text-lg font-bold">{defaults.turborepoTitle}</h2>
        </CardHeader>
        <CardBody>
          <p>{defaults.turborepoBody}</p>
        </CardBody>
        <CardFooter>
          <Link
            href="https://turborepo.org/docs"
            target="_blank"
            aria-label="Turborepo"
          >
            {t('actions.getStarted')}
          </Link>
        </CardFooter>
      </Card>
    </div>
  );
}

function Hello() {
  const { electron } = window;
  const { t } = useTranslation(['errors', 'common']);

  if (!electron) {
    return (
      <Card className="bg-white/10 p-10 text-center text-white backdrop-blur">
        <CardHeader className="flex flex-col gap-2 text-center">
          <h1 className="text-2xl font-semibold">
            {t('errors:ipc.unavailableTitle')}
          </h1>
        </CardHeader>
        <CardBody className="text-base text-white/80">
          {t('errors:ipc.unavailableDescription')}
        </CardBody>
      </Card>
    );
  }

  return <IntegrationDashboard electron={electron} />;
}

export default function App() {
  return (
    <HeroUIProvider>
      <div className="min-h-screen bg-gradient-to-br from-amber-300 via-rose-500 to-indigo-700 py-12 px-4 text-white md:px-8">
        <div className="mx-auto w-full max-w-5xl">
          <Hello />
        </div>
      </div>
    </HeroUIProvider>
  );
}
