import { useState } from 'react';

interface Props {
  title: string;
  body: string;
  label?: string;
  className?: string;
}

/** Trigger + popup for the in-game "how does this mode/discipline work" rule explanation. */
export default function RulesButton({ title, body, label = 'RULES', className }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>
        {label}
      </button>
      {open && (
        <div
          className="n01-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label={`${title}のルール`}
          onClick={() => setOpen(false)}
        >
          <div className="n01-modal-card" onClick={(event) => event.stopPropagation()}>
            <h2>{title} のルール</h2>
            <p className="rules-modal-body">{body}</p>
            <button type="button" className="n01-modal-primary" onClick={() => setOpen(false)}>
              閉じる
            </button>
          </div>
        </div>
      )}
    </>
  );
}
