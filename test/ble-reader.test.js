import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULTS, matchesBleDevice } from '../dist/index.js';
import { parseListenMs, toReadOptions } from '../dist/cli.js';

test('matches BLE devices by exact name, prefix, service UUID, or no filters', () => {
  assert.equal(matchesBleDevice({ name: 'Sensor A' }, { deviceName: 'Sensor A' }), true);
  assert.equal(matchesBleDevice({ name: 'Sensor A' }, { deviceName: 'Sensor B' }), false);
  assert.equal(matchesBleDevice({ name: 'SK12V324PH00057' }, { namePrefix: 'SK' }), true);
  assert.equal(matchesBleDevice({ name: 'Other', serviceUuids: ['0000fff0-0000-1000-8000-00805f9b34fb'] }, { namePrefix: '', serviceUuid: 'fff0' }), true);
  assert.equal(matchesBleDevice({ name: 'Other' }, { namePrefix: '', serviceUuid: null }), true);
});

test('parses CLI read options for raw advertisement capture', () => {
  const options = toReadOptions(
    {
      bluetooth: 'noble',
      namePrefix: 'SK',
      serviceUuid: 'fff0',
      listenMs: '2500',
      debug: false
    },
    'SK12V324PH00057'
  );

  assert.equal(options.bluetooth, 'noble');
  assert.equal(options.namePrefix, 'SK');
  assert.equal(options.deviceName, 'SK12V324PH00057');
  assert.equal(options.scanServiceUuid, 'fff0');
  assert.equal(options.matchServiceUuid, 'fff0');
  assert.equal(options.listenMs, 2500);
});

test('validates listen duration', () => {
  assert.equal(parseListenMs(undefined), DEFAULTS.listenMs);
  assert.equal(parseListenMs('0'), 0);
  assert.throws(() => parseListenMs('-1'), /--listen-ms/);
});
