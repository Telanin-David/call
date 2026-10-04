import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { components } from '@dialer/api-client';
import { api } from './api';
import { isLive } from './backend';

type S = components['schemas'];
export type Verification = S['Verification'];
export type VerificationRequest = S['VerificationRequest'];
export type IDType = VerificationRequest['id_type'];

export const verificationKey = ['verification'] as const;

/** The rep's ID check. While it runs, it is asked again every 5 seconds. */
export function useVerification() {
  return useQuery({
    queryKey: verificationKey,
    queryFn: () => api.get<Verification>('/verification'),
    enabled: isLive(),
    refetchInterval: q => (q.state.data?.status === 'pending' ? 5000 : false),
  });
}

export const startVerification = (body: VerificationRequest) => api.post<Verification>('/verification', body);

/** The IDs on the Verify screen. A null country means the rep's own. */
export const ID_CHOICES: { key: IDType; label: string; country: string | null }[] = [
  { key: 'national_id', label: 'National ID or NIN slip', country: null },
  { key: 'passport', label: 'International passport', country: null },
  { key: 'drivers_licence', label: "Driver's licence", country: null },
  { key: 'ghana_card', label: 'Ghana Card', country: 'GH' },
  { key: 'kenya_id', label: 'Kenya National ID', country: 'KE' },
];

/** The longest side photos are sent at: sharp enough to read an ID, small enough to send on mobile data. */
export const MAX_SIDE = 1280;

function toJpeg(source: CanvasImageSource, width: number, height: number, maxSide: number, quality: number): string {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error("This browser can't take photos.");
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', quality);
}

/** A JPEG data URL of what the camera shows now. */
export function snapshot(video: HTMLVideoElement, maxSide = MAX_SIDE, quality = 0.85): string {
  return toJpeg(video, video.videoWidth, video.videoHeight, maxSide, quality);
}

/** A chosen photo, shrunk to a JPEG data URL. */
export async function fileToJpeg(file: Blob, maxSide = MAX_SIDE): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("That photo couldn't be opened. Try another."));
      img.src = url;
    });
    return toJpeg(img, img.naturalWidth, img.naturalHeight, maxSide, 0.85);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * The camera, live in a <video>. `error` is set when there is no camera or
 * the rep said no; the screen then offers to pick a photo instead.
 */
export function useCamera(facing: 'environment' | 'user', on = true) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!on) return;
    let stream: MediaStream | null = null;
    let stopped = false;
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("This browser can't open the camera.");
      return;
    }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: facing, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false })
      .then(async s => {
        if (stopped) { s.getTracks().forEach(t => t.stop()); return; }
        stream = s;
        const v = videoRef.current;
        if (v) {
          v.srcObject = s;
          await v.play().catch(() => { /* autoplay is muted; it shows anyway */ });
        }
        setReady(true);
      })
      .catch((e: unknown) => {
        const denied = e instanceof DOMException && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
        setError(denied ? 'The camera is blocked. Allow it in your browser, or pick a photo instead.' : "The camera couldn't open. Pick a photo instead.");
      });
    return () => {
      stopped = true;
      stream?.getTracks().forEach(t => t.stop());
      setReady(false);
    };
  }, [facing, on]);

  return { videoRef, ready, error };
}
