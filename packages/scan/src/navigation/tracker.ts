// ═══════════════════════════════════════════════════════════════════
// @fluxapi/scan - Navigation Tracker
// Monitors route changes (pushState, popstate, hashchange) to:
// 1. Provide navigation context for each request
// 2. Build navigation transition matrix for prefetch analysis (Week 2)
// 3. Track page dwell times for engagement analysis
// ═══════════════════════════════════════════════════════════════════

import type { NavigationEvent, NavigationContext } from '../types';
import { generateId } from '../utils';

// ─── State ──────────────────────────────────────────────────────

let _isTracking = false;
let _currentRoute: string = '';
let _previousRoute: string | null = null;
let _lastNavigationTime: number = 0;
let _pageLoadTime: number = 0;
let _navigations: NavigationEvent[] = [];
let _cleanupFns: (() => void)[] = [];

// ─── Route Extraction ───────────────────────────────────────────

/**
 * Extract a normalized route from the current URL.
 * Removes hash fragments and query params for pattern matching,
 * but preserves the path structure.
 */
function getCurrentRoute(): string {
  if (typeof window === 'undefined') return '/';
  
  const { pathname, hash } = window.location;
  
  // For hash-based routing (Vue, some React apps)
  if (hash && hash.length > 1) {
    const hashRoute = hash.replace(/^#\/?/, '/');
    // If hash looks like a route, use it
    if (hashRoute.match(/^\/[a-zA-Z]/)) {
      return hashRoute.split('?')[0]; // Remove query params from hash
    }
  }
  
  return pathname;
}

/**
 * Get the current page lifecycle state.
 */
function getPageState(): 'loading' | 'interactive' | 'complete' {
  if (typeof document === 'undefined') return 'complete';
  
  switch (document.readyState) {
    case 'loading': return 'loading';
    case 'interactive': return 'interactive';
    case 'complete': return 'complete';
    default: return 'complete';
  }
}

// ─── Navigation Event Recording ─────────────────────────────────

function recordNavigation(
  toRoute: string,
  trigger: NavigationEvent['trigger'],
): void {
  const now = performance.now();
  const fromRoute = _currentRoute;
  
  // Don't record if same route (some frameworks fire multiple events)
  if (toRoute === _currentRoute && trigger !== 'initial') return;

  const event: NavigationEvent = {
    id: generateId(),
    fromRoute,
    toRoute,
    timestamp: now,
    trigger,
    dwellTime: _lastNavigationTime > 0 ? now - _lastNavigationTime : 0,
  };

  _navigations.push(event);
  _previousRoute = _currentRoute;
  _currentRoute = toRoute;
  _lastNavigationTime = now;
}

// ─── History API Interception ───────────────────────────────────

let _originalPushState: typeof history.pushState | null = null;
let _originalReplaceState: typeof history.replaceState | null = null;

function interceptHistory(): void {
  if (typeof window === 'undefined' || typeof history === 'undefined') return;

  _originalPushState = history.pushState;
  _originalReplaceState = history.replaceState;

  // Intercept pushState
  history.pushState = function fluxPushState(
    data: any,
    unused: string,
    url?: string | URL | null,
  ): void {
    _originalPushState!.call(this, data, unused, url);
    // Wait a tick for the URL to actually update
    setTimeout(() => {
      recordNavigation(getCurrentRoute(), 'pushState');
    }, 0);
  };

  // Intercept replaceState
  history.replaceState = function fluxReplaceState(
    data: any,
    unused: string,
    url?: string | URL | null,
  ): void {
    _originalReplaceState!.call(this, data, unused, url);
    setTimeout(() => {
      recordNavigation(getCurrentRoute(), 'replaceState');
    }, 0);
  };
}

function restoreHistory(): void {
  if (_originalPushState) {
    history.pushState = _originalPushState;
    _originalPushState = null;
  }
  if (_originalReplaceState) {
    history.replaceState = _originalReplaceState;
    _originalReplaceState = null;
  }
}

// ─── Event Listeners ────────────────────────────────────────────

function setupEventListeners(): void {
  if (typeof window === 'undefined') return;

  // popstate fires on browser back/forward
  const onPopState = () => {
    recordNavigation(getCurrentRoute(), 'popstate');
  };

  // hashchange for hash-based routing
  const onHashChange = () => {
    recordNavigation(getCurrentRoute(), 'hashchange');
  };

  window.addEventListener('popstate', onPopState);
  window.addEventListener('hashchange', onHashChange);

  _cleanupFns.push(
    () => window.removeEventListener('popstate', onPopState),
    () => window.removeEventListener('hashchange', onHashChange),
  );
}

// ─── Transition Matrix Builder ──────────────────────────────────

export interface TransitionMatrix {
  /** Map of "from -> to -> count" */
  transitions: Map<string, Map<string, number>>;
  /** Total navigations from each route */
  totals: Map<string, number>;
}

/**
 * Build a first-order Markov transition matrix from recorded navigations.
 * Used by Week 2 analysis to detect prefetch opportunities.
 */
export function buildTransitionMatrix(): TransitionMatrix {
  const transitions = new Map<string, Map<string, number>>();
  const totals = new Map<string, number>();

  for (const nav of _navigations) {
    if (nav.trigger === 'initial') continue; // Skip initial load
    
    const from = nav.fromRoute;
    const to = nav.toRoute;
    
    if (!transitions.has(from)) {
      transitions.set(from, new Map());
    }
    
    const fromMap = transitions.get(from)!;
    fromMap.set(to, (fromMap.get(to) || 0) + 1);
    totals.set(from, (totals.get(from) || 0) + 1);
  }

  return { transitions, totals };
}

/**
 * Get transition probabilities from a specific route.
 * Returns array sorted by probability (highest first).
 */
export function getTransitionProbabilities(
  fromRoute: string,
): Array<{ route: string; probability: number; count: number }> {
  const matrix = buildTransitionMatrix();
  const fromMap = matrix.transitions.get(fromRoute);
  const total = matrix.totals.get(fromRoute) || 0;

  if (!fromMap || total === 0) return [];

  const probabilities: Array<{ route: string; probability: number; count: number }> = [];
  
  fromMap.forEach((count, route) => {
    probabilities.push({
      route,
      probability: count / total,
      count,
    });
  });

  return probabilities.sort((a, b) => b.probability - a.probability);
}

// ─── Public API ─────────────────────────────────────────────────

/**
 * Start tracking navigation events.
 */
export function startNavigationTracking(): void {
  if (_isTracking) return;
  
  _isTracking = true;
  _pageLoadTime = performance.now();
  _currentRoute = getCurrentRoute();
  _lastNavigationTime = _pageLoadTime;
  
  // Record initial page load
  recordNavigation(_currentRoute, 'initial');
  
  // Set up interception
  interceptHistory();
  setupEventListeners();
}

/**
 * Stop tracking and clean up.
 */
export function stopNavigationTracking(): void {
  if (!_isTracking) return;
  
  _isTracking = false;
  restoreHistory();
  _cleanupFns.forEach(fn => fn());
  _cleanupFns = [];
}

/**
 * Get all recorded navigation events.
 */
export function getNavigations(): NavigationEvent[] {
  return [..._navigations];
}

/**
 * Get current navigation context (called by observer for each request).
 */
export function getNavigationContext(): NavigationContext {
  return {
    currentRoute: _currentRoute || getCurrentRoute(),
    previousRoute: _previousRoute,
    timeSinceNavigation: _lastNavigationTime > 0
      ? performance.now() - _lastNavigationTime
      : performance.now() - _pageLoadTime,
    pageState: getPageState(),
  };
}

/**
 * Reset all navigation data (for testing).
 */
export function resetNavigation(): void {
  _navigations = [];
  _currentRoute = '';
  _previousRoute = null;
  _lastNavigationTime = 0;
}
