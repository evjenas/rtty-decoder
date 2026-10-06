// ===== RTTY decoder core (ITA2 / Baudot) =====
const ITA2_LTRS = ['\0','E','\n','A',' ','S','I','U','\r','D','R','J','N','F','C','K',
                   'T','Z','L','W','H','Y','P','Q','O','B','G','','M','X','V',''];
const ITA2_FIGS = ['\0','3','\n','-',' ','\'','8','7','\r','$','4','\x07',',','!',':','(',
                   '5','+',')','2','#','6','0','1','9','?','&','','.','/',';',''];
const CODE_FIGS = 0x1B, CODE_LTRS = 0x1F;

class RttyDecoder {
  constructor(fs, onChar) {
    this.fs = fs;
    this.onChar = onChar || (() => {});
    this.cfg = { baud: 45.45, shift: 170, center: 1500, reverse: false,
                 squelch: 0.35, digitsOnly: true, usos: true };
    this.quality = 0;     // 0..1, контраст тонов
    this.level = 0;       // уровень сигнала
    this.figs = false;
    this.reset();
  }
  configure(c) { Object.assign(this.cfg, c); this.reset(); }
  reset() {
    const c = this.cfg, fs = this.fs;
    this.N = Math.max(8, Math.round(fs / c.baud));
    const fm = c.center + c.shift / 2, fsp = c.center - c.shift / 2; // mark выше
    this.wm = 2 * Math.PI * fm / fs; this.ws = 2 * Math.PI * fsp / fs;
    this.pm = 0; this.ps = 0;
    const N = this.N;
    this.bmI = new Float64Array(N); this.bmQ = new Float64Array(N);
    this.bsI = new Float64Array(N); this.bsQ = new Float64Array(N);
    this.smI = this.smQ = this.ssI = this.ssQ = 0;
    this.idx = 0;
    this.state = 0; this.cnt = 0; this.bits = 0;
    const bitPos = k => Math.round((k + 0.5) * N);
    this.tStart = bitPos(0);
    this.tBits = [1, 2, 3, 4, 5].map(bitPos);
    this.tStop = bitPos(6);
    this.figs = false;
  }
  process(buf) {
    const N = this.N, c = this.cfg;
    const qa = 1 / N, la = 1 / (this.fs * 0.2);
    for (let n = 0; n < buf.length; n++) {
      const x = buf[n];
      // смешивание с тонами mark / space
      const mI = x * Math.cos(this.pm), mQ = -x * Math.sin(this.pm);
      const sI = x * Math.cos(this.ps), sQ = -x * Math.sin(this.ps);
      this.pm += this.wm; if (this.pm > 6.283185307179586) this.pm -= 6.283185307179586;
      this.ps += this.ws; if (this.ps > 6.283185307179586) this.ps -= 6.283185307179586;
      // согласованный фильтр (скользящее среднее длиной 1 бит)
      const i = this.idx;
      this.smI += mI - this.bmI[i]; this.bmI[i] = mI;
      this.smQ += mQ - this.bmQ[i]; this.bmQ[i] = mQ;
      this.ssI += sI - this.bsI[i]; this.bsI[i] = sI;
      this.ssQ += sQ - this.bsQ[i]; this.bsQ[i] = sQ;
      if (++this.idx >= N) { // пересчёт сумм против накопления ошибки
        this.idx = 0;
        let a = 0, b = 0, d = 0, e = 0;
        for (let k = 0; k < N; k++) { a += this.bmI[k]; b += this.bmQ[k]; d += this.bsI[k]; e += this.bsQ[k]; }
        this.smI = a; this.smQ = b; this.ssI = d; this.ssQ = e;
      }
      const m = Math.hypot(this.smI, this.smQ), s = Math.hypot(this.ssI, this.ssQ);
      let dd = (m - s) / (m + s + 1e-12);
      if (c.reverse) dd = -dd;
      this.quality += (Math.abs(dd) - this.quality) * qa;
      this.level += ((m + s) / N - this.level) * la;
      const mark = dd > 0;
      // UART
      switch (this.state) {
        case 0: if (mark) this.state = 1; break;          // ждём mark
        case 1: if (!mark) { this.state = 2; this.cnt = 0; this.bits = 0; } break; // фронт старт-бита
        case 2: {
          const t = ++this.cnt;
          if (t === this.tStart) { if (mark) this.state = 1; }
          else if (t === this.tStop) {
            if (mark && this.quality >= c.squelch) this.emit(this.bits);
            this.state = mark ? 1 : 0;
          } else {
            for (let k = 0; k < 5; k++) if (t === this.tBits[k]) { if (mark) this.bits |= 1 << k; break; }
          }
        }
      }
    }
  }
  emit(code) {
    const c = this.cfg;
    if (c.digitsOnly) {
      const ch = ITA2_FIGS[code];
      if (/^[0-9., \n]$/.test(ch)) this.onChar(ch);
      return;
    }
    if (code === CODE_FIGS) { this.figs = true; return; }
    if (code === CODE_LTRS) { this.figs = false; return; }
    let ch = (this.figs ? ITA2_FIGS : ITA2_LTRS)[code];
    if (code === 0x04 && c.usos) this.figs = false;
    if (ch === '\r' || ch === '\0' || ch === '' || ch === '\x07') return;
    this.onChar(ch);
  }
}
if (typeof module !== 'undefined') module.exports = { RttyDecoder, ITA2_LTRS, ITA2_FIGS };
