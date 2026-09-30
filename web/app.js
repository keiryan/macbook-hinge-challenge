'use strict';
const $=id=>document.getElementById(id), filter={vendorId:0x05ac,productId:0x8104,usagePage:0x20,usage:0x8a};
const flatten=cs=>cs.flatMap(c=>[c,...flatten(c.children||[])]),hex=(n,w=2)=>n.toString(16).padStart(w,'0');
const localOrigin=['127.0.0.1','localhost','[::1]'].includes(location.hostname)&&['http:','https:'].includes(location.protocol);
const hostedMode=!localOrigin;
const browserSensorAvailable=isSecureContext&&!!navigator.hid&&typeof navigator.hid.getDevices==='function'&&typeof navigator.hid.requestDevice==='function';
let sensor=null,aborter=null,source=null,busy=false,generation=0,awaitingNativeReport=false;
let latest=null,received=0,arrivals=[],changeTimes=[],recent=[],previousAngle=null,lastGap=null,challenge=null;
let tableDirty=false,frame=0,lastRender=0;
const NATIVE_MAX_DELAY_MS=150;
let nativePrevious=null,droppedNative=0,visibleSinceEpochMs=Date.now(),visibleSinceAt=performance.now();
let challengeStartedEpochMs=null,stageStartedEpochMs=null,stageStartedAt=null;
let currentView='live';
const dialogIds=['compatibility-dialog','connection-dialog','diagnostics-dialog'],dialogFocus=new Map();
function log(value){$('diagnostic').textContent+=String(value)+'\n';}
function reportAge(now){return latest?now-latest.freshAt:Infinity;}
function freshnessLimit(){return source==='native'?NATIVE_MAX_DELAY_MS:1500;}
function localTime(epochMs){const date=new Date(epochMs);return date.toLocaleTimeString('en-US',{hour12:false})+'.'+String(date.getMilliseconds()).padStart(3,'0');}
// Pure validation also rejects a stale first packet; it does not anchor the
// first received packet as current. Both processes use this Mac's wall clock.
function nativeFreshness(item,nowEpochMs,previous,minimumEpochMs){
 if(!Number.isSafeInteger(item.sequence)||item.sequence<1||!Number.isFinite(item.readCompletedMonoMs)||item.readCompletedMonoMs<0||!Number.isFinite(item.readCompletedEpochMs)||!Number.isFinite(item.readMs)||item.readMs<0)return null;
 if(previous&&(item.sequence<=previous.sequence||item.readCompletedMonoMs<=previous.readCompletedMonoMs))return null;
 const delayMs=nowEpochMs-item.readCompletedEpochMs;
 // Date.now has millisecond precision; allow its rounding difference only.
 if(delayMs < -2 || delayMs>NATIVE_MAX_DELAY_MS||item.readCompletedEpochMs<minimumEpochMs)return null;
 return {sequence:item.sequence,readCompletedMonoMs:item.readCompletedMonoMs,readCompletedEpochMs:item.readCompletedEpochMs,delayMs:Math.max(0,delayMs),readGapMs:previous?item.readCompletedMonoMs-previous.readCompletedMonoMs:null};
}
function buttons(){
 $('connect').disabled=busy||!browserSensorAvailable||source==='browser';$('native').disabled=busy||source==='native';$('stop').disabled=busy||!source;
 $('start').disabled=busy||document.hidden||!source||!latest||reportAge(performance.now())>freshnessLimit()||(challenge&&challenge.getState(performance.now()).status==='active');
 $('cancel').disabled=!challenge||challenge.getState(performance.now()).status!=='active';
}
function resetMeasurements(){latest=null;received=0;arrivals=[];changeTimes=[];recent=[];previousAngle=null;lastGap=null;nativePrevious=null;droppedNative=0;tableDirty=true;$('angle').textContent='—';$('challenge-angle').textContent='—';$('raw').textContent='—';$('count').textContent='0';}
function receive(angle,raw,reportId,readMs,nativeTiming=null,eventAt=null){
 if(document.hidden)return;
 if(!Number.isInteger(angle)||angle<0||angle>360){log('Rejected an unrecognized angle.');return;}
 const now=performance.now();lastGap=latest?now-latest.at:null;received++;
 if(previousAngle!==null&&angle!==previousAngle)changeTimes.push(now);previousAngle=angle;
 latest={angle,raw,reportId,readMs,at:now,freshAt:now-(nativeTiming?.delayMs||0),nativeTiming};arrivals.push(now);arrivals=arrivals.filter(t=>now-t<=10000);changeTimes=changeTimes.filter(t=>now-t<=10000);
 recent.unshift({time:localTime(Date.now()),gap:lastGap,angle,raw,source,nativeTiming});recent.length=Math.min(recent.length,16);tableDirty=true;
 $('angle').textContent=String(angle);$('challenge-angle').textContent=String(angle);$('raw').textContent=raw;$('count').textContent=String(received);
 if(source==='native'&&awaitingNativeReport){awaitingNativeReport=false;$('status').textContent='Native reader connected. Up to 60 reads/s; move the lid to check actual freshness.';render();closeDialog('connection-dialog');}
 if(challenge){
  const before=challenge.getState(now);
  const afterPrompt=nativeTiming?nativeTiming.readCompletedEpochMs>=Math.max(challengeStartedEpochMs,stageStartedEpochMs):(eventAt===null||eventAt>=stageStartedAt);
  // Engine time is always browser arrival time. Native completion time gates
  // eligibility separately, so delayed packets never rewind display ticks.
  if(before.status==='active'&&afterPrompt){const after=challenge.update(angle,now);if(after.stageIndex!==before.stageIndex){stageStartedEpochMs=Date.now()+1;stageStartedAt=performance.now();}}
 }
 if(!frame)frame=requestAnimationFrame(()=>{frame=0;render();});
}
function input(event){
 if(event.device!==sensor||source!=='browser'||document.hidden||event.timeStamp<visibleSinceAt)return;
 const bytes=new Uint8Array(event.data.buffer,event.data.byteOffset,event.data.byteLength);
 if(event.reportId!==1||bytes.length!==2){log('Ignored unexpected input report '+event.reportId+' / '+bytes.length+' bytes');return;}
 receive(event.data.getUint16(0,true),Array.from(bytes,b=>hex(b)).join(' '),event.reportId,null,null,event.timeStamp);
}
function receiveNative(item){
 if(document.hidden)return;
 const timing=nativeFreshness(item,Date.now(),nativePrevious,visibleSinceEpochMs);
 if(!timing){droppedNative++;return;}
 nativePrevious=timing;
 receive(item.angle,item.raw.map(b=>hex(b)).join(' '),item.reportId,item.readMs,timing);
}
async function stop(reason='Disconnected.'){
 generation++;if(challenge&&challenge.getState(performance.now()).status==='active')challenge.abort('Sensor source disconnected or changed.');
 const old=sensor;sensor=null;source=null;awaitingNativeReport=false;aborter?.abort();aborter=null;
 if(old){old.removeEventListener('inputreport',input);try{if(old.opened)await old.close();}catch(e){log(e.message);}}
 $('status').textContent=reason;$('source-name').textContent='Disconnected · last value retained';buttons();render();
}
async function browserConnect(){
 if(!browserSensorAvailable){$('status').textContent=browserAvailabilityMessage();return;}
 if(busy)return;busy=true;buttons();await stop('Connecting browser sensor…');const run=++generation;
 try{
  const granted=await navigator.hid.getDevices();
  let candidate=granted.find(d=>d.vendorId===filter.vendorId&&d.productId===filter.productId&&flatten(d.collections).some(c=>c.usagePage===filter.usagePage&&c.usage===filter.usage));
  if(!candidate){const choices=await navigator.hid.requestDevice({filters:[filter]});candidate=choices[0];}
  if(!candidate){$('status').textContent=hostedMode?'No device selected. If the sensor is unavailable here, set up the native reader locally.':'No device selected. Try native mode if this browser cannot expose the sensor.';return;}
  if(candidate.vendorId!==filter.vendorId||candidate.productId!==filter.productId||!flatten(candidate.collections).some(c=>c.usagePage===filter.usagePage&&c.usage===filter.usage))throw new Error('The selected device is not the expected lid sensor.');
  if(run!==generation)return;
  resetMeasurements();sensor=candidate;source='browser';sensor.addEventListener('inputreport',input);await sensor.open();
  $('device').textContent=(sensor.productName||'Apple lid sensor')+' · 05ac:8104';$('source-name').textContent='Direct browser · WebHID';$('status').textContent='Browser sensor connected. Move your lid to see the reporting cadence.';
  $('diagnostic').textContent=JSON.stringify(sensor.collections,null,2)+'\n';
  render();closeDialog('connection-dialog');
 }catch(e){await stop(e.name+': '+e.message);log(e.message);if(e.name!=='AbortError')openDialog('connection-dialog');}finally{busy=false;buttons();}
}
async function nativeConnect(){
 // Hosted pages must never try native endpoints or reach across origins to a
 // local helper. The native path is available only from a loopback page.
 if(hostedMode){showLocalSetup();return;}
 if(busy)return;busy=true;buttons();await stop('Connecting local native reader…');const run=++generation;const controller=new AbortController();aborter=controller;
 try{
  const response=await fetch('/session',{headers:{'X-Hinge-Client':'1'},signal:controller.signal});if(!response.ok)throw new Error('Native server unavailable. Run scripts/run.sh to enable this mode.');
  const session=await response.json();if(!session.nativeAvailable)throw new Error('Native reader binary is not available.');
  const stream=await fetch('/sensor',{headers:{'X-Hinge-Client':'1','X-Hinge-Key':session.token},signal:controller.signal});if(!stream.ok)throw new Error(await stream.text());
  if(run!==generation)return;
  resetMeasurements();source='native';awaitingNativeReport=true;$('source-name').textContent='Native feature polling · local bridge';$('device').textContent='Built-in las · 05ac:8104';$('status').textContent='Native reader open. Waiting for the first accepted sensor measurement…';log('Native IOKit Feature Report 1. Requested rate: 60 reads/s.');busy=false;buttons();render();
  const reader=stream.body.getReader(),decoder=new TextDecoder();let pending='';
  while(run===generation){const {value,done}=await reader.read();if(done)break;pending+=decoder.decode(value,{stream:true});let newline;
   while((newline=pending.indexOf('\n'))>=0){const line=pending.slice(0,newline);pending=pending.slice(newline+1);if(!line.trim())continue;const item=JSON.parse(line);if(item.error)throw new Error(item.error);if(run!==generation)break;receiveNative(item);}
  }
  if(run===generation){await stop('Native stream ended.');openDialog('connection-dialog');}
 }catch(e){if(run===generation){await stop(e.name==='AbortError'?'Disconnected.':e.message);log(e.message);busy=false;buttons();if(e.name!=='AbortError')openDialog('connection-dialog');}}finally{if(run===generation){busy=false;buttons();}}
}
function browserAvailabilityMessage(){
 if(!isSecureContext)return 'Direct sensor access requires HTTPS or a localhost page. Open the HTTPS demo, or follow the local native setup.';
 return hostedMode?'This browser does not support WebHID. Open this demo in desktop Chrome or Edge, or set up the native reader locally.':'WebHID is unavailable here. Use the local native reader, or open this page in desktop Chrome or Edge.';
}
function showLocalSetup(){
 openDialog('connection-dialog');$('local-setup').hidden=false;$('local-setup').scrollIntoView({behavior:'smooth',block:'nearest'});$('local-setup-summary').focus();
 $('status').textContent='Native mode runs on your Mac. Follow the local setup below, then open the loopback page.';
}
function interruptChallenge(reason){
 if(challenge?.getState(performance.now()).status==='active')challenge.abort(reason);
}
function closeMenu(restoreFocus=false){
 const wasOpen=!$('menu-panel').hidden;$('menu-panel').hidden=true;$('menu-toggle').setAttribute('aria-expanded','false');
 if(wasOpen&&restoreFocus)$('menu-toggle').focus();
}
function setView(view){
 if(view!=='live'&&view!=='challenge')return;
 if(currentView==='challenge'&&view!=='challenge')interruptChallenge('Challenge view closed. Start again when ready.');
 currentView=view;document.body.dataset.view=view;$('live-view').hidden=view!=='live';$('challenge-view').hidden=view!=='challenge';
 for(const name of ['live','challenge']){const item=$('menu-'+name);if(name===view)item.setAttribute('aria-current','page');else item.removeAttribute('aria-current');}
 $('view-name').textContent=view==='live'?'Live angle':'Hinge challenge';closeMenu(true);render();
 if(document.activeElement&&!visibleFocusTarget(document.activeElement))$('menu-toggle').focus();
}
function visibleFocusTarget(element){
 if(!element||element.disabled||element.isConnected===false)return false;
 for(let node=element;node;node=node.parentElement)if(node.hidden||(node.tagName==='DIALOG'&&!node.open))return false;
 return true;
}
function closeDialog(id){const dialog=$(id);if(dialog?.open&&typeof dialog.close==='function')dialog.close();}
function openDialog(id){
 const dialog=$(id);if(!dialog||typeof dialog.showModal!=='function')return;
 interruptChallenge('Challenge interrupted. Start again when ready.');closeMenu(true);
 for(const other of dialogIds)if(other!==id)closeDialog(other);
 if(!dialog.open){dialogFocus.set(id,document.activeElement&&document.activeElement!==document.body?document.activeElement:$('menu-toggle'));try{dialog.showModal();}catch{}}
 render();
}
function setupNavigation(){
 const welcomeKey='hinge-welcome-dismissed-v1';
 for(const id of dialogIds)$(id)?.addEventListener('close',()=>{
  if(id==='compatibility-dialog')try{sessionStorage.setItem(welcomeKey,'1');}catch{}
  const previous=dialogFocus.get(id);(visibleFocusTarget(previous)?previous:$('connection-state')).focus();
 });
 $('compatibility-dismiss').onclick=$('compatibility-close').onclick=()=>closeDialog('compatibility-dialog');
 $('connection-close').onclick=()=>closeDialog('connection-dialog');$('diagnostics-close').onclick=()=>closeDialog('diagnostics-dialog');
 $('connection-state').onclick=$('open-connect').onclick=$('menu-connect').onclick=()=>openDialog('connection-dialog');
 $('menu-about').onclick=()=>openDialog('compatibility-dialog');$('menu-diagnostics').onclick=()=>openDialog('diagnostics-dialog');
 $('menu-live').onclick=$('back-live').onclick=()=>setView('live');$('menu-challenge').onclick=()=>setView('challenge');
 $('menu-toggle').onclick=()=>{if(!$('menu-panel').hidden){closeMenu(true);return;}$('menu-panel').hidden=false;$('menu-toggle').setAttribute('aria-expanded','true');$('menu-live').focus();};
 document.addEventListener('click',event=>{if(!$('menu-panel').hidden&&!$('menu-panel').contains(event.target)&&!$('menu-toggle').contains(event.target))closeMenu(true);});
 document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!$('menu-panel').hidden){event.preventDefault();closeMenu(true);}});
 $('browser-notice').hidden=browserSensorAvailable;$('browser-notice').textContent=browserSensorAvailable?'':browserAvailabilityMessage();
 $('local-setup').hidden=true;closeMenu();setView('live');
 let acknowledged=false;try{acknowledged=sessionStorage.getItem(welcomeKey)==='1';}catch{}
 if(!acknowledged)openDialog('compatibility-dialog');
}
function randomInt(range){const limit=Math.floor(4294967296/range)*range,word=new Uint32Array(1);do{crypto.getRandomValues(word);}while(word[0]>=limit);return word[0]%range;}
function startChallenge(){
 const now=performance.now();if(busy||document.hidden||!latest||reportAge(now)>freshnessLimit()||!source)return;
 const targets=HingeChallenge.generateTargets(latest.angle,randomInt);
 // Round the epoch boundary up: Date.now() must not admit a read completed
 // fractionally before this prompt within the same millisecond.
 challengeStartedEpochMs=Date.now()+1;stageStartedEpochMs=challengeStartedEpochMs;stageStartedAt=now;
 challenge=new HingeChallenge({targets,startedAt:now,timeoutMs:60000,tolerance:3,holdMs:500,maxGapMs:freshnessLimit(),minSamples:2});render();
}
function render(){
 const now=performance.now(),age=latest?reportAge(now):null;buttons();
 const connectionText=source==='browser'?'Browser connected':source==='native'?'Native connected':'Disconnected';
 $('connection-state').textContent=connectionText;$('connection-state').dataset.connected=String(!!source);$('connection-state').setAttribute('aria-label',connectionText+'. Manage sensor connection');$('open-connect').hidden=!!source;$('telemetry').hidden=!source;
 $('freshness').textContent=document.hidden?'Paused while this page is hidden.':!latest?'Waiting for a fresh measurement.':(source?'':'Disconnected; ')+(latest.nativeTiming?'Native read completed ':'Last browser report received ')+Math.round(age)+' ms ago.';
 const windowTimes=arrivals.filter(t=>now-t<=10000);$('rate').textContent=windowTimes.length>1?((windowTimes.length-1)*1000/(windowTimes.at(-1)-windowTimes[0])).toFixed(1)+' / second (recent)':'—';
 $('interval').textContent=lastGap===null?'—':lastGap.toFixed(1)+' ms';$('changes').textContent=changeTimes.filter(t=>now-t<=10000).length+' value changes / last 10 s';
 $('native-timing').textContent=latest?.nativeTiming?(latest.nativeTiming.readGapMs===null?'First read':latest.nativeTiming.readGapMs.toFixed(1)+' ms between reads')+' · '+latest.readMs.toFixed(1)+' ms request · '+latest.nativeTiming.delayMs.toFixed(1)+' ms to browser':'—';$('discarded').textContent=String(droppedNative);
 const state=challenge?challenge.tick(now):null;
 document.body.dataset.challengeState=state?.status||'idle';
 $('dot').style.display=latest?'block':'none';if(latest)$('dot').style.left=Math.max(0,Math.min(100,(latest.angle-55)/70*100))+'%';
 $('band').style.display=state?.status==='active'?'block':'none';
 for(let i=0;i<3;i++)$('step'+i).className='step'+(state&&i<state.completedStages?' done':state?.status==='active'&&i===state.stageIndex?' active':'');
 if(state?.status==='active'){
  $('target').textContent=state.target+'°';const delta=latest?state.target-latest.angle:null;
  $('challenge-status').textContent=age===null||age>freshnessLimit()?'Waiting for a fresh sensor report.':Math.abs(delta)<=3?'On target. Stay near it until successive reports confirm this step.':(delta>0?'Open':'Close')+' the screen a little to reach the target.';
  $('band').style.left=(state.target-3-55)/70*100+'%';$('band').style.width=6/70*100+'%';
  $('hold').value=state.holdProgress;$('challenge-meta').textContent='Step '+(state.stageIndex+1)+' of 3 · '+Math.ceil(state.remainingMs/1000)+' s remaining';
 }else if(state){
  $('hold').value=state.status==='passed'?1:0;$('target').textContent=state.status==='passed'?'Challenge completed.':state.status==='expired'?'Time ran out.':'Challenge stopped.';
  $('challenge-status').textContent=state.status==='passed'?'All three targets were confirmed by received sensor reports.':state.reason||'Start again when ready.';
  $('challenge-meta').textContent=state.status==='passed'?'Local result · '+(state.elapsedMs/1000).toFixed(1)+' seconds':'Targets stay between 65° and 110°.';
 }else{$('challenge-status').textContent=source&&latest?'Ready. Start to receive your first target.':'Connect a sensor and receive a fresh angle to begin.';}
 if(tableDirty&&now-lastRender>250){$('rows').textContent='';for(const item of recent){const row=document.createElement('tr');for(const value of [item.time,item.gap===null?'—':item.gap.toFixed(1)+' ms',item.nativeTiming?localTime(item.nativeTiming.readCompletedEpochMs):'—',item.nativeTiming?item.nativeTiming.delayMs.toFixed(1)+' ms':'—',item.source,item.raw,item.angle+'°']){const td=document.createElement('td');td.textContent=value;row.append(td);}$('rows').append(row);}tableDirty=false;lastRender=now;}
}
$('connect').onclick=browserConnect;$('native').onclick=nativeConnect;$('stop').onclick=async()=>{busy=true;buttons();await stop();busy=false;buttons();};$('start').onclick=startChallenge;$('cancel').onclick=()=>{challenge?.abort('Cancelled.');render();};
if(browserSensorAvailable)navigator.hid.addEventListener('disconnect',e=>{if(e.device===sensor)void stop('Sensor disconnected.').then(()=>openDialog('connection-dialog'));});
$('native').textContent=hostedMode?'Set up native reader':'Use native reader';
if(!browserSensorAvailable)$('connect').textContent=isSecureContext?'WebHID unavailable':'HTTPS required';
$('status').textContent=browserSensorAvailable?(hostedMode?'Ready. Connect directly through WebHID here, or set up the native reader locally.':'Ready. Choose direct browser access or the local native reader.'):browserAvailabilityMessage();
window.addEventListener('pagehide',()=>{aborter?.abort();if(sensor?.opened)void sensor.close();});
document.addEventListener('visibilitychange',()=>{
 if(document.hidden)challenge?.abort('Page hidden. Start a new challenge after returning.');
 else {visibleSinceEpochMs=Date.now()+1;visibleSinceAt=performance.now();}
 // Resuming needs a new report; a pre-hide value cannot enable Start.
 latest=null;arrivals=[];changeTimes=[];previousAngle=null;lastGap=null;$('angle').textContent='—';$('challenge-angle').textContent='—';render();
});
setInterval(render,100);render();setupNavigation();
