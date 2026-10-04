import { useQuery } from '@tanstack/react-query';
import type { components } from '@dialer/api-client';
import { api } from './api';
import { apiBase, isLive } from './backend';

export type RecordingSetting = components['schemas']['RecordingSetting'];
export type Recording = components['schemas']['Recording'];

/** What the rep says first on every recorded call. */
export const RECORDING_NOTICE = 'Just so you know, this call may be recorded.';

export const recordingKeys = {
  setting: ['recordings', 'setting'] as const,
  one: (callId: string) => ['recordings', callId] as const,
};

export function useRecordingSetting(on = true) {
  return useQuery({ queryKey: recordingKeys.setting, queryFn: () => api.get<RecordingSetting>('/recordings/settings'), enabled: isLive() && on });
}

/** On needs agree: the rep tells every lead the call may be recorded. */
export const setRecording = (on: boolean, agree = false) => api.put<RecordingSetting>('/recordings/settings', { on, agree });

/** A call's recording. While it is being saved, it is checked every 3 seconds. */
export function useRecording(callId: string) {
  return useQuery({
    queryKey: recordingKeys.one(callId),
    queryFn: () => api.get<Recording>(`/recordings/${callId}`),
    enabled: isLive() && Boolean(callId),
    retry: false,
    refetchInterval: q => (q.state.data?.status === 'processing' ? 3000 : false),
  });
}

export const deleteRecording = (callId: string) => api.delete<void>(`/recordings/${callId}`);

/** Links to files kept on this api (development) are paths; S3 links are full addresses. */
export function fileUrl(link: string): string {
  return link.startsWith('/') ? `${apiBase() ?? '/api'}${link}` : link;
}
