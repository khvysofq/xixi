import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { JSDOM, VirtualConsole } = require('../scripts/deps.cjs');
const vc=new VirtualConsole(); vc.on('jsdomError',(e)=>console.log('JSDOMERR:',String(e&&e.message||e).slice(0,200)));
const dom=new JSDOM('<html><body></body></html>',{runScripts:'dangerously',url:'http://localhost/',virtualConsole:vc});
const w=dom.window;
const script=w.document.createElement('script');
script.textContent=fs.readFileSync('vendor/jszip.min.js','utf8');
w.document.body.appendChild(script);
const JSZipNode = require('../vendor/jszip.min.js');
const zip=new JSZipNode();
zip.file('word/document.xml','<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>王五</w:t></w:r></w:p></w:body></w:document>');
const buf=await zip.generateAsync({type:'nodebuffer'});
const f=new w.File([new w.Uint8Array(Array.from(buf))],'r.docx');
const fr=new w.FileReader();
fr.onload=()=>{
  console.log('fr.result ctor:',fr.result.constructor.name);
  try{
    const u8=new Uint8Array(fr.result);
    console.log('u8 ok len',u8.length,'ctor realm check:',u8.constructor===w.Uint8Array);
    w.JSZip.loadAsync(u8).then(z=>{
      console.log('loadAsync ok');
      return z.file('word/document.xml').async('string');
    }).then(s=>console.log('string ok len',s.length)).catch(e=>console.log('REJECT',e.message));
  }catch(e){console.log('THROW',e.message);}
};
fr.onerror=()=>console.log('fr onerror');
fr.readAsArrayBuffer(f);
await new Promise(r=>setTimeout(r,2000));
process.exit(0);
