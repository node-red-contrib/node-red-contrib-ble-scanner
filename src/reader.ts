import { DEFAULTS } from './constants.js';
import { bluezBackend } from './ble/bluez.js';
import { nobleBackend } from './ble/noble.js';
import type {
  BleAdvertisement,
  BleDiscoveredDevice,
  BleReading,
  BluetoothBackend,
  BluetoothBackendName,
  DiscoverOptions,
  ReadOptions
} from './ble/backend.js';

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
  const bluetooth = options.bluetooth || 'auto';
  const backend = await selectBluetoothBackend(bluetooth, logger);
  const byDevice = new Map<string, BleReading>();

  try {
    await backend.scanAdvertisements({
      namePrefix: options.namePrefix ?? DEFAULTS.namePrefix,
      deviceName: options.deviceName || null,
      timeoutMs: options.timeoutMs || DEFAULTS.timeoutMs,
      listenMs: options.listenMs ?? DEFAULTS.listenMs,
      scanServiceUuid: options.scanServiceUuid ?? null,
      matchServiceUuid: options.matchServiceUuid ?? null,
      logger,
      onAdvertisement: (advertisement) => {
        const reading = readingForAdvertisement(byDevice, advertisement);
        reading.messages.push(advertisement.message);
        logger(
          `BLE manufacturer data ${advertisement.message.companyIdHex}:${advertisement.message.hex} ` +
            `(${advertisement.message.length} byte${advertisement.message.length === 1 ? '' : 's'}).`
        );
      }
    });
  } catch (error) {
    if (bluetooth === 'auto' && isBluetoothUnavailableError(error)) {
      logger(`No usable Bluetooth backend found: ${error instanceof Error ? error.message : String(error)}.`);
      return [];
    }
    throw error;
  }

  return [...byDevice.values()].sort((left, right) => displayReading(left).localeCompare(displayReading(right)));
}

export async function readDevice(device: BleDiscoveredDevice, options: ReadOptions = {}): Promise<BleReading> {
  const readings = await readDevices({
    ...options,
    bluetooth: device.backend,
    namePrefix: '',
    deviceName: device.name || undefined
  });
  const match = readings.find((reading) => sameDevice(reading.device, device));
  return (
    match || {
      device,
      timestamp: new Date().toISOString(),
      messages: []
    }
  );
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

function readingForAdvertisement(readings: Map<string, BleReading>, advertisement: BleAdvertisement): BleReading {
  const key = deviceKey(advertisement.device);
  const existing = readings.get(key);
  if (existing) {
    existing.device = advertisement.device;
    existing.timestamp = advertisement.message.timestamp;
    return existing;
  }

  const reading: BleReading = {
    device: advertisement.device,
    timestamp: advertisement.message.timestamp,
    messages: []
  };
  readings.set(key, reading);
  return reading;
}

function sameDevice(left: BleDiscoveredDevice, right: BleDiscoveredDevice): boolean {
  return (
    left.id === right.id ||
    (!!left.address && !!right.address && left.address.toLowerCase() === right.address.toLowerCase()) ||
    (!!left.name && !!right.name && left.name === right.name)
  );
}

function deviceKey(device: BleDiscoveredDevice): string {
  return device.address?.toLowerCase() || device.name || `${device.backend}:${device.id}`;
}

function displayReading(reading: BleReading): string {
  return reading.device.name || reading.device.address || reading.device.id;
}

function isBluetoothUnavailableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return message.includes('bluetooth adapter state is unsupported') || message.includes('no compatible bluetooth') || message.includes('not available on');
}
