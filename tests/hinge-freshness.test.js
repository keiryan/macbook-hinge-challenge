'use strict';
// Synthetic packets exist only in these offline tests. No device is opened.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const {HingeChallenge}=require('../web/hinge-challenge.js');
const script=fs.readFileSync(require('node:path').join(__dirname,'../web/app.js'),'utf8');
function fixture(options={}){
 let clock=1000;const elements=new Map(),listeners={};
 function element(){const handlers={},attributes={};return {textContent:'',disabled:false,hidden:false,open:false,style:{},dataset:{},append(){},scrollIntoView(){},focus(){document.activeElement=this;},contains(target){return target===this;},setAttribute(name,value){attributes[name]=String(value);},getAttribute(name){return attributes[name]??null;},removeAttribute(name){delete attributes[name];},className:'',value:0,showModalCalls:0,closeCalls:0,addEventListener(type,fn){handlers[type]=fn;},showModal(){this.open=true;this.showModalCalls++;},close(){this.open=false;this.closeCalls++;handlers.close?.();}};}
 const document={hidden:false,body:{dataset:{}},activeElement:null,getElementById(id){if(!elements.has(id)){const value=element();if(id.endsWith('-dialog')&&options.dialogSupported===false)delete value.showModal;elements.set(id,value);}return elements.get(id);},createElement:element,addEventListener(type,fn){listeners[type]=fn;}};
 class ClockDate extends Date {constructor(...args){super(...(args.length?args:[clock]));}static now(){return clock;}}
 const stored=new Map(),sessionStorage=options.sessionStorage||{getItem:key=>stored.get(key)??null,setItem:(key,value)=>stored.set(key,String(value))};
 const context=vm.createContext({document,Date:ClockDate,HingeChallenge,performance:{now:()=>clock},navigator:options.navigator||{},location:options.location||{hostname:'127.0.0.1',protocol:'http:'},isSecureContext:options.isSecureContext??true,sessionStorage,fetch:options.fetch||(()=>{throw new Error('Unexpected network request in offline test');}),AbortController,TextDecoder,window:{addEventListener(){},HingeAppearance:options.appearance},requestAnimationFrame:()=>1,setInterval:()=>1,crypto:{getRandomValues(a){a[0]=0;return a;}}});
 vm.runInContext(script,context);
 return {context,document,setTime(value){clock=value;},run(code){return vm.runInContext(code,context);},hidden(value){document.hidden=value;listeners.visibilitychange();},event(type,event){listeners[type]?.(event);}};
}
const packet=(overrides={})=>({sequence:1,readCompletedMonoMs:900,readCompletedEpochMs:990,readMs:1,angle:75,raw:[1,75,0],reportId:1,...overrides});
function deliver(f,item){f.context.packet=item;f.run('receiveNative(packet)');}

test('native freshness rejects stale first packets, clock-future packets, replay and backward native time',()=>{
 const f=fixture();f.context.packet=packet();
 assert.ok(f.run('nativeFreshness(packet,1000,null,0)'));
 assert.equal(f.run('nativeFreshness(packet,1141,null,0)'),null);
 assert.equal(f.run('nativeFreshness(packet,980,null,0)'),null);
 assert.equal(f.run('nativeFreshness(packet,1000,{sequence:1,readCompletedMonoMs:899},0)'),null);
 assert.equal(f.run('nativeFreshness(packet,1000,{sequence:0,readCompletedMonoMs:901},0)'),null);
 assert.equal(f.run('nativeFreshness(packet,1000,null,991)'),null);
});

test('native prompt gate excludes old reads while engine uses arrival time after display ticks',()=>{
 const f=fixture();f.run('source="native";visibleSinceEpochMs=0;challengeStartedEpochMs=1000;stageStartedEpochMs=1000;stageStartedAt=1000;challenge=new HingeChallenge({targets:[75,100],startedAt:1000,maxGapMs:150});');
 f.setTime(1020);deliver(f,packet({readCompletedEpochMs:999}));
 assert.equal(f.run('challenge.getState(1020).holdSamples'),0);
 f.run('challenge.tick(1020)');
 f.setTime(1040);deliver(f,packet({sequence:2,readCompletedMonoMs:920,readCompletedEpochMs:1030}));
 assert.equal(f.run('challenge.getState(1040).holdSamples'),1);
 assert.equal(f.run('latest.at'),1040);
 assert.equal(f.run('latest.freshAt'),1030);
 for(let t=1140,n=3;t<=1540;t+=100,n++){f.setTime(t);deliver(f,packet({sequence:n,readCompletedMonoMs:t-120,readCompletedEpochMs:t-10}));}
 assert.equal(f.run('challenge.getState(1540).completedStages'),1);
 f.setTime(1560);deliver(f,packet({sequence:8,readCompletedMonoMs:1440,readCompletedEpochMs:1539,angle:100}));
 assert.equal(f.run('challenge.getState(1560).holdSamples'),0,'new target must not consume a read made before that prompt');
});

