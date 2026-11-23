import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { JSDOM, VirtualConsole } = require('../scripts/deps.cjs');
const vc=new VirtualConsole(); vc.on('jsdomError',(e)=>console.log('JSDOMERR:',String(e&&e.message||e).slice(0,200)));
const dom=new JSDOM('<html><body></body></html>',{runScripts:'dangerously',url:'http://localhost/',virtualConsole:vc});
const w=dom.window;
const s1=w.document.createElement('script'); s1.textContent=fs.readFileSync('vendor/jszip.min.js','utf8'); w.document.body.appendChild(s1);
const s2=w.document.createElement('script');
s2.textContent=`window.__run=function(f){return new Promise(function(res,rej){
  if(f.arrayBuffer){f.arrayBuffer().then(function(ab){res('hasAB:'+ab.byteLength);},function(e){rej('abthrow:'+e.message);});return;}
  var fr=new FileReader();
  fr.onload=function(){try{var u8=new Uint8Array(fr.result);
    res('u8:'+u8.length+' pageU8:'+(u8.constructor===window.Uint8Array));
  }catch(e){rej('throw:'+e.message);}};
  fr.onerror=function(){rej('frerr');};
  fr.readAsArrayBuffer(f);
});};
window.__zip=function(u8str){return window.JSZip.loadAsync(u8str).then(function(z){return z.file('word/document.xml').async('string');});};`;
w.document.body.appendChild(s2);
const JSZipNode = require('../vendor/jszip.min.js');
const zip=new JSZipNode();
zip.file('word/document.xml','<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>王五OK</w:t></w:r></w:p></w:body></w:document>');
const buf=await zip.generateAsync({type:'nodebuffer'});
const f=new w.File([new w.Uint8Array(Array.from(buf))],'r.docx');
let out;
try{ out=await w.__run(f); }catch(e){ out='ERR '+e.message; }
console.log('run:',out);
try{
  const u8=new w.Uint8Array(Array.from(buf));
  const str=await w.__zip(u8);
  console.log('zip pageU8 ok:',str.slice(-12));
}catch(e){console.log('zip ERR',e.message);}
process.exit(0);
