import { incomeMonthBounds, validIncomeMonth, type StaffIncomeEstimate } from "./staff-income-remote-model"
export type IncomeBucket={ day:string;eligible:number;amountVnd:number;baseVnd:number;peakVnd:number;distanceVnd:number;incentiveVnd:number; incomplete?: boolean }
export type IncomeSource='amountVnd'|'baseVnd'|'peakVnd'|'distanceVnd'|'incentiveVnd'
/** Reconcile API amounts only; never derive an official pay policy or payment. */
export function incomeStatementReconciliation(estimate:StaffIncomeEstimate){
 const eligible=estimate.assignments.filter(row=>row.eligible)
 let assignmentVnd=0,incentiveVnd=0
 for(const row of eligible){if(estimate.policy.version==='DEMO_V2'&&!row.detail)throw Error('INCOME_DETAIL_MISSING');assignmentVnd+=row.detail?.totalVnd??estimate.policy.unitPriceVnd}
 for(const row of estimate.incentives||[])incentiveVnd+=row.amountVnd
 const totalVnd=assignmentVnd+incentiveVnd
 if(![assignmentVnd,incentiveVnd,totalVnd].every(value=>Number.isSafeInteger(value)&&value>=0)||totalVnd!==estimate.estimateTotalVnd||eligible.length!==estimate.counts.eligible)throw Error('INCOME_TOTAL_MISMATCH')
 return {assignmentVnd,incentiveVnd,totalVnd,eligible:eligible.length}
}
/** V2 groups by verified check-out in UTC+7. V1 remains explicitly scheduled-month legacy data. */
export function incomeDailySeries(estimate:StaffIncomeEstimate):IncomeBucket[]{
 const days=new Map<string,IncomeBucket>(),start=Date.parse(estimate.period.from+'T00:00:00.000Z'),end=Date.parse(estimate.period.to+'T00:00:00.000Z')
 for(let stamp=start;stamp<=end;stamp+=86400000){const day=new Date(stamp).toISOString().slice(0,10);days.set(day,{day,eligible:0,amountVnd:0,baseVnd:0,peakVnd:0,distanceVnd:0,incentiveVnd:0,incomplete:estimate.counts.incomplete>0})}
 for(const row of estimate.assignments)if(row.eligible){if(estimate.policy.version==='DEMO_V2'&&!row.detail)throw Error('INCOME_DETAIL_MISSING');const detail=row.detail,day=detail?.day||new Date(Date.parse(row.scheduledStart)+7*3600000).toISOString().slice(0,10),bucket=days.get(day);if(!bucket)throw Error('OUTSIDE_INCOME_PERIOD');bucket.eligible++;bucket.baseVnd+=detail?.baseVnd??estimate.policy.unitPriceVnd;bucket.peakVnd+=detail?.peakVnd??0;bucket.distanceVnd+=detail?.distanceVnd??0;bucket.amountVnd+=detail?.totalVnd??estimate.policy.unitPriceVnd}
 for(const incentive of estimate.incentives||[]){const bucket=days.get(incentive.day);if(!bucket)throw Error('OUTSIDE_INCENTIVE_PERIOD');bucket.incentiveVnd+=incentive.amountVnd;bucket.amountVnd+=incentive.amountVnd}
 const result=[...days.values()];if(result.reduce((n,row)=>n+row.amountVnd,0)!==estimate.estimateTotalVnd)throw Error('INCOME_TOTAL_MISMATCH');return result
}
export function groupIncomeSeries(rows:readonly IncomeBucket[],period:'day'|'week'|'month'):IncomeBucket[]{
 if(!['day','week','month'].includes(period))throw Error('INVALID_INCOME_PERIOD');const groups=new Map<string,IncomeBucket>()
 for(const row of rows){let key=row.day;if(period==='month')key=key.slice(0,7);if(period==='week'){const date=new Date(key+'T00:00:00.000Z');date.setUTCDate(date.getUTCDate()-(date.getUTCDay()+6)%7);key=date.toISOString().slice(0,10)}const group=groups.get(key)||{day:key,eligible:0,amountVnd:0,baseVnd:0,peakVnd:0,distanceVnd:0,incentiveVnd:0};for(const field of ['eligible','amountVnd','baseVnd','peakVnd','distanceVnd','incentiveVnd'] as const){group[field]+=row[field];if(!Number.isSafeInteger(group[field]))throw Error('UNSAFE_INCOME_TOTAL')}group.incomplete=!!(group.incomplete||row.incomplete);groups.set(key,group)}return [...groups.values()]
}

