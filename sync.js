/* Goleroz online sync — configurable Supabase project, client-side encryption. */
(()=>{
'use strict';
const SKEY='gol-period-v1',K_CFG='gol-sync-cfg',K_AUTH='gol-sync-auth',K_PASS='gol-sync-pass',K_META='gol-sync-meta',K_LAST='gol-sync-last';
const TABLE='cloud_backups',g=id=>document.getElementById(id),rawSet=Storage.prototype.setItem;
const txt=(fa,en)=>{try{return typeof EN!=='undefined'&&EN?en:fa}catch(e){return fa}};
const esc=s=>String(s??'').replace(/[&<>\"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[m]));
const ls=(k,v)=>{try{if(v===undefined)return localStorage.getItem(k);if(v===null)localStorage.removeItem(k);else rawSet.call(localStorage,k,String(v))}catch(e){return null}};
const parse=(s,d)=>{try{return JSON.parse(s)}catch(e){return d}};
const clone=x=>JSON.parse(JSON.stringify(x));
const stable=x=>Array.isArray(x)?'['+x.map(stable).join(',')+']':x&&typeof x==='object'?'{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+stable(x[k])).join(',')+'}':JSON.stringify(x);
const cfg=()=>{const c=parse(ls(K_CFG)||'{}',{});return{url:String(c.url||'').trim().replace(/\/+$/,''),key:String(c.key||'').trim()}};
const cfgOk=()=>{const c=cfg();try{return new URL(c.url).protocol==='https:'&&c.key.length>20}catch(e){return false}};
let auth=parse(ls(K_AUTH)||'null',null),sessionPassword='',encPassword=ls(K_PASS)||'',fallbackEncPassword=ls(K_PASS)||'',rememberRequested=false,busy=false,again=false,applying=false,timer=null,lastState=null;
let status={s:auth?'idle':'off',m:'',t:+(ls(K_LAST)||0)};
let meta=parse(ls(K_META)||'null',null)||{ts:0,prefsTs:0,days:{},deletedDays:{}};
const cleanMeta=m=>({ts:+m?.ts||0,prefsTs:+m?.prefsTs||0,days:Object.assign({},m?.days||{}),deletedDays:Object.assign({},m?.deletedDays||{})});
meta=cleanMeta(meta);
const currentState=()=>{const x=parse(ls(SKEY)||'null',null);if(x&&typeof x==='object'&&!Array.isArray(x))return x;try{if(typeof S!=='undefined'&&S&&typeof S==='object')return clone(S)}catch(e){}return{days:{},c:28,p:5,pms:7}};
lastState=clone(currentState());

/* Preserve a previously remembered encryption password, then retire legacy toggle keys. */
const legacyPass=ls('gol-cloud-pass');
if(legacyPass&&!ls(K_PASS)){ls(K_PASS,legacyPass);encPassword=legacyPass;fallbackEncPassword=legacyPass}
ls('gol-cloud-pass',null);ls('gol-online',null);ls('gol-online-open',null);

function setStatus(s,m){status.s=s;status.m=m||'';drawStatus()}
function statusText(){
  if(!cfgOk())return txt('پروژه‌ی Supabase را تنظیم کن','Set up a Supabase project');
  if(!auth)return txt('ورود با ایمیل برای همگام‌سازی','Sign in to sync');
  if(status.s==='syncing')return txt('در حال همگام‌سازی…','Syncing…');
  if(status.s==='error')return '⚠️ '+(status.m||txt('خطا','Error'));
  if(status.s==='off')return txt('نشست تمام شده؛ دوباره وارد شو','Session expired; sign in again');
  if(status.t)return txt('همگام · آخرین: ','Synced · Last: ')+new Date(status.t).toLocaleTimeString(txt('fa-IR','en-US'),{hour:'2-digit',minute:'2-digit'});
  return txt('آماده‌ی همگام‌سازی','Ready to sync');
}
function drawStatus(){const a=g('gol-sync-caption'),b=g('gs-status'),c=g('gs-feedback');if(a)a.textContent=statusText();if(b)b.textContent=status.m||statusText();if(c)c.textContent=status.m||''}

/* Supabase Auth REST client; only the public anon key is stored in browser config. */
function setAuth(j){auth={at:j.access_token,rt:j.refresh_token,exp:Math.floor(Date.now()/1000)+(j.expires_in||3600),uid:j.user&&j.user.id,email:j.user&&j.user.email};ls(K_AUTH,JSON.stringify(auth))}
function clearAuth(){auth=null;ls(K_AUTH,null)}
async function refresh(){
  const c=cfg();if(!auth?.rt)throw new Error('SESSION');
  const r=await fetch(c.url+'/auth/v1/token?grant_type=refresh_token',{method:'POST',headers:{apikey:c.key,'Content-Type':'application/json'},body:JSON.stringify({refresh_token:auth.rt})});
  if(r.status===400||r.status===401){clearAuth();throw new Error('SESSION')}
  if(!r.ok)throw new Error('HTTP '+r.status);
  setAuth(await r.json());
}
async function api(path,options={},retried=false){
  if(!auth)throw new Error('SESSION');
  if(auth.exp-Date.now()/1000<60)await refresh();
  const c=cfg(),headers=Object.assign({apikey:c.key,Authorization:'Bearer '+auth.at,'Content-Type':'application/json'},options.headers||{});
  const r=await fetch(c.url+path,Object.assign({},options,{headers}));
  if(r.status===401&&!retried){await refresh();return api(path,options,true)}
  return r;
}
async function errText(r){try{const j=await r.json();return j.message||j.msg||j.error_description||('HTTP '+r.status)}catch(e){return 'HTTP '+r.status}}
async function getRow(){
  const r=await api('/rest/v1/'+TABLE+'?select=user_id,rev,payload,updated_at&user_id=eq.'+encodeURIComponent(auth.uid)+'&limit=1');
  if(!r.ok)throw new Error(await errText(r));const a=await r.json();return a[0]||null;
}
async function putRow(row,payload){
  let r;
  if(!row){
    r=await api('/rest/v1/'+TABLE,{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({user_id:auth.uid,rev:1,payload,updated_at:new Date().toISOString()})});
    if(r.status===409)return false;
  }else{
    r=await api('/rest/v1/'+TABLE+'?user_id=eq.'+encodeURIComponent(auth.uid)+'&rev=eq.'+encodeURIComponent(row.rev),{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify({payload,rev:(+row.rev||1)+1,updated_at:new Date().toISOString()})});
  }
  if(!r.ok)throw new Error(await errText(r));const a=await r.json();return !!a.length;
}

/* AES-GCM payload envelope intentionally matches the previous Goleroz format. */
const enc=new TextEncoder(),dec=new TextDecoder(),toB64=u=>{let s='';for(let i=0;i<u.length;i+=0x8000)s+=String.fromCharCode(...u.subarray(i,i+0x8000));return btoa(s)},fromB64=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
async function derive(pass,salt){const k=await crypto.subtle.importKey('raw',enc.encode(pass),'PBKDF2',false,['deriveKey']);return crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:150000,hash:'SHA-256'},k,{name:'AES-GCM',length:256},false,['encrypt','decrypt'])}
async function encrypt(pass,obj){const salt=crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12)),key=await derive(pass,salt),data=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,enc.encode(JSON.stringify(obj)));return JSON.stringify({v:1,salt:toB64(salt),iv:toB64(iv),data:toB64(new Uint8Array(data))})}
async function decrypt(pass,raw){const x=JSON.parse(raw),key=await derive(pass,fromB64(x.salt)),data=await crypto.subtle.decrypt({name:'AES-GCM',iv:fromB64(x.iv)},key,fromB64(x.data));return JSON.parse(dec.decode(data))}
function validState(s){return !!s&&typeof s==='object'&&!Array.isArray(s)&&s.days&&typeof s.days==='object'&&!Array.isArray(s.days)}
function normalizeDoc(obj,remoteTs=0){
  if(obj&&obj._golSyncV===2&&validState(obj.state))return{state:obj.state,meta:cleanMeta(obj.meta)};
  if(validState(obj))return{state:obj,meta:{ts:remoteTs,prefsTs:remoteTs,days:{},deletedDays:{}}};
  throw new Error('BADPAYLOAD');
}
function timestamp(v){const n=typeof v==='number'?v:Date.parse(v||'');return Number.isFinite(n)?n:0}
function merge(local,remote,remoteTs){
  const L={state:local.state,meta:cleanMeta(local.meta)},R={state:remote.state,meta:cleanMeta(remote.meta)};
  const lt=L.meta.ts||0,rt=R.meta.ts||remoteTs||0,lp=L.meta.prefsTs||lt,rp=R.meta.prefsTs||rt,remotePrefs=rp>lp;
  const out=clone(remotePrefs?R.state:L.state);
  const allKeys=new Set([...Object.keys(L.state),...Object.keys(R.state)]);allKeys.delete('days');
  for(const k of allKeys){const preferred=remotePrefs?R.state:L.state,other=remotePrefs?L.state:R.state;if(preferred[k]!==undefined)out[k]=clone(preferred[k]);else if(other[k]!==undefined)out[k]=clone(other[k]);else delete out[k]}
  const LD=L.state.days||{},RD=R.state.days||{},allDates=new Set([...Object.keys(LD),...Object.keys(RD),...Object.keys(L.meta.deletedDays),...Object.keys(R.meta.deletedDays)]),days={},md={ts:Math.max(lt,rt),prefsTs:Math.max(lp,rp),days:{},deletedDays:{}};
  for(const d of allDates){
    const hasL=Object.prototype.hasOwnProperty.call(LD,d),hasR=Object.prototype.hasOwnProperty.call(RD,d),lts=+(L.meta.days[d]||(hasL?lt:0)),rts=+(R.meta.days[d]||(hasR?rt:0)),del=Math.max(+(L.meta.deletedDays[d]||0),+(R.meta.deletedDays[d]||0));
    if(del>Math.max(lts,rts)){md.deletedDays[d]=del;continue}
    if(hasL&&hasR){days[d]=clone(lts>=rts?LD[d]:RD[d]);md.days[d]=Math.max(lts,rts)}
    else if(hasL){days[d]=clone(LD[d]);md.days[d]=lts}
    else if(hasR){days[d]=clone(RD[d]);md.days[d]=rts}
    else if(del)md.deletedDays[d]=del;
  }
  out.days=days;return{state:out,meta:md};
}
function bundle(){return{_golSyncV:2,state:currentState(),meta:cleanMeta(parse(ls(K_META)||'{}',{}))}}
function applyBundle(b){
  applying=true;try{
    if(typeof S!=='undefined')S=clone(b.state);
    rawSet.call(localStorage,SKEY,JSON.stringify(b.state));rawSet.call(localStorage,K_META,JSON.stringify(b.meta));
    meta=cleanMeta(b.meta);lastState=clone(b.state);
  }finally{applying=false}
  try{if(typeof render==='function')render()}catch(e){}
}
function track(next){
  const before=lastState||{},now=Date.now(),oldDays=before.days||{},newDays=next.days||{},keys=new Set([...Object.keys(oldDays),...Object.keys(newDays)]);let changed=false;
  for(const d of keys){const a=Object.prototype.hasOwnProperty.call(oldDays,d),b=Object.prototype.hasOwnProperty.call(newDays,d);if(a===b&&stable(oldDays[d])===stable(newDays[d]))continue;changed=true;if(b){meta.days[d]=now;delete meta.deletedDays[d]}else{delete meta.days[d];meta.deletedDays[d]=now}}
  const a=Object.assign({},before),b=Object.assign({},next);delete a.days;delete b.days;if(stable(a)!==stable(b)){meta.prefsTs=now;changed=true}
  if(changed){meta.ts=now;ls(K_META,JSON.stringify(cleanMeta(meta)))}
  lastState=clone(next);
}
function schedule(){if(!auth||!cfgOk())return;clearTimeout(timer);timer=setTimeout(()=>sync(),2500)}
Storage.prototype.setItem=function(k,v){
  if(this===localStorage&&k===SKEY&&!applying){
    let next;try{next=JSON.parse(v);if(next&&typeof next==='object')track(next)}catch(e){}
    const result=rawSet.call(this,k,v);if(next&&typeof next==='object')schedule();return result;
  }
  return rawSet.call(this,k,v);
};

