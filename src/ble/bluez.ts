import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';

import type {
  BleDiscoveredDevice,
  BluetoothBackend,
  Logger,
  ResolvedDiscoverOptions,
  ResolvedScanOptions
} from './backend.js';
import {
  createManufacturerData,
  createRawManufacturerMessage,
  errorMessage,
  formatCanonicalUuid,
  matchesBleDevice,
  nullableNumber,
  nullableString,
  normalizeUuid,
  unboxBluezValue,
  uniqueDevices
} from './utils.js';

type BluezObjects = Record<string, Record<string, Record<string, unknown>>>;
type BluezVariantConstructor = new (signature: string, value: unknown) => unknown;

interface BluezBus {
  getProxyObject(service: string, path: string): Promise<{ getInterface(name: string): unknown }>;
  disconnect(): void;
}

interface BluezObjectManager {
  GetManagedObjects(): Promise<BluezObjects>;
  on?(event: 'InterfacesAdded', listener: (path: string, interfaces: Record<string, Record<string, unknown>>) => void): void;
  removeListener?(event: 'InterfacesAdded', listener: (path: string, interfaces: Record<string, Record<string, unknown>>) => void): void;
}

interface BluezAdapter {
  StartDiscovery(): Promise<void>;
  StopDiscovery(): Promise<void>;
  SetDiscoveryFilter(filter: Record<string, unknown>): Promise<void>;
}

interface BluezProperties {
  on(event: 'PropertiesChanged', listener: (interfaceName: string, changed: Record<string, unknown>, invalidated: string[]) => void): void;
  removeListener(event: 'PropertiesChanged', listener: (interfaceName: string, changed: Record<string, unknown>, invalidated: string[]) => void): void;
}

interface DeviceWatcher {
  properties: BluezProperties;
  listener: (interfaceName: string, changed: Record<string, unknown>, invalidated: string[]) => void;
}

const requireOptional = createRequire(import.meta.url);
const BLUEZ_SERVICE = 'org.bluez';
const DBUS_OBJECT_MANAGER = 'org.freedesktop.DBus.ObjectManager';
const DBUS_PROPERTIES = 'org.freedesktop.DBus.Properties';
const BLUEZ_ADAPTER = 'org.bluez.Adapter1';
const BLUEZ_DEVICE = 'org.bluez.Device1';
const DISCOVERY_POLL_MS = 500;

export const bluezBackend: BluetoothBackend = {
  name: 'bluez',
  isAvailable: isBluezAvailable,
  discover: discoverBluezDevices,
  scanAdvertisements: scanBluezAdvertisements,
  shutdown: async () => {}
};

async function isBluezAvailable(logger: Logger = () => {}): Promise<boolean> {
  if (process.platform !== 'linux') return false;
  try {
    const { systemBus } = loadDbusNext();
    const bus = systemBus();
    try {
      const object = await bus.getProxyObject(BLUEZ_SERVICE, '/');
      const objectManager = object.getInterface(DBUS_OBJECT_MANAGER) as BluezObjectManager;
      const objects = await objectManager.GetManagedObjects();
      return findBluezAdapterPath(objects) !== null;
    } finally {
      bus.disconnect();
    }
  } catch (error) {
    logger(`BlueZ backend is not available: ${errorMessage(error)}.`);
    return false;
  }
}

async function discoverBluezDevices(options: ResolvedDiscoverOptions): Promise<BleDiscoveredDevice[]> {
  const devices = new Map<string, BleDiscoveredDevice>();
  await runBluezScan({
    timeoutMs: options.timeoutMs,
    scanServiceUuid: options.scanServiceUuid,
    logger: options.logger,
    onDevice: (device) => {
      if (matchesDiscoveredDevice(device, options)) devices.set(deviceKey(device), device);
    }
  });
  return uniqueDevices([...devices.values()]);
}

async function scanBluezAdvertisements(options: ResolvedScanOptions): Promise<void> {
  await runBluezScan({
    timeoutMs: options.listenMs,
    scanServiceUuid: options.scanServiceUuid,
    logger: options.logger,
    onAdvertisement: (device, payload) => {
      if (!matchesDiscoveredDevice(device, options)) return;
      options.onAdvertisement({
        device,
        message: createRawManufacturerMessage(payload.companyId, payload.data)
      });
    }
  });
}

