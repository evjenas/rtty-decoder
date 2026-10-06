const { RttyDecoder, ITA2_FIGS } = require(__dirname + '/rtty-core.js');
function encode(text){ const codes=[0x1B]; for(const ch of text){ if(ch==='\n'){codes.push(8,2);continue;} codes.push(ITA2_FIGS.indexOf(ch)); } return codes; }
function synth(codes, fs, baud, shift, center, snrNoise, freqErr=0, baudErr=1){
  const fm=center+shift/2+freqErr, fsp=center-shift/2+freqErr, spb=fs/(baud*baudErr); const out=[]; let ph=0, t=0;
  const tone=(mark,bits)=>{ const n=Math.round(bits*spb); for(let i=0;i<n;i++){ ph+=2*Math.PI*(mark?fm:fsp)/fs; out.push(0.3*Math.sin(ph)+snrNoise*(Math.random()*2-1)*1.7);} };
  tone(1,30); for(const c of codes){ tone(0,1); for(let k=0;k<5;k++) tone((c>>k)&1,1); tone(1,1.5);} tone(1,30);
  return Float32Array.from(out);
}
const msg='12,345 67890. 4,4 1.2,3\n987 000 31415';
for (const [baud,shift,noise,fe,be] of [[45.45,170,0,0,1],[45.45,170,0.3,0,1],[45.45,170,0.6,0,1],[50,450,0.5,15,1],[45.45,170,0.3,0,1.02],[75,850,0.4,0,1]]){
  let out=''; const fs=48000; const d=new RttyDecoder(fs,ch=>out+=ch);
  d.configure({baud,shift,center:1600,squelch:0.3}); const s=synth(encode(msg),fs,baud,shift,1600,noise,fe,be);
  // noise before signal too
  for(let i=0;i<s.length;i+=128) d.process(s.subarray(i,i+128));
  console.log(baud,shift,'noise',noise,'fe',fe,'be',be,'|',JSON.stringify(out), out.trim()===msg?'OK':''); if(out.trim()!==msg) process.exitCode=1;
}
// (CI) fail if decoding broke