test('hidden page aborts challenge and resuming requires a read completed after resume',()=>{
 const f=fixture();f.run('source="native";visibleSinceEpochMs=0;challengeStartedEpochMs=1000;stageStartedEpochMs=1000;stageStartedAt=1000;challenge=new HingeChallenge({targets:[75],startedAt:1000});');
 f.setTime(1020);deliver(f,packet({readCompletedEpochMs:1010}));f.hidden(true);
 assert.equal(f.run('challenge.getState(1020).status'),'aborted');assert.equal(f.run('latest'),null);
 f.setTime(1100);deliver(f,packet({sequence:2,readCompletedMonoMs:1000,readCompletedEpochMs:1090}));assert.equal(f.run('latest'),null);
 f.setTime(1150);f.hidden(false);
 deliver(f,packet({sequence:3,readCompletedMonoMs:1040,readCompletedEpochMs:1149}));assert.equal(f.run('latest'),null);
 f.setTime(1170);deliver(f,packet({sequence:4,readCompletedMonoMs:1060,readCompletedEpochMs:1160}));assert.equal(f.run('latest.angle'),75);
});

test('hosted native button shows local setup and never fetches native endpoints',async()=>{
 const requests=[];
 const f=fixture({location:{hostname:'hinge-demo.example',protocol:'https:'},fetch:async path=>{requests.push(path);throw new Error('No hosted native endpoint');}});
 assert.equal(f.document.getElementById('native').textContent,'Set up native reader');
 assert.equal(f.document.getElementById('local-setup').hidden,true);
 await f.document.getElementById('native').onclick();
 await f.run('nativeConnect()');
 assert.deepEqual(requests,[]);
 assert.equal(f.document.getElementById('local-setup').hidden,false);
 assert.equal(f.document.getElementById('connection-dialog').open,true);
 assert.match(f.document.getElementById('status').textContent,/runs on your Mac/);
});

test('hosted unsupported or insecure browsers explain why direct access is disabled',async()=>{
 const safari=fixture({location:{hostname:'hinge-demo.example',protocol:'https:'}});
 assert.equal(safari.document.getElementById('connect').disabled,true);
 assert.equal(safari.document.getElementById('connect').textContent,'WebHID unavailable');
 assert.match(safari.document.getElementById('status').textContent,/Chrome or Edge.*native reader locally/);
 const hid={getDevices:async()=>[],requestDevice:async()=>[],addEventListener(){}};
 const insecure=fixture({location:{hostname:'hinge-demo.example',protocol:'http:'},isSecureContext:false,navigator:{hid}});
 assert.equal(insecure.document.getElementById('connect').disabled,true);
 assert.equal(insecure.document.getElementById('connect').textContent,'HTTPS required');
 await insecure.run('browserConnect()');
 assert.match(insecure.document.getElementById('status').textContent,/requires HTTPS/);
 const secure=fixture({location:{hostname:'hinge-demo.example',protocol:'https:'},navigator:{hid}});
 assert.equal(secure.document.getElementById('connect').disabled,false);
});

test('loopback native mode still requests its session and authenticated sensor stream',async()=>{
 const requests=[];
 const f=fixture({fetch:async(path,options)=>{
  requests.push({path,options});
  return path==='/session'?{ok:true,json:async()=>({token:'offline-test-token',nativeAvailable:true})}:{ok:true,body:{getReader:()=>({read:async()=>({done:true})})}};
 }});
 assert.equal(f.document.getElementById('local-setup').hidden,true);
 assert.equal(f.document.getElementById('native').textContent,'Use native reader');
 f.document.getElementById('compatibility-dismiss').onclick();
 f.document.getElementById('open-connect').onclick();
 assert.equal(f.document.getElementById('connection-dialog').open,true);
 await f.document.getElementById('native').onclick();
 assert.deepEqual(requests.map(request=>request.path),['/session','/sensor']);
 assert.equal(requests[1].options.headers['X-Hinge-Key'],'offline-test-token');
 assert.equal(f.document.getElementById('connection-dialog').open,true,'an ended stream exposes its status in the dialog');
 assert.match(f.document.getElementById('status').textContent,/Native stream ended/);
});

