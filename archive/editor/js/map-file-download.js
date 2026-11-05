(function (root) {
  'use strict';
  const encoder = new TextEncoder();
  function crc32(bytes) {
    let crc = -1;
    for (const byte of bytes) { crc ^= byte; for (let i=0;i<8;i++) crc = (crc>>>1) ^ (0xedb88320 & -(crc&1)); }
    return (crc ^ -1) >>> 0;
  }
  async function archive(files) {
    const chunks=[], directory=[]; let offset=0;
    for (const file of files) {
      const name=encoder.encode(file.name); const data=file.data instanceof Blob ? new Uint8Array(await file.data.arrayBuffer()) : encoder.encode(file.data);
      const crc=crc32(data), local=new Uint8Array(30+name.length), l=new DataView(local.buffer);
      l.setUint32(0,0x04034b50,true); l.setUint16(4,20,true); l.setUint16(6,0x800,true); l.setUint32(14,crc,true); l.setUint32(18,data.length,true); l.setUint32(22,data.length,true); l.setUint16(26,name.length,true); local.set(name,30);
      const central=new Uint8Array(46+name.length), c=new DataView(central.buffer);
      c.setUint32(0,0x02014b50,true); c.setUint16(4,20,true); c.setUint16(6,20,true); c.setUint16(8,0x800,true); c.setUint32(16,crc,true); c.setUint32(20,data.length,true); c.setUint32(24,data.length,true); c.setUint16(28,name.length,true); c.setUint32(42,offset,true); central.set(name,46);
      chunks.push(local,data); directory.push(central); offset+=local.length+data.length;
    }
    const size=directory.reduce((sum,item)=>sum+item.length,0), end=new Uint8Array(22), e=new DataView(end.buffer);
    e.setUint32(0,0x06054b50,true); e.setUint16(8,files.length,true); e.setUint16(10,files.length,true); e.setUint32(12,size,true); e.setUint32(16,offset,true);
    return new Blob([...chunks,...directory,end],{type:'application/zip'});
  }
  function download(name, blob) {
    const url=URL.createObjectURL(blob), a=document.createElement('a'); a.href=url; a.download=name; document.body.append(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),60000);
  }
  const api={archive,download,json:value=>JSON.stringify(value,null,2)+'\n'};
  if(typeof module==='object'&&module.exports)module.exports=api; else root.MapFileDownload=api;
})(typeof window==='object'?window:globalThis);
