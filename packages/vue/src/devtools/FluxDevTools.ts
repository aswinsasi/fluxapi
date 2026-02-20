// ═══════════════════════════════════════════════════════════════════
// <FluxDevTools /> — Drop-in Vue component for live API monitoring
//
// Usage:
//   <script setup>
//   import { FluxDevTools } from '@fluxiapi/vue';
//   </script>
//   <template>
//     <FluxDevTools />
//   </template>
// ═══════════════════════════════════════════════════════════════════

import {
  defineComponent,
  h,
  ref,
  computed,
  onMounted,
  onUnmounted,
  type PropType,
} from 'vue';

import { ScannerBridge, getGlobalBridge, type FluxState } from '../scanner-bridge';
import { C, MONO, SANS, scoreColor, severityColor, methodColor, durationColor, statusColor, fmtMs, fmtBytes, injectStyles, RULE_NAMES } from './styles';

type Tab = 'overview' | 'violations' | 'requests';

export const FluxDevTools = defineComponent({
  name: 'FluxDevTools',

  props: {
    position: {
      type: String as PropType<'bottom-right' | 'bottom-left' | 'top-right' | 'top-left'>,
      default: 'bottom-right',
    },
    network: { type: String, default: 'wifi' },
    analysisInterval: { type: Number, default: 3000 },
    autoStart: { type: Boolean, default: true },
    defaultOpen: { type: Boolean, default: false },
    verbose: { type: Boolean, default: false },
    bridge: { type: Object as PropType<ScannerBridge>, default: undefined },
    forceShow: { type: Boolean, default: false },
    shortcut: { type: String as PropType<string | null>, default: 'ctrl+shift+f' },
  },

  setup(props) {
    // Dev-only guard
    if (!props.forceShow && typeof process !== 'undefined' && process.env?.NODE_ENV === 'production') {
      return () => null;
    }

    const bridge = props.bridge ?? getGlobalBridge({
      network: props.network,
      analysisInterval: props.analysisInterval,
      autoStart: props.autoStart,
      verbose: props.verbose,
    });

    const open = ref(props.defaultOpen);
    const tab = ref<Tab>('overview');
    const expanded = ref<number | null>(null);
    const state = ref<FluxState>({ ...bridge.state });

    let unsub: (() => void) | null = null;

    onMounted(() => {
      injectStyles();

      unsub = bridge.subscribe((s) => {
        state.value = { ...s };
      });

      if (props.autoStart && !bridge.state.scanning) {
        bridge.start();
      }

      // Keyboard shortcut
      if (props.shortcut) {
        const parts = props.shortcut.toLowerCase().split('+');
        const key = parts.pop()!;
        const needCtrl = parts.includes('ctrl');
        const needShift = parts.includes('shift');

        const handler = (e: KeyboardEvent) => {
          if (e.key.toLowerCase() === key && e.ctrlKey === needCtrl && e.shiftKey === needShift) {
            e.preventDefault();
            open.value = !open.value;
          }
        };
        window.addEventListener('keydown', handler);
        onUnmounted(() => window.removeEventListener('keydown', handler));
      }
    });

    onUnmounted(() => {
      unsub?.();
    });

    const s = state;
    const apiRequests = computed(() =>
      s.value.requests.filter((r) => r.type === 'api-rest' || r.type === 'api-graphql')
    );

    // ─── Render Functions ─────────────────────────────────────

    function renderBadge() {
      const sc = s.value.score;
      const clr = scoreColor(sc);
      const critCount = s.value.violations.filter((v) => v.severity === 'critical').length;

      return h('div', {
        class: 'flux-devtools',
        style: {
          position: 'fixed', zIndex: 2147483647, fontFamily: SANS, fontSize: '12px', color: C.fg,
        },
      }, [
        h('div', {
          onClick: () => { open.value = true; },
          style: {
            ...posStyle(props.position),
            width: '52px', height: '52px', borderRadius: '50%', background: C.bg,
            border: `2.5px solid ${clr}`, cursor: 'pointer', display: 'flex',
            alignItems: 'center', justifyContent: 'center', flexDirection: 'column',
            boxShadow: `0 4px 24px rgba(0,0,0,0.5), 0 0 0 1px ${C.border}`,
            transition: 'transform 0.2s', userSelect: 'none',
          },
          title: s.value.scanning
            ? `Scanning... ${s.value.requests.length} requests`
            : `API Score: ${sc}/100 · ${s.value.violations.length} issues`,
        },
          s.value.scanning
            ? [
                h('div', { style: { width: '10px', height: '10px', borderRadius: '50%', background: C.accent, animation: 'fluxPulse 1.5s infinite' } }),
                h('div', { style: { fontSize: '7px', fontWeight: 700, color: C.fg3, marginTop: '2px', letterSpacing: '0.5px' } }, 'SCAN'),
              ]
            : [
                h('div', { style: { fontSize: '16px', fontWeight: 800, color: clr, lineHeight: 1 } }, String(sc)),
                h('div', { style: { fontSize: '7px', fontWeight: 700, color: C.fg3, letterSpacing: '0.5px' } }, critCount > 0 ? `${critCount}!` : 'API'),
              ]
        ),
      ]);
    }

    function renderPanel() {
      const sc = s.value.score;
      const clr = scoreColor(sc);
      const isRight = props.position.includes('right');
      const isBottom = props.position.includes('bottom');

      return h('div', {
        class: 'flux-devtools',
        style: { position: 'fixed', zIndex: 2147483647, fontFamily: SANS, fontSize: '12px', color: C.fg },
      }, [
        h('div', {
          style: {
            position: 'fixed',
            [isBottom ? 'bottom' : 'top']: '16px',
            [isRight ? 'right' : 'left']: '16px',
            width: '390px', maxHeight: 'min(590px, calc(100vh - 40px))',
            background: C.bg, border: `1px solid ${C.border}`, borderRadius: '14px',
            boxShadow: '0 8px 48px rgba(0,0,0,0.65)', display: 'flex',
            flexDirection: 'column', overflow: 'hidden',
          },
        }, [
          // ── Header ──
          h('div', {
            style: {
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '10px 14px', background: C.bg2, borderBottom: `1px solid ${C.border}`,
            },
          }, [
            h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', fontWeight: 700 } }, [
              h('span', '⚡'),
              h('span', 'FluxAPI'),
              s.value.scanning
                ? h('span', { style: { color: C.accent, fontSize: '10px', fontWeight: 500 } }, '● Recording')
                : s.value.report
                  ? h('span', { style: { color: clr, fontSize: '10px', fontWeight: 700 } }, `${sc}/100`)
                  : null,
            ]),
            h('div', { style: { display: 'flex', gap: '4px' } }, [
              s.value.scanning
                ? h('button', { onClick: () => bridge.stop(), style: btnStyle(C.red) }, '⏹ Stop')
                : h('button', { onClick: () => bridge.start(), style: btnStyle(C.green) }, '▶ Scan'),
              h('button', { onClick: () => { open.value = false; }, style: btnStyle(C.fg3) }, '✕'),
            ]),
          ]),

          // ── Tab Bar ──
          h('div', { style: { display: 'flex', borderBottom: `1px solid ${C.border}`, background: C.bg2 } },
            (['overview', 'violations', 'requests'] as Tab[]).map((t) =>
              h('button', {
                key: t,
                onClick: () => { tab.value = t; },
                style: {
                  flex: 1, padding: '7px 0', fontSize: '10px', fontWeight: 600,
                  textAlign: 'center', cursor: 'pointer', background: 'none', border: 'none',
                  color: tab.value === t ? C.accent : C.fg3,
                  borderBottom: `2px solid ${tab.value === t ? C.accent : 'transparent'}`,
                  textTransform: 'uppercase', letterSpacing: '0.5px', transition: 'all 0.15s',
                },
              }, [
                t.charAt(0).toUpperCase() + t.slice(1),
                t === 'violations' && s.value.violations.length > 0
                  ? h('span', { style: { marginLeft: '4px', background: C.red, color: '#fff', borderRadius: '8px', padding: '0 5px', fontSize: '9px', fontWeight: 700 } }, String(s.value.violations.length))
                  : null,
                t === 'requests'
                  ? h('span', { style: { marginLeft: '4px', color: C.fg3, fontSize: '9px' } }, String(apiRequests.value.length))
                  : null,
              ])
            )
          ),

          // ── Body ──
          h('div', { style: { flex: 1, overflow: 'auto', padding: '12px' } }, [
            tab.value === 'overview' ? renderOverview(sc, clr) : null,
            tab.value === 'violations' ? renderViolations() : null,
            tab.value === 'requests' ? renderRequests() : null,
          ]),
        ]),
      ]);
    }

    // ─── Overview Tab ─────────────────────────────────────────

    function renderOverview(sc: number, clr: string) {
      const dash = Math.round((sc / 100) * 251);
      const crits = s.value.violations.filter(v => v.severity === 'critical').length;
      const warns = s.value.violations.filter(v => v.severity === 'warning').length;
      const totalTime = s.value.violations.reduce((a, v) => a + (v.impact?.timeSavedMs ?? 0), 0);
      const totalReqs = s.value.violations.reduce((a, v) => a + (v.impact?.requestsEliminated ?? 0), 0);

      const cats = s.value.report?.score?.categories ?? [];
      const getCat = (c: string) => cats.find((x: any) => x.category === c)?.score ?? 100;

      return [
        // Score ring + info
        h('div', { style: { display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '14px' } }, [
          h('div', { style: { width: '72px', height: '72px', position: 'relative', flexShrink: 0 } }, [
            h('svg', { viewBox: '0 0 100 100', style: { transform: 'rotate(-90deg)' } }, [
              h('circle', { cx: 50, cy: 50, r: 40, fill: 'none', stroke: C.bg3, 'stroke-width': 6 }),
              h('circle', { cx: 50, cy: 50, r: 40, fill: 'none', stroke: clr, 'stroke-width': 6, 'stroke-dasharray': `${dash} 251`, 'stroke-linecap': 'round' }),
            ]),
            h('div', { style: { position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -55%)', fontSize: '22px', fontWeight: 800, color: clr } }, String(sc)),
            h('div', { style: { position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, 50%)', fontSize: '8px', fontWeight: 600, color: clr, textTransform: 'uppercase' } },
              sc >= 90 ? 'A+' : sc >= 70 ? 'B' : sc >= 50 ? 'C' : 'F'
            ),
          ]),
          h('div', [
            h('div', { style: { fontSize: '13px', fontWeight: 700, marginBottom: '4px' } }, 'API Health'),
            h('div', { style: { fontSize: '10px', color: C.fg3 } }, `${apiRequests.value.length} API calls · ${s.value.elapsed}s`),
            s.value.framework ? h('div', { style: { fontSize: '10px', color: C.accent, marginTop: '2px' } }, `🔧 ${s.value.framework}`) : null,
          ]),
        ]),

        // Stats cards
        h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', marginBottom: '14px' } }, [
          statCard(crits, 'Critical', C.red),
          statCard(warns, 'Warnings', C.orange),
          statCard(apiRequests.value.length, 'API Calls', C.blue),
        ]),

        // Impact banner
        (totalTime > 0 || totalReqs > 0)
          ? h('div', { style: { display: 'flex', gap: '10px', padding: '6px 10px', background: C.bg2, borderRadius: '6px', marginBottom: '12px', fontSize: '10px' } }, [
              totalTime > 0 ? h('span', { style: { color: C.blue, fontWeight: 600 } }, `⚡ ${fmtMs(totalTime)} saveable`) : null,
              totalReqs > 0 ? h('span', { style: { color: C.green, fontWeight: 600 } }, `📉 ${totalReqs} fewer requests`) : null,
            ])
          : null,

        // Category bars
        s.value.report ? h('div', { style: { marginBottom: '12px' } }, [
          catBar('⚡', 'Efficiency', getCat('efficiency')),
          catBar('💾', 'Caching', getCat('caching')),
          catBar('🔄', 'Patterns', getCat('patterns')),
        ]) : null,

        // Top issues
        s.value.violations.length > 0
          ? h('div', [
              h('div', { style: { fontSize: '10px', fontWeight: 700, color: C.fg2, marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.5px' } }, 'Top Issues'),
              ...s.value.violations.slice(0, 3).map((v, i) =>
                h('div', { key: i, style: { display: 'flex', alignItems: 'center', gap: '6px', padding: '3px 0', fontSize: '10px' } }, [
                  h('span', { style: { width: '8px', height: '8px', borderRadius: '50%', background: severityColor(v.severity), flexShrink: 0 } }),
                  h('span', { style: { fontSize: '9px', fontWeight: 700, fontFamily: MONO, color: C.accent, padding: '1px 4px', borderRadius: '3px', background: 'rgba(124,106,252,0.12)' } }, v.ruleId),
                  h('span', { style: { color: C.fg2, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, v.title),
                  v.impact?.timeSavedMs > 0 ? h('span', { style: { color: C.blue, fontSize: '9px', fontWeight: 600 } }, `⚡${fmtMs(v.impact.timeSavedMs)}`) : null,
                ])
              ),
            ])
          : null,

        // Empty states
        s.value.violations.length === 0 && !s.value.scanning && apiRequests.value.length > 0
          ? h('div', { style: { textAlign: 'center', padding: '24px', color: C.fg3 } }, [
              h('div', { style: { fontSize: '24px', marginBottom: '6px' } }, '✨'),
              h('div', { style: { color: C.green, fontWeight: 700 } }, 'No API issues found!'),
            ])
          : null,

        s.value.scanning && apiRequests.value.length === 0
          ? h('div', { style: { textAlign: 'center', padding: '24px', color: C.fg3 } }, [
              h('div', { style: { fontSize: '24px', marginBottom: '6px' } }, '📡'),
              'Waiting for API requests...',
            ])
          : null,
      ];
    }

    // ─── Violations Tab ───────────────────────────────────────

    function renderViolations() {
      const viol = s.value.violations;

      if (viol.length === 0) {
        return h('div', { style: { textAlign: 'center', padding: '24px', color: C.fg3 } }, [
          h('div', { style: { fontSize: '24px', marginBottom: '6px' } }, '✨'),
          'No violations detected',
        ]);
      }

      return viol.map((v, i) =>
        h('div', {
          key: i,
          style: { background: C.bg2, border: `1px solid ${C.border}`, borderRadius: '8px', padding: '10px', marginBottom: '8px' },
        }, [
          // Header
          h('div', {
            onClick: () => { expanded.value = expanded.value === i ? null : i; },
            style: { display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', marginBottom: '4px' },
          }, [
            h('span', { style: { width: '8px', height: '8px', borderRadius: '50%', background: severityColor(v.severity), flexShrink: 0 } }),
            h('span', { style: { fontSize: '9px', fontWeight: 700, fontFamily: MONO, color: C.accent, padding: '1px 4px', borderRadius: '3px', background: 'rgba(124,106,252,0.12)' } }, v.ruleId),
            h('span', { style: { fontSize: '10px', color: C.fg3, flex: 0 } }, RULE_NAMES[v.ruleId] || ''),
            h('span', { style: { flex: 1 } }),
            h('span', { style: { color: C.fg3, fontSize: '10px' } }, expanded.value === i ? '▾' : '▸'),
          ]),

          // Title
          h('div', { style: { fontSize: '11px', fontWeight: 600, marginTop: '2px' } }, v.title),

          // Impact pills
          h('div', { style: { display: 'flex', gap: '10px', marginTop: '6px', fontSize: '10px' } }, [
            v.impact?.timeSavedMs > 0 ? h('span', { style: { color: C.blue, fontWeight: 600, fontFamily: MONO } }, `⚡ ${fmtMs(v.impact.timeSavedMs)}`) : null,
            v.impact?.requestsEliminated > 0 ? h('span', { style: { color: C.green, fontWeight: 600, fontFamily: MONO } }, `📉 ${v.impact.requestsEliminated} reqs`) : null,
            v.impact?.bandwidthSavedBytes > 0 ? h('span', { style: { color: C.orange, fontWeight: 600, fontFamily: MONO } }, `💾 ${fmtBytes(v.impact.bandwidthSavedBytes)}`) : null,
          ]),

          // Expanded details
          expanded.value === i
            ? h('div', { style: { marginTop: '8px' } }, [
                h('div', { style: { fontSize: '10px', color: C.fg3, lineHeight: '1.4' } }, v.description),

                // Endpoints
                v.affectedEndpoints?.length > 0
                  ? h('div', { style: { marginTop: '6px' } }, [
                      h('div', { style: { fontSize: '9px', color: C.fg3, fontWeight: 600, marginBottom: '3px' } }, 'ENDPOINTS'),
                      ...v.affectedEndpoints.slice(0, 5).map((ep: string, j: number) =>
                        h('div', { key: j, style: { fontSize: '10px', fontFamily: MONO, color: C.fg2, padding: '1px 0' } }, ep)
                      ),
                    ])
                  : null,

                // Fix code
                v.metadata?.fix
                  ? h('div', { style: { marginTop: '6px' } }, [
                      h('div', { style: { fontSize: '9px', color: C.fg3, fontWeight: 600, marginBottom: '3px' } }, 'FIX'),
                      h('pre', {
                        style: {
                          fontSize: '9px', fontFamily: MONO, color: C.accent2, background: C.bg,
                          borderRadius: '4px', padding: '6px', overflow: 'auto', maxHeight: '120px',
                          lineHeight: '1.4', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                        },
                      }, typeof v.metadata.fix === 'string' ? v.metadata.fix : (v.metadata.fix as any)?.code ?? ''),
                    ])
                  : null,
              ])
            : null,
        ])
      );
    }

    // ─── Requests Tab ─────────────────────────────────────────

    function renderRequests() {
      const reqs = [...apiRequests.value].sort((a, b) => b.startTime - a.startTime);

      if (reqs.length === 0) {
        return h('div', { style: { textAlign: 'center', padding: '24px', color: C.fg3 } }, [
          h('div', { style: { fontSize: '24px', marginBottom: '6px' } }, '📡'),
          'No API requests captured yet',
        ]);
      }

      return [
        h('div', { style: { fontSize: '10px', color: C.fg3, marginBottom: '6px' } }, `${reqs.length} API requests (newest first)`),
        ...reqs.slice(0, 50).map((r, i) => {
          const path = r.urlParts?.pathname ?? '';
          const short = path.length > 40 ? '…' + path.slice(-37) : path;
          const status = r.response?.status ?? 0;
          const dur = r.duration ?? 0;

          return h('div', {
            key: i,
            style: { display: 'flex', alignItems: 'center', gap: '6px', padding: '4px 0', borderBottom: `1px solid ${C.border}`, fontSize: '10px' },
          }, [
            h('span', {
              style: {
                fontSize: '9px', fontWeight: 700, fontFamily: MONO, padding: '1px 4px', borderRadius: '3px',
                color: methodColor(r.method), background: `${methodColor(r.method)}18`, minWidth: '32px', textAlign: 'center',
              },
            }, r.method),
            h('span', {
              style: { flex: 1, color: C.fg2, fontFamily: MONO, fontSize: '10px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
              title: r.url,
            }, short),
            status > 0 ? h('span', { style: { fontFamily: MONO, fontSize: '9px', fontWeight: 600, color: statusColor(status), minWidth: '24px', textAlign: 'center' } }, String(status)) : null,
            h('span', { style: { fontFamily: MONO, fontWeight: 600, fontSize: '10px', color: durationColor(dur), minWidth: '40px', textAlign: 'right' } }, `${dur}ms`),
          ]);
        }),
      ];
    }

    // ─── Helpers ───────────────────────────────────────────────

    function statCard(num: number, label: string, color: string) {
      return h('div', {
        style: { background: C.bg2, border: `1px solid ${C.border}`, borderRadius: '8px', padding: '8px', textAlign: 'center' },
      }, [
        h('div', { style: { fontSize: '18px', fontWeight: 800, color, lineHeight: '1.2' } }, String(num)),
        h('div', { style: { fontSize: '9px', color: C.fg3, textTransform: 'uppercase', letterSpacing: '0.3px' } }, label),
      ]);
    }

    function catBar(icon: string, name: string, score: number) {
      const clr = score >= 70 ? C.green : score >= 50 ? C.orange : C.red;
      return h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px', fontSize: '11px' } }, [
        h('span', icon),
        h('span', { style: { width: '70px', color: C.fg2 } }, name),
        h('div', { style: { flex: 1, height: '6px', borderRadius: '3px', background: C.bg3, overflow: 'hidden' } }, [
          h('div', { style: { width: `${score}%`, height: '100%', borderRadius: '3px', background: clr, transition: 'width 0.5s ease' } }),
        ]),
        h('span', { style: { width: '32px', textAlign: 'right', fontWeight: 700, fontFamily: MONO, fontSize: '10px', color: clr } }, `${score}%`),
      ]);
    }

    function btnStyle(color: string): Record<string, string> {
      return { background: 'none', border: 'none', color, cursor: 'pointer', fontSize: '10px', padding: '2px 4px', borderRadius: '4px', lineHeight: '1' };
    }

    function posStyle(pos: string): Record<string, string> {
      switch (pos) {
        case 'bottom-left': return { position: 'fixed', bottom: '16px', left: '16px' };
        case 'top-right': return { position: 'fixed', top: '16px', right: '16px' };
        case 'top-left': return { position: 'fixed', top: '16px', left: '16px' };
        default: return { position: 'fixed', bottom: '16px', right: '16px' };
      }
    }

    // ─── Main Render ──────────────────────────────────────────

    return () => open.value ? renderPanel() : renderBadge();
  },
});
