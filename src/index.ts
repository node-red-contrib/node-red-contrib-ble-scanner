export { DEFAULTS } from './constants.js';
export { discoverDevices, readDevice, readDevices, shutdownBluetooth } from './reader.js';
export { matchesBleDevice } from './ble/utils.js';
export type { BleAdvertisement, BleDiscoveredDevice, BleManufacturerData, BleReading, BluetoothBackendName, DiscoverOptions, RawBleMessage, ReadOptions } from './ble/backend.js';
