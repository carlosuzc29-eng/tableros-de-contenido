// Firestore REST simulado en memoria para pruebas automáticas
function pack(v){
  if(v===null) return {nullValue:null};
  if(Array.isArray(v)) return {arrayValue:{values:v.map(pack)}};
  if(typeof v==='object') return {mapValue:{fields:Object.fromEntries(Object.entries(v).map(([k,x])=>[k,pack(x)]))}};
  if(typeof v==='number') return Number.isInteger(v)?{integerValue:String(v)}:{doubleValue:v};
  if(typeof v==='boolean') return {booleanValue:v};
  return {stringValue:String(v)};
}

function unpack(v){
  if(!v || typeof v!=='object') return v;
  if('stringValue' in v) return v.stringValue;
  if('integerValue' in v) return +v.integerValue;
  if('doubleValue' in v) return v.doubleValue;
  if('booleanValue' in v) return v.booleanValue;
  if('nullValue' in v) return null;
  if('mapValue' in v) return Object.fromEntries(Object.entries(v.mapValue.fields||{}).map(([k,x])=>[k,unpack(x)]));
  if('arrayValue' in v) return (v.arrayValue.values||[]).map(unpack);
  return v;
}

class Stub{
  constructor(fields){
    this.fields = fields ? JSON.parse(JSON.stringify(fields)) : null;
    this.t = 1;
    this.log = [];
    this.failGet = 0;
    this.failPatch = 0;
  }
  doc(){
    return {
      name: 'projects/nexo-qa-inexistente/databases/(default)/documents/tableros/doc',
      fields: Object.fromEntries(Object.entries(this.fields||{}).map(([k,v])=>[k,pack(v)])),
      updateTime: '2026-10-28T00:00:0' + this.t + '.000000Z'
    };
  }
  bump(){ this.t++; }
  async attach(page){
    await page.route('**/*', async r=>{
      const req = r.request(), u = req.url(), m = req.method();
      if (u.startsWith('file:') || /cdn\.jsdelivr|cdnjs|fonts\.googleapis|fonts\.gstatic/.test(u)) return r.continue();
      if (u.includes('firestore.googleapis.com') && u.includes('/tableros/')){
        if (m === 'GET'){
          if (this.failGet > 0){ this.failGet--; return r.abort(); }
          if (!this.fields) return r.fulfill({status:404, contentType:'application/json', body:'{"error":{"code":404,"message":"Not found"}}'});
          return r.fulfill({status:200, contentType:'application/json', body:JSON.stringify(this.doc())});
        }
        if (m === 'PATCH'){
          const url = new URL(u);
          const body = JSON.parse(req.postData());
          this.log.push({url:u, body});
          if (this.failPatch > 0){
            this.failPatch--;
            return r.fulfill({status:500, contentType:'application/json', body:'{"error":{"code":500,"message":"simulado"}}'});
          }
          const pre = url.searchParams.get('currentDocument.updateTime');
          if (pre && pre !== this.doc().updateTime){
            return r.fulfill({status:400, contentType:'application/json', body:'{"error":{"status":"FAILED_PRECONDITION","message":"precondition"}}'});
          }
          const mask = url.searchParams.getAll('updateMask.fieldPaths');
          this.fields = this.fields || {};
          for (const k of mask){
            if (body.fields && body.fields[k] !== undefined) {
              this.fields[k] = unpack(body.fields[k]);
            } else {
              delete this.fields[k];
            }
          }
          this.bump();
          return r.fulfill({status:200, contentType:'application/json', body:JSON.stringify(this.doc())});
        }
      }
      if (u.includes('documents/tableros?')) {
        this.log.push({create:true});
        if (!this.fields){
          const b = JSON.parse(req.postData());
          this.fields = Object.fromEntries(Object.entries(b.fields||{}).map(([k,v])=>[k,unpack(v)]));
          this.bump();
          return r.fulfill({status:200, contentType:'application/json', body:JSON.stringify(this.doc())});
        }
        return r.fulfill({status:409, contentType:'application/json', body:'{"error":{"code":409,"message":"Already exists"}}'});
      }
      return r.abort();
    });
  }
}

module.exports = { Stub, pack, unpack };
