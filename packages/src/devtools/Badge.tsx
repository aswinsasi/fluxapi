// ═══════════════════════════════════════════════════════════════════
// Score Badge — collapsed floating circle
// ═══════════════════════════════════════════════════════════════════

import type { FluxState } from '../scanner-bridge';
import * as S from './styles';

interface BadgeProps {
  state: FluxState;
  position: string;
  onClick: () => void;
}

export function Badge({ state, position, onClick }: BadgeProps) {
  const { score, scanning, violations } = state;
  const critCount = violations.filter((v) => v.severity === 'critical').length;

  return (
    <div
      style={S.badgeStyle(score, position)}
      onClick={onClick}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.transform = 'scale(1.1)';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.transform = 'scale(1)';
      }}
      title={
        scanning
          ? `Scanning... ${state.requests.length} requests`
          : `API Score: ${score}/100 · ${violations.length} issues`
      }
    >
      {scanning ? (
        <>
          <div style={S.scanningDotStyle} />
          <div style={{ ...S.badgeLabelStyle, marginTop: '2px' }}>SCAN</div>
        </>
      ) : (
        <>
          <div style={S.badgeScoreStyle(score)}>{score}</div>
          <div style={S.badgeLabelStyle}>
            {critCount > 0 ? `${critCount}!` : 'API'}
          </div>
        </>
      )}
    </div>
  );
}