async function runBluezScan({
  timeoutMs,
  scanServiceUuid,
  logger,
  onDevice,
  onAdvertisement
}: {
  timeoutMs: number;
  scanServiceUuid: string | null;
  logger: Logger;
  onDevice?: (device: BleDiscoveredDevice) => void;
  onAdvertisement?: (device: BleDiscoveredDevice, payload: { companyId: string; data: Buffer }) => void;
}): Promise<void> {
  if (process.platform !== 'linux') throw new Error('BlueZ backend is only available on Linux.');
  const { systemBus, Variant } = loadDbusNext();
  const bus = systemBus();
  const deviceProperties = new Map<string, Record<string, unknown>>();
  const deviceWatchers = new Map<string, DeviceWatcher>();
  const lastManufacturerData = new Map<string, string>();
  let pollTimer: NodeJS.Timeout | null = null;
  let polling = false;

  const processDeviceProperties = (path: string, properties: Record<string, unknown>) => {
    const merged = { ...(deviceProperties.get(path) || {}), ...properties };
    deviceProperties.set(path, merged);

    const device = toDiscoveredDevice(path, merged, 'bluez');
    onDevice?.(device);

    for (const payload of readManufacturerData(merged.ManufacturerData)) {
      const key = `${path}:${payload.companyId}`;
      const hex = payload.data.toString('hex');
      if (lastManufacturerData.get(key) === hex) continue;
      lastManufacturerData.set(key, hex);

      const advertisedDevice = toDiscoveredDevice(path, { ...merged, ManufacturerData: new Map([[payload.companyId, payload.data]]) }, 'bluez');
      onAdvertisement?.(advertisedDevice, payload);
    }
  };

  const watchDeviceProperties = async (path: string) => {
    if (deviceWatchers.has(path)) return;
    try {
      const object = await bus.getProxyObject(BLUEZ_SERVICE, path);
      const properties = object.getInterface(DBUS_PROPERTIES) as BluezProperties;
      const listener = (interfaceName: string, changed: Record<string, unknown>) => {
        if (interfaceName === BLUEZ_DEVICE) processDeviceProperties(path, changed);
      };
      properties.on('PropertiesChanged', listener);
      deviceWatchers.set(path, { properties, listener });
    } catch (error) {
      logger(`Warning: could not watch BlueZ properties for ${path}: ${errorMessage(error)}.`);
    }
  };

  const processInterfaces = (path: string, interfaces: Record<string, Record<string, unknown>>) => {
    const device = interfaces[BLUEZ_DEVICE];
    if (!device) return;
    void watchDeviceProperties(path);
    processDeviceProperties(path, device);
  };

  try {
    const { objectManager, adapter } = await openBluezAdapter(bus);
    const onInterfacesAdded = (path: string, interfaces: Record<string, Record<string, unknown>>) => processInterfaces(path, interfaces);
    objectManager.on?.('InterfacesAdded', onInterfacesAdded);

    const pollManagedObjects = async () => {
      if (polling) return;
      polling = true;
      try {
        const objects = await objectManager.GetManagedObjects();
        for (const [path, interfaces] of Object.entries(objects)) processInterfaces(path, interfaces);
      } finally {
        polling = false;
      }
    };

    try {
      await setBluezDiscoveryFilter(adapter, Variant, scanServiceUuid, true, logger);
      await adapter.StartDiscovery();
      logger(`BlueZ advertisement scan started. Listening ${timeoutMs}ms.`);
      await pollManagedObjects();
      pollTimer = setInterval(() => {
        void pollManagedObjects().catch((error: unknown) => logger(`Warning: could not poll BlueZ devices: ${errorMessage(error)}.`));
      }, DISCOVERY_POLL_MS);
      await delay(timeoutMs);
    } finally {
      if (pollTimer) clearInterval(pollTimer);
      objectManager.removeListener?.('InterfacesAdded', onInterfacesAdded);
      for (const { properties, listener } of deviceWatchers.values()) properties.removeListener('PropertiesChanged', listener);
      await adapter.StopDiscovery().catch((error: unknown) => logger(`Warning: could not stop BlueZ discovery: ${errorMessage(error)}.`));
    }
  } finally {
    bus.disconnect();
  }
}

