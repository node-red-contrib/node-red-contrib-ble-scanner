# node-red-contrib-ble-scanner

Strict TypeScript Node.js library, CLI, and Node-RED nodes for collecting raw Bluetooth LE advertisement manufacturer data.

The package supports two BLE backend implementations:

- `auto`: uses BlueZ on Linux when available, otherwise noble
- `bluez`: uses Linux BlueZ over D-Bus
- `noble`: uses `@abandonware/noble`

The scanner does not connect to BLE devices and does not parse or decrypt device-specific payloads. It listens for BLE advertisements and returns the raw manufacturer data bytes.

## Library

The package exports a typed ESM API from `dist/index.js`:

- `discoverDevices(options)` returns matching BLE devices
- `readDevices(options)` listens for matching advertisements and collects raw manufacturer data
- `readDevice(device, options)` reads advertisements for one discovered device
- `shutdownBluetooth()` stops active BLE scans

Each reading contains device metadata, a timestamp, and a `messages` array. Every raw message includes the company id, original Buffer as `data`, plus `hex`, `base64`, `bytes`, `length`, and `timestamp`.

```js
import { readDevices } from 'node-red-contrib-ble-scanner';

const readings = await readDevices({
  deviceName: 'My BLE Device',
  listenMs: 5000
});

console.log(readings.flatMap((reading) => reading.messages.map((message) => message.hex)));
```

## Nodes

- `ble-reader-device`: config node for BLE advertisement scanning, device selection, and filters
- `ble-reader-read`: input node that collects raw manufacturer data

Use the config node's search button to discover devices from the Node-RED editor. Select one exact advertised device name, or keep "All discovered devices".

The output is placed in `msg.payload` as an array with zero, one, or multiple readings.

Incoming `msg.payload` may contain `{ deviceName, listenMs, serviceUuid }` to override the configured values for one read.

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
node ./bin/ble-reader.js read "My BLE Device" --listen-ms 5000
node ./bin/ble-reader.js read --bluetooth bluez --debug
node ./bin/ble-reader.js read "My BLE Device" --interval 5
```

`read --interval 5` repeats an advertisement scan every five seconds until stopped.

## Development

```sh
npm run build
npm run lint
npm test
npm run check
```
