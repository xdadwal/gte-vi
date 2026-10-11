export type Node={id:string;x:number;y:number;lon?:number;lat?:number};
export type Edge={id:string;a:string;b:string;length:number};
export type Graph={nodes:Node[];edges:Edge[]};
export type Zone={x:number;y:number;width:number;height:number;buffer:number};
export type Route={nodes:string[];distance:number;insideDistance:number};
type Interval=[number,number];
const eps=1e-7;
function rectInterval(a:Node,b:Node,x:number,y:number,w:number,h:number):Interval[]{let lo=0,hi=1;for(const [p,d,min,max] of [[a.x,b.x-a.x,x,x+w],[a.y,b.y-a.y,y,y+h]]){if(Math.abs(d)<eps){if(p<min||p>max)return [];}else{let u=(min-p)/d,v=(max-p)/d;if(u>v)[u,v]=[v,u];lo=Math.max(lo,u);hi=Math.min(hi,v);if(lo>hi)return [];}}return [[lo,hi]];}
function circleInterval(a:Node,b:Node,x:number,y:number,r:number):Interval[]{const dx=b.x-a.x,dy=b.y-a.y,px=a.x-x,py=a.y-y,A=dx*dx+dy*dy;if(A<eps)return px*px+py*py<=r*r?[[0,1]]:[];const B=2*(px*dx+py*dy),C=px*px+py*py-r*r,disc=B*B-4*A*C;if(disc<0)return [];const s=Math.sqrt(disc),lo=Math.max(0,(-B-s)/(2*A)),hi=Math.min(1,(-B+s)/(2*A));return lo<=hi?[[lo,hi]]:[];}
function merge(xs:Interval[]):Interval[]{xs.sort((a,b)=>a[0]-b[0]);const out:Interval[]=[];for(const x of xs){const last=out.at(-1);if(last&&x[0]<=last[1]+eps)last[1]=Math.max(last[1],x[1]);else out.push([...x]);}return out;}
export function segmentIntervals(a:Node,b:Node,z:Zone):Interval[]{const {x,y,width:w,height:h,buffer:r}=z;return merge([...rectInterval(a,b,x-r,y,w+2*r,h),...rectInterval(a,b,x,y-r,w,h+2*r),...[[x,y],[x+w,y],[x,y+h],[x+w,y+h]].flatMap(([cx,cy])=>circleInterval(a,b,cx,cy,r))]);}
export function pointInZone(p:Node,z:Zone){const dx=Math.max(z.x-p.x,0,p.x-z.x-z.width),dy=Math.max(z.y-p.y,0,p.y-z.y-z.height);return dx*dx+dy*dy<=z.buffer*z.buffer+eps;}
export function distanceToZone(p:Node,z:Zone){const dx=Math.max(z.x-p.x,0,p.x-z.x-z.width),dy=Math.max(z.y-p.y,0,p.y-z.y-z.height);return Math.max(0,Math.hypot(dx,dy)-z.buffer);}
function zonesTouch(a:Zone,b:Zone){const dx=Math.max(a.x-b.x-b.width,b.x-a.x-a.width,0),dy=Math.max(a.y-b.y-b.height,b.y-a.y-a.height,0);return Math.hypot(dx,dy)<=a.buffer+b.buffer+eps;}
type Label={node:string;exited:boolean;distance:number;inside:number;parent?:Label;dead?:boolean};
class Heap{items:Label[]=[];less(a:Label,b:Label){return a.inside<b.inside-eps||(Math.abs(a.inside-b.inside)<eps&&a.distance<b.distance)}push(x:Label){const a=this.items;a.push(x);let i=a.length-1;while(i){const p=(i-1)>>1;if(!this.less(a[i],a[p]))break;[a[i],a[p]]=[a[p],a[i]];i=p;}}pop(){const a=this.items,top=a[0],last=a.pop()!;if(a.length){a[0]=last;let i=0;while(true){let j=i,l=i*2+1,r=l+1;if(l<a.length&&this.less(a[l],a[j]))j=l;if(r<a.length&&this.less(a[r],a[j]))j=r;if(j===i)break;[a[i],a[j]]=[a[j],a[i]];i=j;}}return top;}}
export function routeGraph(g:Graph,start:string,end:string|string[],zones:Zone[],max:number):Route|null{
 const ns=new Map(g.nodes.map(n=>[n.id,n])),origin=ns.get(start);if(!origin)return null;const targets=new Set(Array.isArray(end)?end:[end]);for(const id of [...targets]){const n=ns.get(id);if(!n||zones.some(z=>pointInZone(n,z)))targets.delete(id);}if(!targets.size)return null;
 const component=new Set<number>();zones.forEach((z,i)=>{if(pointInZone(origin,z))component.add(i)});let grew=true;while(grew){grew=false;zones.forEach((z,i)=>{if(!component.has(i)&&[...component].some(j=>zonesTouch(z,zones[j]))){component.add(i);grew=true;}})}
 const adjacency=new Map<string,Edge[]>();for(const e of g.edges){if(!ns.has(e.a)||!ns.has(e.b))continue;for(const id of [e.a,e.b]){const list=adjacency.get(id)||[];list.push(e);adjacency.set(id,list);}}
 const heap=new Heap(),labels=new Map<string,Label[]>();const initial:Label={node:start,exited:component.size===0,distance:0,inside:0};heap.push(initial);labels.set(start+':'+initial.exited,[initial]);
 while(heap.items.length){const cur=heap.pop();if(cur.dead)continue;if(targets.has(cur.node)&&cur.exited){const path=[];let p:Label|undefined=cur;while(p){path.push(p.node);p=p.parent;}return {nodes:path.reverse(),distance:cur.distance,insideDistance:cur.inside};}
  for(const edge of adjacency.get(cur.node)||[]){const id=edge.a===cur.node?edge.b:edge.a,a=ns.get(cur.node)!,b=ns.get(id)!,length=edge.length;if(cur.distance+length>max+eps)continue;
   const all=merge(zones.flatMap(z=>segmentIntervals(a,b,z)));let inside=0,exited=cur.exited;
   if(exited){if(all.some(([lo,hi])=>hi-lo>eps))continue;}else{if(zones.some((z,i)=>!component.has(i)&&segmentIntervals(a,b,z).some(([lo,hi])=>hi-lo>eps)))continue;if(all.length>1||all.length===1&&all[0][0]>eps)continue;if(all.length){inside=length*(all[0][1]-all[0][0]);exited=all[0][1]<1-eps||!zones.some(z=>pointInZone(b,z));}else exited=true;}
   const next:Label={node:id,exited,distance:cur.distance+length,inside:cur.inside+inside,parent:cur};const key=id+':'+exited,list=labels.get(key)||[];
   if(list.some(l=>!l.dead&&l.distance<=next.distance+eps&&l.inside<=next.inside+eps))continue;for(const l of list){if(next.distance<=l.distance+eps&&next.inside<=l.inside+eps)l.dead=true;}list.push(next);labels.set(key,list);heap.push(next);
  }
 }
 return null;
}
// Snap to an edge, preserving both legal directions and the original edge geometry.
export function snapGraph(g:Graph,points:{id:string;x:number;y:number}[],maxSnap=75):Graph|null{
 const nodes=new Map(g.nodes.map(n=>[n.id,n])),splits=new Map<string,{id:string;t:number;x:number;y:number}[]>();
 for(const p of points){let best: {edge:Edge;t:number;x:number;y:number;distance:number}|undefined;for(const edge of g.edges){const a=nodes.get(edge.a)!,b=nodes.get(edge.b)!;if(!a||!b)continue;const dx=b.x-a.x,dy=b.y-a.y,L=dx*dx+dy*dy,t=L?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/L)):0,x=a.x+t*dx,y=a.y+t*dy,distance=Math.hypot(p.x-x,p.y-y);if(!best||distance<best.distance)best={edge,t,x,y,distance};}if(!best||best.distance>maxSnap)return null;const s={id:p.id,t:best.t,x:best.x,y:best.y};const arr=splits.get(best.edge.id)||[];arr.push(s);splits.set(best.edge.id,arr);nodes.set(p.id,{id:p.id,x:p.x,y:p.y});nodes.set(p.id+':snap',{id:p.id+':snap',x:s.x,y:s.y});}
 const edges:Edge[]=[];for(const e of g.edges){const ss=splits.get(e.id);if(!ss){edges.push(e);continue;}ss.sort((a,b)=>a.t-b.t);let last=e.a,t=0;for(const s of ss){edges.push({id:e.id+':'+s.id,a:last,b:s.id+':snap',length:e.length*(s.t-t)});edges.push({id:s.id+':connector',a:s.id,b:s.id+':snap',length:Math.hypot(nodes.get(s.id)!.x-s.x,nodes.get(s.id)!.y-s.y)});last=s.id+':snap';t=s.t;}edges.push({id:e.id+':end',a:last,b:e.b,length:e.length*(1-t)});}return {nodes:[...nodes.values()],edges};
}
