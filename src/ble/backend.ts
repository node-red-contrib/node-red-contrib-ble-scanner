export type BluetoothBackendName = 'auto' | 'bluez' | 'noble';
export type ResolvedBluetoothBackendName = Exclude<BluetoothBackendName, 'auto'>;
export type Logger = (message: string) => void;

export interface BleDiscoveredDevice {
  id: string;
  name: string | null;
  address: string | null;
  addressType?: string | null;
  rssi: number | null;
  backend: ResolvedBluetoothBackendName;
}

export interface RawBleMessage {
  timestamp: string;
  uuid: string;
  length: number;
  data: Buffer;
  hex: string;
  base64: string;
  bytes: number[];
}

export interface BleReading {
  device: BleDiscoveredDevice;
  timestamp: string;
  notifyUuid: string;
  messages: RawBleMessage[];
}

export interface ReadOptions {
  bluetooth?: BluetoothBackendName;
  namePrefix?: string;
  deviceName?: string;
  timeoutMs?: number;
  listenMs?: number;
  connectTimeoutMs?: number;
  notifyUuid?: string;
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

export interface ResolvedConnectOptions {
  device: BleDiscoveredDevice;
  timeoutMs: number;
  connectTimeoutMs: number;
  notifyUuid: string;
  logger: Logger;
}

export interface BleCharacteristic {
  uuid: string;
  properties: string[];
  write(data: Buffer, withoutResponse?: boolean): Promise<void>;
  subscribe(): Promise<void>;
  onData(listener: (data: Buffer) => void): void;
  removeDataListener(listener: (data: Buffer) => void): void;
}

export interface BleSession {
  device: BleDiscoveredDevice;
  notify: BleCharacteristic;
  disconnect(): Promise<void>;
}

export interface BluetoothBackend {
  name: ResolvedBluetoothBackendName;
  isAvailable(logger?: Logger): Promise<boolean>;
  discover(options: ResolvedDiscoverOptions): Promise<BleDiscoveredDevice[]>;
  connect(options: ResolvedConnectOptions): Promise<BleSession>;
  shutdown(): Promise<void>;
}