async function openBluezAdapter(bus: BluezBus): Promise<{ objectManager: BluezObjectManager; adapter: BluezAdapter; adapterPath: string }> {
  const objectManagerObject = await bus.getProxyObject(BLUEZ_SERVICE, '/');
  const objectManager = objectManagerObject.getInterface(DBUS_OBJECT_MANAGER) as BluezObjectManager;
  const objects = await objectManager.GetManagedObjects();
  const adapterPath = findBluezAdapterPath(objects);
  if (!adapterPath) throw new Error('Could not find a BlueZ adapter via org.bluez ObjectManager.');
  const adapterObject = await bus.getProxyObject(BLUEZ_SERVICE, adapterPath);
  const adapter = adapterObject.getInterface(BLUEZ_ADAPTER) as BluezAdapter;
  return { objectManager, adapter, adapterPath };
}

function findBluezAdapterPath(objects: BluezObjects): string | null {
  for (const [path, interfaces] of Object.entries(objects)) {
    if (interfaces[BLUEZ_ADAPTER]) return path;
  }
  return null;
}

function matchesDiscoveredDevice(device: BleDiscoveredDevice, options: ResolvedDiscoverOptions): boolean {
  return matchesBleDevice(
    { name: device.name, address: device.address, serviceUuids: device.serviceUuids },
    { namePrefix: options.namePrefix, deviceName: options.deviceName, serviceUuid: options.matchServiceUuid }
  );
}

function toDiscoveredDevice(path: string, device: Record<string, unknown>, backend: 'bluez'): BleDiscoveredDevice {
  return {
    id: path,
    address: nullableString(unboxBluezValue(device.Address)),
    addressType: nullableString(unboxBluezValue(device.AddressType)),
    name: nullableString(unboxBluezValue(device.Name)) || nullableString(unboxBluezValue(device.Alias)),
    rssi: nullableNumber(unboxBluezValue(device.RSSI)),
    serviceUuids: readBluezUuids(device),
    manufacturerData: readManufacturerData(device.ManufacturerData).map((payload) => createManufacturerData(payload.companyId, payload.data)),
    backend
  };
}

function readBluezUuids(device: Record<string, unknown>): string[] {
  const value = unboxBluezValue(device.UUIDs);
  return Array.isArray(value) ? value.map((uuid) => String(uuid)) : [];
}

function readManufacturerData(value: unknown): Array<{ companyId: string; data: Buffer }> {
  const data = unboxBluezValue(value);
  if (!data || typeof data !== 'object') return [];

  const entries = data instanceof Map ? Array.from(data.entries()) : Object.entries(data as Record<string, unknown>);
  const payloads: Array<{ companyId: string; data: Buffer }> = [];

  for (const [companyId, bytes] of entries) {
    const buffer = bytesToBuffer(bytes);
    if (buffer && buffer.length > 0) payloads.push({ companyId: String(companyId), data: buffer });
  }

  return payloads;
}

function bytesToBuffer(value: unknown): Buffer | null {
  const unboxed = unboxBluezValue(value);
  if (Buffer.isBuffer(unboxed)) return unboxed;
  if (unboxed instanceof Uint8Array) return Buffer.from(unboxed);
  if (Array.isArray(unboxed) && unboxed.every((byte) => typeof byte === 'number')) return Buffer.from(unboxed);
  return null;
}

export async function setBluezDiscoveryFilter(
  adapter: BluezAdapter,
  Variant: BluezVariantConstructor,
  serviceUuid: string | null,
  duplicateData: boolean,
  logger: Logger
): Promise<void> {
  const filter: Record<string, unknown> = {
    Transport: new Variant('s', 'le'),
    DuplicateData: new Variant('b', duplicateData)
  };
  if (serviceUuid) filter.UUIDs = new Variant('as', [formatCanonicalUuid(serviceUuid)]);

  const names = ['transport', duplicateData ? 'duplicate advertisement data' : 'deduplicated advertisement data'];
  if (serviceUuid) names.push(`service UUID ${normalizeUuid(serviceUuid)}`);

  await adapter.SetDiscoveryFilter(filter)
    .then(() => logger(`BlueZ discovery filter applied: ${names.join(', ')}.`))
    .catch((error: unknown) => logger(`Warning: could not set BlueZ discovery filter (${names.join(', ')}): ${errorMessage(error)}.`));
}

function deviceKey(device: BleDiscoveredDevice): string {
  return device.address?.toLowerCase() || device.name || `${device.backend}:${device.id}`;
}

function loadDbusNext(): { systemBus: () => BluezBus; Variant: BluezVariantConstructor } {
  try {
    return requireOptional('dbus-next') as { systemBus: () => BluezBus; Variant: BluezVariantConstructor };
  } catch (error) {
    throw new Error(`BlueZ backend requires the "dbus-next" dependency. Run npm install. ${errorMessage(error)}`);
  }
}
