import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

export interface PhoneUploadServerInfo {
  url: string;
  host: string;
  port: number;
  token: string;
}

export interface PhoneUploadReceivedEvent {
  sourcePath: string;
  originalName: string;
}

export async function startPhoneUploadServer(): Promise<PhoneUploadServerInfo> {
  if (!isTauri()) {
    throw new Error('Phone upload requires the desktop app');
  }
  return invoke<PhoneUploadServerInfo>('start_phone_upload_server');
}

export async function stopPhoneUploadServer(): Promise<void> {
  if (!isTauri()) return;
  await invoke('stop_phone_upload_server');
}

export async function subscribePhoneUploadReceived(
  handler: (event: PhoneUploadReceivedEvent) => void
): Promise<() => void> {
  const unlisten = await listen<PhoneUploadReceivedEvent>('phone-upload-received', (e) => {
    handler(e.payload);
  });
  return unlisten;
}