async function sync(){
  if(!auth||!cfgOk())return;
  if(busy){again=true;return}
  if(!encPassword){setStatus('error',txt('رمز ورود را وارد کن تا داده‌ها رمزگشایی شوند.','Enter your account password to decrypt the data.'));return}
  busy=true;setStatus('syncing');
  try{
    for(let i=0;i<5;i++){
      const row=await getRow(),remoteTs=row?timestamp(row.updated_at):0;
      let remote=null;
      if(row){
        let decoded=null;for(const pass of [encPassword,fallbackEncPassword].filter((v,i,a)=>v&&a.indexOf(v)===i)){try{decoded=await decrypt(pass,row.payload);if(pass!==encPassword)encPassword=pass;break}catch(e){}}if(decoded===null)throw new Error('BADPASS');
        remote=normalizeDoc(decoded,remoteTs);
      }
      const local=bundle(),merged=remote?merge(local,remote,remoteTs):local;
      const changedLocal=stable(merged)!==stable(local);
      if(changedLocal)applyBundle(merged);
      if(!row||stable(merged)!==stable(remote)){
        const ok=await putRow(row,await encrypt(encPassword,merged));
        if(!ok)continue;
      }
      status.t=Date.now();ls(K_LAST,String(status.t));setStatus('idle');return;
    }
    throw new Error('CONFLICT');
  }catch(e){
    const m=e&&e.message||'';
    if(m==='SESSION'){clearAuth();setStatus('off',txt('نشست تمام شده؛ دوباره وارد شو.','Session expired; please sign in again.'))}
    else if(m==='BADPASS')setStatus('error',txt('رمز ورود درست نیست یا بکاپ قابل‌خواندن نیست.','Wrong password or unreadable backup.'))
    else if(m==='BADPAYLOAD')setStatus('error',txt('ساختار بکاپ معتبر نیست.','The backup format is invalid.'))
    else if(m==='CONFLICT')setStatus('error',txt('تغییر هم‌زمان؛ دوباره همگام‌سازی کن.','Concurrent change; please sync again.'))
    else if(/PGRST205|42P01/i.test(m))setStatus('error',txt('جدول پیدا نشد؛ فایل SQL راه‌اندازی را در Supabase اجرا کن.','Table missing; run the setup SQL in Supabase.'))
    else if(/42501|permission denied|row-level security/i.test(m))setStatus('error',txt('دسترسی جدول مجاز نیست؛ فایل SQL و Policyها را بررسی کن.','Table access denied; check the SQL and RLS policies.'))
    else if(/PGRST204|column .*rev|Could not find the .*rev/i.test(m))setStatus('error',txt('ستون نسخه‌ی جدول قدیمی است؛ فایل SQL جدید را اجرا کن.','The table is missing the revision column; run the updated SQL.'))
    else if(!navigator.onLine||e instanceof TypeError)setStatus('error',txt('اتصال ممکن نیست؛ بعداً دوباره تلاش می‌شود.','Network error; will retry later.'))
    else setStatus('error',m||txt('خطای همگام‌سازی','Sync error'));
  }finally{busy=false;if(again){again=false;schedule()}}
}

