import React, { useCallback, useEffect, useState } from 'react';
import QRCode from 'react-qr-code';
import {
  startPhoneUploadServer,
  stopPhoneUploadServer,
  type PhoneUploadServerInfo,
} from '../lib/phoneUpload';
import './PhoneUploadPanel.css';

interface PhoneUploadPanelProps {
  active: boolean;
  onClose: () => void;
}

export function PhoneUploadPanel({ active, onClose }: PhoneUploadPanelProps) {
  const [server, setServer] = useState<PhoneUploadServerInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  const bootServer = useCallback(async () => {
    setStarting(true);
    setError(null);
    try {
      const info = await startPhoneUploadServer();
      setServer(info);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setServer(null);
    } finally {
      setStarting(false);
    }
  }, []);

  useEffect(() => {
    if (!active) {
      setServer(null);
      setError(null);
      stopPhoneUploadServer().catch(() => {});
      return;
    }

    bootServer();
    return () => {
      stopPhoneUploadServer().catch(() => {});
    };
  }, [active, bootServer]);

  if (!active) return null;

  return (
    <div className="phone-upload-panel">
      <div className="phone-upload-header">
        <span className="phone-upload-title">Import from phone</span>
        <button type="button" className="phone-upload-close" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>

      {starting && !server && <p className="phone-upload-status">Starting Wi‑Fi receiver…</p>}

      {error && (
        <div className="phone-upload-error">
          <p>{error}</p>
          <button type="button" className="btn btn-topbar" onClick={bootServer}>
            Retry
          </button>
        </div>
      )}

      {server && (
        <>
          <p className="phone-upload-steps">
            1. Phone on <strong>same Wi‑Fi</strong> as this PC
            <br />
            2. Scan QR or open link below
            <br />
            3. Pick your video — it imports automatically
          </p>

          <div className="phone-upload-qr-wrap">
            <QRCode value={server.url} size={168} bgColor="#ffffff" fgColor="#0a0e14" />
          </div>

          <a className="phone-upload-url" href={server.url} target="_blank" rel="noreferrer">
            {server.url}
          </a>

          <p className="phone-upload-note">
            Windows may ask to allow network access — choose <strong>Private networks</strong>.
            Large clips can take a few minutes on Wi‑Fi.
          </p>
        </>
      )}
    </div>
  );
}