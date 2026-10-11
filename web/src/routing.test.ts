import {describe,it,expect} from 'vitest';
import {routeGraph,type Graph,type Zone} from './routing';
const nodes=[{id:'a',x:0,y:0},{id:'b',x:100,y:0},{id:'c',x:200,y:0},{id:'d',x:100,y:150}];
const graph:Graph={nodes,edges:[{id:'ab',a:'a',b:'b',length:100},{id:'bc',a:'b',b:'c',length:100},{id:'ad',a:'a',b:'d',length:181},{id:'dc',a:'d',b:'c',length:181}]};
describe('client routing',()=>{
 it('avoids a hazard crossing an entire edge',()=>{const z:Zone={x:70,y:-10,width:60,height:20,buffer:0};const r=routeGraph(graph,'a','c',[z],3000);expect(r?.nodes).toEqual(['a','d','c']);});
 it('minimizes distance inside the starting zone',()=>{const z={x:-10,y:-10,width:60,height:20,buffer:0};const r=routeGraph(graph,'a','c',[z],3000);expect(r?.nodes).toEqual(['a','d','c']);expect(r?.insideDistance).toBeCloseTo(181/15);});
 it('enforces the total length limit',()=>expect(routeGraph(graph,'a','c',[],150)).toBeNull());
 it('does not enter a disconnected excluded area during exit',()=>{const zs=[{x:-10,y:-10,width:60,height:20,buffer:0},{x:70,y:-10,width:60,height:20,buffer:0}];expect(routeGraph(graph,'a','c',zs,3000)?.nodes).toEqual(['a','d','c']);});
 it('keeps shortest valid alternatives under a constrained cap',()=>{const g:Graph={nodes:[{id:'a',x:0,y:0},{id:'b',x:10,y:0},{id:'c',x:20,y:0},{id:'d',x:0,y:20}],edges:[{id:'ab',a:'a',b:'b',length:10},{id:'bc',a:'b',b:'c',length:10},{id:'ad',a:'a',b:'d',length:20},{id:'db',a:'d',b:'b',length:22}]};expect(routeGraph(g,'a','c',[],25)?.distance).toBe(20);});
});