/* Supabase setup, login and sync controls. */
const panel=document.createElement('div');panel.className='bg';panel.id='gol-sync-panel';
panel.innerHTML='<div class="sheet" style="max-height:92vh;overflow:auto"><h2>'+txt('☁️ همگام‌سازی آنلاین','☁️ Online sync')+'</h2><div id="gs-body"></div><div class="msg" id="gs-feedback"></div><button class="btn s" id="gs-close" style="margin-top:12px">'+txt('بستن','Close')+'</button></div>';
document.body.appendChild(panel);
const input=(id,ph,type='text',value='')=>'<input id="'+id+'" type="'+type+'" placeholder="'+esc(ph)+'" value="'+esc(value)+'" dir="ltr" autocomplete="off" style="margin:0 0 8px;width:100%">';
function ui(){
  const c=cfg();let h='';
  if(!cfgOk()){
    h='<div class="hint" style="text-align:right;line-height:1.9">'+txt('برای همگام‌سازی، در Supabase یک پروژه بساز، Project URL و anon public key را از Project Settings › API بردار و SQL راه‌اندازی را یک‌بار در SQL Editor اجرا کن. از service_role key استفاده نکن.','Create a Supabase project, copy its Project URL and anon public key from Project Settings › API, then run the setup SQL once in SQL Editor. Never use the service_role key.')+'</div><a href="./supabase-schema.sql" target="_blank" rel="noopener" class="mb" style="display:block;text-align:center;margin:8px 0">'+txt('نمایش فایل SQL راه‌اندازی','View setup SQL')+'</a>'+input('gs-url','Project URL (https://xxxx.supabase.co)','text',c.url)+input('gs-key','anon public key','text',c.key)+'<button class="btn" id="gs-savecfg">'+txt('ذخیره‌ی تنظیمات سرور','Save server settings')+'</button>';
  }else if(!auth){
    h='<div class="hint" style="text-align:right;line-height:1.9">'+txt('با همان پروژه و حساب، روی دستگاه‌های مختلف وارد شو. رمز ورود برای رمزگذاری هم استفاده می‌شود تا داده‌ها پیش از ارسال رمز شوند.','Sign in on each device with the same project and account. Your password also encrypts the data before it is uploaded.')+'</div>'+input('gs-email',txt('ایمیل حساب','Account email'),'email')+input('gs-password',txt('رمز عبور','Password'),'password')+'<label class="ob-remember" style="display:flex;align-items:center;gap:8px;margin:6px 0 12px"><input id="gs-remember" type="checkbox" '+(ls(K_PASS)?'checked':'')+'><span>'+txt('رمز را روی این دستگاه به خاطر بسپار','Remember password on this device')+'</span></label><div class="two"><button class="btn" id="gs-login">'+txt('ورود','Sign in')+'</button><button class="btn s" id="gs-signup">'+txt('ساخت حساب','Create account')+'</button></div><button class="mb" id="gs-change" style="text-align:center">'+txt('تغییر آدرس سرور','Change server URL')+'</button>';
  }else{
    h='<div class="card"><small style="color:var(--mute)">'+txt('حساب','Account')+'</small><div style="font-weight:700;margin:2px 0 8px" dir="ltr">'+esc(auth.email||'')+'</div><div id="gs-status">'+esc(statusText())+'</div></div><div class="hint" style="text-align:right;line-height:1.8">'+txt('اطلاعات پیش از ارسال با رمز ورود رمزگذاری می‌شوند. برای بازیابی روی دستگاه دیگر، همان رمز را وارد کن.','Data is encrypted before upload using your account password. Enter the same password on every device to decrypt it.')+'</div>'+input('gs-password',ls(K_PASS)?txt('رمز روی این دستگاه ذخیره شده','Password saved on this device'):txt('رمز حساب برای رمزگشایی','Account password to decrypt'),'password')+'<label class="ob-remember" style="display:flex;align-items:center;gap:8px;margin:6px 0 12px"><input id="gs-remember" type="checkbox" '+(ls(K_PASS)?'checked':'')+'><span>'+txt('رمز را روی این دستگاه به خاطر بسپار','Remember password on this device')+'</span></label><button class="btn" id="gs-sync">'+txt('همگام‌سازی الان','Sync now')+'</button><button class="btn s" id="gs-logout" style="margin-top:8px">'+txt('خروج از حساب','Sign out')+'</button><button class="mb" id="gs-change" style="text-align:center">'+txt('تغییر آدرس سرور','Change server URL')+'</button><a href="./supabase-schema.sql" target="_blank" rel="noopener" class="mb" style="display:block;text-align:center">'+txt('فایل SQL راه‌اندازی','Setup SQL')+'</a>';
  }
  const body=g('gs-body');if(body)body.innerHTML=h;drawStatus();
}
function openPanel(){ui();panel.classList.add('open')}
function rememberPassword(pass){const cb=g('gs-remember');if(cb&&cb.checked)ls(K_PASS,pass);else ls(K_PASS,null)}
async function authCall(kind){
  const email=g('gs-email')?.value.trim(),password=g('gs-password')?.value;
  if(!cfgOk())return setStatus('error',txt('ابتدا تنظیمات Supabase را ذخیره کن.','Save the Supabase settings first.'));
  if(!email||!password||password.length<6)return setStatus('error',txt('ایمیل و رمز حداقل ۶ کاراکتری را وارد کن.','Enter an email and a password of at least 6 characters.'));
  const c=cfg();setStatus('syncing');
  try{
    const endpoint=kind==='in'?'/auth/v1/token?grant_type=password':'/auth/v1/signup';
    const r=await fetch(c.url+endpoint,{method:'POST',headers:{apikey:c.key,'Content-Type':'application/json'},body:JSON.stringify({email,password})});
    const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.msg||j.error_description||j.message||'AUTH');
    if(!j.access_token){sessionPassword='';ui();setStatus('idle',txt('حساب ساخته شد؛ ایمیل را تأیید کن و بعد وارد شو. از همان رمز برای همگام‌سازی استفاده کن.','Account created. Confirm your email, then sign in using the same password for sync.'));return}
    setAuth(j);sessionPassword=password;rememberRequested=!!g('gs-remember')?.checked;fallbackEncPassword=ls(K_PASS)||fallbackEncPassword;encPassword=password;if(!rememberRequested)ls(K_PASS,null);status.t=0;ui();if(g('gs-remember'))g('gs-remember').checked=rememberRequested;await sync();if(status.s==='idle'){rememberPassword(encPassword);fallbackEncPassword=encPassword}
  }catch(e){const m=e?.message||'';setStatus('error',/invalid login/i.test(m)?txt('ایمیل یا رمز اشتباه است.','Invalid email or password.'): /already registered/i.test(m)?txt('این ایمیل قبلاً ثبت شده؛ وارد شو.','This email is already registered; sign in.'):e instanceof TypeError?txt('اتصال به Supabase برقرار نشد.','Could not connect to Supabase.'):m)}
}
function withStoredOrInputPassword(){const v=g('gs-password')?.value||'';if(v){encPassword=v;sessionPassword=v}else if(!encPassword)encPassword=ls(K_PASS)||sessionPassword||'';if(!encPassword){setStatus('error',txt('رمز ورود را برای رمزگشایی وارد کن.','Enter your password to decrypt the backup.'));return false}return true}
panel.addEventListener('click',async e=>{
  if(e.target===panel){panel.classList.remove('open');return}
  const b=e.target.closest('button[id]');if(!b)return;
  if(b.id==='gs-close')panel.classList.remove('open');
  else if(b.id==='gs-savecfg'){
    const url=g('gs-url').value.trim().replace(/\/+$/,''),key=g('gs-key').value.trim();try{if(new URL(url).protocol!=='https:'||key.length<20)throw 0}catch(x){return setStatus('error',txt('آدرس HTTPS یا anon public key معتبر نیست.','Enter a valid HTTPS URL and anon public key.'))}
    ls(K_CFG,JSON.stringify({url,key}));clearAuth();encPassword=ls(K_PASS)||'';status.t=0;ui();setStatus('idle',txt('حالا وارد حساب Supabase شو.','Now sign in to your Supabase account.'));
  }
  else if(b.id==='gs-login')await authCall('in');
  else if(b.id==='gs-signup')await authCall('up');
  else if(b.id==='gs-change'){
    clearAuth();ls(K_CFG,null);sessionPassword='';encPassword=ls(K_PASS)||'';ui();setStatus('idle',txt('آدرس جدید Supabase را وارد کن. اطلاعات محلی پاک نمی‌شود.','Enter the new Supabase URL. Local app data is not changed.'));
  }
  else if(b.id==='gs-sync'){
    if(!withStoredOrInputPassword())return;
    await sync();if(status.s==='idle'){rememberPassword(encPassword);fallbackEncPassword=encPassword}
  }
  else if(b.id==='gs-logout'){
    clearAuth();sessionPassword='';encPassword=ls(K_PASS)||'';setStatus('off',txt('از حساب خارج شدی؛ داده‌های این دستگاه باقی مانده‌اند.','Signed out; data on this device is unchanged.'));ui();drawStatus();
  }
});
document.addEventListener('click',e=>{if(e.target.closest('[data-act="golSync"]')){e.preventDefault();openPanel()}});

/* Keep the existing settings row in sync with the active status. */
const initialAuth=auth&&cfgOk();
if(auth&&!cfgOk()){clearAuth();auth=null}
if(initialAuth&&encPassword){setTimeout(()=>sync(),350)}else if(initialAuth){setStatus('idle',txt('رمز ورود را وارد کن تا همگام‌سازی شروع شود.','Enter your password to start syncing.'))}
if(auth)ui();drawStatus();
window.addEventListener('online',()=>sync());
document.addEventListener('visibilitychange',()=>{if(!document.hidden)sync()});
setInterval(()=>{if(!document.hidden)sync()},120000);
})();
