// ═══════════════════════════════════════════════════════════════════
// @fluxapi/scan - WebSocket Monitor
// Monkey-patches the WebSocket constructor to track connections,
// message frequency, subscription patterns, and reconnection issues.
//
// Stage 3: Smarter Scanner
// ═══════════════════════════════════════════════════════════════════

import type { WebSocketConnection, WebSocketSummary, WebSocketEvent, FluxEventHandler } from '../types';
import { generateId } from '../utils';

// ─── State ──────────────────────────────────────────────────────

let _isActive = false;
let _originalWebSocket: typeof WebSocket | null = null;
const _connections: WebSocketConnection[] = [];
const _handlers: FluxEventHandler[] = [];
let _totalMessages = 0;
let _startTime = 0;

// ─── Event Emitter ──────────────────────────────────────────────

function emit(type: 'websocket:open' | 'websocket:message' | 'websocket:close', data: WebSocketEvent): void {
  for (const handler of _handlers) {
    try { handler({ type, data }); } catch { /* ignore */ }
  }
}

export function onWsEvent(handler: FluxEventHandler): () => void {
  _handlers.push(handler);
  return () => {
    const idx = _handlers.indexOf(handler);
    if (idx !== -1) _handlers.splice(idx, 1);
  };
}

// ─── Channel Detection ──────────────────────────────────────────

function detectChannel(data: string): string | null {
  try {
    const parsed = JSON.parse(data);
    // Common patterns: { type: 'subscribe', channel: 'orders' }
    // Socket.IO: { event: 'join', data: { room: 'chat' } }
    // ActionCable: { command: 'subscribe', identifier: '{"channel":"ChatChannel"}' }
    // Phoenix: { topic: 'room:lobby', event: 'phx_join' }
    return parsed.channel || parsed.topic || parsed.room ||
           parsed.event || parsed.type || parsed.action || null;
  } catch {
    return null;
  }
}

function estimateSize(data: any): number {
  if (typeof data === 'string') return new Blob([data]).size;
  if (data instanceof Blob) return data.size;
  if (data instanceof ArrayBuffer) return data.byteLength;
  return 0;
}

// ─── Interceptor ────────────────────────────────────────────────

function interceptWebSocket(): void {
  if (typeof WebSocket === 'undefined' || _originalWebSocket) return;

  _originalWebSocket = WebSocket;

  const OrigWS = WebSocket;

  // Replace global WebSocket with our interceptor
  (globalThis as any).WebSocket = function FluxWebSocket(
    url: string | URL,
    protocols?: string | string[],
  ) {
    const ws = new OrigWS(url, protocols);
    const wsUrl = typeof url === 'string' ? url : url.href;

    const conn: WebSocketConnection = {
      url: wsUrl,
      openedAt: 0,
      closedAt: null,
      messagesReceived: 0,
      messagesSent: 0,
      avgMessageSize: 0,
      channels: [],
    };

    let totalSize = 0;

    // Track open
    const origOnOpen = ws.onopen;
    ws.addEventListener('open', () => {
      conn.openedAt = performance.now();
      _connections.push(conn);

      emit('websocket:open', {
        id: generateId(), url: wsUrl, eventType: 'open',
        timestamp: conn.openedAt, messageSize: null, direction: null, channel: null,
      });
    });

    // Track incoming messages
    ws.addEventListener('message', (event) => {
      conn.messagesReceived++;
      _totalMessages++;

      const size = estimateSize(event.data);
      totalSize += size;
      conn.avgMessageSize = Math.round(totalSize / (conn.messagesReceived + conn.messagesSent));

      const channel = typeof event.data === 'string' ? detectChannel(event.data) : null;
      if (channel && !conn.channels.includes(channel)) {
        conn.channels.push(channel);
      }

      emit('websocket:message', {
        id: generateId(), url: wsUrl, eventType: 'message',
        timestamp: performance.now(), messageSize: size,
        direction: 'received', channel,
      });
    });

    // Track close
    ws.addEventListener('close', () => {
      conn.closedAt = performance.now();

      emit('websocket:close', {
        id: generateId(), url: wsUrl, eventType: 'close',
        timestamp: conn.closedAt, messageSize: null, direction: null, channel: null,
      });
    });

    // Intercept send
    const origSend = ws.send.bind(ws);
    ws.send = function(data: string | ArrayBufferLike | Blob | ArrayBufferView) {
      conn.messagesSent++;
      _totalMessages++;

      const size = estimateSize(data);
      totalSize += size;
      conn.avgMessageSize = Math.round(totalSize / (conn.messagesReceived + conn.messagesSent));

      const channel = typeof data === 'string' ? detectChannel(data) : null;
      if (channel && !conn.channels.includes(channel)) {
        conn.channels.push(channel);
      }

      return origSend(data);
    };

    return ws;
  } as any;

  // Copy static properties
  (globalThis.WebSocket as any).CONNECTING = OrigWS.CONNECTING;
  (globalThis.WebSocket as any).OPEN = OrigWS.OPEN;
  (globalThis.WebSocket as any).CLOSING = OrigWS.CLOSING;
  (globalThis.WebSocket as any).CLOSED = OrigWS.CLOSED;
  (globalThis.WebSocket as any).prototype = OrigWS.prototype;
}

// ─── Public API ─────────────────────────────────────────────────

export function startWebSocketMonitoring(): void {
  if (_isActive) return;
  _isActive = true;
  _startTime = performance.now();
  _connections.length = 0;
  _totalMessages = 0;
  interceptWebSocket();
}

export function stopWebSocketMonitoring(): void {
  if (!_isActive) return;
  _isActive = false;

  // Restore original WebSocket
  if (_originalWebSocket) {
    globalThis.WebSocket = _originalWebSocket;
    _originalWebSocket = null;
  }
}

export function getWebSocketSummary(): WebSocketSummary {
  const elapsed = (performance.now() - _startTime) / 1000;
  return {
    connections: [..._connections],
    totalMessages: _totalMessages,
    messagesPerSecond: elapsed > 0 ? Math.round((_totalMessages / elapsed) * 100) / 100 : 0,
  };
}

export function resetWebSocketMonitor(): void {
  _connections.length = 0;
  _totalMessages = 0;
  _startTime = performance.now();
}
