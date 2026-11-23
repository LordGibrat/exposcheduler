(function(root,factory){
  "use strict";
  const api=factory(root);
  if(typeof module==="object"&&module.exports) module.exports=api;
  else{root.ExpoExperience=api;if(root.document)api.createExperience().start();}
})(typeof globalThis!=="undefined"?globalThis:this,function(root){
  "use strict";
  const INTENTS=Object.freeze(["study_room","imac","meeting_room","auditorium"]);
  function normaliseFloor(value){const n=Number(value);return Number.isInteger(n)&&n>=1&&n<=8?n:null;}
  function journeyPhase(phase,reviewOpen){return phase==="saved"||reviewOpen?"review":phase==="ready"?"result":"search";}
  function createExperience(options={}){
    const doc=options.document||root.document,win=options.window||root;
    const EventClass=options.Event||win.Event||root.Event;
    const Observer=options.MutationObserver||win.MutationObserver;
    const $=id=>doc.getElementById(id);
    const all=selector=>Array.from(doc.querySelectorAll(selector));
    const state={stage:"search",started:false};
    const handlers=[],observers=[];
    function listen(node,event,handler){if(node){node.addEventListener(event,handler);handlers.push([node,event,handler]);}}
    function emit(node,event){node.dispatchEvent(new EventClass(event,{bubbles:true}));}
    function syncIntent(){
      const current=$("find-kind").value;
      all("[data-intent]").forEach(button=>button.setAttribute("aria-pressed",String(button.dataset.intent===current)));
    }
    function syncFloor(){
      const floor=normaliseFloor($("find-floor").value)||4;
      all("[data-atlas-floor]").forEach(button=>button.setAttribute("aria-pressed",String(Number(button.dataset.atlasFloor)===floor)));
      all("[data-slice-floor]").forEach(slice=>slice.classList.toggle("is-active",Number(slice.dataset.sliceFloor)===floor));
      const caption=$("atlas-floor-caption");if(caption)caption.textContent=`STARTING FLOOR ${String(floor).padStart(2,"0")}`;
      return floor;
    }
    function setIntent(value){
      if(!INTENTS.includes(value))return false;
      const field=$("find-kind");field.value=value;
      emit(field,"input");emit(field,"change");syncIntent();return true;
    }
    function setFloor(value){
      const floor=normaliseFloor(value);if(floor===null)return false;
      const field=$("find-floor");field.value=String(floor);emit(field,"input");syncFloor();return true;
    }
    function syncJourney(){
      state.stage=journeyPhase($("find-results").dataset.phase,!$("find-review").hidden);
      all("[data-journey]").forEach(item=>{
        if(item.dataset.journey===state.stage)item.setAttribute("aria-current","step");
        else item.removeAttribute("aria-current");
      });
      return state.stage;
    }
    function start(){
      if(state.started)return;state.started=true;
      all("[data-intent]").forEach(button=>listen(button,"click",()=>setIntent(button.dataset.intent)));
      const floors=all("[data-atlas-floor]");
      floors.forEach((button,index)=>{
        listen(button,"click",()=>setFloor(button.dataset.atlasFloor));
        listen(button,"keydown",event=>{
          let next=index;
          if(event.key==="ArrowDown"||event.key==="ArrowRight")next=Math.min(index+1,floors.length-1);
          else if(event.key==="ArrowUp"||event.key==="ArrowLeft")next=Math.max(index-1,0);
          else if(event.key==="Home")next=0;
          else if(event.key==="End")next=floors.length-1;
          else return;
          event.preventDefault();setFloor(floors[next].dataset.atlasFloor);floors[next].focus();
        });
      });
      listen($("find-kind"),"input",syncIntent);listen($("find-kind"),"change",syncIntent);
      listen($("find-floor"),"input",syncFloor);listen($("find-floor"),"change",syncFloor);
      if(Observer){
        const observer=new Observer(syncJourney);
        observer.observe($("find-results"),{attributes:true,attributeFilter:["data-phase"]});
        observer.observe($("find-review"),{attributes:true,attributeFilter:["hidden"]});
        observers.push(observer);
      }
      syncIntent();syncFloor();syncJourney();
    }
    function destroy(){
      handlers.forEach(([node,event,handler])=>node.removeEventListener(event,handler));handlers.length=0;
      observers.forEach(observer=>observer.disconnect());observers.length=0;state.started=false;
    }
    return{state,start,setIntent,setFloor,syncIntent,syncFloor,syncJourney,destroy};
  }
  return{INTENTS,normaliseFloor,journeyPhase,createExperience};
});