test('welcome dismissal persists for the session and About can reopen it',()=>{
 const location={hostname:'hinge-demo.example',protocol:'https:'},stored=new Map();
 const sessionStorage={getItem:key=>stored.get(key)??null,setItem:(key,value)=>stored.set(key,value)};
 const first=fixture({location,sessionStorage}),dialog=first.document.getElementById('compatibility-dialog');
 assert.equal(dialog.open,true);assert.equal(dialog.showModalCalls,1);
 assert.equal(stored.has('hinge-welcome-dismissed-v2'),false,'opening is not acknowledgment');
 first.document.getElementById('compatibility-dismiss').onclick();
 assert.equal(dialog.open,false);assert.equal(dialog.closeCalls,1);
 assert.equal(stored.get('hinge-welcome-dismissed-v2'),'1');
 const revisit=fixture({location,sessionStorage});
 assert.equal(revisit.document.getElementById('compatibility-dialog').showModalCalls,0);
 revisit.document.getElementById('menu-about').onclick();
 assert.equal(revisit.document.getElementById('compatibility-dialog').open,true);
 revisit.document.getElementById('compatibility-close').onclick();
 assert.equal(revisit.document.getElementById('compatibility-dialog').open,false);
});

test('native dialog close also acknowledges Escape dismissal',()=>{
 const f=fixture({location:{hostname:'hinge-demo.example',protocol:'https:'}});
 f.document.getElementById('compatibility-dialog').close();
 assert.equal(f.context.sessionStorage.getItem('hinge-welcome-dismissed-v2'),'1');
});

test('welcome opens on first visit for all browsers and shows compatibility only when needed',()=>{
 const hid={getDevices:async()=>[],requestDevice:async()=>[],addEventListener(){}};
 for(const options of [{}, {location:{hostname:'hinge-demo.example',protocol:'https:'},navigator:{hid}}, {location:{hostname:'hinge-demo.example',protocol:'http:'},isSecureContext:false}]){
  const f=fixture(options);
  assert.equal(f.document.getElementById('compatibility-dialog').showModalCalls,1);
  assert.equal(f.document.getElementById('browser-notice').hidden,!!options.navigator?.hid&&options.isSecureContext!==false);
 }
});

test('blocked storage and missing dialog support do not break the page',()=>{
 const location={hostname:'hinge-demo.example',protocol:'https:'};
 const f=fixture({location,sessionStorage:{getItem(){throw new Error('Storage blocked');},setItem(){throw new Error('Storage blocked');}}});
 assert.equal(f.document.getElementById('compatibility-dialog').open,true);
 assert.doesNotThrow(()=>f.document.getElementById('compatibility-dismiss').onclick());
 assert.equal(f.document.getElementById('compatibility-dialog').open,false);
 assert.match(f.document.getElementById('status').textContent,/does not support WebHID/);
 const legacy=fixture({location,dialogSupported:false});
 assert.equal(legacy.document.getElementById('compatibility-dialog').showModalCalls,0);
 assert.equal(legacy.document.getElementById('native').disabled,false);
});

test('view navigation isolates screens and leaving an active challenge aborts it',()=>{
 const f=fixture();f.document.getElementById('compatibility-dismiss').onclick();
 assert.equal(f.document.body.dataset.view,'live');
 assert.equal(f.document.getElementById('live-view').hidden,false);
 assert.equal(f.document.getElementById('challenge-view').hidden,true);
 assert.equal(f.document.getElementById('menu-live').getAttribute('aria-current'),'page');
 assert.equal(f.document.getElementById('menu-challenge').getAttribute('aria-current'),null);
 f.document.getElementById('menu-challenge').onclick();
 assert.equal(f.document.body.dataset.view,'challenge');
 assert.equal(f.document.getElementById('live-view').hidden,true);
 assert.equal(f.document.getElementById('challenge-view').hidden,false);
 assert.equal(f.document.getElementById('menu-live').getAttribute('aria-current'),null);
 assert.equal(f.document.getElementById('menu-challenge').getAttribute('aria-current'),'page');
 f.run('challenge=new HingeChallenge({targets:[75],startedAt:1000});challenge.update(75,1000);render();');
 assert.equal(f.document.body.dataset.challengeState,'active');
 const back=f.document.getElementById('back-live');back.parentElement=f.document.getElementById('challenge-view');back.focus();back.onclick();
 assert.equal(f.run('challenge.getState(1000).status'),'aborted');
 assert.equal(f.document.body.dataset.challengeState,'aborted');
 assert.equal(f.document.getElementById('view-name').textContent,'Live angle');
 assert.equal(f.document.activeElement,f.document.getElementById('menu-toggle'));
});

