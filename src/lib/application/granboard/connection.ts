import { notifyUuid, serviceUuid } from './protocol';

interface Characteristic extends EventTarget {
  uuid: string;
  value?: DataView;
  properties: { notify: boolean };
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

const relayPath = '/api/granboard/';
type Device = Awaited<ReturnType<Bluetooth['requestDevice']>>;
type Receiver = { frame: (frame: string) => void; ready: () => void; lost: () => void };

export function bluetooth() {
  return (navigator as Navigator & { bluetooth?: Bluetooth }).bluetooth;
}

export type BoardConnector = (signal: AbortSignal, receiver: Receiver) => Promise<void>;

export function bluetoothConnector(): BoardConnector {
  let selected: Promise<Device> | undefined;
  return async (signal, receiver) => {
    selected ??= bluetooth()!.requestDevice({ filters: [{ services: [serviceUuid] }] });
    await connectBluetooth(await selected, signal, receiver);
  };
}

async function connectBluetooth(device: Device, signal: AbortSignal, receiver: Receiver) {
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
  const notifications = (await service.getCharacteristics()).filter(
    (item) => item.properties.notify,
  );
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
  receiver.ready();
}

export async function relayAvailable(signal: AbortSignal) {
  const response = await fetch(relayPath + 'status', { signal, cache: 'no-store' });
  return response.ok && (await response.json()).protocol === 'granboard-v1';
}

export async function connectRelay(code: string, signal: AbortSignal, receiver: Receiver) {
  const response = await fetch(relayPath + 'session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
    signal,
  });
  if (!response.ok) throw new Error('Relay pairing failed');
  signal.throwIfAborted();
  const stream = new EventSource(relayPath + 'events');
  signal.addEventListener('abort', () => stream.close(), { once: true });
  let sequence = 0;
  let ready = false;
  stream.onerror = receiver.lost;
  stream.addEventListener('board', (event: MessageEvent<string>) => {
    try {
      const value = JSON.parse(event.data);
      if (value.type === 'ready' && !ready) {
        ready = true;
        receiver.ready();
      } else if (ready && value.type === 'hit' && typeof value.frame === 'string') {
        if (value.sequence === sequence) return;
        if (value.sequence !== sequence + 1) throw new Error('Missing relay event');
        sequence = value.sequence;
        receiver.frame(value.frame);
      } else {
        throw new Error('Unexpected relay event');
      }
    } catch {
      receiver.lost();
    }
  });
}
