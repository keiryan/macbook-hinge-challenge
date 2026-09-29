'use strict';
// Synthetic packets exist only in these offline tests. No device is opened.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const {HingeChallenge}=require('../web/hinge-challenge.js');
const script=fs.readFileSync(require('node:path').join(__dirname,'../web/app.js'),'utf8');
function fixture(options={}){
 let clock=1000;const elements=new Map(),listeners={};
 function element(){const handlers={};return {textContent:'',disabled:false,hidden:false,open:false,style:{},append(){},scrollIntoView(){},focus(){},className:'',value:0,showModalCalls:0,closeCalls:0,addEventListener(type,fn){handlers[type]=fn;},showModal(){this.open=true;this.showModalCalls++;},close(){this.open=false;this.closeCalls++;handlers.close?.();}};}
 const document={hidden:false,getElementById(id){if(!elements.has(id)){const value=element();if(id==='compatibility-dialog'&&options.dialogSupported===false)delete value.showModal;elements.set(id,value);}return elements.get(id);},createElement:element,addEventListener(type,fn){listeners[type]=fn;}};
 class ClockDate extends Date {constructor(...args){super(...(args.length?args:[clock]));}static now(){return clock;}}
 const stored=new Map(),sessionStorage=options.sessionStorage||{getItem:key=>stored.get(key)??null,setItem:(key,value)=>stored.set(key,String(value))};
 const context=vm.createContext({document,Date:ClockDate,HingeChallenge,performance:{now:()=>clock},navigator:options.navigator||{},location:options.location||{hostname:'127.0.0.1',protocol:'http:'},isSecureContext:options.isSecureContext??true,sessionStorage,fetch:options.fetch||(()=>{throw new Error('Unexpected network request in offline test');}),AbortController,TextDecoder,window:{addEventListener(){}},requestAnimationFrame:()=>1,setInterval:()=>1,crypto:{getRandomValues(a){a[0]=0;return a;}}});
 vm.runInContext(script,context);
 return {context,document,setTime(value){clock=value;},run(code){return vm.runInContext(code,context);},hidden(value){document.hidden=value;listeners.visibilitychange();}};
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
 assert.equal(f.document.getElementById('local-setup').hidden,false);
 await f.document.getElementById('native').onclick();
 await f.run('nativeConnect()');
 assert.deepEqual(requests,[]);
 assert.equal(f.document.getElementById('local-setup').open,true);
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
 await f.document.getElementById('native').onclick();
 assert.deepEqual(requests.map(request=>request.path),['/session','/sensor']);
 assert.equal(requests[1].options.headers['X-Hinge-Key'],'offline-test-token');
 assert.match(f.document.getElementById('status').textContent,/Native stream ended/);
});

test('unsupported hosted browser opens a modal and dismissal persists for the session',()=>{
 const location={hostname:'hinge-demo.example',protocol:'https:'},stored=new Map();
 const sessionStorage={getItem:key=>stored.get(key)??null,setItem:(key,value)=>stored.set(key,value)};
 const first=fixture({location,sessionStorage}),dialog=first.document.getElementById('compatibility-dialog');
 assert.equal(dialog.open,true);assert.equal(dialog.showModalCalls,1);
 assert.equal(stored.has('hinge-browser-notice-dismissed'),false,'opening is not acknowledgment');
 first.document.getElementById('compatibility-dismiss').onclick();
 assert.equal(dialog.open,false);assert.equal(dialog.closeCalls,1);
 assert.equal(stored.get('hinge-browser-notice-dismissed'),'1');
 const revisit=fixture({location,sessionStorage});
 assert.equal(revisit.document.getElementById('compatibility-dialog').showModalCalls,0);
});

test('native dialog close also acknowledges Escape dismissal',()=>{
 const f=fixture({location:{hostname:'hinge-demo.example',protocol:'https:'}});
 f.document.getElementById('compatibility-dialog').close();
 assert.equal(f.context.sessionStorage.getItem('hinge-browser-notice-dismissed'),'1');
});

test('supported browser and local native page do not open the compatibility modal',()=>{
 const hid={getDevices:async()=>[],requestDevice:async()=>[],addEventListener(){}};
 for(const options of [{}, {location:{hostname:'hinge-demo.example',protocol:'https:'},navigator:{hid}}, {location:{hostname:'hinge-demo.example',protocol:'http:'},isSecureContext:false}]){
  const f=fixture(options);
  assert.equal(f.document.getElementById('compatibility-dialog').showModalCalls,0);
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
