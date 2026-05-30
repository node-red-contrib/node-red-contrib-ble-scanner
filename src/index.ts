export { DEFAULTS } from './constants.js';
export { connectDevice, connectReaders, discoverDevices, readDevice, readDevices, readSession, shutdownBluetooth, type BleReader } from './reader.js';
export { matchesBleDevice } from './ble/utils.js';
export type { BleDiscoveredDevice, BleReading, BleSession, BluetoothBackendName, DiscoverOptions, RawBleMessage, ReadOptions } from './ble/backend.js';
