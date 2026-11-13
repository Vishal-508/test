// The backup route. Two devices on the same Wi-Fi often cannot open a direct link to each other: the router will
// not pass traffic between its own devices, or a phone cannot look up the other device's hidden local name. When
// that happens the game's messages travel through a free public message relay instead (MQTT over a secure
// WebSocket). That is slower than a direct link, so it is only used when the direct link will not open.
// The relays are public test services: no sign-up, no promise of uptime. So several are tried at once, the first
// to reach the host is used, and the game moves to another one if it goes quiet. Nothing here needs a server of
// our own, so GitHub Pages can still host the whole game.
const PUBLIC = ['wss://broker.emqx.io:8084/mqtt', 'wss://broker.hivemq.com:8884/mqtt', 'wss://test.mosquitto.org:8081/mqtt'];
const TOPIC = 'jugnupur-cp/5/';   // + room code + '/h' (to the host) or '/c/<guest>' (to one guest)

export function relayUrls() {
  const u = new URLSearchParams(location.search), q = u.get('relay');
  if (q === 'off' || u.get('link') === 'direct') return [];   // ?link=direct: never use the backup route (for testing)
  if (q) return q.split(',').map(s => s.trim()).filter(s => /^wss?:\/\//.test(s));   // test override: ?relay=ws://127.0.0.1:9101
  return PUBLIC;
}

// run f whenever this page comes back on screen (a phone that was locked, a tab that was behind another): links that
// dropped meanwhile are redialled at once. Returns a function that stops watching.
export function onShow(f) { const h = () => { if (document.visibilityState === 'visible') f(); }; document.addEventListener('visibilitychange', h); return () => document.removeEventListener('visibilitychange', h); }

const enc = new TextEncoder(), dec = new TextDecoder();
const rnd = n => { let s = ''; while (s.length < n) s += Math.random().toString(36).slice(2); return s.slice(0, n); };
const str = s => { const b = enc.encode(s), o = new Uint8Array(2 + b.length); o[0] = b.length >> 8; o[1] = b.length & 255; o.set(b, 2); return o; };
function packet(type, parts) {
  let n = 0; for (const p of parts) n += p.length;
  const len = []; let x = n; do { let d = x % 128; x = Math.floor(x / 128); if (x > 0) d |= 128; len.push(d); } while (x > 0);
  const o = new Uint8Array(1 + len.length + n); o[0] = type; o.set(len, 1); let k = 1 + len.length;
  for (const p of parts) { o.set(p, k); k += p.length; }
  return o;
}

// One connection to one relay: a very small MQTT 3.1.1 client (connect, listen on one topic, publish, keep alive).
// It keeps redialling with a growing pause until stop() is called. "up" means connected and listening.
class Mq {
  constructor(url, topic, h) { this.url = url; this.topic = topic; this.h = h; this.ws = null; this.up = false; this.stopped = false; this.wait = 1000; this.upAt = 0; this.downAt = performance.now(); this.buf = new Uint8Array(0); this._dial(); }
  _dial() {
    if (this.stopped) return;
    let ws; try { ws = new WebSocket(this.url, 'mqtt'); } catch (e) { return; }   // an address the browser refuses: leave this relay out
    this.ws = ws; ws.binaryType = 'arraybuffer'; this.buf = new Uint8Array(0);
    const slow = setTimeout(() => { if (this.ws === ws && !this.up) { try { ws.close(); } catch (e) {} } }, 10000);
    ws.onopen = () => this._send(packet(0x10, [str('MQTT'), new Uint8Array([4, 2, 0, 60]), str('cp' + rnd(16))]));
    ws.onmessage = e => { if (this.ws === ws && e.data instanceof ArrayBuffer) this._feed(new Uint8Array(e.data)); };
    ws.onerror = () => {};
    ws.onclose = () => {
      clearTimeout(slow); if (this.ws !== ws) return;
      const was = this.up, now = performance.now(); this.ws = null; this.up = false; clearInterval(this.ping);
      if (was) { this.downAt = now; if (now - this.upAt > 20000) this.wait = 1000; if (this.h.onDown) this.h.onDown(this); }
      if (!this.stopped) { this.timer = setTimeout(() => this._dial(), this.wait); this.wait = Math.min(this.wait * 2, 30000); }
    };
  }
  nudge() { if (!this.stopped && !this.ws) { clearTimeout(this.timer); this.wait = 1000; this._dial(); } }   // do not wait out the pause: dial now
  _feed(chunk) {   // packets can arrive split across frames, or several in one frame
    let d = chunk;
    if (this.buf.length) { d = new Uint8Array(this.buf.length + chunk.length); d.set(this.buf); d.set(chunk, this.buf.length); }
    let at = 0;
    while (d.length - at >= 2) {
      let len = 0, mul = 1, i = at + 1, ok = false;
      while (i < d.length && i <= at + 4) { const b = d[i++]; len += (b & 127) * mul; mul *= 128; if (!(b & 128)) { ok = true; break; } }
      if (!ok) { if (i > at + 4) { this._kill(); return; } break; }
      if (d.length < i + len) break;
      this._packet(d[at], d.subarray(i, i + len)); at = i + len;
      if (!this.ws) return;
    }
    this.buf = at < d.length ? d.slice(at) : new Uint8Array(0);
  }
  _packet(head, body) {
    const type = head >> 4;
    if (type === 2) {   // the relay let us in: ask for our topic
      if (body[1] !== 0) return this._kill();
      this._send(packet(0x82, [new Uint8Array([0, 1]), str(this.topic), new Uint8Array([0])]));
    } else if (type === 9) {   // listening: this relay is ready to use
      if (body[2] & 0x80) return this._kill();
      if (!this.up) { this.up = true; this.upAt = performance.now(); clearInterval(this.ping); this.ping = setInterval(() => this._send(new Uint8Array([0xC0, 0])), 25000); if (this.h.onUp) this.h.onUp(this); }
    } else if (type === 3 && this.up) {
      const off = 2 + ((body[0] << 8) | body[1]) + (((head >> 1) & 3) ? 2 : 0);
      if (off <= body.length && this.h.onMsg) this.h.onMsg(this, dec.decode(body.subarray(off)));
    }
  }
  _send(bytes) { const ws = this.ws; if (!ws || ws.readyState !== 1) return false; try { ws.send(bytes); return true; } catch (e) { return false; } }
  _kill() { const ws = this.ws; if (ws) { try { ws.close(); } catch (e) {} } }
  get busy() { return !this.ws || this.ws.bufferedAmount > 48000; }   // a slow link is backing up: skip what can be skipped
  pub(topic, text) { return this.up && this._send(packet(0x30, [str(topic), enc.encode(text)])); }
  stop() {
    this.stopped = true; clearTimeout(this.timer); clearInterval(this.ping);
    const ws = this.ws; this.ws = null; this.up = false;
    if (ws) { try { if (ws.readyState === 1) ws.send(new Uint8Array([0xE0, 0])); ws.close(); } catch (e) {} }
  }
}

// One end of a conversation carried over a relay. Fast-changing things (where the cars are) are sent once and may
// be lost. Everything else is numbered, sent again until the other side confirms it, and handed over in order.
class Chan {
  constructor(raw, deliver) { this.raw = raw; this.deliver = deliver; this.n = 0; this.nIn = 0; this.rOut = 0; this.rIn = 0; this.box = []; this.hold = new Map(); this.ackDue = false; }
  send(m, sure) {
    if (sure) { const p = { r: ++this.rOut, m }; this.box.push({ p, t: performance.now() }); if (this.box.length > 600) this.box.shift(); this._out(p); }
    else this._out({ n: ++this.n, m });
  }
  _out(p) { p.a = this.rIn; this.ackDue = false; return this.raw(p); }
  take(p) {
    if (p.a > 0) while (this.box.length && this.box[0].p.r <= p.a) this.box.shift();
    if (p.r > 0) {
      this.ackDue = true;
      if (p.r === this.rIn + 1) {
        this.rIn++; this.deliver(p.m);
        while (this.hold.has(this.rIn + 1)) { const m = this.hold.get(this.rIn + 1); this.hold.delete(this.rIn + 1); this.rIn++; this.deliver(m); }
      } else if (p.r > this.rIn + 1 && this.hold.size < 300) this.hold.set(p.r, p.m);
    } else if (p.n > this.nIn) { this.nIn = p.n; this.deliver(p.m); }
  }
  tick(now, all) {   // a few times a second: send again what was not confirmed, and confirm what arrived
    let k = 0;
    for (const b of this.box) if ((all || now - b.t > 1500) && k++ < 30) { b.t = now; this._out(b.p); }
    if (this.ackDue) this._out({});
  }
}

// The host's end of one guest's link through a relay. To the rest of the game it looks like a direct connection.
class RelayConn {
  constructor(hub, cid, mq) {
    this.hub = hub; this.cid = cid; this.mq = mq; this.open = false; this.relay = true; this.fn = {}; this.lastSnap = 0;
    this.chan = new Chan(p => this.mq.pub(hub.toGuest + cid, JSON.stringify(p)), m => this._emit('data', m));
  }
  on(k, f) { this.fn[k] = f; }
  _emit(k, v) { const f = this.fn[k]; if (f) f(v); }
  send(m) {
    if (!this.open || !m) return;
    if (m.k === 's' && !m.o) {   // the picture of the round, many times a second: thin it out, and one may be lost...
      const ev = m.e && m.e.length;
      if (ev) this.chan.send({ k: 'ev', e: m.e }, true);   // ...but the things that happened must arrive
      const now = performance.now(); if (now - this.lastSnap < 95 || this.mq.busy) return; this.lastSnap = now;
      this.chan.send(ev ? Object.assign({}, m, { e: [] }) : m, false);
    } else this.chan.send(m, m.k !== 'hb');
  }
  close() { if (!this.open) return; this.mq.pub(this.hub.toGuest + this.cid, '{"t":"bye"}'); this.hub._forget(this); }
}

// The host listens on every relay for the whole life of the room, and answers each guest on the relay they were last heard on.
export class RelayHost {
  constructor(code, onConn) {
    this.onConn = onConn; this.guests = new Map(); this.dead = new Set();
    this.hid = rnd(6);   // this room's own mark: guests address it, so two rooms that happen to share a code cannot get tangled
    this.toHost = TOPIC + code + '/h'; this.toGuest = TOPIC + code + '/c/';
    this.mqs = relayUrls().map(u => new Mq(u, this.toHost, { onMsg: (mq, text) => this._in(mq, text) }));
    this.timer = setInterval(() => { const now = performance.now(); for (const g of this.guests.values()) g.chan.tick(now); }, 400);
    this.unshow = onShow(() => { for (const m of this.mqs) m.nudge(); });
  }
  get up() { return this.mqs.some(m => m.up); }
  _in(mq, text) {
    let p; try { p = JSON.parse(text); } catch (e) { return; }
    if (!p || typeof p.c !== 'string' || !/^[a-z0-9]{8,16}$/.test(p.c)) return;
    const to = this.toGuest + p.c;
    if (p.t === 'hi') { mq.pub(to, '{"t":"ok","h":"' + this.hid + '"}'); return; }   // "is the room here?" - "yes"
    if (p.h !== this.hid) return;   // meant for another room
    if (this.dead.has(p.c)) { if (p.t !== 'bye') mq.pub(to, '{"t":"bye"}'); return; }
    let g = this.guests.get(p.c);
    if (p.t === 'go') {   // "I will use this relay"
      mq.pub(to, '{"t":"on"}');
      if (g) { g.mq = mq; g.chan.tick(performance.now(), true); }
      else { g = new RelayConn(this, p.c, mq); this.guests.set(p.c, g); this.onConn(g); g.open = true; g._emit('open'); }
      return;
    }
    if (!g) { mq.pub(to, '{"t":"no"}'); return; }
    if (p.t === 'bye') { this._forget(g); g._emit('close'); return; }
    g.mq = mq;
    try { g.chan.take(p); } catch (e) { console.warn('relay message failed', e); }
  }
  _forget(g) { g.open = false; this.guests.delete(g.cid); this.dead.add(g.cid); }
  close() { clearInterval(this.timer); this.unshow(); for (const g of [...this.guests.values()]) g.close(); for (const m of this.mqs) m.stop(); }
}

// A guest's end. It asks every relay "is the room here?"; the first relay the host answers on becomes the link.
// h: onReady() the room answered on some relay, onOpen() the link is up, onData(msg), onClose() the host is gone.
export class RelayGuest {
  constructor(code, h) {
    this.h = h; this.cid = rnd(10); this.toHost = TOPIC + code + '/h'; this.mine = TOPIC + code + '/c/' + this.cid;
    this.mqs = []; this.oks = []; this.hid = ''; this.cur = null; this.open = false; this.closed = false; this.going = false; this.seeking = true;
    this.heard = 0; this.lastP = 0; this.pf = 0; this.ticks = 0;
    this.chan = new Chan(p => { p.c = this.cid; p.h = this.hid; return !!this.cur && this.cur.pub(this.toHost, JSON.stringify(p)); }, m => { if (this.h.onData) this.h.onData(m); });
    this._dialAll();
    this.timer = setInterval(() => this._tick(), 400);
    this.unshow = onShow(() => { for (const m of this.mqs) m.nudge(); });
  }
  get anyUp() { return this.mqs.some(m => m.up); }
  get ready() { return this.oks.length > 0; }
  _dialAll() {
    for (const u of relayUrls()) if (!this.mqs.some(m => m.url === u)) this.mqs.push(new Mq(u, this.mine, { onUp: mq => { if (this.seeking) this._ctl(mq, 'hi'); }, onMsg: (mq, text) => this._in(mq, text) }));
  }
  _ctl(mq, t) { return mq.pub(this.toHost, JSON.stringify({ c: this.cid, h: this.hid, t })); }
  _use(mq) { this.cur = mq; if (!this.hid) this.hid = mq.hid; this.seeking = false; this.going = true; this.heard = performance.now(); this._ctl(mq, 'go'); }
  commit() { if (this.ready && !this.cur && !this.closed) this._use(this.oks.find(m => m.up) || this.oks[0]); }   // use the relay: called once the direct link has had its chance
  _in(mq, text) {
    if (this.closed) return;
    let p; try { p = JSON.parse(text); } catch (e) { return; }
    if (!p) return;
    if (p.t === 'ok') {
      if (this.hid) { if (this.seeking && this.open && p.h === this.hid) this._use(mq); return; }   // moving to another relay mid-game: the first one our room answers on takes over
      if (!this.oks.includes(mq)) { mq.hid = String(p.h || ''); this.oks.push(mq); if (this.oks.length === 1 && this.h.onReady) this.h.onReady(); }
      return;
    }
    if (p.t === 'on') {
      if (mq !== this.cur) return;
      this.going = false; this.heard = performance.now();
      for (const m of this.mqs) if (m !== mq) m.stop();
      this.mqs = [mq];
      if (!this.open) { this.open = true; if (this.h.onOpen) this.h.onOpen(); } else this.chan.tick(performance.now(), true);
      return;
    }
    if (p.t === 'bye' || p.t === 'no') { if (this.open) { this._stop(); if (this.h.onClose) this.h.onClose(); } return; }
    if (!this.open) return;
    this.heard = performance.now();
    try { this.chan.take(p); } catch (e) { console.warn('relay message failed', e); }
  }
  _tick() {
    if (this.closed) return;
    const now = performance.now(), slow = ++this.ticks % 3 === 0;   // every 1.2 seconds
    if (slow && this.seeking) for (const m of this.mqs) if (m.up) this._ctl(m, 'hi');
    if (slow && this.going && this.cur) this._ctl(this.cur, 'go');
    const down = !!this.cur && !this.cur.up && now - this.cur.downAt > 2500;
    if (this.going && down) {   // the relay that was chosen dropped before it confirmed: choose again
      const lost = this.cur; this.going = false; this.seeking = true;
      if (this.open) this._dialAll();
      else { this.cur = null; this.hid = ''; this.oks = this.oks.filter(m => m !== lost && m.up); if (this.oks.length) this._use(this.oks[0]); }
    }
    if (!this.open) return;
    this.chan.tick(now);
    // the relay in use went quiet or dropped: ask them all again, and move to the first one that reaches the host
    if (!this.seeking && !this.going && (down || now - this.heard > 6500)) { this.seeking = true; this._dialAll(); for (const m of this.mqs) if (m.up) this._ctl(m, 'hi'); }
  }
  send(m) {
    if (!this.open || !m) return;
    if (m.k === 'p') {   // where my car is, many times a second: thin it out, and one may be lost
      this.pf |= m.f & 16;
      const now = performance.now(); if (now - this.lastP < 95 || this.cur.busy) return; this.lastP = now;
      if (this.pf) { m = Object.assign({}, m, { f: m.f | this.pf }); this.pf = 0; }
      this.chan.send(m, false);
    } else this.chan.send(m, m.k !== 'hb');
  }
  close() { if (this.closed) return; if (this.cur && (this.open || this.going)) this._ctl(this.cur, 'bye'); this._stop(); }
  _stop() { this.closed = true; this.open = false; clearInterval(this.timer); this.unshow(); for (const m of this.mqs) m.stop(); }
}
