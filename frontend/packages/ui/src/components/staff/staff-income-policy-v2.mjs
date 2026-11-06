/** Shared, pure BFF/browser validator. Reject mismatched totals and remove unknown fields. */
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v), integer=v=>Number.isSafeInteger(v)&&v>=0
const iso=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v
const id=v=>typeof v==='string'&&/^[1-9]\d{0,18}$/.test(v)&&BigInt(v)<=9223372036854775807n
export function parseIncomeV2(value,month){
 try{
 if(!object(value)||!object(value.policy)||value.policy.version!=='DEMO_V2'||value.timezone!=='Asia/Ho_Chi_Minh'||!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)||month<'1971-01'||month>'2099-12'||!object(value.period)||!object(value.counts)||!object(value.payout)||value.payout.status!=='NOT_INTEGRATED'||!Array.isArray(value.assignments)||value.assignments.length>500||!Array.isArray(value.incentives)||value.incentives.length>31||!object(value.breakdown))return null
 const to=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),0)).toISOString().slice(0,10), from=month+'-01', policy=value.policy
 if(value.period.month!==month||value.period.from!==from||value.period.to!==to||value.period.timezone!=='Asia/Ho_Chi_Minh'||policy.code!=='ESTIMATE_FOR_DEMO'||policy.currency!=='VND'||typeof policy.label!=='string'||!policy.label||policy.label.length>200||policy.unitPriceVnd!==60000||policy.distanceFeePerKmVnd!==3000||policy.includedDistanceMetres!==3000||policy.peakBonusVnd!==10000||policy.peakStartMinute!==1020||policy.peakEndMinute!==1200||policy.dailyThreshold!==5||policy.dailyBonusVnd!==30000||policy.dayBasis!=='CHECK_OUT_AT'||policy.peakBasis!=='CHECK_IN_AT')return null
 const seen=new Set(),days=new Map(),assignments=[];let eligible=0,incomplete=0,baseVnd=0,peakVnd=0,distanceVnd=0,unverifiedDistance=0
 for(const row of value.assignments){
 if(!object(row)||!id(row.id)||!id(row.bookingId)||seen.has(row.id)||!['ASSIGNED','ACCEPTED','IN_PROGRESS','DONE','CANCELLED'].includes(row.status)||!iso(row.scheduledStart)||!iso(row.scheduledEnd)||row.scheduledEnd<=row.scheduledStart||!(row.checkInAt===null||iso(row.checkInAt))||!(row.checkOutAt===null||iso(row.checkOutAt)))return null
 seen.add(row.id)
 const valid=row.status==='DONE'&&row.checkInAt!==null&&row.checkOutAt!==null&&row.checkOutAt>=row.checkInAt,day=valid?new Date(Date.parse(row.checkOutAt)+7*3600000).toISOString().slice(0,10):null
 const expectedEligible=valid&&day>=from&&day<=to, reason=expectedEligible?null:row.status!=='DONE'?'STATUS_NOT_DONE':!row.checkInAt||!row.checkOutAt?'MISSING_CHECK_TIMES':row.checkOutAt<row.checkInAt?'INVALID_CHECK_TIMES':'OUTSIDE_COMPLETION_PERIOD'
 const scheduledDay=new Date(Date.parse(row.scheduledStart)+7*3600000).toISOString().slice(0,10)
 if(!(scheduledDay>=from&&scheduledDay<=to)&&!(row.checkOutAt&&new Date(Date.parse(row.checkOutAt)+7*3600000).toISOString().slice(0,10)>=from&&new Date(Date.parse(row.checkOutAt)+7*3600000).toISOString().slice(0,10)<=to))return null
 if(row.eligible!==expectedEligible||row.reason!==reason)return null
 let detail=null
 if(expectedEligible){const d=row.detail;if(!object(d)||d.day!==day||d.baseVnd!==policy.unitPriceVnd||!integer(d.peakVnd)||!integer(d.totalVnd)||!['VERIFIED','UNVERIFIED','INVALID'].includes(d.distanceStatus))return null
 const time=new Date(Date.parse(row.checkInAt)+7*3600000),minute=time.getUTCHours()*60+time.getUTCMinutes(),peak=minute>=1020&&minute<1200?10000:0;if(d.peakVnd!==peak)return null
 if(d.distanceStatus==='VERIFIED'){if(typeof d.distanceKm!=='string'||!/^\d{1,6}(?:\.\d{1,3})?$/.test(d.distanceKm)||!integer(d.distanceVnd))return null;const[whole,fraction='']=d.distanceKm.split('.'),metres=BigInt(whole)*1000n+BigInt(fraction.padEnd(3,'0'));if(d.distanceVnd!==Number((metres>3000n?metres-3000n:0n)*3n))return null}else if(d.distanceVnd!==null||d.distanceKm!==null)return null
 if(d.totalVnd!==d.baseVnd+d.peakVnd+(d.distanceVnd??0))return null
 detail={day,baseVnd:d.baseVnd,peakVnd:d.peakVnd,distanceVnd:d.distanceVnd,distanceStatus:d.distanceStatus,distanceKm:d.distanceKm,totalVnd:d.totalVnd};eligible++;baseVnd+=d.baseVnd;peakVnd+=d.peakVnd;distanceVnd+=d.distanceVnd??0;if(d.distanceStatus!=='VERIFIED')unverifiedDistance++;days.set(day,(days.get(day)||0)+1)
 }else{if(row.detail!==null)return null;if(['MISSING_CHECK_TIMES','INVALID_CHECK_TIMES'].includes(reason))incomplete++}
 assignments.push({id:row.id,bookingId:row.bookingId,status:row.status,scheduledStart:row.scheduledStart,scheduledEnd:row.scheduledEnd,checkInAt:row.checkInAt,checkOutAt:row.checkOutAt,eligible:expectedEligible,reason,detail})
 }
 const expected=[...days].filter(([,n])=>n>=5).sort(([a],[b])=>a.localeCompare(b)),incentives=[]
 if(value.incentives.length!==expected.length)return null
 for(let i=0;i<expected.length;i++){const[day,count]=expected[i],v=value.incentives[i];if(!object(v)||v.day!==day||v.eligibleCount!==count||v.amountVnd!==30000)return null;incentives.push({day,eligibleCount:count,amountVnd:30000})}
 const incentiveVnd=incentives.length*30000,breakdown={baseVnd,peakVnd,distanceVnd,incentiveVnd,unverifiedDistance},total=baseVnd+peakVnd+distanceVnd+incentiveVnd
 if(!integer(total)||value.estimateTotalVnd!==total||Object.entries(breakdown).some(([k,v])=>value.breakdown[k]!==v)||value.counts.assignments!==assignments.length||value.counts.eligible!==eligible||value.counts.incomplete!==incomplete||value.counts.excluded!==assignments.length-eligible-incomplete)return null
 return {period:{month,from,to,timezone:'Asia/Ho_Chi_Minh'},policy:{code:policy.code,version:policy.version,unitPriceVnd:policy.unitPriceVnd,currency:'VND',label:policy.label,distanceFeePerKmVnd:3000,includedDistanceMetres:3000,peakBonusVnd:10000,peakStartMinute:1020,peakEndMinute:1200,dailyThreshold:5,dailyBonusVnd:30000,dayBasis:'CHECK_OUT_AT',peakBasis:'CHECK_IN_AT'},counts:{assignments:assignments.length,eligible,incomplete,excluded:assignments.length-eligible-incomplete},estimateTotalVnd:total,assignments,incentives,breakdown,payout:{status:'NOT_INTEGRATED'},timezone:'Asia/Ho_Chi_Minh'}
 }catch{return null}
}
