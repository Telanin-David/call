import { create } from 'zustand';

interface CallState {
  callId: string | null;
  status: 'idle' | 'ringing' | 'answered' | 'ended';
  secondsElapsed: number;
  costMicrodollars: number;
  setCallId: (id: string | null) => void;
  setStatus: (s: CallState['status']) => void;
  tick: () => void;
  addCost: (microdollars: number) => void;
  reset: () => void;
}

export const useCallStore = create<CallState>((set) => ({
  callId: null,
  status: 'idle',
  secondsElapsed: 0,
  costMicrodollars: 0,
  setCallId: (id) => set({ callId: id }),
  setStatus: (status) => set({ status }),
  tick: () => set((s) => ({ secondsElapsed: s.secondsElapsed + 1 })),
  addCost: (c) => set((s) => ({ costMicrodollars: s.costMicrodollars + c })),
  reset: () => set({ callId: null, status: 'idle', secondsElapsed: 0, costMicrodollars: 0 }),
}));
