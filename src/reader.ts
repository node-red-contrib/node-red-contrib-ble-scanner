import { setTimeout as delay } from 'node:timers/promises';

import { DEFAULTS } from './constants.js';
import { bluezBackend } from './ble/bluez.js';
import { nobleBackend } from './ble/noble.js';
import { displayDevice, normalizeUuid } from './ble/utils.js';
import type {
  BleDiscoveredDevice,
  BleReading,
  BleSession,
  BluetoothBackend,
  BluetoothBackendName,
  DiscoverOptions,
  RawBleMessage,
  ReadOptions,
  ResolvedBluetoothBackendName
} from './ble/backend.js';

export interface BleReader {
  device: BleDiscoveredDevice;
  read(options?: ReadOptions): Promise<BleReading>;
  disconnect(): Promise<void>;
}

export async function discoverDevices(options: DiscoverOptions = {}): Promise<BleDiscoveredDevice[]> {
  const logger = options.logger || (() => {});
  const bluetooth = options.bluetooth || 'auto';
  const backend = await selectBluetoothBackend(bluetooth, logger);
  try {
    return await backend.discover({
      namePrefix: options.namePrefix ?? DEFAULTS.namePrefix,
      deviceName: options.deviceName || null,
      timeoutMs: options.timeoutMs || DEFAULTS.timeoutMs,
      scanServiceUuid: options.scanServiceUuid ?? null,
      matchServiceUuid: options.matchServiceUuid ?? null,
      logger
    });
  } catch (error) {
    if (bluetooth === 'auto' && isBluetoothUnavailableError(error)) {
      logger(`No usable Bluetooth backend found: ${error instanceof Error ? error.message : String(error)}.`);
      return [];
    }
    throw error;
  }
}

export async function readDevices(options: ReadOptions = {}): Promise<BleReading[]> {
  const logger = options.logger || (() => {});
  const devices = await discoverDevices({ ...options, logger });
  const readings: BleReading[] = [];

  for (const device of devices) {
    logger(`Reading raw BLE notifications from ${displayDevice(device)}.`);
    readings.push(await readDevice(device, { ...options, logger }));
  }

  return readings;
}

export async function readDevice(device: BleDiscoveredDevice, options: ReadOptions = {}): Promise<BleReading> {
  const reader = await connectDevice(device, options);
  try {
    return await reader.read(options);
  } finally {
    await reader.disconnect().catch(() => {});
  }
}

export async function connectReaders(options: ReadOptions = {}): Promise<BleReader[]> {
  const logger = options.logger || (() => {});
  const devices = await discoverDevices({ ...options, logger });
  const readers: BleReader[] = [];

  try {
    for (const device of devices) {
      logger(`Connecting ${displayDevice(device)}.`);
      readers.push(await connectDevice(device, { ...options, logger }));
    }
    return readers;
  } catch (error) {
    await Promise.all(readers.map((reader) => reader.disconnect().catch(() => {})));
    throw error;
  }
}

export async function connectDevice(device: BleDiscoveredDevice, options: ReadOptions = {}): Promise<BleReader> {
  const logger = options.logger || (() => {});
  const backend = backendForDevice(device);
  const notifyUuid = normalizeUuid(options.notifyUuid || DEFAULTS.notifyUuid);
  const session = await backend.connect({
    device,
    timeoutMs: options.timeoutMs || DEFAULTS.timeoutMs,
    connectTimeoutMs: options.connectTimeoutMs || DEFAULTS.connectTimeoutMs,
    notifyUuid,
    logger
  });

  let disconnected = false;

  return {
    device: session.device,
    read: (readOptions) => readSession(session, { ...options, ...readOptions, notifyUuid, logger }),
    disconnect: async () => {
      if (disconnected) return;
      disconnected = true;
      await session.disconnect();
    }
  };
}

export async function readSession(session: BleSession, options: ReadOptions = {}): Promise<BleReading> {
  const logger = options.logger || (() => {});
  const listenMs = options.listenMs ?? DEFAULTS.listenMs;
  const notifyUuid = normalizeUuid(options.notifyUuid || session.notify.uuid || DEFAULTS.notifyUuid);
  const messages: RawBleMessage[] = [];

  const onData = (data: Buffer) => {
    const raw = Buffer.from(data);
    const message: RawBleMessage = {
      timestamp: new Date().toISOString(),
      uuid: session.notify.uuid,
      length: raw.length,
      data: raw,
      hex: raw.toString('hex'),
      base64: raw.toString('base64'),
      bytes: [...raw]
    };
    logger(`BLE notification ${message.hex} (${message.length} byte${message.length === 1 ? '' : 's'}).`);
    messages.push(message);
  };

  session.notify.onData(onData);
  try {
    logger(`Listening for ${listenMs}ms on characteristic ${notifyUuid}.`);
    await delay(listenMs);
  } finally {
    session.notify.removeDataListener(onData);
  }

  return {
    device: session.device,
    timestamp: new Date().toISOString(),
    notifyUuid,
    messages
  };
}

export async function shutdownBluetooth(): Promise<void> {
  await Promise.all([nobleBackend.shutdown(), bluezBackend.shutdown()]);
}

async function selectBluetoothBackend(bluetooth: BluetoothBackendName, logger: (message: string) => void): Promise<BluetoothBackend> {
  if (bluetooth === 'bluez') return bluezBackend;
  if (bluetooth === 'noble') return nobleBackend;
  if (await bluezBackend.isAvailable(logger)) return bluezBackend;
  return nobleBackend;
}

function backendForDevice(device: BleDiscoveredDevice): BluetoothBackend {
  const backends: Record<ResolvedBluetoothBackendName, BluetoothBackend> = {
    bluez: bluezBackend,
    noble: nobleBackend
  };
  return backends[device.backend];
}

function isBluetoothUnavailableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return message.includes('bluetooth adapter state is unsupported') || message.includes('no compatible bluetooth') || message.includes('not available on');
}
