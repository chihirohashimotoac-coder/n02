import { useEffect, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
}

interface Props {
  actions?: React.ReactNode;
  onBrandClick?: () => void;
}

export default function TopBar({ actions, onBrandClick }: Props) {
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    const handler = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  return (
    <header className="topbar">
      <button type="button" className="brand" onClick={onBrandClick} aria-label="n02 ホームへ">
        <strong>n02</strong>
        <span aria-hidden="true" />
        <em>Checkout Arena</em>
      </button>
      <div className="top-actions">
        {installPrompt && (
          <button
            type="button"
            className="subtle-button"
            onClick={() => {
              void installPrompt.prompt();
              setInstallPrompt(null);
            }}
          >
            アプリをインストール
          </button>
        )}
        {actions}
      </div>
    </header>
  );
}
