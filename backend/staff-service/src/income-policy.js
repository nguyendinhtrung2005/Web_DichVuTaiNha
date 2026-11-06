/** Approved by Staff website owner on 2026-11-04 FOR DEMONSTRATION ONLY. */
export const DEMO_INCOME_POLICY = Object.freeze({ code:'ESTIMATE_FOR_DEMO', version:'DEMO_V2', unitPriceVnd:60000, currency:'VND', label:'Tiền công dự kiến — chính sách minh họa 60.000đ/công việc + phụ phí/thưởng đủ điều kiện', distanceFeePerKmVnd:3000, includedDistanceMetres:3000, peakBonusVnd:10000, peakStartMinute:1020, peakEndMinute:1200, dailyThreshold:5, dailyBonusVnd:30000, dayBasis:'CHECK_OUT_AT', peakBasis:'CHECK_IN_AT' })
export const incomeDemoEnabled = (env=process.env) => env.NODE_ENV==='development' && env.STAFF_INCOME_DEMO_ENABLED==='true'
function validTime(value){return typeof value==='string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString()===value}
export function calculateIncomeLine(assignment, distanceEvidence=null, policy=DEMO_INCOME_POLICY) {
 if(assignment.status!=='DONE'||!validTime(assignment.checkInAt)||!validTime(assignment.checkOutAt)||assignment.checkOutAt<assignment.checkInAt)return null
 const start=new Date(Date.parse(assignment.checkInAt)+7*3600000), day=new Date(Date.parse(assignment.checkOutAt)+7*3600000).toISOString().slice(0,10), minute=start.getUTCHours()*60+start.getUTCMinutes()
 const baseVnd=policy.unitPriceVnd, peakVnd=minute>=policy.peakStartMinute&&minute<policy.peakEndMinute?policy.peakBonusVnd:0
 let distanceVnd=null,distanceStatus='UNVERIFIED',distanceKm=null
 if(distanceEvidence?.verified===true){if(typeof distanceEvidence.kilometres==='string'&&/^\d{1,6}(?:\.\d{1,3})?$/.test(distanceEvidence.kilometres)){const[whole,fraction='']=distanceEvidence.kilometres.split('.');const metres=BigInt(whole)*1000n+BigInt(fraction.padEnd(3,'0'));const chargeable=metres>BigInt(policy.includedDistanceMetres)?metres-BigInt(policy.includedDistanceMetres):0n;const charge=chargeable*BigInt(policy.distanceFeePerKmVnd)/1000n;if(charge>BigInt(Number.MAX_SAFE_INTEGER))throw Error('INCOME_OVERFLOW');distanceVnd=Number(charge);distanceKm=distanceEvidence.kilometres;distanceStatus='VERIFIED'}else distanceStatus='INVALID'}
 const totalVnd=baseVnd+peakVnd+(distanceVnd??0);if(!Number.isSafeInteger(totalVnd))throw Error('INCOME_OVERFLOW')
 return {day,baseVnd,peakVnd,distanceVnd,distanceStatus,distanceKm,totalVnd}
}
export function summarizeIncomeLines(assignments,policy=DEMO_INCOME_POLICY) {
 const days=new Map();let baseVnd=0,peakVnd=0,distanceVnd=0,unverifiedDistance=0
 for(const row of assignments)if(row.eligible&&row.detail){const detail=row.detail;baseVnd+=detail.baseVnd;peakVnd+=detail.peakVnd;distanceVnd+=detail.distanceVnd??0;if(detail.distanceStatus!=='VERIFIED')unverifiedDistance++;days.set(detail.day,(days.get(detail.day)||0)+1)}
 const incentives=[...days].filter(([,count])=>count>=policy.dailyThreshold).sort(([a],[b])=>a.localeCompare(b)).map(([day,eligibleCount])=>({day,eligibleCount,amountVnd:policy.dailyBonusVnd}))
 const incentiveVnd=incentives.reduce((sum,row)=>sum+row.amountVnd,0),estimateTotalVnd=baseVnd+peakVnd+distanceVnd+incentiveVnd;if(!Number.isSafeInteger(estimateTotalVnd))throw Error('INCOME_OVERFLOW')
 return {breakdown:{baseVnd,peakVnd,distanceVnd,incentiveVnd,unverifiedDistance},incentives,estimateTotalVnd}
}
