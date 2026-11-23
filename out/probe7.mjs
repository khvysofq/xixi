import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { JSDOM, VirtualConsole } = require('../scripts/deps.cjs');
const { TextDecoder, TextEncoder } = require('node:util');
const vc=new VirtualConsole(); vc.on('jsdomError',(e)=>console.log('JSDOMERR:',String(e&&e.message||e).slice(0,200)));
const dom=new JSDOM('<html><body></body></html>',{runScripts:'dangerously',url:'http://localhost/',virtualConsole:vc,beforeParse(w){w.TextDecoder=TextDecoder;w.TextEncoder=TextEncoder;}});
const w=dom.window;
const s1=w.document.createElement('script'); s1.textContent=fs.readFileSync('vendor/jszip.min.js','utf8'); w.document.body.appendChild(s1);
const s2=w.document.createElement('script');
s2.textContent=`window.__chain=function(f){
  var log=[];
  return new Promise(function(res,rej){
    var fr=new FileReader();
    fr.onload=function(){try{
      var u8=new Uint8Array(fr.result);
      log.push('u8:'+u8.length);
      window.JSZip.loadAsync(u8).then(function(z){
        log.push('loaded');
        return z.file('word/document.xml').async('string');
      }).then(function(s){log.push('str:'+s.length);res(log.join(' | '));},function(e){rej(new Error(log.join('|')+' REJ:'+e.message));});
    }catch(e){rej(new Error('throw '+e.message));}};
    fr.onerror=function(){rej(new Error('frerr'));};
    fr.readAsArrayBuffer(f);
    setTimeout(function(){res(log.join(' | ')+' (timeout-pending)');},3000);
  });};`;
w.document.body.appendChild(s2);
const JSZipNode = require('../vendor/jszip.min.js');
const zip=new JSZipNode();
zip.file('word/document.xml','<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>王五OK</w:t></w:r></w:p></w:body></w:document>');
const buf=await zip.generateAsync({type:'nodebuffer'});
const f=new w.File([new w.Uint8Array(Array.from(buf))],'r.docx');
console.log('chain:',await w.__chain(f));
process.exit(0);
