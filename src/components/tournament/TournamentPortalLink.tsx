/**
 * Link from the n02 top screen to the tournament & league portal (a separate static site, the
 * n02-tournament-viewer GitHub Pages). It is a plain navigation link, not a game mode: n02 keeps no
 * tournament state of its own and nothing here touches settings, saves or the running match.
 */
const TOURNAMENT_PORTAL_URL: string =
  import.meta.env.VITE_TOURNAMENT_PORTAL_URL || 'https://chihirohashimotoac-coder.github.io/n02-tournament-viewer/events/';

export default function TournamentPortalLink() {
  return (
    <a className="tournament-link" href={TOURNAMENT_PORTAL_URL}>
      {/* A bracket: two pairs feeding a final. Drawn, not glyphed, so it reads the same everywhere. */}
      <svg className="tournament-link__icon" width="28" height="28" viewBox="0 0 28 28" aria-hidden="true">
        <path
          d="M3 5h6v6H3M3 17h6v6H3M9 8h4v12H9M13 14h5M18 9h7v10h-7z"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinejoin="round"
        />
      </svg>
      <span className="tournament-link__text">
        {/* Breaks after the 「・」 when the bar is narrow, never inside a word. */}
        <strong>
          トーナメント・
          <wbr />
          リーグ
        </strong>
        <small>大会の閲覧・作成・運営</small>
      </span>
      <svg className="tournament-link__go" width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
        <path d="m8.6 4 8 8-8 8-1.2-1.2 6.8-6.8-6.8-6.8L8.6 4Z" fill="currentColor" />
      </svg>
    </a>
  );
}