test('menu does not interrupt a challenge, but all dialogs do and restore focus',()=>{
 for(const [button,dialog,close] of [['menu-connect','connection-dialog','connection-close'],['menu-about','compatibility-dialog','compatibility-dismiss'],['menu-diagnostics','diagnostics-dialog','diagnostics-close']]){
  const f=fixture();f.document.getElementById('compatibility-dismiss').onclick();
  f.run('setView("challenge");challenge=new HingeChallenge({targets:[75],startedAt:1000});');
  f.document.getElementById('menu-toggle').onclick();
  assert.equal(f.run('challenge.getState(1000).status'),'active');
  assert.equal(f.document.getElementById('menu-toggle').getAttribute('aria-expanded'),'true');
  f.document.getElementById(button).onclick();
  assert.equal(f.run('challenge.getState(1000).status'),'aborted');
  assert.equal(f.document.getElementById(dialog).open,true);
  assert.equal(f.document.getElementById('menu-panel').hidden,true);
  f.document.getElementById(close).onclick();
  assert.equal(f.document.getElementById(dialog).open,false);
  assert.equal(f.document.activeElement,f.document.getElementById('menu-toggle'));
 }
});

test('outside click and Escape close the menu and restore its toggle focus',()=>{
 const f=fixture();f.document.getElementById('compatibility-dismiss').onclick();
 f.document.getElementById('menu-toggle').onclick();
 f.event('click',{target:f.document.getElementById('live-view')});
 assert.equal(f.document.getElementById('menu-panel').hidden,true);
 assert.equal(f.document.activeElement,f.document.getElementById('menu-toggle'));
 f.document.getElementById('menu-toggle').onclick();let prevented=false;
 f.event('keydown',{key:'Escape',preventDefault(){prevented=true;}});
 assert.equal(prevented,true);
 assert.equal(f.document.getElementById('menu-toggle').getAttribute('aria-expanded'),'false');
});

test('connection state and both angle views track real accepted reports and reset together',()=>{
 const f=fixture();f.document.getElementById('compatibility-dismiss').onclick();
 assert.equal(f.document.getElementById('telemetry').hidden,true);
 assert.equal(f.document.getElementById('connection-state').dataset.connected,'false');
 f.run('source="native";visibleSinceEpochMs=0;');
 f.setTime(1020);deliver(f,packet({readCompletedEpochMs:1010}));f.run('render()');
 assert.equal(f.document.getElementById('angle').textContent,'75');
 assert.equal(f.document.getElementById('challenge-angle').textContent,'75');
 assert.equal(f.document.getElementById('connection-state').textContent,'Native connected');
 assert.equal(f.document.getElementById('connection-state').dataset.connected,'true');
 assert.match(f.document.getElementById('connection-state').getAttribute('aria-label'),/^Native connected\./);
 assert.equal(f.document.getElementById('telemetry').hidden,false);
 assert.equal(f.document.getElementById('open-connect').hidden,true);
 f.hidden(true);
 assert.equal(f.document.getElementById('angle').textContent,'—');
 assert.equal(f.document.getElementById('challenge-angle').textContent,'—');
});

test('native helper startup error keeps the connection dialog and failure message visible',async()=>{
 const bytes=new TextEncoder().encode(JSON.stringify({error:'No built-in lid sensor found.'})+'\n');
 const f=fixture({fetch:async path=>path==='/session'?{ok:true,json:async()=>({token:'offline-test-token',nativeAvailable:true})}:{ok:true,body:{getReader:()=>({read:async()=>({done:false,value:bytes})})}}});
 f.document.getElementById('compatibility-close').onclick();f.document.getElementById('open-connect').onclick();
 await f.document.getElementById('native').onclick();
 assert.equal(f.document.getElementById('connection-dialog').open,true);
 assert.equal(f.document.getElementById('connection-dialog').closeCalls,0);
 assert.equal(f.document.getElementById('status').textContent,'No built-in lid sensor found.');
 assert.equal(f.document.getElementById('connection-state').dataset.connected,'false');
});

