import { createRequire } from 'node:module';

import type { BleDiscoveredDevice, BluetoothBackend, ResolvedDiscoverOptions, ResolvedScanOptions } from './backend.js';
import { asError, createManufacturerData, createRawManufacturerMessage, matchesBleDevice, normalizeUuid, uniqueDevices } from './utils.js';
import type { Noble, NoblePeripheral } from '@abandonware/noble';

const STOP_SCAN_TIMEOUT_MS = 250;
const requireOptional = createRequire(import.meta.url);

let nobleModule: Noble | null = null;
const discoveredPeripherals = new Map<string, NoblePeripheral>();

export const nobleBackend: BluetoothBackend = {
  name: 'noble',
  isAvailable: async () => true,
  discover: discoverNobleDevices,
  scanAdvertisements: scanNobleAdvertisements,
  shutdown: shutdownNoble
};

async function discoverNobleDevices(options: ResolvedDiscoverOptions): Promise<BleDiscoveredDevice[]> {
  const devices: BleDiscoveredDevice[] = [];
  await runNobleScan({
    timeoutMs: options.timeoutMs,
    scanServiceUuid: options.scanServiceUuid,
    logger: options.logger,
    onPeripheral: (peripheral) => {
      const device = toDiscoveredDevice(peripheral);
      if (!matchesDiscoveredDevice(device, options)) return;
      cachePeripheral(peripheral);
      options.logger(`Discovered ${device.name || '<unnamed>'} (${device.address || device.id}, rssi=${device.rssi ?? 'unknown'}).`);
      devices.push(device);
    }
  });
  return uniqueDevices(devices);
}

async function scanNobleAdvertisements(options: ResolvedScanOptions): Promise<void> {
  await runNobleScan({
    timeoutMs: options.listenMs,
    scanServiceUuid: options.scanServiceUuid,
    logger: options.logger,
    onPeripheral: (peripheral) => {
      const manufacturerData = peripheral.advertisement?.manufacturerData;
      if (!manufacturerData || manufacturerData.length === 0) return;

      const device = toDiscoveredDevice(peripheral);
      if (!matchesDiscoveredDevice(device, options)) return;
      cachePeripheral(peripheral);

      const { companyId, data } = splitNobleManufacturerData(manufacturerData);
      options.onAdvertisement({
        device: {
          ...device,
          manufacturerData: [createManufacturerData(companyId, data)]
        },
        message: createRawManufacturerMessage(companyId, data)
      });
    }
  });
}

function runNobleScan({
  timeoutMs,
  scanServiceUuid,
  logger,
  onPeripheral
}: {
  timeoutMs: number;
  scanServiceUuid: string | null;
  logger: (message: string) => void;
  onPeripheral(peripheral: NoblePeripheral): void;
}): Promise<void> {
  const noble = loadNoble();

  return new Promise<void>((resolve, reject) => {
    let settled = false;

    const finish = async (error?: Error | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      noble.removeListener('discover', onDiscover);
      await stopScanningAndWait(noble);
      if (error) reject(error);
      else resolve();
    };

    const start = () => {
      noble.on('discover', onDiscover);
      noble.startScanning(scanServiceUuid ? [normalizeUuid(scanServiceUuid)] : [], true, (error?: Error) => {
        if (error) finish(error).catch(reject);
        else logger(`noble advertisement scan started. Listening ${timeoutMs}ms.`);
      });
    };

    const onDiscover = (peripheral: NoblePeripheral) => {
      onPeripheral(peripheral);
    };

    const timeout = setTimeout(() => {
      finish().catch(reject);
    }, timeoutMs);

    if (noble.state === 'poweredOn') {
      start();
      return;
    }

    if (noble.state === 'unsupported' || noble.state === 'unauthorized') {
      finish(new Error(`Bluetooth adapter state is ${noble.state}.`)).catch(reject);
      return;
    }

    const onStateChange = (state: string) => {
      if (state === 'poweredOn') {
        noble.removeListener('stateChange', onStateChange);
        start();
      } else if (state === 'unsupported' || state === 'unauthorized') {
        noble.removeListener('stateChange', onStateChange);
        finish(new Error(`Bluetooth adapter state is ${state}.`)).catch(reject);
      }
    };

    noble.on('stateChange', onStateChange);
  }).catch((error) => {
    throw asError(error);
  });
}

function cachePeripheral(peripheral: NoblePeripheral): void {
  const keys = [peripheral.id, peripheral.address, peripheral.advertisement?.localName].filter((key): key is string => !!key);
  for (const key of keys) discoveredPeripherals.set(key.toLowerCase(), peripheral);
}

function matchesDiscoveredDevice(device: BleDiscoveredDevice, options: ResolvedDiscoverOptions): boolean {
  return matchesBleDevice(
    { name: device.name, address: device.address, serviceUuids: device.serviceUuids },
    { namePrefix: options.namePrefix, deviceName: options.deviceName, serviceUuid: options.matchServiceUuid }
  );
}

function splitNobleManufacturerData(data: Buffer): { companyId: string; data: Buffer } {
  if (data.length < 2) return { companyId: 'unknown', data };
  const companyId = String(data.readUInt16LE(0));
  return { companyId, data: data.subarray(2) };
}

function toDiscoveredDevice(peripheral: NoblePeripheral): BleDiscoveredDevice {
  const payload = peripheral.advertisement?.manufacturerData ? splitNobleManufacturerData(peripheral.advertisement.manufacturerData) : null;
  const manufacturerData = payload ? [createManufacturerData(payload.companyId, payload.data)] : [];

  return {
    id: peripheral.id,
    address: peripheral.address || null,
    addressType: peripheral.addressType || null,
    name: peripheral.advertisement?.localName || null,
    rssi: typeof peripheral.rssi === 'number' ? peripheral.rssi : null,
    serviceUuids: peripheral.advertisement?.serviceUuids || [],
    manufacturerData,
    backend: 'noble'
  };
}

function stopScanningAndWait(noble: Noble): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      noble.removeListener('scanStop', finish);
      resolve();
    };
    const timeout = setTimeout(finish, STOP_SCAN_TIMEOUT_MS);
    noble.once('scanStop', finish);
    noble.stopScanning();
  });
}

async function shutdownNoble(): Promise<void> {
  const noble = nobleModule;
  if (!noble) return;
  noble.removeAllListeners('discover');
  await stopScanningAndWait(noble);
  discoveredPeripherals.clear();
}

function loadNoble(): Noble {
  if (!nobleModule) nobleModule = requireOptional('@abandonware/noble') as Noble;
  return nobleModule;
}
