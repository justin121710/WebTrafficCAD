/** 轉彎檢核表（CSV 與可列印 HTML） */
import { ResultEntry } from './store';
import { VERDICT_LABEL, verdictOf } from './compute';
import { PATH_KIND_LABEL } from './model';
import { ConflictSeverity } from './analysis';

const SEV: Record<ConflictSeverity, string> = { intrusion: '侵入', clearance: '淨距不足', crossing: '越線' };

const n = (v: number | null | undefined, d = 2) => (v === null || v === undefined || Number.isNaN(v) ? '' : isFinite(v) ? v.toFixed(d) : '∞');

export interface ReportRow {
  path: string;
  kind: string;
  vehicle: string;
  source: string;
  verdict: string;
  length: string;
  maxSteer: string;
  steerLimit: string;
  infeasible: string;
  rf: string;
  rr: string;
  outer: string;
  inner: string;
  wheelOff: string;
  off: string;
  swept: string;
  clearance: string;
  articulation: string;
  deviation: string;
  conflicts: string;
  notes: string;
}

export const REPORT_COLUMNS: [keyof ReportRow, string][] = [
  ['path', '軌跡'], ['kind', '繪製方式'], ['vehicle', '車種'], ['verdict', '判定'], ['length', '路徑長度 m'],
  ['maxSteer', '最大前輪轉角 °'], ['steerLimit', '轉角上限 °'], ['infeasible', '不可行路段 m'],
  ['rf', '最急處前軸半徑 m'], ['rr', '最急處後軸半徑 m'], ['outer', '外側前角半徑 m'], ['inner', '內側後輪半徑 m'],
  ['wheelOff', '內輪差（同側前後輪最大偏移）m'], ['off', '最後一軸偏移 m'], ['swept', '最大掃掠寬度 m'],
  ['clearance', '最小淨距 m'], ['articulation', '拖車最大折角 °'], ['deviation', '最大偏離路徑 m'],
  ['conflicts', '衝突'], ['notes', '說明'], ['source', '車種尺寸出處'],
];

export function buildReportRows(entries: ResultEntry[]): ReportRow[] {
  return entries.filter(e => !e.partial).map(e => {
    const m = e.result.metrics;
    const v = e.result.vehicle;
    return {
      path: e.path.name,
      kind: PATH_KIND_LABEL[e.path.source.kind],
      vehicle: v.name,
      source: v.source,
      verdict: VERDICT_LABEL[verdictOf(e.result)],
      length: n(m.length, 1),
      maxSteer: n(m.maxSteerDeg, 1),
      steerLimit: n(m.steerLimitDeg, 1),
      infeasible: n(m.infeasibleLength, 1),
      rf: n(m.minFrontRadius, 2),
      rr: n(m.minRearRadius, 2),
      outer: n(m.outerCornerRadius, 2),
      inner: n(m.innerRearRadius, 2),
      wheelOff: n(m.wheelOfftracking, 2),
      off: n(m.offtracking, 2),
      swept: n(m.sweptWidth, 2),
      clearance: m.minClearance === null ? '> 3' : n(m.minClearance, 2),
      articulation: v.trailer ? n(m.maxArticulationDeg, 1) : '',
      deviation: e.path.drive.controller === 'limited' ? n(m.maxDeviation, 2) : '',
      conflicts: e.result.conflicts.map(c => `${c.label}${SEV[c.severity]}${c.severity === 'intrusion' ? ` ${c.depth.toFixed(2)} m` : c.severity === 'clearance' ? ` ${c.minDist.toFixed(2)} m` : ''}`).join('；'),
      notes: e.result.messages.join('；'),
    };
  });
}

export function reportCsv(rows: ReportRow[]): string {
  const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const lines = [REPORT_COLUMNS.map(c => esc(c[1])).join(',')];
  rows.forEach(r => lines.push(REPORT_COLUMNS.map(([k]) => esc(r[k])).join(',')));
  return '﻿' + lines.join('\r\n');
}

export function reportHtml(rows: ReportRow[], title: string, settings: { bufferM: number }): string {
  const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
  const cols = REPORT_COLUMNS.filter(([k]) => k !== 'source');
  const sources = Array.from(new Set(rows.map(r => `${r.vehicle}：${r.source}`)));
  return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><title>${esc(title)}－轉彎檢核表</title>
<style>
@page{size:A4 landscape;margin:12mm}
body{font-family:"Noto Sans TC","Microsoft JhengHei",sans-serif;color:#111;font-size:10pt}
h1{font-size:15pt;margin:0 0 4pt}
.meta{color:#555;font-size:9pt;margin-bottom:8pt}
table{border-collapse:collapse;width:100%;font-size:8.5pt}
th,td{border:1px solid #bbb;padding:3pt 4pt;vertical-align:top}
th{background:#eef1f5;text-align:left}
td.v-通過{color:#15803d;font-weight:bold}td.v-注意{color:#b45309;font-weight:bold}
td.v-侵入,td.v-不可行{color:#b91c1c;font-weight:bold}
.note{font-size:8.5pt;color:#444;margin-top:8pt;line-height:1.5}
</style></head><body>
<h1>${esc(title)}－車輛轉彎檢核表</h1>
<div class="meta">產製日期 ${new Date().toISOString().slice(0, 10)}　淨距帶 ${settings.bufferM.toFixed(2)} m　WebTrafficCAD</div>
<table><thead><tr>${cols.map(c => `<th>${esc(c[1])}</th>`).join('')}</tr></thead><tbody>
${rows.map(r => `<tr>${cols.map(([k]) => `<td${k === 'verdict' ? ` class="v-${esc(r.verdict)}"` : ''}>${esc(r[k])}</td>`).join('')}</tr>`).join('\n')}
</tbody></table>
<div class="note"><b>說明：</b>低速運動學（單軌模型）計算，不考慮側滑；適用於路口轉彎、迴轉等低速情境。
內輪差為同側前輪與後輪（或拖車輪）軌跡的最大偏移；迴轉半徑取最大轉角處的瞬時值；最小淨距為掃掠範圍至建築線、人行道（及設定為實體島的槽化線）的最短距離，「&gt; 3」表示 3 m 內沒有障礙物。</div>
<div class="note"><b>車種尺寸出處：</b><br>${sources.map(esc).join('<br>')}</div>
<script>window.onload=()=>setTimeout(()=>window.print(),300)</script>
</body></html>`;
}
