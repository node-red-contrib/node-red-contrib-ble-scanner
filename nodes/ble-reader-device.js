'use strict';

module.exports = function registerBleReaderDeviceNode(RED) {
  const loadLibrary = async () => import('../dist/index.js');

  function BleReaderDeviceNode(config) {
    RED.nodes.createNode(this, config);
    const node = this;

    node.name = config.name;
    node.bluetooth = config.bluetooth || 'auto';
    node.namePrefix = config.namePrefix || '';
    node.serviceUuid = config.serviceUuid || '';
    node.listenMs = Number(config.listenMs || 5000);
    node.targetMode = config.targetMode || 'all';
    node.deviceName = config.deviceName || '';
    node.queue = Promise.resolve();

    node.loadLibrary = loadLibrary;

    node.enqueue = async (operation) => {
      const run = node.queue.then(async () => {
        const ble = await node.loadLibrary();
        return operation(ble);
      });
      node.queue = run.catch(() => {});
      return run;
    };

    node.on('close', (_removed, done) => {
      node.loadLibrary()
        .then((ble) => ble.shutdownBluetooth())
        .catch(() => {})
        .finally(done);
    });
  }

  RED.nodes.registerType('ble-reader-device', BleReaderDeviceNode);

  const permission = RED.auth?.needsPermission ? RED.auth.needsPermission('flows.read') : (_req, _res, next) => next();
  RED.httpAdmin.get('/ble-reader/devices', permission, async (req, res) => {
    try {
      const ble = await loadLibrary();
      const serviceUuid = typeof req.query.serviceUuid === 'string' && req.query.serviceUuid ? req.query.serviceUuid : null;
      const devices = await ble.discoverDevices({
        bluetooth: normalizeBluetooth(req.query.bluetooth),
        namePrefix: typeof req.query.namePrefix === 'string' ? req.query.namePrefix : '',
        scanServiceUuid: serviceUuid,
        matchServiceUuid: serviceUuid
      });
      res.json(devices);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });
};

function normalizeBluetooth(value) {
  return value === 'bluez' || value === 'noble' || value === 'auto' ? value : 'auto';
}
