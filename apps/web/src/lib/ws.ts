export type WSEvent =
  | { type: 'call.ringing' }
  | { type: 'call.answered' }
  | { type: 'call.cost'; cost_microdollars: number }
  | { type: 'call.ended'; seconds: number; cost_microdollars: number }
  | { type: 'phone.paired' }
  | { type: 'phone.lost' }
  | { type: 'callback.incoming'; lead_id: string; from: string }
  | { type: 'balance.low'; balance_microdollars: number }
  | { type: 'limit.reached' }
  | { type: 'dialer.next'; lead_id: string };

type Listener = (event: WSEvent) => void;

let socket: WebSocket | null = null;
const listeners = new Set<Listener>();

export function connectWS(token?: string) {
  if (socket) return;
  const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/ws${token ? `?t=${token}` : ''}`;
  socket = new WebSocket(url);

  socket.onmessage = (e) => {
    try {
      const event = JSON.parse(e.data as string) as WSEvent;
      listeners.forEach((l) => l(event));
    } catch {
      // ignore malformed frames
    }
  };

  socket.onclose = () => {
    socket = null;
    setTimeout(() => connectWS(token), 3000);
  };
}

export function subscribeWS(listener: Listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
