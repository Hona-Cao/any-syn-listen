export class Selection {
  constructor(){this.ids=new Set();this.anchor=null}
  clear(){this.ids.clear();this.anchor=null}
  all(visible){this.ids=new Set(visible);this.anchor=visible[0]??null}
  click(id,visible,{ctrl=false,shift=false,checkbox=false}={}){
    if(!visible.includes(id))return
    if(shift&&this.anchor&&visible.includes(this.anchor)){
      const from=visible.indexOf(this.anchor),to=visible.indexOf(id)
      if(!ctrl)this.ids.clear()
      for(const value of visible.slice(Math.min(from,to),Math.max(from,to)+1))this.ids.add(value)
    }else if(ctrl||checkbox){this.ids.has(id)?this.ids.delete(id):this.ids.add(id);this.anchor=id}
    else{this.ids=new Set([id]);this.anchor=id}
  }
  prune(valid){const set=new Set(valid);this.ids=new Set([...this.ids].filter(id=>set.has(id)));if(!set.has(this.anchor))this.anchor=null}
}
