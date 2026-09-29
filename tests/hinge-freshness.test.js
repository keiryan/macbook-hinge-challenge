'use strict';
// Synthetic packets exist only in these offline tests. No device is opened.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const {HingeChallenge}=require('../web/hinge-challenge.js');
const script=fs.readFileSync(require('node:path').join(__dirname,'../web/app.js'),'utf8');
function fixture(){
 let clock=1000;const elements=new Map(),listeners={};
 function element(){return {textContent:'',disabled:false,style:{},append(){},className:'',value:0};}
 const document={hidden:false,getElementById(id){if(!elements.has(id))elements.set(id,element());return elements.get(id);},createElement:element,addEventListener(type,fn){listeners[type]=fn;}};
 class ClockDate extends Date {constructor(...args){super(...(args.length?args:[clock]));}static now(){return clock;}}
 const context=vm.createContext({document,Date:ClockDate,HingeChallenge,performance:{now:()=>clock},navigator:{},window:{addEventListener(){}},requestAnimationFrame:()=>1,setInterval:()=>1,crypto:{getRandomValues(a){a[0]=0;return a;}}});
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