test('native dialog closes only after accepted data and restores a visible connection trigger',async()=>{
 let reads=0,accepted=false,f;
 const bytes=new TextEncoder().encode(JSON.stringify(packet({readCompletedEpochMs:1000}))+'\n');
 f=fixture({fetch:async path=>path==='/session'?{ok:true,json:async()=>({token:'offline-test-token',nativeAvailable:true})}:{ok:true,body:{getReader:()=>({read:async()=>{
  if(reads++===0){assert.equal(f.document.getElementById('connection-dialog').open,true);return {done:false,value:bytes};}
  assert.equal(f.document.getElementById('connection-dialog').open,false);
  assert.equal(f.document.getElementById('angle').textContent,'75');
  assert.equal(f.document.getElementById('open-connect').hidden,true);
  assert.equal(f.document.activeElement,f.document.getElementById('connection-state'));
  accepted=true;return {done:true};
 }})}}});
 f.document.getElementById('compatibility-close').onclick();
 f.document.getElementById('open-connect').focus();f.document.getElementById('open-connect').onclick();
 await f.document.getElementById('native').onclick();
 assert.equal(accepted,true);
});

test('an asynchronous browser connection error reopens its visible status dialog',async()=>{
 const hid={getDevices:async()=>{throw new Error('Device permission failed');},requestDevice:async()=>[],addEventListener(){}};
 const f=fixture({navigator:{hid}});f.document.getElementById('compatibility-close').onclick();
 f.document.getElementById('open-connect').onclick();
 const connecting=f.document.getElementById('connect').onclick();
 f.document.getElementById('connection-close').onclick();
 await connecting;
 assert.equal(f.document.getElementById('connection-dialog').open,true);
 assert.match(f.document.getElementById('status').textContent,/Device permission failed/);
});

test('appearance follows only accepted reports and resets when data is stale, hidden, or disconnected',async()=>{
 const updates=[];let clears=0,setups=0;
 const f=fixture({appearance:{setup(){setups++;},update(angle){updates.push(angle);},clear(){clears++;},challengeState(){}}});
 assert.equal(setups,1);assert.deepEqual(updates,[]);
 f.document.getElementById('compatibility-close').onclick();f.run('source="native";visibleSinceEpochMs=0;');
 f.setTime(1020);deliver(f,packet({readCompletedEpochMs:1010,angle:270}));
 assert.deepEqual(updates,[270]);
 assert.equal(f.document.getElementById('angle').textContent,'270','decoration never clamps the real readout');
 f.run('render()');assert.deepEqual(updates,[270],'display ticks do not invent measurements');
 let before=clears;f.setTime(1200);f.run('render()');assert.ok(clears>before);
 deliver(f,packet({sequence:2,readCompletedMonoMs:1000,readCompletedEpochMs:1010,angle:90}));
 assert.deepEqual(updates,[270],'stale native packet cannot drive appearance');
 f.setTime(1220);deliver(f,packet({sequence:3,readCompletedMonoMs:1100,readCompletedEpochMs:1210,angle:90}));
 assert.deepEqual(updates,[270,90]);
 before=clears;f.hidden(true);assert.ok(clears>before);
 before=clears;f.run('resetMeasurements()');assert.ok(clears>before);
 before=clears;await f.run('stop()');assert.ok(clears>before);
 assert.deepEqual(updates,[270,90]);
});

test('Start and Cancel swap: each is shown only while it can apply to the run',()=>{
 const f=fixture(),start=f.document.getElementById('start'),cancel=f.document.getElementById('cancel');
 f.run('buttons()');
 assert.equal(start.hidden,false);assert.equal(cancel.hidden,true,'no run yet, so nothing to cancel');
 f.run('source="native";challenge=new HingeChallenge({targets:[75,100,80],startedAt:1000});buttons();');
 assert.equal(start.hidden,true,'a running challenge hides Start');
 assert.equal(cancel.hidden,false);assert.equal(cancel.disabled,false);
 f.run('challenge.abort("test");buttons();');
 assert.equal(start.hidden,false);assert.equal(cancel.hidden,true,'a finished run hides Cancel');
});
