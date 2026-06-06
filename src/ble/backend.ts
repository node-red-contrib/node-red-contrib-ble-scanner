export type BluetoothBackendName = 'auto' | 'bluez' | 'noble';
export type ResolvedBluetoothBackendName = Exclude<BluetoothBackendName, 'auto'>;
export type Logger = (message: string) => void;

export interface BleManufacturerData {
  companyId: string;
  companyIdHex: string;
  length: number;
  data: Buffer;
  hex: string;
  base64: string;
  bytes: number[];
}

export interface BleDiscoveredDevice {
  id: string;
  name: string | null;
  address: string | null;
  addressType?: string | null;
  rssi: number | null;
  serviceUuids?: string[];
  manufacturerData?: BleManufacturerData[];
  backend: ResolvedBluetoothBackendName;
}

export interface RawBleMessage extends BleManufacturerData {
  timestamp: string;
  source: 'manufacturerData';
}

export interface BleAdvertisement {
  device: BleDiscoveredDevice;
  message: RawBleMessage;
}

export interface BleReading {
  device: BleDiscoveredDevice;
  timestamp: string;
  messages: RawBleMessage[];
}

export interface ReadOptions {
  bluetooth?: BluetoothBackendName;
  namePrefix?: string;
  deviceName?: string;
  timeoutMs?: number;
  listenMs?: number;
  scanServiceUuid?: string | null;
  matchServiceUuid?: string | null;
  logger?: Logger;
}

export interface DiscoverOptions {
  bluetooth?: BluetoothBackendName;
  namePrefix?: string;
  deviceName?: string;
  timeoutMs?: number;
  scanServiceUuid?: string | null;
  matchServiceUuid?: string | null;
  logger?: Logger;
}

export interface ResolvedDiscoverOptions {
  namePrefix: string;
  deviceName: string | null;
  timeoutMs: number;
  scanServiceUuid: string | null;
  matchServiceUuid: string | null;
  logger: Logger;
}

export interface ResolvedScanOptions extends ResolvedDiscoverOptions {
  listenMs: number;
  onAdvertisement(advertisement: BleAdvertisement): void;
}

export interface BluetoothBackend {
  name: ResolvedBluetoothBackendName;
  isAvailable(logger?: Logger): Promise<boolean>;
  discover(options: ResolvedDiscoverOptions): Promise<BleDiscoveredDevice[]>;
  scanAdvertisements(options: ResolvedScanOptions): Promise<void>;
  shutdown(): Promise<void>;
}
