import type { BoardConnector, BoardReceiver } from './connection';
import { notifyUuid, serviceUuid } from './protocol';

interface Characteristic extends EventTarget {
  uuid: string;
  value?: DataView;
  properties: { notify?: boolean; write?: boolean; writeWithoutResponse?: boolean };
  writeValueWithResponse?(frame: Uint8Array<ArrayBuffer>): Promise<void>;
  writeValueWithoutResponse?(frame: Uint8Array<ArrayBuffer>): Promise<void>;
  startNotifications(): Promise<unknown>;
}
interface Server {
  connect(): Promise<Server>;
  disconnect(): void;
  getPrimaryService(uuid: string): Promise<{
    getCharacteristics(): Promise<Characteristic[]>;
  }>;
}
interface Bluetooth {
  requestDevice(options: {
    filters: { services: string[] }[];
  }): Promise<EventTarget & { gatt?: Server }>;
}

type Device = Awaited<ReturnType<Bluetooth['requestDevice']>>;

export function bluetooth() {
  return (navigator as Navigator & { bluetooth?: Bluetooth }).bluetooth;
}

export function bluetoothConnector(): BoardConnector {
  let selected: Promise<Device> | undefined;
  return async (signal, receiver) => {
    selected ??= bluetooth()!.requestDevice({ filters: [{ services: [serviceUuid] }] });
    await connectBluetooth(await selected, signal, receiver);
  };
}

async function connectBluetooth(device: Device, signal: AbortSignal, receiver: BoardReceiver) {
  signal.throwIfAborted();
  const gatt = device.gatt;
  if (!gatt) throw new Error('No GATT server');
  signal.addEventListener('abort', () => gatt.disconnect(), { once: true });
  device.addEventListener('gattserverdisconnected', receiver.lost, { signal });
  const server = await gatt.connect();
  // Disconnect again if cancellation occurred while the connection was pending.
  if (signal.aborted) server.disconnect();
  signal.throwIfAborted();
  const service = await server.getPrimaryService(serviceUuid);
  const characteristics = await service.getCharacteristics();
  const notifications = characteristics.filter((item) => item.properties.notify);
  const characteristic =
    notifications.find((item) => item.uuid === notifyUuid) ??
    (notifications.length === 1 ? notifications[0] : undefined);
  if (!characteristic) throw new Error('No GranBoard notification characteristic');
  signal.throwIfAborted();
  characteristic.addEventListener(
    'characteristicvaluechanged',
    () => {
      const value = characteristic.value;
      if (value && value.byteLength <= 5) {
        const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
        receiver.frame(String.fromCharCode(...bytes));
      }
    },
    { signal },
  );
  await characteristic.startNotifications();
  signal.throwIfAborted();
  const output = characteristics.find(
    (item) => item.uuid === '442f1572-8a00-9a28-cbe1-e1d4212d53eb',
  );
  const write = output?.properties.writeWithoutResponse
    ? output.writeValueWithoutResponse
    : output?.properties.write
      ? output.writeValueWithResponse
      : undefined;
  let pendingWrite = Promise.resolve();
  receiver.ready(
    write
      ? (frame) => {
          const result = pendingWrite.then(async () => {
            signal.throwIfAborted();
            await write.call(output, frame);
          });
          pendingWrite = result.catch(() => {});
          return result;
        }
      : undefined,
  );
}