export type IncomePeriod = 'day' | 'week' | 'month'
export type IncomeHistorySpan = 1 | 3 | 6 | 12
export function shiftIncomeHistoryMonth(month: string, offset: number): string | null {
 if(!validIncomeMonth(month)||!Number.isInteger(offset)||Math.abs(offset)>12)return null
 const result=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7))-1+offset,1)).toISOString().slice(0,7)
 return validIncomeMonth(result)?result:null
}
/** Calendar months ending at the selected month. No hidden prefetch or fabricated months. */
export function incomeHistoryMonths(end: string, span: number): string[] {
 if(![1,3,6,12].includes(span)||!validIncomeMonth(end))throw Error('INVALID_INCOME_RANGE')
 const months=Array.from({length:span},(_,index)=>shiftIncomeHistoryMonth(end,index-span+1))
 if(months.some(month=>month===null))throw Error('INVALID_INCOME_RANGE')
 return months as string[]
}
export function incomeHistorySeries(estimates: readonly StaffIncomeEstimate[]): IncomeBucket[] {
 if(!estimates.length||estimates.length>12)throw Error('INVALID_INCOME_RANGE')
 const months=new Set<string>(),assignments=new Set<string>(),rows:IncomeBucket[]=[]
 const version=estimates[0].policy.version
 for(const estimate of [...estimates].sort((a,b)=>a.period.month.localeCompare(b.period.month))){
  if(months.has(estimate.period.month)||estimate.policy.version!==version)throw Error('INCOME_PERIOD_MISMATCH')
  months.add(estimate.period.month);incomeStatementReconciliation(estimate)
  // A DONE assignment may appear as excluded in its scheduled month; count its completion once.
  for(const row of estimate.assignments)if(row.eligible){if(assignments.has(row.id))throw Error('DUPLICATE_INCOME_ASSIGNMENT');assignments.add(row.id)}
  rows.push(...incomeDailySeries(estimate))
 }
 const total=rows.reduce((sum,row)=>sum+row.amountVnd,0)
 if(!Number.isSafeInteger(total))throw Error('UNSAFE_INCOME_TOTAL')
 return rows
}
/** A zero-based, integral VND axis with at most five intervals and proportional bar heights. */
export function incomeAxis(maximum: number) {
 if(!Number.isSafeInteger(maximum)||maximum<0)throw Error('INVALID_INCOME_AMOUNT')
 const raw=maximum?maximum/4:50000,power=10**Math.floor(Math.log10(Math.max(1,raw)))
 const step=Math.max(1,Math.ceil(([1,2,2.5,5,10].find(value=>value*power>=raw)??10)*power))
 const max=maximum?Math.ceil(maximum/step)*step:200000
 return {max,step,ticks:Array.from({length:Math.round(max/step)+1},(_,index)=>index*step)}
}
export function incomeBucketBounds(key: string, period: IncomePeriod, from: string, to: string) {
 const start=period==='month'?key+'-01':key
 const end=period==='month'?incomeMonthBounds(key).to:period==='week'?new Date(Date.parse(key+'T00:00:00Z')+6*86400000).toISOString().slice(0,10):key
 return {from:start<from?from:start,to:end>to?to:end}
}
