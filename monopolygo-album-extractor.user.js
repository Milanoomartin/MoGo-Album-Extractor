// ==UserScript==
// @name         MONOPOLY GO! Universal Album Extractor
// @namespace    mgo.album-extractor.standalone
// @version      1.0.1
// @description  Capture the live album and export names, sets, stars, gold status, original art, full card PNGs, CSVs and manifests in one ZIP.
// @match        https://www.monopolygo.com/*
// @match        https://monopolygo.com/*
// @run-at       document-start
// @sandbox      raw
// @noframes
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_listValues
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @connect      a.prod.tophat.withbuddies.com
// ==/UserScript==

(function () {
  'use strict';

  function makeCore() {
    const CDN = 'https://a.prod.tophat.withbuddies.com';
    const DEFAULT_MANIFEST = CDN + '/public/manifests/prod/WebPortal/manifest-collections.json';
    const RARITIES = {1:{stars:1,gold:false},2:{stars:2,gold:false},3:{stars:3,gold:false},4:{stars:4,gold:false},5:{stars:5,gold:false},
      6:{stars:1,gold:true},7:{stars:2,gold:true},8:{stars:3,gold:true},9:{stars:4,gold:true},10:{stars:5,gold:true},11:{stars:6,gold:false},12:{stars:6,gold:true}};
    const text = (x, max = 160) => typeof x === 'string' ? x.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max) : '';
    const first = (obj, keys) => keys.map(key => obj?.[key]).find(x => x !== null && x !== undefined);
    const id = value => typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : text(value);
    const positive = value => Number.isInteger(value) && value > 0 && value <= 10000 ? value : null;
    const bool = value => typeof value === 'boolean' ? value : null;
    const date = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT/.test(value) && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
    function publicURL(raw, manifest = false) {
      if (typeof raw !== 'string') return '';
      try {
        const u = new URL(raw.startsWith('public/') ? CDN + '/' + raw : raw);
        const validPath = manifest ? /^\/public\/manifests\/[A-Za-z0-9_./-]+\.json$/i.test(u.pathname) : /^\/public\/assets\/[A-Za-z0-9_./-]+$/i.test(u.pathname);
        return u.origin === CDN && !u.username && !u.password && validPath && !u.pathname.includes('..') ? u.origin + u.pathname : '';
      } catch (_) {return '';}
    }
    function unwrap(value) {
      if (!value || typeof value !== 'object' || value.IsSuccess === false) return null;
      return value.Data ?? value.data ?? value;
    }
    function parseRarities(value) {
      const data = unwrap(value), list = first(data, ['Rarities','rarities','StickerRarities']);
      if (!Array.isArray(list)) return null;
      const out = {};
      for (const r of list.slice(0, 200)) {
        const index = positive(first(r, ['Index','index','Id','id'])), stars = positive(first(r, ['Stars','stars','StarCount'])), gold = bool(first(r, ['IsGolden','isGolden','Gold','gold']));
        if (index && stars && stars <= 10 && gold !== null) out[index] = {stars, gold};
      }
      return Object.keys(out).length ? out : null;
    }
    function normalizeStarPlacement(value) {
      if(!value||typeof value!=='object')return null;
      const {width,left,top}=value;
      if(!Number.isFinite(width)||width<.5||width>1.75||!Number.isFinite(left)||Math.abs(left)>.5||!Number.isFinite(top)||top<-.75||top>.3)return null;
      return {width,left,top,units:'frame-width',source:text(value.source,80)||'official album page'};
    }
    const DEFAULT_STAR_PLACEMENT={width:1,left:0,top:-.25,units:'frame-width',source:'standard album layout'};
    function cardLayout(width,height,starWidth,starHeight,placement=DEFAULT_STAR_PLACEMENT) {
      if(![width,height,starWidth,starHeight].every(x=>Number.isFinite(x)&&x>0))throw new Error('Invalid card image dimensions.');
      const p=normalizeStarPlacement(placement)||DEFAULT_STAR_PLACEMENT,sw=width*p.width,sh=sw*starHeight/starWidth,sx=width*p.left,sy=width*p.top;
      const left=Math.ceil(Math.max(0,-sx)),right=Math.ceil(Math.max(0,sx+sw-width)),top=Math.ceil(Math.max(0,-sy))+2;
      return {width:width+left+right,height:height+top,frame:{x:left,y:top,width,height},stars:{x:left+sx,y:top+sy,width:sw,height:sh},placement:p};
    }
    function parseAlbum(value, rarityMap = {}, source = 'website') {
      let data = unwrap(value);
      if (!data) return null;
      if (data.Album && !data.Sets) data = data.Album;
      const albumId = id(first(data, ['AlbumId','albumId','id'])), inputSets = first(data, ['Sets','sets','StickerSets']);
      if (!albumId || !Array.isArray(inputSets) || !inputSets.length || inputSets.length > 200) return null;
      const rarities = {...RARITIES, ...rarityMap}, seen = new Set(), sets = [];
      for (const [i, rawSet] of inputSets.entries()) {
        const setId = id(first(rawSet, ['SetId','setId','id'])) || albumId + '.' + (i + 1), inputStickers = first(rawSet, ['Stickers','stickers','Cards']);
        if (!Array.isArray(inputStickers) || !inputStickers.length || inputStickers.length > 200 || seen.has('set:' + setId)) return null;
        seen.add('set:' + setId);
        const setNumber = positive(first(rawSet, ['SetNumber','setNumber','Number','number'])) || positive(Number(setId.split('.').pop())) || i + 1;
        if(seen.has('set-number:'+setNumber))return null;seen.add('set-number:'+setNumber);
        const stickers = [];
        for (const [j, raw] of inputStickers.entries()) {
          const stickerId = id(first(raw, ['StickerId','stickerId','id'])) || setId + '.' + (j + 1), name = text(first(raw, ['StickerName','stickerName','Name','name']), 200);
          if (!name || seen.has('sticker:' + stickerId)) return null;
          seen.add('sticker:' + stickerId);
          const rarityCode = positive(first(raw, ['Rarity','rarity','RarityIndex','rarityCode'])), mapped = rarities[rarityCode];
          const explicitStars = positive(first(raw, ['Stars','stars','StarCount','starCount'])), explicitGold = bool(first(raw, ['IsGolden','isGolden','IsGold','isGold','Gold','gold']));
          const artKey = text(first(raw, ['ArtKey','artKey']), 200);
          const number=positive(first(raw, ['StickerNumber','stickerNumber','Number','number'])) || positive(Number(stickerId.split('.').pop())) || j+1;
          if(seen.has('sticker-number:'+setId+':'+number))return null;seen.add('sticker-number:'+setId+':'+number);
          const direct = raw.assets || {};
          stickers.push({id: stickerId, name, number,
            rarityCode, stars: explicitStars && explicitStars <= 10 ? explicitStars : mapped?.stars || null, gold: explicitGold !== null ? explicitGold : mapped?.gold ?? null,
            raritySource: ['sticker response','live probabilities','known rarity mapping','unknown'].includes(raw.raritySource) && raw.rarityCode===rarityCode ? raw.raritySource : explicitStars && explicitGold !== null ? 'sticker response' : rarityMap[rarityCode] ? 'live probabilities' : mapped ? 'known rarity mapping' : 'unknown', artKey,starPlacement:normalizeStarPlacement(raw.starPlacement),
            assets: {art: publicURL(first(raw, ['ArtworkUrl','ArtUrl','ImageUrl','imageUrl']) || direct.art), frame: publicURL(first(raw, ['FrameUrl','frameUrl']) || direct.frame),
              starImage: publicURL(first(raw, ['StarsImageUrl','StarImageUrl']) || direct.starImage), ribbon: publicURL(first(raw, ['RibbonUrl','ribbonUrl']) || direct.ribbon)}});
        }
        const rewards = first(rawSet, ['CompletionRewards','completionRewards','rewards']);
        sets.push({id: setId, number: setNumber, name: text(first(rawSet, ['SetName','setName','Name','name']), 200) || setId, artKey: text(first(rawSet, ['ArtKey','artKey']), 200),
          rewards: Array.isArray(rewards) ? rewards.slice(0, 40).map(r=>({key: text(first(r,['CommodityKey','key'])), quantity: Number(first(r,['Quantity','quantity']))})).filter(r=>r.key&&Number.isFinite(r.quantity)) : [], stickers});
      }
      return {id: albumId, name: text(first(data, ['AlbumName','albumName','Name','name']), 200) || albumId,
        locale: text(first(data, ['Locale','locale']), 30), prestige: first(data, ['IsPrestigeMode','isPrestigeMode','prestige']) === true,
        startAt: date(first(data, ['StartTime','startAt'])), endAt: date(first(data, ['EndTime','endAt'])), capturedAt: date(data.capturedAt) || new Date().toISOString(),
        source, sets};
    }
    function albumKey(album) {return album.id + '|' + album.locale + '|' + (album.prestige ? 'prestige' : 'base');}
    function flattenManifest(value) {
      const out = {}; let count = 0;
      function walk(input, prefix, depth) {
        if (!input || typeof input !== 'object' || depth > 8 || count > 40000) return;
        for (const [key, raw] of Object.entries(input)) {
          if (++count > 40000) break;
          const path = prefix ? prefix + '/' + key : key, logical = key.includes('/') ? key : path;
          const rawURL = typeof raw === 'string' ? raw : first(raw, ['url','Url','path','Path','assetUrl','AssetUrl']);
          const url = publicURL(rawURL);
          if (url && /^[A-Za-z0-9_./ -]+$/.test(logical) && /(?:collections|collection-features|collections-features)\//i.test(logical)) out[logical.toLowerCase()] = url;
          else if (typeof raw === 'object') walk(raw, path, depth + 1);
        }
      }
      walk(unwrap(value), '', 0); return out;
    }
    function selectManifest(manifest, album) {
      const p = 'collections/' + album.id.toLowerCase() + '/';
      return Object.fromEntries(Object.entries(manifest).filter(([key,url])=>(key.startsWith(p)||key.startsWith('collections-features/'))&&publicURL(url)));
    }
    function imageKey(key) {return /\.(?:webp|png|jpe?g|avif|gif)$/i.test(key);}
    function resolveAssets(sticker, set, album, manifest, override = {}) {
      const p = 'collections/' + album.id.toLowerCase() + '/', sp = p + set.number + '/all/', direct = sticker.assets || {};
      const pick = (...keys) => keys.map(key=>publicURL(manifest[key.toLowerCase()])).find(Boolean) || '';
      const byArtKey = sticker.artKey ? Object.entries(manifest).find(([key])=>key.startsWith(p)&&imageKey(key)&&key.split('/').pop().replace(/\.[^.]+$/,'')===sticker.artKey.toLowerCase())?.[1] || '' : '';
      const kind = sticker.gold === true ? 'special' : 'basic', six = sticker.stars === 6 ? '_6_star' : '';
      const standard = pick(...['webp','png','jpg','avif'].map(ext=>sp + sticker.number + '.' + ext));
      const art = publicURL(direct.art) || byArtKey || standard || publicURL(override.art);
      return {art,
        frame: publicURL(direct.frame) || publicURL(override.frame) || (sticker.gold === null ? '' : pick(sp + 'cardfront_' + kind + six + '.webp', p + 'album/all/cardfront_' + kind + six + '.webp', sp + 'cardfront_' + kind + '.webp', p + 'album/all/cardfront_' + kind + '.webp', 'collections-features/all/bg_sticker' + kind + '.webp')),
        starImage: publicURL(direct.starImage) || (sticker.stars ? pick('collections-features/all/collections_star_' + sticker.stars + 'star.webp') : '') || publicURL(override.starImage),
        ribbon: publicURL(direct.ribbon) || publicURL(override.ribbon) || pick(sp + 'ribbonowned.webp', p + 'album/all/ribbonowned.webp')};
    }
    function rows(album, manifest, cards = {}) {
      return album.sets.flatMap(set=>set.stickers.map(sticker=>({set,sticker,assets:resolveAssets(sticker,set,album,manifest,cards[sticker.id]),starPlacement:normalizeStarPlacement(cards[sticker.id]?.starPlacement)||normalizeStarPlacement(sticker.starPlacement)||normalizeStarPlacement(cards.$starPlacement)||DEFAULT_STAR_PLACEMENT})));
    }
    function stats(album, manifest, cards = {}) {
      const list = rows(album,manifest,cards);
      return {sets: album.sets.length, stickers: list.length, artwork: list.filter(x=>x.assets.art).length,
        completeLayers: list.filter(x=>Object.values(x.assets).every(Boolean)).length, gold: list.filter(x=>x.sticker.gold===true).length,
        unknownRarity: list.filter(x=>!x.sticker.stars||x.sticker.gold===null).length};
    }
    function filePart(value, fallback = 'Untitled') {
      const clean = String(value || '').normalize('NFC').replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g,'').replace(/\s+/g,' ').trim().replace(/[. ]+$/g,'').slice(0,110).replace(/[. ]+$/g,'');
      return !clean ? fallback : /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(clean) ? '_' + clean : clean;
    }
    function stickerPath(row, ext, prefix = 'original-artwork') {
      return prefix + '/' + String(row.set.number).padStart(2,'0') + ' - ' + filePart(row.set.name) + '/' + String(row.set.number).padStart(2,'0') + '.' + String(row.sticker.number).padStart(2,'0') + ' - ' + filePart(row.sticker.name) + '.' + ext;
    }
    function mime(bytes) {
      const chars = (start,n) => {let s='';for(let i=start;i<Math.min(start+n,bytes.length);i++)s+=String.fromCharCode(bytes[i]);return s;};
      if (bytes[0]===137&&chars(1,3)==='PNG'&&bytes[4]===13&&bytes[5]===10) return {extension:'png',type:'image/png'};
      if (bytes[0]===255&&bytes[1]===216&&bytes[2]===255) return {extension:'jpg',type:'image/jpeg'};
      if (chars(0,4)==='RIFF'&&chars(8,4)==='WEBP') return {extension:'webp',type:'image/webp'};
      if (/^GIF8[79]a$/.test(chars(0,6))) return {extension:'gif',type:'image/gif'};
      if (chars(4,4)==='ftyp'&&/avif|avis/.test(chars(8,24))) return {extension:'avif',type:'image/avif'};
      throw new Error('The response was not a supported image.');
    }
    // Never retain or call methods on a foreign Blob or typed-array wrapper.
    function localBytes(buffer) {
      const view = new Uint8Array(buffer), output = new Uint8Array(view.byteLength);
      for (let i=0;i<view.byteLength;i++) output[i]=view[i];
      return output;
    }
    function binaryTextBytes(value) {
      if (typeof value!=='string') throw new Error('No binary image text returned.');
      const out=new Uint8Array(value.length);for(let i=0;i<value.length;i++)out[i]=value.charCodeAt(i)&255;return out;
    }
    let table;
    function crc32(bytes) {
      if (!table) table=Array.from({length:256},(_,n)=>{let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
      let crc=0xffffffff;for(let i=0;i<bytes.length;i++)crc=table[(crc^bytes[i])&255]^(crc>>>8);return(crc^0xffffffff)>>>0;
    }
    function zip(files) {
      if (!files.length||files.length>65000)throw new Error('Invalid ZIP file count.');
      const encoder=new TextEncoder(),parts=[],directory=[],seen=new Set();let offset=0,size=0;
      for(const file of files){
        const name=String(file.name).replace(/\\/g,'/');
        if(!name||name.startsWith('/')||name.split('/').some(x=>!x||x==='.'||x==='..'||/[\u0000-\u001f]/.test(x))||seen.has(name))throw new Error('Duplicate or invalid ZIP filename: '+name);seen.add(name);
        const path=encoder.encode(name),data=typeof file.data==='string'?encoder.encode(file.data):file.data,crc=crc32(data);
        if(path.length>65535||offset+data.length+path.length+30>0xffffffff)throw new Error('This album exceeds the ZIP export limit.');
        const local=new Uint8Array(30),l=new DataView(local.buffer);l.setUint32(0,0x04034b50,true);l.setUint16(4,20,true);l.setUint16(6,0x800,true);l.setUint16(12,33,true);l.setUint32(14,crc,true);l.setUint32(18,data.length,true);l.setUint32(22,data.length,true);l.setUint16(26,path.length,true);parts.push(local,path,data);
        const header=new Uint8Array(46),c=new DataView(header.buffer);c.setUint32(0,0x02014b50,true);c.setUint16(4,20,true);c.setUint16(6,20,true);c.setUint16(8,0x800,true);c.setUint16(14,33,true);c.setUint32(16,crc,true);c.setUint32(20,data.length,true);c.setUint32(24,data.length,true);c.setUint16(28,path.length,true);c.setUint32(42,offset,true);directory.push(header,path);size+=header.length+path.length;offset+=local.length+path.length+data.length;
      }
      const end=new Uint8Array(22),e=new DataView(end.buffer);e.setUint32(0,0x06054b50,true);e.setUint16(8,files.length,true);e.setUint16(10,files.length,true);e.setUint32(12,size,true);e.setUint32(16,offset,true);
      return new Blob([...parts,...directory,end],{type:'application/zip'});
    }
    const csvCell=value=>'"'+String(value??'').replace(/^[=+@-]/,"'$&").replace(/"/g,'""')+'"';
    const csv=data=>'\ufeff'+data.map(row=>row.map(csvCell).join(',')).join('\r\n');
    function metadata(album, manifest, cards={}, downloadInfo={}) {
      const list=rows(album,manifest,cards), exportedAt=new Date().toISOString();
      const sets=album.sets.map(set=>({...set,stickers:set.stickers.map(sticker=>{const row=list.find(x=>x.sticker.id===sticker.id),info=downloadInfo[sticker.id]||{};return{...sticker,assets:row.assets,starPlacement:row.starPlacement,files:info.files||{},exportStatus:info.status||'Metadata only',issues:info.issues||[]};})}));
      const result={format:'monopolygo-album-extractor',version:1,exportedAt,album:{...album,sets},statistics:stats(album,manifest,cards)};
      const names=csv([['Album ID','Album name','Set number','Set name','Sticker number','Sticker name','Stars','Gold','Regular or Gold','Rarity code','Art key','Art URL','Frame URL','Star image URL','Ribbon URL','Original artwork file','Full card PNG file','Export status'],
        ...sets.flatMap(set=>set.stickers.map(x=>[album.id,album.name,set.number,set.name,x.number,x.name,x.stars??'Unknown',x.gold===null?'Unknown':x.gold?'Yes':'No',x.gold===null?'Unknown':x.gold?'Gold':'Regular',x.rarityCode??'',x.artKey,x.assets.art,x.assets.frame,x.assets.starImage,x.assets.ribbon,x.files.artwork||'',x.files.card||'',x.exportStatus]))]);
      const setCSV=csv([['Album ID','Album name','Set number','Set name','Sticker count','Gold count','Art key','Completion rewards'],...sets.map(set=>[album.id,album.name,set.number,set.name,set.stickers.length,set.stickers.filter(x=>x.gold===true).length,set.artKey,JSON.stringify(set.rewards)])]);
      return {structured:result,names,setCSV,manifest:selectManifest(manifest,album)};
    }
    return {CDN,DEFAULT_MANIFEST,RARITIES,text,publicURL,parseRarities,parseAlbum,albumKey,flattenManifest,selectManifest,imageKey,resolveAssets,rows,stats,filePart,stickerPath,mime,localBytes,binaryTextBytes,crc32,zip,csv,metadata,normalizeStarPlacement,DEFAULT_STAR_PLACEMENT,cardLayout};
  }

  const C=makeCore();
  if(typeof module==='object'&&module.exports&&typeof window==='undefined'){module.exports=C;return;}
  const PREFIX='mgo-universal-album-extractor-v1:',SETTINGS=PREFIX+'settings',ALBUM_PREFIX=PREFIX+'album:';
  const load=(key,fallback)=>{try{const value=GM_getValue(key,'');return typeof value==='string'&&value?JSON.parse(value):fallback;}catch(_){return fallback;}};
  const save=(key,value)=>{try{GM_setValue(key,JSON.stringify(value));}catch(_){message('Browser storage is unavailable. Keep this page open until exporting.');}};
  const settings={open:true,fullscreen:true,cards:true,extras:true,concurrency:4,...load(SETTINGS,{})};
  const archives=new Map();let selected='',manifest={},manifestURL=C.DEFAULT_MANIFEST,rarities={},job=null,host=null,root=null,queued=false,search='',setFilter='',notice='Open Sticker Album to capture its live data.',observedAlbumRequest=null,scanTimer=null,captureSerial=0;
  const nativeFetch=typeof window.fetch==='function'?window.fetch.bind(window):null;
  for(const key of GM_listValues()){if(!key.startsWith(ALBUM_PREFIX))continue;const stored=load(key,null),album=C.parseAlbum(stored?.album,{},stored?.album?.source||'saved capture');if(album)archives.set(C.albumKey(album),{album,manifest:C.flattenManifest(stored.manifest||{}),cards:stored.cards||{}});}
  const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function message(text){notice=String(text);renderSoon();}
  function current(){return archives.get(selected)||null;}
  function persist(record){save(ALBUM_PREFIX+C.albumKey(record.album),record);}
  function captureAlbum(data,source='live album response'){
    let album=C.parseAlbum(data,rarities,source);if(!album)return false;
    const key=C.albumKey(album),old=archives.get(key),cachedRarities={};
    if(old)for(const set of old.album.sets)for(const x of set.stickers)if(x.rarityCode&&x.stars&&x.gold!==null&&x.raritySource==='live probabilities')cachedRarities[x.rarityCode]={stars:x.stars,gold:x.gold};
    if(Object.keys(cachedRarities).length)album=C.parseAlbum(data,{...cachedRarities,...rarities},source);
    const record={album,manifest:{...(old?.manifest||{}),...C.selectManifest(manifest,album)},cards:old?.cards||{}};
    archives.set(key,record);selected=key;persist(record);captureSerial++;scanPage();
    message('Captured '+album.sets.length+' sets and '+album.sets.reduce((n,s)=>n+s.stickers.length,0)+' stickers.');return true;
  }
  function captureRarities(data){const found=C.parseRarities(data);if(!found)return false;rarities={...rarities,...found};const record=current();if(record){for(const set of record.album.sets)for(const x of set.stickers){const r=found[x.rarityCode];if(r&&x.raritySource!=='sticker response'){x.stars=r.stars;x.gold=r.gold;x.raritySource='live probabilities';}}persist(record);renderSoon();}return true;}
  function captureManifest(data,url){const found=C.flattenManifest(data);if(!Object.keys(found).length)return false;manifest={...manifest,...found};if(C.publicURL(url,true))manifestURL=C.publicURL(url,true);const record=current();if(record){record.manifest={...record.manifest,...C.selectManifest(manifest,record.album)};persist(record);}renderSoon();return true;}
  function kindOf(rawURL,method='GET'){
    if(String(method).toUpperCase()!=='GET')return '';
    try{const u=new URL(rawURL,location.href);if(C.publicURL(u.href,true)&&/collections|stickers/i.test(u.pathname))return'manifest';if((u.hostname==='api.prod.monopolygo.com'||u.hostname==='www.monopolygo.com'||u.hostname==='monopolygo.com')&&/\/web-portal\//.test(u.pathname))return'portal';}catch(_){}return'';
  }
  function accept(data,kind,url){if(kind==='manifest')captureManifest(data,url);else{captureRarities(data);captureAlbum(data);}}
  if(nativeFetch){
    window.fetch=function(input,init){
      let url='',kind='',method='GET';try{url=typeof input==='string'?input:input.url;method=init?.method||input?.method||'GET';kind=kindOf(url,method);}catch(_){}
      const result=nativeFetch(input,init);
      if(kind)result.then(response=>{if(response.status<200||response.status>=300)return;response.clone().text().then(raw=>{let data;try{data=JSON.parse(raw);}catch(_){return;}if(kind==='portal'&&C.parseAlbum(data,rarities)){try{observedAlbumRequest={url,headers:new Headers(init?.headers||input?.headers||{}),credentials:init?.credentials||input?.credentials||'same-origin'};}catch(_){observedAlbumRequest={url};}}accept(data,kind,url);}).catch(()=>{});},()=>{});
      return result;
    };
  }
  if(typeof XMLHttpRequest!=='undefined'){
    const proto=XMLHttpRequest.prototype,open=proto.open,send=proto.send,setHeader=proto.setRequestHeader,tracked=new WeakMap();
    proto.open=function(method,url){tracked.set(this,{url:String(url),method,kind:kindOf(url,method),headers:{}});return open.apply(this,arguments);};
    proto.setRequestHeader=function(key,value){const info=tracked.get(this);if(info)info.headers[key]=value;return setHeader.apply(this,arguments);};
    proto.send=function(){const info=tracked.get(this);if(info?.kind)this.addEventListener('loadend',()=>{if(this.status<200||this.status>=300)return;try{const raw=this.responseType==='json'?JSON.stringify(this.response):this.responseText,data=JSON.parse(raw);if(info.kind==='portal'&&C.parseAlbum(data,rarities))observedAlbumRequest={url:info.url,headers:new Headers(info.headers),credentials:this.withCredentials?'include':'same-origin'};accept(data,info.kind,info.url);}catch(_){}},{once:true});return send.apply(this,arguments);};
  }
  function request(url,mode,task){
    return new Promise((resolve,reject)=>{
      let finished=false,handle=null,timer,abort;
      const finish=(fn,value)=>{if(finished)return;finished=true;clearTimeout(timer);task?.aborts.delete(abort);fn(value);};
      abort=()=>{try{handle?.abort();}catch(_){}finish(reject,new Error('Cancelled.'));};
      if(task?.cancelled){reject(new Error('Cancelled.'));return;}
      task?.aborts.add(abort);timer=setTimeout(()=>{try{handle?.abort();}catch(_){}finish(reject,new Error('Image request timed out.'));},30000);
      try{handle=GM_xmlhttpRequest({method:'GET',url,anonymous:mode!=='binary-text',responseType:mode==='buffer'?'arraybuffer':'text',fetch:mode==='binary-text'?false:true,
        ...(mode==='binary-text'?{overrideMimeType:'text/plain; charset=x-user-defined'}:{}),timeout:30000,
        onload:r=>{try{const finalURL=mode==='json'?C.publicURL(r.finalUrl||url,true):C.publicURL(r.finalUrl||url);if(r.status<200||r.status>=300||!finalURL)throw new Error('Image server returned '+r.status+'.');
          if(mode==='json')finish(resolve,JSON.parse(String(r.responseText)));
          else{const bytes=mode==='buffer'?C.localBytes(r.response):C.binaryTextBytes(r.responseText);if(!bytes.length||bytes.length>32*1024*1024)throw new Error('Unexpected image size.');const format=C.mime(bytes);finish(resolve,{bytes,...format});}
        }catch(error){finish(reject,error);}},onerror:()=>finish(reject,new Error('Could not fetch the public asset.')),ontimeout:()=>finish(reject,new Error('Image request timed out.')),onabort:()=>finish(reject,new Error('Cancelled.'))});}
      catch(error){finish(reject,error);}
    });
  }
  async function getImage(url,task){
    if(!C.publicURL(url))throw new Error('Artwork is not mapped yet.');
    if(task.cache.has(url))return task.cache.get(url);
    const promise=(async()=>{let last;for(let attempt=0;attempt<3;attempt++){
      if(task.cancelled)throw new Error('Cancelled.');
      try{return await request(url,attempt===1?'binary-text':'buffer',task);}catch(error){last=error;if(task.cancelled)throw error;}
    }throw last;})();task.cache.set(url,promise);return promise;
  }
  function scanPage(){
    if(scanTimer)return;scanTimer=setTimeout(()=>{scanTimer=null;const record=current();if(!record)return;let changed=false;
      for(const element of document.querySelectorAll('[data-sticker-card-context="album"][data-testid^="sticker-card-"]')){
        const stickerId=element.getAttribute('data-testid').replace(/^sticker-card-/,'');if(!record.album.sets.some(s=>s.stickers.some(x=>x.id===stickerId)))continue;
        const card={...(record.cards[stickerId]||{})};for(const[key,marker]of[['art','_sticker-card-image_'],['frame','_sticker-card-border-image_'],['starImage','_sticker-card-stars-image_'],['ribbon','_sticker-card-name-ribbon-image_']]){const image=element.querySelector('img[class*="'+marker+'"]'),url=C.publicURL(image?.currentSrc||image?.src);if(url&&card[key]!==url){card[key]=url;changed=true;}}
        const frame=element.querySelector('img[class*="_sticker-card-border-image_"]'),stars=element.querySelector('img[class*="_sticker-card-stars-image_"]');
        if(frame&&stars){const fr=frame.getBoundingClientRect(),sr=stars.getBoundingClientRect();if(fr.width>0&&fr.height>0&&sr.width>0&&sr.height>0){
          const round=n=>Math.round(n*100000)/100000,placement=C.normalizeStarPlacement({width:round(sr.width/fr.width),left:round((sr.left-fr.left)/fr.width),top:round((sr.top-fr.top)/fr.width),source:'official album page'});
          if(placement&&JSON.stringify(card.starPlacement)!==JSON.stringify(placement)){card.starPlacement=placement;changed=true;}
          if(placement&&!element.hasAttribute('data-album-art-key')&&JSON.stringify(record.cards.$starPlacement)!==JSON.stringify(placement)){record.cards.$starPlacement=placement;changed=true;}
        }}
        record.cards[stickerId]=card;
      }if(changed){persist(record);renderSoon();}
    },400);
  }
  async function captureNow(){
    message('Refreshing the live manifest and checking the album page...');
    scanPage();
    for(const script of document.querySelectorAll('script[type="application/json"]')){try{const raw=JSON.parse(script.textContent);if(!captureAlbum(raw,'page JSON'))for(const value of Object.values(raw?.props?.pageProps||{}))captureAlbum(value,'page JSON');}catch(_){}}
    try{captureManifest(await request(manifestURL,'json'),manifestURL);}catch(error){message('Manifest refresh failed: '+error.message+' The saved manifest remains available.');}
    if(observedAlbumRequest&&nativeFetch){try{const r=await nativeFetch(observedAlbumRequest.url,{method:'GET',headers:observedAlbumRequest.headers,credentials:observedAlbumRequest.credentials});if(!r.ok)throw new Error('Album response '+r.status);captureAlbum(await r.json());}catch(error){message('Open or reload Sticker Album while signed in to refresh its names. '+error.message);}}
    else if(!current())message('The artwork manifest is ready. Open Sticker Album while signed in, or reload it once with this script enabled, to capture names and rarity.');
    else{const s=C.stats(current().album,current().manifest,current().cards);message('Ready: '+s.sets+' sets, '+s.stickers+' stickers; '+s.artwork+'/'+s.stickers+' artwork links mapped.');}
  }
  async function decode(asset){const url=URL.createObjectURL(new Blob([asset.bytes],{type:asset.type}));try{return await new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(new Error('Image decoding failed.'));image.src=url;});}finally{URL.revokeObjectURL(url);}}
  async function fullCard(row,task){
    const urls=row.assets;if(!urls.art)throw new Error('Sticker artwork is not mapped.');
    if(!urls.frame||!urls.starImage||!urls.ribbon)throw new Error('Full card layers are incomplete; original artwork is exported separately.');
    const layers=await Promise.all([urls.art,urls.frame,urls.starImage,urls.ribbon].map(async url=>decode(await getImage(url,task))));
    if(task.cancelled)throw new Error('Cancelled.');
    const[art,frame,stars,ribbon]=layers,w=Math.min(frame.naturalWidth,1600),h=Math.round(w*frame.naturalHeight/frame.naturalWidth),caption=Math.round(w*.23),gap=Math.max(3,Math.round(w*.018));
    const layout=C.cardLayout(w,h,stars.naturalWidth,stars.naturalHeight,row.starPlacement),canvas=document.createElement('canvas');canvas.width=layout.width;canvas.height=layout.height+gap+caption;const ctx=canvas.getContext('2d');if(!ctx)throw new Error('Canvas PNG export is unavailable.');ctx.imageSmoothingQuality='high';
    const inset=Math.max(1,w*.02),aw=w-2*inset,ah=h-2*inset;ctx.drawImage(art,layout.frame.x+inset,layout.frame.y+inset,aw,ah);ctx.drawImage(frame,layout.frame.x,layout.frame.y,w,h);
    ctx.drawImage(stars,layout.stars.x,layout.stars.y,layout.stars.width,layout.stars.height);ctx.drawImage(ribbon,layout.frame.x,layout.height+gap,w,caption);
    let font=Math.max(12,Math.round(w*.071));ctx.font='bold '+font+'px Arial, sans-serif';while(ctx.measureText(row.sticker.name).width>w*.9&&font>8){font--;ctx.font='bold '+font+'px Arial, sans-serif';}
    ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle='#ffffff';ctx.strokeStyle='#241734';ctx.lineWidth=Math.max(1,w*.006);ctx.lineJoin='round';ctx.strokeText(row.sticker.name,layout.frame.x+w/2,layout.height+gap+caption/2,w*.9);ctx.fillText(row.sticker.name,layout.frame.x+w/2,layout.height+gap+caption/2,w*.9);
    const blob=await new Promise((resolve,reject)=>canvas.toBlob(x=>x?resolve(x):reject(new Error('PNG creation failed.')),'image/png'));
    return C.localBytes(await blob.arrayBuffer());
  }
  function download(name,data,type){
    const blob=typeof data==='string'||data instanceof Uint8Array?new Blob([data],{type}):data,url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=name;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
  }
  function startJob(total,label){if(job)return null;job={total,done:0,status:label,cancelled:false,aborts:new Set(),cache:new Map()};renderSoon();return job;}
  function stopJob(task){task.cache.clear();if(job===task)job=null;renderSoon();}
  async function individual(stickerId,mode){
    const record=current();if(!record)return;const row=C.rows(record.album,record.manifest,record.cards).find(x=>x.sticker.id===stickerId);if(!row)return;
    const task=startJob(1,'Downloading '+row.sticker.name+'...');if(!task)return;
    try{if(mode==='card'){const bytes=await fullCard(row,task);if(task.cancelled)return;download(C.stickerPath(row,'png','cards').split('/').pop(),bytes,'image/png');}
      else{const asset=await getImage(row.assets.art,task);if(task.cancelled)return;download(C.stickerPath(row,asset.extension).split('/').pop(),asset.bytes,asset.type);}message('Downloaded '+row.sticker.name+'.');}
    catch(error){message(task.cancelled?'Download cancelled.':'Download failed: '+error.message);}finally{stopJob(task);}
  }
  async function parallel(items,task,fn){let next=0;const workers=Math.max(1,Math.min(6,Number(settings.concurrency)||4));await Promise.all(Array.from({length:Math.min(workers,items.length)},async()=>{while(next<items.length&&!task.cancelled){const i=next++;await fn(items[i],i);task.done++;renderSoon();}}));}
  function exportMetadata(){const record=current();if(!record)return;const m=C.metadata(record.album,record.manifest,record.cards),name=C.filePart(record.album.name)+'-'+C.filePart(record.album.id)+'-metadata.zip';
    download(name,C.zip([{name:'sticker-manifest.json',data:JSON.stringify(m.structured,null,2)},{name:'asset-manifest.json',data:JSON.stringify(m.manifest,null,2)},{name:'collections-manifest.json',data:JSON.stringify(manifest,null,2)},{name:'sticker-names.csv',data:m.names},{name:'sets.csv',data:m.setCSV},{name:'album-data.json',data:JSON.stringify(record.album,null,2)}]),'application/zip');message('Exported album metadata, manifest and CSVs.');}
  function gallery(metadata){
    const list=metadata.album.sets.flatMap(set=>set.stickers.map(x=>({name:x.name,stars:x.stars,gold:x.gold,set:set.number,setName:set.name,art:x.files.artwork||'',card:x.files.card||''}))),data=JSON.stringify(list).replace(/</g,'\\u003c');
    return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+esc(metadata.album.name)+' Sticker Gallery</title><style>body{font:16px system-ui;background:#0b1323;color:#eef5ff;margin:0;padding:28px}h1{color:#76f5ce}header{max-width:850px}input,select{padding:12px;background:#182a42;color:#fff;border:1px solid #557187;border-radius:9px;font:inherit;margin:5px}main{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:18px;margin-top:25px}article{background:#142238;border:1px solid #385777;border-radius:14px;padding:12px;min-width:0}img{width:100%;height:300px;object-fit:contain}h2{font-size:16px}small{color:#b7cbe2;line-height:1.6}a{display:block;margin:12px 0;color:#85f5d3}p{line-height:1.6}footer{margin-top:25px;color:#abc1d8}</style></head><body><header><h1>'+esc(metadata.album.name)+'</h1><p>'+metadata.statistics.sets+' sets · '+metadata.statistics.stickers+' stickers. Image files already have their sticker names in the ZIP. Use the links to open a full image.</p><input id="q" type="search" placeholder="Find sticker"><select id="type"><option value="">All stickers</option><option value="gold">Gold</option><option value="regular">Regular</option></select><span id="count"></span></header><main id="grid"></main><footer>Keep this gallery beside its image folders. The complete names list is in sticker-names.csv.</footer><script>const rows='+data+';function render(){const q=document.getElementById("q").value.toLowerCase(),type=document.getElementById("type").value,shown=rows.filter(x=>(!q||x.name.toLowerCase().includes(q))&&(!type||(type==="gold"?x.gold===true:x.gold===false)));document.getElementById("count").textContent=shown.length+" stickers";const root=document.getElementById("grid");root.replaceChildren();for(const x of shown){const card=document.createElement("article"),img=document.createElement("img");img.src=x.card||x.art;img.alt=x.name;img.loading="lazy";if(x.card||x.art)card.append(img);const h=document.createElement("h2");h.textContent=x.name;const meta=document.createElement("small");meta.textContent="Set "+x.set+" · "+x.setName+" · "+(x.stars||"Unknown")+" stars · "+(x.gold===null?"Unknown":x.gold?"Gold":"Regular");card.append(h,meta);for(const [file,label]of[[x.card,"Open full card PNG"],[x.art,"Open original artwork"]])if(file){const a=document.createElement("a");a.href=file;a.textContent=label;a.target="_blank";a.rel="noopener";card.append(a);}root.append(card);}}document.getElementById("q").oninput=render;document.getElementById("type").onchange=render;render();<\/script></body></html>';
  }
  async function exportEverything(){
    if(job)return;
    const initial=current();if(!initial){message('Capture an album before exporting.');return;}
    // Freeze a plain, script-owned snapshot so an album rollover cannot mix files.
    const record=JSON.parse(JSON.stringify({...initial,sourceManifest:manifest})),list=C.rows(record.album,record.manifest,record.cards),includeCards=settings.cards===true,includeExtras=settings.extras===true;
    const task=startJob(list.length,'Preparing the complete album export...');if(!task)return;
    const files=[],info={},failures=[],assetFiles=new Map(),allImages=new Map();
    try{
      const selectedManifest=C.selectManifest(record.manifest,record.album);
      for(const row of list)for(const[type,url]of Object.entries(row.assets))if(url)allImages.set(url,{url,logicalKeys:[],usedBy:[]});
      const albumPrefix='collections/'+record.album.id.toLowerCase()+'/';
      for(const[key,url]of Object.entries(selectedManifest)){if(!C.imageKey(key))continue;if(!key.startsWith(albumPrefix)&&!allImages.has(url))continue;if(!includeExtras&&!allImages.has(url))continue;if(!allImages.has(url))allImages.set(url,{url,logicalKeys:[],usedBy:[]});allImages.get(url).logicalKeys.push(key);}
      for(const row of list)for(const[type,url]of Object.entries(row.assets))if(url&&allImages.has(url))allImages.get(url).usedBy.push({stickerId:row.sticker.id,layer:type});
      for(const row of list){info[row.sticker.id]={files:{},status:'Pending',issues:[]};}
      task.total=allImages.size+(includeCards?list.length:0);task.status='Fetching original artwork and album assets...';renderSoon();
      await parallel([...allImages.values()],task,async asset=>{
        if(task.cancelled)return;
        try{const image=await getImage(asset.url,task),owner=list.find(row=>row.assets.art===asset.url),stem=asset.url.split('/').pop().replace(/\.[^.]+$/,'');
          const filename=owner?C.stickerPath(owner,image.extension):'album-assets/'+C.filePart(stem)+'.'+image.extension;
          files.push({name:filename,data:image.bytes});assetFiles.set(asset.url,{file:filename,mime:image.type,byteLength:image.bytes.length});
          for(const row of list)if(row.assets.art===asset.url){const ownFile=C.stickerPath(row,image.extension);if(ownFile!==filename)files.push({name:ownFile,data:image.bytes});info[row.sticker.id].files.artwork=ownFile;}
          task.status='Assets: '+(task.done+1)+'/'+allImages.size;
        }catch(error){if(!task.cancelled)failures.push({url:asset.url,logicalKeys:asset.logicalKeys,error:error.message});}
      });
      if(task.cancelled){message('Album export cancelled.');return;}
      if(includeCards){task.status='Rendering full card PNGs...';await parallel(list,task,async row=>{try{const bytes=await fullCard(row,task),file=C.stickerPath(row,'png','full-cards');files.push({name:file,data:bytes});info[row.sticker.id].files.card=file;task.status='Full cards: '+row.sticker.name;}catch(error){if(!task.cancelled)info[row.sticker.id].issues.push(error.message);}});}
      if(task.cancelled){message('Album export cancelled.');return;}
      for(const row of list){const result=info[row.sticker.id];if(!row.assets.art)result.issues.push('Original artwork URL is not mapped.');else if(!result.files.artwork)result.issues.push('Original artwork download failed.');if(row.sticker.gold===null||!row.sticker.stars)result.issues.push('Rarity is unknown.');result.status=result.issues.length?'Incomplete':includeCards&&result.files.card?'Artwork and full card exported':'Artwork exported';}
      const m=C.metadata(record.album,record.manifest,record.cards,info),assets=[...allImages.values()].map(asset=>({...asset,...assetFiles.get(asset.url),status:assetFiles.has(asset.url)?'Downloaded':'Failed'}));
      const artworkCount=list.filter(row=>info[row.sticker.id].files.artwork).length,cardCount=list.filter(row=>info[row.sticker.id].files.card).length,incomplete=list.filter(row=>info[row.sticker.id].issues.length).length;
      const report={exportedAt:m.structured.exportedAt,albumId:record.album.id,expectedStickers:list.length,originalArtworkDownloaded:artworkCount,fullCardsCreated:cardCount,requestedFullCards:includeCards,
        albumAssetsRequested:allImages.size,albumAssetsDownloaded:assetFiles.size,incompleteStickers:incomplete,failedAssets:failures,complete:artworkCount===list.length&&(!includeCards||cardCount===list.length)&&!failures.length&&!incomplete};
      m.structured.exportReport=report;m.structured.assets=assets;
      files.push({name:'sticker-manifest.json',data:JSON.stringify(m.structured,null,2)},{name:'asset-manifest.json',data:JSON.stringify(selectedManifest,null,2)},{name:'collections-manifest.json',data:JSON.stringify(record.sourceManifest,null,2)},
        {name:'sticker-names.csv',data:m.names},{name:'sets.csv',data:m.setCSV},{name:'album-data.json',data:JSON.stringify(record.album,null,2)},
        {name:'export-report.json',data:JSON.stringify(report,null,2)},{name:'Open-Album-Gallery.html',data:gallery(m.structured)},
        {name:'README.txt',data:'ALBUM EXPORT\n\nAlbum: '+record.album.name+' ('+record.album.id+')\nStickers: '+list.length+'\nOriginal artwork: '+artworkCount+'/'+list.length+'\nFull cards: '+cardCount+'/'+(includeCards?list.length:0)+'\nStatus: '+(report.complete?'Complete':'Incomplete; check export-report.json and sticker-manifest.json')+'\n\nExtract this ZIP. All images are named and grouped by set. Open Open-Album-Gallery.html to browse them.\n\nFull card PNGs assemble the native official artwork, frame, star image and name ribbon with the sticker name. Original artwork is unchanged. album-assets contains additional album images and shared layers. asset-manifest.json preserves the logical asset keys. sticker-manifest.json links stickers to their artwork, layers, local files and issues. sticker-names.csv includes set names, sticker names, stars, gold status and image paths. Unknown data is marked instead of guessed.\n'});
      files.sort((a,b)=>a.name.localeCompare(b.name));task.status='Building ZIP...';renderSoon();
      const name=C.filePart(record.album.name)+'-'+C.filePart(record.album.id)+(record.album.prestige?'-Prestige':'')+'-album-export.zip';download(name,C.zip(files),'application/zip');
      message((report.complete?'Complete export':'Export finished with gaps')+': '+artworkCount+'/'+list.length+' originals, '+cardCount+' full cards, '+assetFiles.size+' album assets. '+(report.complete?'':'See export-report.json in the ZIP.'));
    }catch(error){message(task.cancelled?'Album export cancelled.':'Export failed: '+error.message);}finally{stopJob(task);}
  }
  const CSS=`:host{all:initial;font:14px system-ui,sans-serif;color:#edf5ff}*{box-sizing:border-box}button,input,select{font:inherit}button{cursor:pointer;border:1px solid #40607f;background:#1c3049;color:#eef6ff;border-radius:10px;padding:9px 12px;font-weight:650}button:hover:not(:disabled){border-color:#82f9d8;background:#284766}button:disabled{opacity:.45;cursor:default}button.primary{background:#7cf6d0;color:#072d27;border-color:#7cf6d0}button.danger{color:#ffb5b5}input,select{color:#f3f8ff;background:#102037;border:1px solid #3a5875;border-radius:9px;min-height:39px;padding:8px 10px}input[type=checkbox]{min-height:auto;accent-color:#7cf6d0}label{display:flex;align-items:center;gap:7px}.panel{color:#edf5ff;font:14px system-ui,sans-serif;position:fixed;inset:12px;background:#0c1728;border:1px solid #496e91;border-radius:20px;box-shadow:0 20px 100px #0008;display:flex;flex-direction:column;overflow:hidden;z-index:2147483601}.panel.window{inset:auto;top:18px;right:18px;width:min(950px,calc(100vw - 24px));height:min(850px,calc(100vh - 24px));resize:both;min-width:340px;min-height:400px;max-width:calc(100vw - 16px);max-height:calc(100vh - 16px)}header{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:19px 22px;background:#14263d;border-bottom:1px solid #35516b;cursor:move;touch-action:none}header small{display:block;letter-spacing:2px;color:#a4d5ed;font-size:10px;font-weight:800;margin-bottom:5px}header h1{font-size:25px;margin:0;color:#85f7d6}.window-tools{display:flex;gap:6px}.window-tools button{width:36px;padding:7px}.topbar{display:flex;align-items:center;gap:10px;padding:14px 22px;background:#0e1d32;border-bottom:1px solid #2b455f;flex-wrap:wrap}.topbar select{min-width:250px;max-width:100%;flex:1}.layout{display:flex;flex:1;min-height:0}.sidebar{width:220px;border-right:1px solid #2b455f;overflow:auto;padding:17px 12px;background:#101f34}.sidebar button{display:block;text-align:left;width:100%;margin:0 0 7px;font-size:12px}.sidebar button.active{border-color:#7cf6d0}.sidebar strong{display:block;color:#b7d1e6;font-size:11px;letter-spacing:1px;margin:0 7px 12px}.main{overflow:auto;flex:1;padding:23px;min-width:0}.title{display:flex;gap:15px;justify-content:space-between;align-items:start}.title h2{font-size:27px;margin:0 0 5px}.title p{margin:0;color:#b0c7df;line-height:1.65;font-size:12px}.badge{border:1px solid #4f778d;background:#19394a;border-radius:20px;padding:7px 12px;color:#89f7d7;font-weight:700;font-size:12px;white-space:nowrap}.badge.warn{color:#ffe0a1;background:#3a2e20;border-color:#b99043}.metrics{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin:20px 0}.metric{border:1px solid #35536e;background:#14283e;border-radius:13px;padding:14px}.metric strong{display:block;font-size:26px;color:#edf8ff}.metric span{font-size:11px;color:#a9c5dd}.export-box{border:1px solid #466e82;background:linear-gradient(110deg,#123b3f,#152840);border-radius:16px;padding:18px;margin:15px 0 20px}.export-box h3{margin:0 0 5px;font-size:18px;color:#9bf9dd}.export-box p{margin:0 0 15px;font-size:12px;color:#bad8e6;line-height:1.6}.export-options,.export-buttons{display:flex;flex-wrap:wrap;gap:12px;align-items:center}.export-options{font-size:12px;margin-bottom:16px}.export-buttons button.primary{padding:12px 18px}.progress{display:flex;gap:10px;align-items:center;margin-top:15px;flex-wrap:wrap}.progress progress{width:180px;accent-color:#7cf6d0}.progress span{font-size:12px;flex:1;min-width:150px}.filters{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:20px 0}.filters input{flex:1;min-width:160px}.filters small{color:#a9c8de}.sets{display:grid;gap:22px}.set{border:1px solid #2f4c68;border-radius:17px;background:#101f34;padding:17px}.set h3{margin:0 0 14px;font-size:19px}.set h3 span{color:#a6c5dc;font-size:12px;margin-left:8px;font-weight:400}.stickers{display:grid;grid-template-columns:repeat(auto-fill,minmax(145px,1fr));gap:14px}.sticker{min-width:0;border:1px solid #355574;border-radius:12px;padding:10px;background:#132940}.sticker .art{position:relative;width:100%;height:auto;aspect-ratio:var(--frame-ratio,350 / 486);margin-top:27%;margin-bottom:9px}.art img{object-fit:contain;position:absolute;pointer-events:none}.art .drawing{inset:2%;width:96%;height:96%;z-index:1}.art .frame{inset:0;width:100%;height:100%;z-index:2}.art .stars{left:0;top:0;width:100%;height:auto;transform:translateY(-67.5%);z-index:3}.placeholder{display:grid;place-items:center;height:100%;color:#8daec9;background:#192d44;border-radius:10px;text-align:center;padding:10px;font-size:12px}.sticker strong{display:block;font-size:13px;line-height:1.35;min-height:36px}.sticker .rarity{font-size:11px;color:#b4d0e3;display:block;margin:5px 0 10px}.sticker .rarity.gold{color:#ffe193}.sticker .actions{display:flex;gap:5px;flex-wrap:wrap}.sticker .actions button{font-size:11px;flex:1;padding:7px 4px}.empty{max-width:800px;margin:20px auto;padding:40px 20px;color:#b6cde2;line-height:1.7}.empty h2{color:#91fadd;font-size:30px}.empty .steps{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-top:25px}.empty .step{background:#183049;border:1px solid #42637d;border-radius:15px;padding:20px}.step b{display:block;color:#87f8d4;margin-bottom:8px}.fine{color:#9ebbd4;font-size:11px;line-height:1.7}.footer{padding:12px 22px;border-top:1px solid #35516b;background:#11243b;display:flex;gap:10px;align-items:center;flex-wrap:wrap}.footer .notice{flex:1;min-width:200px;color:#cfebf5;font-size:12px;line-height:1.5}.bubble{font:14px system-ui,sans-serif;position:fixed;right:18px;top:18px;z-index:2147483602;border:2px solid #7ff7d4;border-radius:100px;padding:14px 20px;background:#123c3d;box-shadow:0 8px 35px #0008;color:#dcfff4;font-weight:800}.bubble small{display:block;color:#99dac7;font-size:10px;margin-top:3px}[hidden]{display:none!important}@media(max-width:800px){.sidebar{display:none}.main{padding:17px}.metrics{grid-template-columns:repeat(3,1fr)}.title{flex-wrap:wrap}.stickers{grid-template-columns:repeat(auto-fill,minmax(135px,1fr))}}@media(max-width:480px){.panel{inset:6px;border-radius:15px}header{padding:12px}header h1{font-size:19px}header small{font-size:8px}.topbar{padding:10px;gap:7px}.topbar select{min-width:100%;font-size:12px}.topbar button{font-size:11px;flex:1}.main{padding:12px}.title h2{font-size:23px}.metrics{grid-template-columns:repeat(2,1fr);gap:7px}.metric{padding:10px}.metric strong{font-size:22px}.export-box{padding:13px}.export-options{gap:9px}.export-buttons button{flex:1;font-size:12px}.stickers{grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}.set{padding:10px}.sticker{padding:7px}.sticker .art{height:auto}.footer{padding:10px}.footer .notice{font-size:11px}.empty{padding:10px}.empty .steps{grid-template-columns:1fr}.window-tools button{width:30px;font-size:12px}}`;
  function bodyHTML(record){
    if(!record)return'<div class="empty"><h2>One album. One complete export.</h2><p>Capture the live album from Monopoly GO, then export all its names, rarity and artwork in a single ZIP. This extractor automatically follows the album the website supplies.</p><button class="primary" data-action="open-official">Open Sticker Album</button><div class="steps"><div class="step"><b>1. Load your album</b>Open Sticker Album while signed in. Reload once after installing this script.</div><div class="step"><b>2. Check capture</b>Names, sets, stars and public image links appear here automatically.</div><div class="step"><b>3. Export everything</b>Download named artwork, full card PNGs, CSVs and manifests in one ZIP.</div></div></div>';
    const album=record.album,s=C.stats(album,record.manifest,record.cards),list=C.rows(album,record.manifest,record.cards),ready=s.artwork===s.stickers&&!s.unknownRarity;
    const shown=list.filter(row=>(!setFilter||row.set.id===setFilter)&&(!search||row.sticker.name.toLowerCase().includes(search.toLowerCase()))),sets=album.sets.filter(set=>shown.some(row=>row.set.id===set.id));
    return '<div class="title"><div><h2>'+esc(album.name)+(album.prestige?' · Prestige':'')+'</h2><p>Album '+esc(album.id)+' · '+esc(album.locale||'Website language')+'<br>Captured '+esc(new Date(album.capturedAt).toLocaleString())+'</p></div><span class="badge '+(ready?'':'warn')+'">'+(ready?'Ready to export':'Capture needs attention')+'</span></div>'+
      '<div class="metrics">'+[[s.sets,'Sets'],[s.stickers,'Stickers'],[s.artwork+'/'+s.stickers,'Artwork mapped'],[s.completeLayers+'/'+s.stickers,'Full card layers'],[s.gold,'Gold stickers']].map(([n,t])=>'<div class="metric"><strong>'+n+'</strong><span>'+t+'</span></div>').join('')+'</div>'+
      '<section class="export-box"><h3>Export the entire album</h3><p>All stickers are included, including ones you do not own. Search and set filters below only change the preview. The ZIP includes set names, sticker names, stars, gold status, original artwork, manifests and CSVs.</p><div class="export-options"><label><input id="include-cards" type="checkbox" '+(settings.cards?'checked':'')+' '+(job?'disabled':'')+'> Full card PNGs with names</label><label><input id="include-extras" type="checkbox" '+(settings.extras?'checked':'')+' '+(job?'disabled':'')+'> Include all album art and shared layers</label><label>Downloads at once <select id="concurrency" '+(job?'disabled':'')+'>'+[1,2,4,6].map(x=>'<option value="'+x+'" '+(Number(settings.concurrency)===x?'selected':'')+'>'+x+'</option>').join('')+'</select></label></div><div class="export-buttons"><button class="primary" data-action="export-all" '+(job?'disabled':'')+'>Export everything (ZIP)</button><button data-action="export-metadata" '+(job?'disabled':'')+'>Manifest + CSV ZIP</button><button data-action="csv" '+(job?'disabled':'')+'>Sticker names CSV</button></div>'+(job?'<div class="progress" role="status"><progress max="'+job.total+'" value="'+job.done+'"></progress><span>'+esc(job.status)+'</span><button class="danger" data-action="cancel">Cancel</button></div>':'')+'</section>'+
      (s.artwork<s.stickers||s.unknownRarity?'<p class="fine">'+(s.stickers-s.artwork)+' artwork links are not mapped; '+s.unknownRarity+' stickers have unknown rarity. Click Capture / refresh, and let the official album finish loading. Missing data is reported in the export.</p>':'')+
      '<div class="filters"><input id="search" type="search" placeholder="Find a sticker by name" value="'+esc(search)+'"><select id="set-filter"><option value="">All sets</option>'+album.sets.map(set=>'<option value="'+esc(set.id)+'" '+(setFilter===set.id?'selected':'')+'>'+set.number+'. '+esc(set.name)+'</option>').join('')+'</select><small>'+shown.length+' shown</small></div><div class="sets">'+sets.map(set=>'<section class="set" id="set-'+esc(set.number)+'"><h3>'+set.number+'. '+esc(set.name)+'<span>'+set.stickers.length+' stickers</span></h3><div class="stickers">'+shown.filter(row=>row.set.id===set.id).map(row=>{const x=row.sticker,a=row.assets;return'<article class="sticker"><div class="art">'+(a.art?'<img class="drawing" src="'+esc(a.art)+'" loading="lazy" referrerpolicy="no-referrer" alt="'+esc(x.name)+'">':'<div class="placeholder">Artwork not mapped yet</div>')+(a.frame?'<img class="frame" src="'+esc(a.frame)+'" loading="lazy" alt="">':'')+(a.starImage?'<img class="stars" src="'+esc(a.starImage)+'" data-star-width="'+row.starPlacement.width+'" data-star-left="'+row.starPlacement.left+'" data-star-top="'+row.starPlacement.top+'" loading="lazy" alt="">':'')+'</div><strong>'+esc(x.name)+'</strong><span class="rarity '+(x.gold===true?'gold':'')+'">'+(x.stars?x.stars+' stars':'Unknown stars')+' · '+(x.gold===null?'Unknown rarity':x.gold?'Gold':'Regular')+'</span><div class="actions"><button data-action="art" data-sticker="'+esc(x.id)+'" '+(job||!a.art?'disabled':'')+'>Artwork</button><button data-action="card" data-sticker="'+esc(x.id)+'" '+(job||!Object.values(a).every(Boolean)?'disabled':'')+'>Card PNG</button></div></article>';}).join('')+'</div></section>').join('')+'</div>';
  }
  function alignPreviewStars(){
    for(const art of root.querySelectorAll('.art')){
      const frame=art.querySelector('.frame'),stars=art.querySelector('.stars');
      const align=()=>{
        if(frame?.naturalWidth&&frame?.naturalHeight)art.style.setProperty('--frame-ratio',frame.naturalWidth+' / '+frame.naturalHeight);
        if(!stars)return;
        const p=C.normalizeStarPlacement({width:Number(stars.dataset.starWidth),left:Number(stars.dataset.starLeft),top:Number(stars.dataset.starTop),source:'preview'})||C.DEFAULT_STAR_PLACEMENT;
        art.style.marginTop=(Math.max(0,-p.top)*100+2)+'%';stars.style.width=p.width*100+'%';stars.style.left=p.left*100+'%';
        if(stars.naturalWidth&&stars.naturalHeight)stars.style.transform='translateY('+(p.top/p.width*stars.naturalWidth/stars.naturalHeight*100)+'%)';
      };
      if(frame)frame.onload=align;if(stars)stars.onload=align;align();
    }
  }
  function render(){
    if(!root)return;const record=current(),scroll=root.querySelector('.main')?.scrollTop||0,focus=root.activeElement?.id,caret=root.activeElement?.selectionStart;
    const options=[...archives].sort((a,b)=>b[1].album.capturedAt.localeCompare(a[1].album.capturedAt)).map(([key,r])=>'<option value="'+esc(key)+'" '+(selected===key?'selected':'')+'>'+esc(r.album.name)+' · '+esc(r.album.id)+(r.album.prestige?' · Prestige':'')+'</option>').join('');
    root.innerHTML='<style>'+CSS+'</style><button class="bubble" id="bubble" '+(settings.open?'hidden':'')+'>Album Extractor<small>'+archives.size+' captured album'+(archives.size===1?'':'s')+'</small></button><section class="panel '+(settings.fullscreen?'':'window')+'" id="panel" '+(!settings.open?'hidden':'')+'><header id="drag"><div><small>MONOPOLY GO · STANDALONE EXPORT TOOL</small><h1>Universal Album Extractor</h1></div><div class="window-tools"><button data-action="fullscreen" aria-label="Toggle full screen">↗</button><button data-action="minimize" aria-label="Minimize">−</button></div></header><div class="topbar"><select id="album-select" '+(job?'disabled':'')+' aria-label="Captured albums">'+(options||'<option>No album captured yet</option>')+'</select><button data-action="capture" '+(job?'disabled':'')+'>Capture / refresh</button><button data-action="open-official">Official album</button></div><div class="layout"><aside class="sidebar"><strong>JUMP TO SET</strong><button data-action="show-all">All sets</button>'+(record?record.album.sets.map(set=>'<button class="'+(setFilter===set.id?'active':'')+'" data-action="select-set" data-set="'+esc(set.id)+'">'+set.number+'. '+esc(set.name)+'</button>').join(''):'')+'</aside><main class="main">'+bodyHTML(record)+'</main></div><footer class="footer"><div class="notice" id="notice" role="status">'+esc(notice)+'</div><button data-action="import">Import capture JSON</button><button data-action="minimize">Minimize</button></footer><input id="import-file" type="file" accept="application/json,.json" hidden></section>';
    alignPreviewStars();root.querySelector('.main').scrollTop=scroll;
    const actionButtons=root.querySelectorAll('[data-action]');for(const button of actionButtons)button.onclick=()=>{
      const action=button.dataset.action;
      if(action==='minimize'){settings.open=false;save(SETTINGS,settings);renderSoon();}
      else if(action==='fullscreen'){settings.fullscreen=!settings.fullscreen;save(SETTINGS,settings);renderSoon();}
      else if(action==='capture')void captureNow();
      else if(action==='export-all')void exportEverything();
      else if(action==='export-metadata')exportMetadata();
      else if(action==='csv'){const r=current();if(r)download(C.filePart(r.album.name)+'-sticker-names.csv',C.metadata(r.album,r.manifest,r.cards).names,'text/csv;charset=utf-8');}
      else if(action==='art'||action==='card')void individual(button.dataset.sticker,action);
      else if(action==='cancel'&&job){job.cancelled=true;for(const abort of job.aborts)abort();job.status='Cancelling...';renderSoon();}
      else if(action==='select-set'||action==='show-all'){setFilter=action==='show-all'?'':button.dataset.set;renderSoon();}
      else if(action==='open-official')location.assign('https://www.monopolygo.com/sticker-album');
      else if(action==='import')root.getElementById('import-file').click();
    };
    root.getElementById('bubble').onclick=()=>{settings.open=true;save(SETTINGS,settings);renderSoon();};
    root.getElementById('album-select').onchange=e=>{selected=e.target.value;search='';setFilter='';renderSoon();};
    const bind=(id,event,fn)=>{const element=root.getElementById(id);if(element)element[event]=fn;};
    bind('search','oninput',e=>{search=e.target.value;renderSoon();});bind('set-filter','onchange',e=>{setFilter=e.target.value;renderSoon();});
    bind('include-cards','onchange',e=>{settings.cards=e.target.checked;save(SETTINGS,settings);});bind('include-extras','onchange',e=>{settings.extras=e.target.checked;save(SETTINGS,settings);});bind('concurrency','onchange',e=>{settings.concurrency=Number(e.target.value);save(SETTINGS,settings);});
    bind('import-file','onchange',async e=>{const file=e.target.files[0];if(!file)return;try{if(file.size>20*1024*1024)throw new Error('Capture JSON must be under 20 MB.');const data=JSON.parse(await file.text());if(data.format==='monopolygo-album-extractor'&&data.album){captureManifest(Object.fromEntries((data.assets||[]).flatMap(a=>(a.logicalKeys||[]).map(key=>[key,a.url]))));if(!captureAlbum(data.album,'imported capture'))throw new Error('Album data is invalid.');}else if(!captureAlbum(data,'imported album JSON')){if(!captureManifest(data))throw new Error('Not an album capture or artwork manifest.');}message('Imported capture data.');}catch(error){message('Import failed: '+error.message);}});
    if(focus){const el=root.getElementById(focus);if(el){el.focus({preventScroll:true});if(caret!==null&&caret!==undefined&&el.type==='search')el.setSelectionRange(caret,caret);}}
    const drag=root.getElementById('drag');drag.onpointerdown=event=>{if(settings.fullscreen||event.target.closest('button'))return;const panel=root.getElementById('panel'),rect=panel.getBoundingClientRect(),x=event.clientX,y=event.clientY;drag.setPointerCapture(event.pointerId);drag.onpointermove=move=>{panel.style.left=Math.max(0,Math.min(window.innerWidth-160,rect.left+move.clientX-x))+'px';panel.style.top=Math.max(0,Math.min(window.innerHeight-70,rect.top+move.clientY-y))+'px';panel.style.right='auto';};drag.onpointerup=()=>{drag.onpointermove=null;};};
  }
  function renderSoon(){if(queued)return;queued=true;setTimeout(()=>{queued=false;render();},90);}
  function mount(){if(host||!document.body)return;host=document.createElement('div');host.id='mgo-universal-album-extractor';host.style.cssText='all:initial;position:fixed;inset:0;width:0;height:0;z-index:2147483647;';root=host.attachShadow({mode:'open'});document.body.appendChild(host);
    if(!selected&&archives.size)selected=[...archives].sort((a,b)=>b[1].album.capturedAt.localeCompare(a[1].album.capturedAt))[0][0];render();
    const observer=new MutationObserver(()=>scanPage());observer.observe(document.body,{childList:true,subtree:true});
    setTimeout(()=>{void captureNow();},500);
  }
  if(document.body)mount();else document.addEventListener('DOMContentLoaded',mount,{once:true});
  document.addEventListener('load',event=>{if(event.target?.tagName==='IMG'&&String(event.target.className).includes('_sticker-card-'))scanPage();},true);
  document.addEventListener('keydown',event=>{if(event.altKey&&event.shiftKey&&event.code==='KeyE'){event.preventDefault();settings.open=!settings.open;save(SETTINGS,settings);renderSoon();}});
  GM_registerMenuCommand('Open Universal Album Extractor',()=>{settings.open=true;save(SETTINGS,settings);renderSoon();});
  GM_registerMenuCommand('Capture / refresh album',()=>{void captureNow();});
})();
