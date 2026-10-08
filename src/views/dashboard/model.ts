export const sections=['overview','bundles','encumbrances','settlement','income','nav','disclosure','activity','settings'] as const;
export type Section=typeof sections[number];
export const labels:Record<Section,string>={overview:'Overview',bundles:'Rights bundles',encumbrances:'Encumbrances',settlement:'Atomic settlement',income:'Income & actions',nav:'NAV attestation',disclosure:'Disclosure',activity:'Activity',settings:'Settings'};
export type RequestRecord={id:string;kind:string;name:string;asset:string;amount:number;details:Record<string,string>;created:string;status:RequestStatus;tx?:string;error?:string};
/** Prepared and Archived are device-local; the rest track an on-chain submission. */
export const requestStatuses=['Prepared','Archived','Proving','Submitted','Confirmed','Failed'] as const;
export type RequestStatus=typeof requestStatuses[number];
/** Private notes (decimal strings); only ever stored encrypted off this device. */
export type WorkspaceNote=Record<string,string>&{commit:string;status:'pending'|'live'|'spent'};
/** An encumbrance this wallet holds for someone else (terms, locked note and release secret). */
export type HeldItem={enc:string;locked:WorkspaceNote;nonce:string;state?:'pending'|'invalid'|'active'|'released'|'defaulted'|'enforced'};
export type Workspace={name:string;requests:RequestRecord[];hideValues:boolean;notes?:WorkspaceNote[];held?:HeldItem[];inbox?:number;inboxes?:Record<string,number>};
export const initial:Workspace={name:'My workspace',requests:[],hideValues:false};
export const claimTypes=['PRINCIPAL','INCOME','VOTE','REDEEM','CONTROL'];
export const assets=['NVDA Stock Token','Treasury token','USDG vault'];
export function fee(value:number,bps:number){return value*bps/10000}
export function validateAmount(value:string){const n=Number(value);if(!Number.isFinite(n)||n<=0||n>1e12)throw new Error('Enter an amount greater than zero and no more than 1 trillion.');return n}
export function createRecord(kind:string,fields:Record<string,string>):RequestRecord{const amount=validateAmount(fields.amount||'1');const name=(fields.name||kind).trim();if(!name)throw new Error('Enter a name for this request.');if(fields.until&&new Date(fields.until)<=new Date())throw new Error('Choose an expiry date in the future.');return{id:crypto.randomUUID(),kind,name,asset:fields.asset||'Portfolio',amount,details:fields,created:new Date().toISOString(),status:'Prepared'}}
export type AssetOption={name:string;claims:string[];address?:string};
export const fallbackAssets:AssetOption[]=assets.map(name=>({name,claims:name==='USDG vault'?claimTypes.filter(c=>c!=='VOTE'):claimTypes}));
export function isWorkspace(data:unknown):data is Workspace{const w=data as Workspace;return !!w&&typeof w.name==='string'&&Array.isArray(w.requests)&&w.requests.every((r:RequestRecord)=>typeof r.id==='string'&&typeof r.kind==='string'&&typeof r.asset==='string'&&typeof r.name==='string'&&typeof r.created==='string'&&Number.isFinite(r.amount)&&!!r.details&&(requestStatuses as readonly string[]).includes(r.status))&&(w.notes===undefined||(Array.isArray(w.notes)&&w.notes.every(n=>typeof n?.commit==='string')))}
/** Combine this device's workspace with the synced copy. A fresh device adopts the synced copy; otherwise requests are unioned by id and this device's edits and preferences win. */
export function mergeWorkspaces(local:Workspace,remote:Workspace):Workspace{if(!local.requests.length&&local.name===initial.name)return remote;const byId=new Map(remote.requests.map(r=>[r.id,r]));for(const r of local.requests)byId.set(r.id,r);const notes=new Map((remote.notes??[]).map(n=>[n.commit,n]));for(const n of local.notes??[]){const r=notes.get(n.commit);if(!r||r.status!=='spent')notes.set(n.commit,n)}const held=new Map([...(remote.held??[]),...(local.held??[])].map(h=>[h.enc,h]));return{...local,requests:[...byId.values()].sort((a,b)=>b.created.localeCompare(a.created)),notes:[...notes.values()],held:[...held.values()],inbox:Math.max(local.inbox??0,remote.inbox??0),inboxes:mergeCursors(local.inboxes,remote.inboxes)}}
/** Inbox cursors per wallet: the furthest read position of either copy. */
export function mergeCursors(a:Record<string,number>={},b:Record<string,number>={}){const out={...b};for(const[k,v]of Object.entries(a))out[k]=Math.max(v,out[k]??0);return out}
/** Single-use pledge codes: returns a checker that accepts a held box only if its code (nonce) is unused or already used by the same encumbrance; it remembers what it accepts, so duplicates opened in one pass are caught too. */
export function pledgeCodes(held:HeldItem[]){const used=new Map(held.map(x=>[x.nonce,x.enc]));return(it:{nonce:string;enc:string})=>{if((used.get(it.nonce)??it.enc)!==it.enc)return false;used.set(it.nonce,it.enc);return true}}
