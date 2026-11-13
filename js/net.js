// Friends connect browser to browser (WebRTC data channels through PeerJS). One player hosts the room; the others
// join with a 4-letter code. The free PeerJS broker introduces the browsers to each other. When two devices cannot
// open a direct link (very common on the same home Wi-Fi), the same messages go through a public message relay
// instead: see relay.js. No game server is needed either way, so GitHub Pages can host it.
import { RelayHost, RelayGuest, relayUrls, onShow } from './relay.js?v=8';

const PREFIX = 'jugnupur-chorpolice-v1-';
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

export function makeCode() { let s = ''; for (let k = 0; k < 4; k++) s += LETTERS[Math.floor(Math.random() * LETTERS.length)]; return s; }
export function cleanCode(s) { return String(s || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4); }

function peerOptions() {
  const q = new URLSearchParams(location.search), ps = q.get('ps'), o = { debug: 1 };
  // Helpers for the direct link: two address-finders, and one free relay for it (not checked from the build machine,
  // so the game does not count on it: the backup route in relay.js is what covers devices that cannot link directly).
  o.config = { sdpSemantics: 'unified-plan', iceServers: [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] },
    { urls: ['turn:staticauth.openrelay.metered.ca:80', 'turns:staticauth.openrelay.metered.ca:443?transport=tcp'], username: 'openrelayproject', credential: 'openrelayproject' },
  ] };
  if (ps) { const [host, port] = ps.split(':'); o.host = host; o.port = +(port || 9000); o.path = q.get('pp') || '/'; o.secure = false; } // test override: ?ps=localhost:9000
  return o;
}
function PeerCtor() { return window.Peer || (window.peerjs && window.peerjs.Peer); }

export class HostNet {
  constructor(handlers) {
    this.h = handlers; this.conns = new Map(); this.peer = null; this.hub = null; this.code = ''; this.seq = 0; this.closed = false;
    this.unshow = onShow(() => this._again(0));
  }
  // the link to the matchmaking service dropped (new guests need it): get back on it, without hammering the service
  _again(ms) {
    clearTimeout(this.rt);
    this.rt = setTimeout(() => { const p = this.peer; if (p && !this.closed && p.disconnected && !p.destroyed) { try { p.reconnect(); } catch (e) {} } }, ms);
  }
  open(tries = 5) {
    return new Promise((resolve, reject) => {
      const P = PeerCtor();
      // if the matchmaking service cannot be reached, the room can still live on the backup route alone
      const relayOnly = (code, why) => {
        const hub = this._hub(code), t0 = performance.now();
        if (!hub) return reject(new Error(why));
        const iv = setInterval(() => {
          if (hub.up && !this.closed) { clearInterval(iv); this.code = code; resolve(code); }
          else if (this.closed || performance.now() - t0 > 8000) { clearInterval(iv); this._dropHub(); reject(new Error(why)); }
        }, 150);
      };
      if (!P) return relayOnly(makeCode(), 'Multiplayer library failed to load.');
      const attempt = left => {
        const code = makeCode();
        let opened = false, over = false;
        this._hub(code);   // listen on the backup route from the first moment
        const peer = new P(PREFIX + code, peerOptions());
        const giveUp = why => { if (over) return; over = true; clearTimeout(timer); try { peer.destroy(); } catch (e) {} relayOnly(code, why); };
        const timer = setTimeout(() => { if (!opened) giveUp('Could not reach the matchmaking service. Check your internet and try again.'); }, 15000);
        peer.on('open', () => { if (over) return; opened = true; clearTimeout(timer); this.peer = peer; this.code = code; resolve(code); });
        peer.on('connection', conn => this._incoming(conn));
        peer.on('disconnected', () => this._again(1500));
        peer.on('error', err => {
          if (opened) { console.warn('host peer error', err && err.type, err && err.message); return; }
          if (over) return;
          if (err && err.type === 'unavailable-id' && left > 0) { over = true; clearTimeout(timer); try { peer.destroy(); } catch (e) {} this._dropHub(); attempt(left - 1); }
          else giveUp('Could not create the room (' + ((err && err.type) || 'network error') + ').');
        });
      };
      attempt(tries);
    });
  }
  _hub(code) { if (!this.hub && relayUrls().length) this.hub = new RelayHost(code, conn => this._incoming(conn)); return this.hub; }
  _dropHub() { if (this.hub) { this.hub.close(); this.hub = null; } }
  _incoming(conn) {   // a guest's link, direct or through the relay: both kinds behave the same from here on
    const pid = 'p' + (++this.seq);
    conn.on('open', () => { this.conns.set(pid, conn); this.h.onJoin && this.h.onJoin(pid); });
    conn.on('data', d => { if (this.conns.get(pid) === conn) this.h.onData && this.h.onData(pid, d); });
    const gone = () => { if (this.conns.get(pid) === conn) { this.conns.delete(pid); this.h.onLeave && this.h.onLeave(pid); } };
    conn.on('close', gone); conn.on('error', gone);
  }
  linkOf(pid) { const c = this.conns.get(pid); return c ? (c.relay ? 'relay' : 'direct') : ''; }
  send(pid, msg) { const c = this.conns.get(pid); if (c && c.open) { try { c.send(msg); } catch (e) {} } }
  broadcast(msg, except) { for (const [pid, c] of this.conns) if (pid !== except && c.open) { try { c.send(msg); } catch (e) {} } }
  kick(pid) { const c = this.conns.get(pid); if (c) { this.conns.delete(pid); try { c.close(); } catch (e) {} } }
  close() { this.closed = true; clearTimeout(this.rt); this.unshow(); for (const c of this.conns.values()) { try { c.close(); } catch (e) {} } this.conns.clear(); this._dropHub(); if (this.peer) { try { this.peer.destroy(); } catch (e) {} } }
}

