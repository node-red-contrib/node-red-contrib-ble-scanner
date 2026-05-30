'use strict';

module.exports = function registerBleReaderReadNode(RED) {
  function BleReaderReadNode(config) {
    RED.nodes.createNode(this, config);
    const node = this;

    node.device = RED.nodes.getNode(config.device);
    node.listenMs = Number(config.listenMs || 0);

    node.on('input', async (msg, send, done) => {
      const emit = send || ((message) => node.send(message));
      try {
        if (!node.device) throw new Error('BLE reader device node is not configured.');
        const override = normalizePayload(msg.payload);
        const deviceName = override.deviceName || (node.device.targetMode === 'name' ? node.device.deviceName : undefined);
        const listenMs = override.listenMs ?? (node.listenMs || node.device.listenMs);
        const serviceUuid = override.serviceUuid ?? node.device.serviceUuid;
        const notifyUuid = override.notifyUuid ?? node.device.notifyUuid;

        node.status({ fill: 'yellow', shape: 'ring', text: 'listening' });
        const result = await node.device.enqueue((ble) =>
          ble.readDevices({
            bluetooth: node.device.bluetooth,
            namePrefix: node.device.namePrefix,
            deviceName,
            listenMs,
            notifyUuid,
            scanServiceUuid: serviceUuid || null,
            matchServiceUuid: serviceUuid || null
          })
        );
        const messageCount = result.reduce((count, reading) => count + reading.messages.length, 0);
        node.status({ fill: 'green', shape: 'dot', text: `${messageCount} message${messageCount === 1 ? '' : 's'}` });
        msg.payload = result;
        emit(msg);
        done?.();
      } catch (error) {
        node.status({ fill: 'red', shape: 'ring', text: 'error' });
        done ? done(error) : node.error(error, msg);
      }
    });
  }

  RED.nodes.registerType('ble-reader-read', BleReaderReadNode);
};

function normalizePayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return {};
  const result = {};
  if (typeof payload.deviceName === 'string' && payload.deviceName) result.deviceName = payload.deviceName;
  if (typeof payload.serviceUuid === 'string') result.serviceUuid = payload.serviceUuid;
  if (typeof payload.notifyUuid === 'string' && payload.notifyUuid) result.notifyUuid = payload.notifyUuid;
  if (payload.listenMs !== undefined) {
    const listenMs = Number(payload.listenMs);
    if (Number.isFinite(listenMs) && listenMs >= 0) result.listenMs = listenMs;
  }
  return result;
}
