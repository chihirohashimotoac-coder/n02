import { useState } from 'react';
import PentathlonModal from './PentathlonModal';

interface Props {
  title: string;
  body: string;
  label?: string;
  className?: string;
}

/** Trigger + popup for the in-game "how does this discipline work" rule explanation (Pentathlon only). */
export default function PentathlonRulesButton({ title, body, label = 'RULES', className }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>
        {label}
      </button>
      {open && (
        <PentathlonModal label={`${title}のルール`} onClose={() => setOpen(false)}>
          <h2>{title} のルール</h2>
          <p className="pent-rules-body">{body}</p>
          <button type="button" className="n01-modal-primary" onClick={() => setOpen(false)}>
            閉じる
          </button>
        </PentathlonModal>
      )}
    </>
  );
}