export class ClientNet {
  constructor(handlers) { this.h = handlers; this.peer = null; this.conn = null; this.relay = null; this.mode = ''; this.closed = false; }
  // The direct link is tried first. If it has not opened after a few seconds the backup route is tried as well, and
  // whichever of the two comes up is used. says(text) tells the waiting player what is going on. hurry: this device
  // needed the backup route last time, so give the direct link two seconds instead of five.
  connect(code, says, hurry) {
    return new Promise((resolve, reject) => {
      const P = PeerCtor(), canRelay = relayUrls().length > 0, t0 = performance.now(), timers = [], hold = hurry ? 2000 : 5000;
      const NO_ROOM = 'No room with that code. Ask your friend for the code again.';
      let done = false, dead = '', relayT0 = 0;
      let stage = 0;         // 0 not yet at the matchmaking service, 1 there
      let unavail = false;   // the service says no such room is registered there right now
      const later = (ms, f) => timers.push(setTimeout(f, ms));
      const settle = () => { done = true; timers.forEach(clearTimeout); };
      const fail = msg => { if (done) return; settle(); this.close(); reject(new Error(msg)); };
      const win = mode => {
        if (done) return; settle(); this.mode = mode;
        if (mode === 'relay') { const c = this.conn, p = this.peer; this.conn = this.peer = null; try { if (c) c.close(); } catch (e) {} try { if (p) p.destroy(); } catch (e) {} }
        else if (this.relay) { this.relay.close(); this.relay = null; }
        resolve(mode);
      };
      // the backup route is used once the direct link has had its few seconds, or at once if the direct link cannot work
      const useRelay = () => { if (!done && this.relay && this.relay.ready && (dead || unavail || performance.now() - t0 >= hold)) this.relay.commit(); };
      const startRelay = () => {
        if (done || this.relay || this.closed || !canRelay) return;
        relayT0 = performance.now();
        if (says && !hurry) says(unavail || dead ? 'Looking for the room…' : 'The direct link is slow to open. Trying the backup route too…');
        this.relay = new RelayGuest(code, {
          onReady: useRelay,
          onOpen: () => win('relay'),
          onData: d => { if (this.mode === 'relay' && this.h.onData) this.h.onData(d); },
          onClose: () => { if (this.mode === 'relay' && !this.closed && this.h.onClose) this.h.onClose(); },
        });
      };
      // the direct link cannot work at all (the matchmaking service is out of reach): it is up to the backup route
      const directDead = why => {
        if (done || dead) return;
        dead = why;
        if (!canRelay) return fail(why);
        startRelay(); useRelay();
        later(Math.max(500, 9000 - (performance.now() - relayT0)), () => { if (!this.relay || !this.relay.ready) fail(why); });
      };
      later(hurry ? 0 : 2000, startRelay); later(hold, useRelay);
      later(35000, () => fail(dead || unavail ? 'Could not connect to the room. Try again.'
        : stage === 0 && !(this.relay && this.relay.anyUp) ? 'Could not reach the matchmaking service. Check your internet and try again.'
        : stage === 0 ? 'Could not find that room. Check the code, and that your friend still has the room open.'
        : 'Found the room, but could not link the two devices. Check that the game is open and on screen on your friend\'s device, then try again. If it keeps failing, put one device on mobile data or a hotspot.'));
      if (canRelay && new URLSearchParams(location.search).get('link') === 'relay') {   // ?link=relay: skip the direct link (for testing the backup route)
        unavail = true; startRelay(); later(12000, () => { if (!this.relay || !this.relay.ready) fail('The backup route could not find that room.'); });
        return;
      }
      if (!P) { directDead('Multiplayer library failed to load.'); return; }
      const peer = this.peer = new P(peerOptions());
      const dial = () => {
        const conn = this.conn = peer.connect(PREFIX + code, { reliable: true, serialization: 'json' });
        conn.on('open', () => { if (!done && this.conn === conn) win('direct'); });
        conn.on('data', d => { if (this.conn === conn && this.mode === 'direct') this.h.onData && this.h.onData(d); });
        conn.on('close', () => { if (!this.closed && this.mode === 'direct' && this.conn === conn) this.h.onClose && this.h.onClose(); });
        conn.on('error', () => { if (!done && this.conn === conn && !unavail) directDead('Could not connect to the room.'); });
      };
      peer.on('error', err => {
        if (done || dead) { console.warn('client peer error', err && err.type); return; }
        if (err && err.type === 'peer-unavailable') {
          // Not registered at the service right now: a wrong code, a room that has closed, or a host whose own link to the
          // service dropped for a moment. (The service says so once, at once, and stays silent if asked again.) So ask the
          // backup route, ask the service twice more, and say "no such room" if nobody has answered after ten seconds.
          if (unavail) return;
          unavail = true; startRelay(); useRelay();
          for (const ms of [2500, 5500]) later(ms, () => { if (!done && !dead && !this.closed) dial(); });
          later(10000, () => { if (!this.relay || !this.relay.ready) fail(NO_ROOM); });
          return;
        }
        directDead('Could not connect (' + ((err && err.type) || 'network error') + ').');
      });
      peer.on('disconnected', () => setTimeout(() => { if (!this.closed && this.peer === peer && peer.disconnected && !peer.destroyed) { try { peer.reconnect(); } catch (e) {} } }, 1500));
      let dialled = false;
      peer.on('open', () => { stage = 1; if (!dialled) { dialled = true; dial(); } });   // 'open' fires again after a reconnect to the service: do not dial twice
    });
  }
  send(msg) {
    if (this.mode === 'relay') { if (this.relay) this.relay.send(msg); }
    else if (this.conn && this.conn.open) { try { this.conn.send(msg); } catch (e) {} }
  }
  close() {
    this.closed = true;
    if (this.relay) { try { this.relay.close(); } catch (e) {} }
    if (this.conn) { try { this.conn.close(); } catch (e) {} }
    if (this.peer) { try { this.peer.destroy(); } catch (e) {} }
  }
}
