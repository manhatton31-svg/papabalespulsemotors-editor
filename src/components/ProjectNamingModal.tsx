import React from 'react';
import { Modal } from './Modal';
import './ProjectNamingModal.css';

interface ProjectNamingModalProps {
  open: boolean;
  projectName: string;
  processing: boolean;
  error: string | null;
  onProjectNameChange: (name: string) => void;
  onClose: () => void;
  onConfirm: () => void;
  cancelLabel?: string;
  title?: string;
  hint?: string;
  confirmLabel?: string;
  processingLabel?: string;
  inputLabel?: string;
  /** Import flow: show clip-count stitching hint */
  clipCount?: number;
}

export function ProjectNamingModal({
  open,
  clipCount = 0,
  projectName,
  processing,
  error,
  onProjectNameChange,
  onClose,
  onConfirm,
  cancelLabel = 'Cancel',
  title = 'Name your project',
  hint,
  confirmLabel = 'Create project',
  processingLabel = 'Stitching clips…',
  inputLabel = 'Project name',
}: ProjectNamingModalProps) {
  const defaultHint =
    clipCount > 0
      ? clipCount === 1
        ? 'This clip will become your main video.'
        : `${clipCount} clips will be stitched with a smooth crossfade between each.`
      : null;

  return (
    <Modal
      open={open}
      title={title}
      onClose={() => {
        if (!processing) onClose();
      }}
      footer={
        <>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onClose}
            disabled={processing}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className="btn btn-accent"
            onClick={onConfirm}
            disabled={processing}
          >
            {processing ? processingLabel : confirmLabel}
          </button>
        </>
      }
    >
      {(hint ?? defaultHint) && <p className="project-naming-hint">{hint ?? defaultHint}</p>}
      <label className="project-naming-label" htmlFor="import-project-name">
        {inputLabel}
      </label>
      <input
        id="import-project-name"
        className="project-naming-input"
        type="text"
        value={projectName}
        onChange={(e) => onProjectNameChange(e.target.value)}
        disabled={processing}
        autoFocus
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !processing) onConfirm();
        }}
      />
      {error && <p className="project-naming-error">{error}</p>}
    </Modal>
  );
}