import { Command, Option } from 'commander';
import { setTimeout as delay } from 'node:timers/promises';

import { DEFAULTS, discoverDevices, readDevices, shutdownBluetooth, type BluetoothBackendName, type ReadOptions } from './index.js';

type Logger = (message: string) => void;

interface GlobalCliOptions {
  bluetooth: BluetoothBackendName;
  namePrefix: string;
  serviceUuid?: string;
  listenMs: string;
  debug?: boolean;
}

interface ReadCliOptions extends GlobalCliOptions {
  interval?: string;
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  installSignalCleanup();

  const program = new Command();
  program
    .name('ble-reader')
    .description('Discover BLE devices and read raw advertisement manufacturer data.')
    .showHelpAfterError();
  addSharedOptions(program);

  addSharedOptions(
    program
      .command('discover')
      .description('Discover BLE devices.')
  ).action(async (options: Partial<GlobalCliOptions>, command: Command) => {
    const globals = globalOptions(command, options);
    const result = await discoverDevices({
      bluetooth: globals.bluetooth,
      namePrefix: globals.namePrefix,
      scanServiceUuid: globals.serviceUuid || null,
      matchServiceUuid: globals.serviceUuid || null,
      logger: loggerFor(globals)
    });
    await writeJson(result);
  });

  addSharedOptions(
    program
      .command('read')
      .description('Read raw advertisement manufacturer data from one exact advertised device name, or all matching devices.')
      .argument('[deviceName]', 'exact advertised BLE device name')
      .option('--interval <seconds>', 'read repeatedly every N seconds')
  ).action(async (deviceName: string | undefined, options: Partial<ReadCliOptions>, command: Command) => {
    const globals = globalOptions(command, options);
    const intervalMs = parseIntervalMs(options.interval);
    if (intervalMs === null) {
      const result = await readDevices(toReadOptions(globals, deviceName));
      await writeJson(result);
      return;
    }

    await readAtInterval(globals, deviceName, intervalMs);
  });

  try {
    await program.parseAsync(argv, { from: 'user' });
  } finally {
    await shutdownBluetooth();
  }
}

export function parseIntervalMs(value: string | undefined): number | null {
  if (value === undefined) return null;
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error('--interval must be a number greater than 0 seconds.');
  return seconds * 1000;
}

export function parseListenMs(value: string | undefined): number {
  const ms = Number(value ?? DEFAULTS.listenMs);
  if (!Number.isFinite(ms) || ms < 0) throw new Error('--listen-ms must be a number greater than or equal to 0.');
  return ms;
}

export function toReadOptions(globals: GlobalCliOptions, deviceName?: string): ReadOptions {
  return {
    bluetooth: globals.bluetooth,
    namePrefix: globals.namePrefix,
    deviceName: deviceName || undefined,
    listenMs: parseListenMs(globals.listenMs),
    scanServiceUuid: globals.serviceUuid || null,
    matchServiceUuid: globals.serviceUuid || null,
    logger: loggerFor(globals)
  };
}

function addSharedOptions(command: Command): Command {
  return command
    .addOption(new Option('--bluetooth <backend>', 'Bluetooth backend').choices(['auto', 'bluez', 'noble']).default('auto'))
    .option('--name-prefix <prefix>', 'BLE advertised name prefix; empty matches all devices', DEFAULTS.namePrefix)
    .option('--service-uuid <uuid>', 'optional BLE service UUID used for discovery filtering')
    .option('--listen-ms <ms>', 'milliseconds to collect advertisements per read', String(DEFAULTS.listenMs))
    .option('--debug', 'print Bluetooth diagnostics to stderr');
}

function globalOptions(command: Command, options: Partial<GlobalCliOptions>): GlobalCliOptions {
  return {
    bluetooth: optionValue(command, options, 'bluetooth', 'auto'),
    namePrefix: optionValue(command, options, 'namePrefix', DEFAULTS.namePrefix),
    serviceUuid: optionValue(command, options, 'serviceUuid', ''),
    listenMs: optionValue(command, options, 'listenMs', String(DEFAULTS.listenMs)),
    debug: optionValue(command, options, 'debug', false)
  };
}

function optionValue<K extends keyof GlobalCliOptions>(command: Command, options: Partial<GlobalCliOptions>, name: K, fallback: NonNullable<GlobalCliOptions[K]>): NonNullable<GlobalCliOptions[K]> {
  const parentOptions = command.parent?.opts<Partial<GlobalCliOptions>>() || {};
  const localSource = command.getOptionValueSource(name);
  if (localSource === 'default' && parentOptions[name] !== undefined) return parentOptions[name] as NonNullable<GlobalCliOptions[K]>;
  return (options[name] ?? fallback) as NonNullable<GlobalCliOptions[K]>;
}

function loggerFor({ debug }: GlobalCliOptions): Logger {
  return debug ? (message) => process.stderr.write(`[ble-reader-debug] ${message}\n`) : () => {};
}

async function writeJson(value: unknown): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`, (error) => (error ? reject(error) : resolve()));
  });
}

async function readAtInterval(globals: GlobalCliOptions, deviceName: string | undefined, intervalMs: number): Promise<void> {
  while (true) {
    await writeJson(await readDevices(toReadOptions(globals, deviceName)));
    await delay(intervalMs);
  }
}

function installSignalCleanup(): void {
  let shuttingDown = false;
  const handler = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    await shutdownBluetooth();
    process.exit(130);
  };
  process.once('SIGINT', handler);
  process.once('SIGTERM', handler);
}
