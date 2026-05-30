# node-red-contrib-ble-scanner

Strict TypeScript Node.js library, CLI, and Node-RED nodes for collecting raw Bluetooth LE notification messages.

The package supports two BLE backend implementations:

- `auto`: uses BlueZ on Linux when available, otherwise noble
- `bluez`: uses Linux BlueZ over D-Bus
- `noble`: uses `@abandonware/noble`

## Library

The package exports a typed ESM API from `dist/index.js`:

- `discoverDevices(options)` returns matching BLE devices
- `readDevices(options)` discovers, connects, subscribes, and collects raw notifications
- `readDevice(device, options)` reads one discovered device
- `connectReaders(options)` discovers and connects once, then returns persistent readers with `read()` and `disconnect()`
- `shutdownBluetooth()` stops active BLE sessions

Each reading contains device metadata, a timestamp, the subscribed notification characteristic UUID, and a `messages` array. Every raw message includes the original Buffer as `data` plus `hex`, `base64`, `bytes`, `length`, and `timestamp`.

```js
import { connectReaders } from 'node-red-contrib-ble-scanner';

const readers = await connectReaders({
  deviceName: 'My BLE Device',
  scanServiceUuid: 'fff0',
  matchServiceUuid: 'fff0',
  notifyUuid: 'fff1',
  listenMs: 5000
});

try {
  const reading = await readers[0].read();
  console.log(reading.messages.map((message) => message.hex));
} finally {
  await Promise.all(readers.map((reader) => reader.disconnect()));
}
```

## Nodes

- `ble-reader-device`: config node for BLE discovery, device selection, and notification UUID
- `ble-reader-read`: input node that collects raw notifications

Use the config node's search button to discover devices from the Node-RED editor. Select one exact advertised device name, or keep "All discovered devices".

The output is placed in `msg.payload` as an array with zero, one, or multiple readings.

Incoming `msg.payload` may contain `{ deviceName, listenMs, serviceUuid, notifyUuid }` to override the configured values for one read.

## CLI

```sh
npm install
npm run build
npm run discover
npm run read
```

Useful options:

```sh
node ./bin/ble-reader.js discover
node ./bin/ble-reader.js discover --name-prefix SK
node ./bin/ble-reader.js discover --service-uuid fff0
node ./bin/ble-reader.js read "My BLE Device" --notify-uuid fff1 --listen-ms 5000
node ./bin/ble-reader.js read --bluetooth bluez --debug
node ./bin/ble-reader.js read "My BLE Device" --interval 5
```

`read --interval 5` keeps the BLE session open and collects notifications every five seconds until stopped.

## Development

```sh
npm run build
npm run lint
npm test
npm run check
```
