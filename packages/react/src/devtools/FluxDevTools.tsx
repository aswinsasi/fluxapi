// ═══════════════════════════════════════════════════════════════════
// <FluxDevTools /> — Drop-in React component for live API monitoring
//
// Usage:
//   import { FluxDevTools } from '@fluxiapi/react';
//   <FluxDevTools />  // Add to app root, renders in dev mode only
// ═══════════════════════════════════════════════════════════════════

import { useState, useEffect, useCallback } from 'react';
import { FluxProvider, useFlux } from '../context';
import { Badge } from './Badge';
import { Panel } from './Panel';
import { injectKeyframes, containerStyle } from './styles';
import type { ScannerBridge } from '../scanner-bridge';

// ─── Props ──────────────────────────────────────────────────────

export interface FluxDevToolsProps {
  /**
   * Position of the floating badge.
   * @default 'bottom-right'
   */
  position?: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';

  /**
   * Network profile for scoring.
   * @default 'wifi'
   */
  network?: string;

  /**
   * Re-analysis interval in ms.
   * @default 3000
   */
  analysisInterval?: number;

  /**
   * Auto-start scanning when component mounts.
   * @default true
   */
  autoStart?: boolean;

  /**
   * Start with panel expanded.
   * @default false
   */
  defaultOpen?: boolean;

  /**
   * Console logging for debug.
   * @default false
   */
  verbose?: boolean;

  /**
   * Custom scanner bridge (for shared state with other components).
   */
  bridge?: ScannerBridge;

  /**
   * Force show even in production. By default, only renders in development.
   * @default false
   */
  forceShow?: boolean;

  /**
   * Keyboard shortcut to toggle panel. Set to null to disable.
   * @default 'ctrl+shift+f'
   */
  shortcut?: string | null;
}

// ─── FluxDevTools Component ─────────────────────────────────────

export function FluxDevTools({
  position = 'bottom-right',
  network,
  analysisInterval,
  autoStart = true,
  defaultOpen = false,
  verbose = false,
  bridge,
  forceShow = false,
  shortcut = 'ctrl+shift+f',
}: FluxDevToolsProps) {
  // Only render in development mode unless forced
  if (!forceShow && typeof process !== 'undefined' && process.env?.NODE_ENV === 'production') {
    return null;
  }

  return (
    <FluxProvider
      network={network}
      analysisInterval={analysisInterval}
      autoStart={autoStart}
      verbose={verbose}
      bridge={bridge}
    >
      <DevToolsInner
        position={position}
        defaultOpen={defaultOpen}
        shortcut={shortcut}
      />
    </FluxProvider>
  );
}

// ─── Inner Component (uses context) ─────────────────────────────

function DevToolsInner({
  position,
  defaultOpen,
  shortcut,
}: {
  position: string;
  defaultOpen: boolean;
  shortcut: string | null;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const { bridge, state } = useFlux();

  // Inject keyframe animations on mount
  useEffect(() => {
    injectKeyframes();
  }, []);

  // Keyboard shortcut
  useEffect(() => {
    if (!shortcut) return;

    const parts = shortcut.toLowerCase().split('+');
    const key = parts.pop()!;
    const needCtrl = parts.includes('ctrl') || parts.includes('control');
    const needShift = parts.includes('shift');
    const needAlt = parts.includes('alt');
    const needMeta = parts.includes('meta') || parts.includes('cmd');

    function handleKeydown(e: KeyboardEvent) {
      if (
        e.key.toLowerCase() === key &&
        e.ctrlKey === needCtrl &&
        e.shiftKey === needShift &&
        e.altKey === needAlt &&
        e.metaKey === needMeta
      ) {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    }

    window.addEventListener('keydown', handleKeydown);
    return () => window.removeEventListener('keydown', handleKeydown);
  }, [shortcut]);

  const toggle = useCallback(() => setOpen((prev) => !prev), []);

  return (
    <div style={containerStyle} className="flux-devtools">
      {open ? (
        <Panel
          state={state}
          bridge={bridge}
          position={position}
          onClose={toggle}
        />
      ) : (
        <Badge
          state={state}
          position={position}
          onClick={toggle}
        />
      )}
    </div>
  );
}
