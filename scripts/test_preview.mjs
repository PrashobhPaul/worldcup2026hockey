import { buildPreview, teamLedger } from '../src/engine/preview.js'
let fail=0
const ok=(n,c,d='')=>{ if(c) console.log('  ok  ',n); else {fail++;console.log('  FAIL',n,d)} }
const M=(id,h,a,hs,as,pc,phase='pool')=>({id,home:h,away:a,phase,status:'completed',score:{home:hs,away:as},penalty_corners:pc})
const up=(h,a,phase='stage2')=>({id:'X',home:h,away:a,phase,status:'scheduled',score:{home:null,away:null}})

console.log('Preview engine')
// No tournament history yet -> no cards invented
ok('an empty tournament yields no cards',
   buildPreview({match:up('FRA','RSA'),matches:[],events:[],pred:null}).length===0)
// TBD fixtures never get a preview
ok('a TBD fixture yields no cards',
   buildPreview({match:up('TBD','TBD'),matches:[M('A1','FRA','RSA',1,0,{home:2,away:1})],events:[],pred:null}).length===0)

const matches=[M('A1','FRA','GER',1,1,{home:5,away:3}),M('A2','FRA','BEL',2,3,{home:4,away:6}),
               M('A3','FRA','MAS',3,3,{home:5,away:2}),M('B1','RSA','ESP',1,3,{home:3,away:4}),
               M('B2','RSA','IRL',1,4,{home:2,away:5}),M('B3','RSA','AUS',2,2,{home:3,away:2})]
const events=[
 {matchId:'A1',team:'FRA',type:'goal',minute:43,via:'FG',player:'Haertelmeyer'},
 {matchId:'A2',team:'FRA',type:'goal',minute:50,via:'PC',player:'Charlet'},
 {matchId:'A3',team:'FRA',type:'goal',minute:20,via:'FG',player:'Haertelmeyer'},
 {matchId:'B1',team:'RSA',type:'goal',minute:30,via:'PC',player:'Cassiem'},
 {matchId:'B2',team:'RSA',type:'goal',minute:55,via:'PC',player:'Cassiem'},
 {matchId:'B3',team:'RSA',type:'goal',minute:58,via:'PC',player:'Cassiem'},
 {matchId:'B3',team:'RSA',type:'yellow_card',minute:12},
 {matchId:'B2',team:'RSA',type:'green_card',minute:22},
 {matchId:'B1',team:'RSA',type:'green_card',minute:33},
 {matchId:'B1',team:'RSA',type:'green_card',minute:41},
 {matchId:'A1',team:'FRA',type:'green_card',minute:15},
]
const L=teamLedger('RSA',matches,events)
ok('ledger counts only this team’s completed matches', L.played===3&&L.w===0&&L.d===1&&L.l===2, JSON.stringify(L))
ok('ledger separates PC goals from volume', L.pcWon===8&&L.pcGoals===3, `${L.pcWon}/${L.pcGoals}`)
ok('ledger counts late goals', L.lateGoals===2, String(L.lateGoals))

const cards=buildPreview({match:up('FRA','RSA'),home:{name:'France'},away:{name:'South Africa'},matches,events,pred:null})
const kinds=cards.map(c=>c.kind)
ok('a real ledger produces evidence cards', cards.length>=3, kinds.join(','))
ok('no prediction card without a model pick', !kinds.includes('prediction'))
ok('the PC card notices volume != threat',
   cards.find(c=>c.kind==='pc')?.headline==='France win more corners, South Africa score more from them',
   cards.find(c=>c.kind==='pc')?.headline)
ok('the discipline card names the worse side',
   cards.find(c=>c.kind==='discipline')?.statLabel.startsWith('South Africa'),
   cards.find(c=>c.kind==='discipline')?.statLabel ?? 'no discipline card')
ok('a thin card sample produces no discipline card',
   !buildPreview({match:up('FRA','RSA'),home:{name:'France'},away:{name:'South Africa'},matches,
     events:[{matchId:'B1',team:'RSA',type:'green_card',minute:5}],pred:null}).some(c=>c.kind==='discipline'))
// every card must state its scope, so a number can never read as all-time
ok('every card scopes its claim to this tournament',
   cards.every(c=>/this World Cup|here|pool stage|these two/i.test(c.statLabel+c.text)),
   kinds.join(','))

// Equal records must not crown a "better" side
const even=[M('A1','FRA','GER',2,0,{home:3,away:1}),M('A2','FRA','BEL',1,2,{home:2,away:2}),
            M('B1','RSA','ESP',2,0,{home:3,away:1}),M('B2','RSA','IRL',1,2,{home:2,away:2})]
const f=buildPreview({match:up('FRA','RSA'),home:{name:'France'},away:{name:'South Africa'},matches:even,events:[],pred:null}).find(c=>c.kind==='form')
ok('a level record is not called "better"', f && !/carry the better record/.test(f.headline), f?.headline)

// Carried-forward Stage-1 meeting is surfaced as still counting
const met=[...matches, M('A9','FRA','RSA',2,1,{home:4,away:2})]
const h2h=buildPreview({match:up('FRA','RSA','stage2'),home:{name:'France'},away:{name:'South Africa'},matches:met,events,pred:null}).find(c=>c.kind==='h2h')
ok('a carried-forward pool meeting is flagged as still counting',
   h2h && /carries forward/.test(h2h.text), h2h?.text?.slice(0,60))

console.log(fail?`\n${fail} FAILED`:'\nAll preview checks passed.')
process.exit(fail?1:0)
