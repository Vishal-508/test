// Friends connect browser to browser (WebRTC data channels through PeerJS). One player hosts the
// room; the others join with a 4-letter code. The only outside service is the free PeerJS broker
// that introduces the browsers to each other. No game server is needed, so GitHub Pages can host it.
const PREFIX = 'jugnupur-chorpolice-v1-';
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

export function makeCode() { let s = ''; for (let k = 0; k < 4; k++) s += LETTERS[Math.floor(Math.random() * LETTERS.length)]; return s; }
export function cleanCode(s) { return String(s || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4); }

function peerOptions() {
  const q = new URLSearchParams(location.search), ps = q.get('ps'), o = { debug: 1 };
  // Ways for two devices to find each other. Several address-finders, plus relays for networks that will not let
  // devices talk directly (many home routers, hostels and offices block device-to-device traffic on the same Wi-Fi).
  o.config = { sdpSemantics: 'unified-plan', iceServers: [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] },
    { urls: ['turn:eu-0.turn.peerjs.com:3478', 'turn:us-0.turn.peerjs.com:3478'], username: 'peerjs', credential: 'peerjsp' },
    { urls: ['turn:openrelay.metered.ca:80', 'turn:openrelay.metered.ca:443', 'turn:openrelay.metered.ca:443?transport=tcp', 'turns:openrelay.metered.ca:443?transport=tcp'], username: 'openrelayproject', credential: 'openrelayproject' },
  ] };
  if (ps) { const [host, port] = ps.split(':'); o.host = host; o.port = +(port || 9000); o.path = q.get('pp') || '/'; o.secure = false; } // test override: ?ps=localhost:9000
  return o;
}
function PeerCtor() { return window.Peer || (window.peerjs && window.peerjs.Peer); }

export class HostNet {
  constructor(handlers) { this.h = handlers; this.conns = new Map(); this.peer = null; this.code = ''; this.seq = 0; this.closed = false; }
  open(tries = 5) {
    return new Promise((resolve, reject) => {
      const P = PeerCtor();
      if (!P) return reject(new Error('Multiplayer library failed to load.'));
      const attempt = left => {
        const code = makeCode();
        let opened = false;
        const peer = new P(PREFIX + code, peerOptions());
        const timer = setTimeout(() => { if (!opened) { try { peer.destroy(); } catch (e) {} reject(new Error('Could not reach the matchmaking service. Check your internet and try again.')); } }, 15000);
        peer.on('open', () => { opened = true; clearTimeout(timer); this.peer = peer; this.code = code; resolve(code); });
        peer.on('connection', conn => this._incoming(conn));
        peer.on('disconnected', () => { if (!this.closed) { try { peer.reconnect(); } catch (e) {} } });
        peer.on('error', err => {
          if (opened) { console.warn('host peer error', err && err.type, err && err.message); return; }
          clearTimeout(timer); try { peer.destroy(); } catch (e) {}
          if (err && err.type === 'unavailable-id' && left > 0) attempt(left - 1);
          else reject(new Error('Could not create the room (' + ((err && err.type) || 'network error') + ').'));
        });
      };
      attempt(tries);
    });
  }
  _incoming(conn) {
    const pid = 'p' + (++this.seq);
    conn.on('open', () => { this.conns.set(pid, conn); this.h.onJoin && this.h.onJoin(pid); });
    conn.on('data', d => { if (this.conns.get(pid) === conn) this.h.onData && this.h.onData(pid, d); });
    const gone = () => { if (this.conns.get(pid) === conn) { this.conns.delete(pid); this.h.onLeave && this.h.onLeave(pid); } };
    conn.on('close', gone); conn.on('error', gone);
  }
  send(pid, msg) { const c = this.conns.get(pid); if (c && c.open) { try { c.send(msg); } catch (e) {} } }
  broadcast(msg, except) { for (const [pid, c] of this.conns) if (pid !== except && c.open) { try { c.send(msg); } catch (e) {} } }
  kick(pid) { const c = this.conns.get(pid); if (c) { this.conns.delete(pid); try { c.close(); } catch (e) {} } }
  close() { this.closed = true; for (const c of this.conns.values()) { try { c.close(); } catch (e) {} } this.conns.clear(); if (this.peer) { try { this.peer.destroy(); } catch (e) {} } }
}

export class ClientNet {
  constructor(handlers) { this.h = handlers; this.peer = null; this.conn = null; this.closed = false; }
  connect(code) {
    return new Promise((resolve, reject) => {
      const P = PeerCtor();
      if (!P) return reject(new Error('Multiplayer library failed to load.'));
      let done = false;
      const fail = msg => { if (done) return; done = true; clearTimeout(timer); this.close(); reject(new Error(msg)); };
      let stage = 0;   // 0 not yet at the matchmaking service, 1 there, 2 the room answered
      const timer = setTimeout(() => fail(stage === 0 ? 'Could not reach the matchmaking service. Check your internet and try again.'
        : 'Found the room, but the two devices could not open a link to each other. Try again; if it keeps failing, put one device on mobile data or a hotspot (some Wi-Fi routers block devices from talking to each other).'), 35000);
      const peer = this.peer = new P(peerOptions());
      let retries = 2;   // the host's link to the matchmaking service can drop for a moment: ask again before giving up
      const dial = () => {
        const conn = this.conn = peer.connect(PREFIX + code, { reliable: true, serialization: 'json' });
        conn.on('open', () => { if (done || this.conn !== conn) return; done = true; clearTimeout(timer); resolve(); });
        conn.on('data', d => { if (this.conn === conn) this.h.onData && this.h.onData(d); });
        conn.on('close', () => { if (!this.closed && done && this.conn === conn) this.h.onClose && this.h.onClose(); });
        conn.on('error', () => { if (!done && this.conn === conn && retries <= 0) fail('Could not connect to the room.'); });
      };
      peer.on('error', err => {
        if (done) { console.warn('client peer error', err && err.type); return; }
        if (err && err.type === 'peer-unavailable' && retries-- > 0) { setTimeout(() => { if (!done && !this.closed) dial(); }, 2500); return; }
        fail(err && err.type === 'peer-unavailable' ? 'No room with that code. Ask your friend for the code again.' : 'Could not connect (' + ((err && err.type) || 'network error') + ').');
      });
      peer.on('disconnected', () => { if (!this.closed) { try { peer.reconnect(); } catch (e) {} } });
      let dialled = false;
      peer.on('open', () => { stage = Math.max(stage, 1); if (!dialled) { dialled = true; dial(); } });   // 'open' fires again after a reconnect to the service: do not dial twice
    });
  }
  send(msg) { if (this.conn && this.conn.open) { try { this.conn.send(msg); } catch (e) {} } }
  close() { this.closed = true; if (this.conn) { try { this.conn.close(); } catch (e) {} } if (this.peer) { try { this.peer.destroy(); } catch (e) {} } }
}
