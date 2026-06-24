import { invoke } from '@tauri-apps/api/core';
import { isTauri } from '@tauri-apps/api/core';

export async function readTextFile(path: string): Promise<string> {
  if (!isTauri()) throw new Error('Tauri runtime required');
  return invoke<string>('read_text_file', { path });
}

export async function writeTextFile(path: string, content: string): Promise<void> {
  if (!isTauri()) throw new Error('Tauri runtime required');
  await invoke('write_text_file', { path, content });
}

export async function getAppDataDir(): Promise<string> {
  if (!isTauri()) throw new Error('Tauri runtime required');
  return invoke<string>('get_app_data_dir');
}