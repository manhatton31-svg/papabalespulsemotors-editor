import React, { useCallback, useEffect, useState } from 'react';
import QRCode from 'react-qr-code';
import { ProjectNamingModal } from './ProjectNamingModal';
import {
  startPhoneUploadServer,
  stopPhoneUploadServer,
  subscribePhoneUploadReceived,
  type PhoneUploadReceivedEvent,
  type PhoneUploadServerInfo,
} from '../lib/phoneUpload';
import { cleanProjectName } from '../utils/names';
import './PhoneUploadModal.css';

interface PhoneUploadModalProps {
  open: boolean;
  onClose: () => void;
  onSessionComplete: (clips: PhoneUploadReceivedEvent[], projectName: string) => Promise<void>;
}

export function PhoneUploadModal({ open, onClose, onSessionComplete }: PhoneUploadModalProps) {
  const [server, setServer] = useState<PhoneUploadServerInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [clips, setClips] = useState<PhoneUploadReceivedEvent[]>([]);
  const [namingOpen, setNamingOpen] = useState(false);
  const [projectName, setProjectName] = useState('');
  const [processing, setProcessing] = useState(false);

  const resetSession = useCallback(() => {
    setClips([]);
    setNamingOpen(false);
    setProjectName('');
    setProcessing(false);
    setError(null);
  }, []);

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
    if (!open) {
      setServer(null);
      resetSession();
      stopPhoneUploadServer().catch(() => {});
      return;
    }

    resetSession();
    bootServer();
    return () => {
      stopPhoneUploadServer().catch(() => {});
    };
  }, [open, bootServer, resetSession]);

  useEffect(() => {
    if (!open) return;

    let unlisten: (() => void) | undefined;
    subscribePhoneUploadReceived((event) => {
      setClips((prev) => [...prev, event]);
    })
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => {});

    return () => {
      unlisten?.();
    };
  }, [open]);

  const handleDoneUploading = () => {
    if (clips.length === 0) {
      setError('Upload at least one video clip before continuing');
      return;
    }
    setError(null);
    setProjectName(cleanProjectName(clips[0].originalName));
    setNamingOpen(true);
  };

  const handleConfirmProject = async () => {
    const trimmed = projectName.trim();
    if (!trimmed) {
      setError('Enter a project name');
      return;
    }
    setProcessing(true);
    setError(null);
    try {
      await onSessionComplete(clips, trimmed);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setProcessing(false);
    }
  };

  if (!open) return null;

  return (
    <>
      <div className="phone-upload-modal-overlay" role="dialog" aria-modal="true">
        <div className="phone-upload-modal">
          <button
            type="button"
            className="phone-upload-modal-close"
            onClick={onClose}
            aria-label="Close"
            disabled={processing}
          >
            ×
          </button>

          <h2 className="phone-upload-modal-title">Scan with your phone to upload video clips</h2>
          <p className="phone-upload-modal-subtitle">
            Keep this window open and upload as many clips as you need — they are added in order.
          </p>

          {starting && !server && (
            <p className="phone-upload-modal-status">Starting Wi‑Fi receiver…</p>
          )}

          {error && !namingOpen && (
            <div className="phone-upload-modal-error">
              <p>{error}</p>
              {!server && (
                <button type="button" className="btn btn-topbar" onClick={bootServer}>
                  Retry
                </button>
              )}
            </div>
          )}

          {server && (
            <div className="phone-upload-modal-body">
              <div className="phone-upload-modal-qr">
                <QRCode value={server.url} size={280} bgColor="#ffffff" fgColor="#0a0e14" />
              </div>

              <p className="phone-upload-modal-wifi">
                Phone must be on the <strong>same Wi‑Fi</strong> as this PC
              </p>

              <a className="phone-upload-modal-url" href={server.url} target="_blank" rel="noreferrer">
                {server.url}
              </a>

              {clips.length > 0 && (
                <div className="phone-upload-modal-clips">
                  <span className="phone-upload-modal-clips-label">
                    {clips.length} clip{clips.length === 1 ? '' : 's'} received
                  </span>
                  <ul>
                    {clips.map((clip, index) => (
                      <li key={`${clip.sourcePath}-${index}`}>{clip.originalName}</li>
                    ))}
                  </ul>
                </div>
              )}

              <button
                type="button"
                className="btn btn-accent phone-upload-modal-done"
                onClick={handleDoneUploading}
                disabled={processing || clips.length === 0}
              >
                Done Uploading
              </button>
            </div>
          )}
        </div>
      </div>

      <ProjectNamingModal
        open={namingOpen}
        clipCount={clips.length}
        projectName={projectName}
        processing={processing}
        error={namingOpen ? error : null}
        onProjectNameChange={setProjectName}
        onClose={() => setNamingOpen(false)}
        onConfirm={handleConfirmProject}
        cancelLabel="Back"
      />
    </>
  );
}