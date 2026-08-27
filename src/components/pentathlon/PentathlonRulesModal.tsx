import { useState } from 'react';
import PentathlonModal from './PentathlonModal';
import { PRESETS } from '../../domain/pentathlon/presets';
import { PENTATHLON_RULE_SUMMARY } from '../../domain/pentathlon/ruleText';
import type { PentathlonPreset } from '../../domain/pentathlon/types';

interface Props {
  label?: string;
  className?: string;
}

/**
 * The "採用ルール・出典" popup shown on the Pentathlon setup and result screens: which rule set each
 * preset follows, and how the overall standing is decided.
 */
export default function PentathlonRulesModal({ label = '採用ルール・出典', className }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>
        {label}
      </button>
      {open && (
        <PentathlonModal label="ペンタスロンの採用ルールと出典" onClose={() => setOpen(false)}>
          <h2>採用ルール・出典</h2>
          <div className="pent-rules-scroll">
            {(Object.keys(PRESETS) as PentathlonPreset[]).map((preset) => (
              <section key={preset} className="pent-rules-section">
                <h3>{PRESETS[preset].name}</h3>
                <p className="pent-rules-body">{PRESETS[preset].description}</p>
              </section>
            ))}
            {PENTATHLON_RULE_SUMMARY.map((section) => (
              <section key={section.title} className="pent-rules-section">
                <h3>{section.title}</h3>
                <p className="pent-rules-body">{section.body}</p>
              </section>
            ))}
          </div>
          <button type="button" className="n01-modal-primary" onClick={() => setOpen(false)}>
            閉じる
          </button>
        </PentathlonModal>
      )}
    </>
  );
}
