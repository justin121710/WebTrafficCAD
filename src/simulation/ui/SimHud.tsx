import React, { useEffect, useRef, useState } from 'react';
import { Play, Pause, SkipBack, Crosshair, Gauge } from 'lucide-react';
import { useSimPlayS, useSimStore } from '../store';
import { poseAtS } from '../render';
import { radiiFromSteer } from '../kinematics';
import { fmtM } from './fields';

/**
 * 底部播放列＋即時讀數（取代原本四張閃爍卡片）：
 * 只標示超限的項目，不閃爍；掃掠範圍與檢核結果不受播放進度影響。
 */
export default function SimHud({ bottom = 0, polished }: { bottom?: number; polished?: boolean }) {
  const store = useSimStore();
  const playS = useSimPlayS();
  // 依畫布寬度切換精簡模式：窄螢幕只留播放、進度、轉角，其餘讀數收進彈出面板
  const ref = useRef<HTMLDivElement>(null);
  const [avail, setAvail] = useState(1200);
  const [showMore, setShowMore] = useState(false);
  useEffect(() => {
    const parent = ref.current?.parentElement;
    if (!parent || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setAvail(parent.clientWidth));
    ro.observe(parent);
    setAvail(parent.clientWidth);
    return () => ro.disconnect();
  });
  const entry = store.activeResult();
  if (!entry) return <div ref={ref} className="hidden" />;
  const compact = avail < 860;
  const tiny = avail < 520;
  const r = entry.result;
  const poses = r.traj.poses;
  const total = poses[poses.length - 1]?.s ?? 0;
  const pose = poseAtS(poses, playS);
  const steerDeg = pose ? (pose.steer * 180) / Math.PI : 0;
  const over = pose ? !pose.feasible : false;
  const { Rf, Rr } = radiiFromSteer(pose?.steer ?? 0, r.vehicle.L);
  const path = entry.path;
  const firstConflict = r.conflicts.slice().sort((a, b) => a.pose - b.pose)[0];
  const cell = (label: string, value: string, unit: string, bad = false, title?: string) => (
    <div className="flex flex-col items-center px-2 min-w-[64px]" title={title}>
      <span className="text-[10px] whitespace-nowrap" style={{ color: 'var(--ui-muted)' }}>{label}</span>
      <span className="font-mono text-[13px] leading-tight whitespace-nowrap" style={{ color: bad ? '#f87171' : 'var(--ui-text)', fontWeight: bad ? 700 : 500 }}>
        {value}<span className="text-[10px] ml-0.5" style={{ color: 'var(--ui-muted)' }}>{unit}</span>
      </span>
    </div>
  );
  const extra = (
    <>
        {cell('前軸半徑', fmtM(Rf, 1), 'm')}
        {cell('後軸半徑', fmtM(Rr, 1), 'm')}
        {path.drive.controller === 'limited' && cell('偏離路徑', fmtM(pose?.dev ?? 0, 2), 'm', (pose?.dev ?? 0) > 0.5)}
        {pose?.trailer && cell('拖車折角', ((pose.trailer.articulation * 180) / Math.PI).toFixed(1), '°', !!pose.jackknife)}
        {pose?.trailer2 && cell('第二節折角', ((pose.trailer2.articulation * 180) / Math.PI).toFixed(1), '°', !!pose.jackknife)}
        <span className="w-px h-8 shrink-0" style={{ background: 'var(--ui-border)' }} />
        <label className="flex flex-col items-center shrink-0" title="動畫速度：只影響播放，不影響軌跡">
          <span className="text-[10px]" style={{ color: 'var(--ui-muted)' }}>動畫速度</span>
          <select value={store.doc.settings.animKmh} onChange={e => store.setSettings({ animKmh: parseFloat(e.target.value) })}
            className="text-[11px] rounded px-1 py-0.5 outline-none cursor-pointer" style={{ background: 'var(--ui-surface2)', color: 'var(--ui-text)', border: '1px solid var(--ui-border)' }}>
            {[5, 10, 15, 30, 60].map(v => <option key={v} value={v}>{v} km/h</option>)}
          </select>
        </label>
    </>
  );
  const panelStyle = polished ? {} : { background: 'var(--ui-surface)', border: '1px solid var(--ui-border)' };
  return (
    <>
    {compact && showMore && (
      <div id="sim-hud-more-panel" className={`absolute left-1/2 -translate-x-1/2 z-30 flex flex-wrap items-center justify-center gap-2 px-3 py-2 shadow-2xl max-w-[calc(100%-24px)] ${polished ? 'glass rounded-2xl' : 'rounded-xl'}`}
        style={{ bottom: bottom + 44 + 60, ...panelStyle }}>
        {extra}
      </div>
    )}
    <div ref={ref} id="sim-hud" className={`absolute left-1/2 -translate-x-1/2 z-30 flex items-center gap-2 px-3 py-2 shadow-2xl max-w-[calc(100%-24px)] overflow-x-auto ${polished ? 'glass rounded-2xl' : 'rounded-xl'}`}
      style={{ bottom: bottom + 44, ...panelStyle }}>
      <button id="sim-play-btn" onClick={() => store.togglePlay()} title={store.playing ? '暫停（Space）' : '播放（Space）'}
        className={`w-8 h-8 shrink-0 rounded-full flex items-center justify-center cursor-pointer ${polished && store.playing ? 'accent-gradient' : ''}`}
        style={polished && store.playing ? {} : { background: store.playing ? 'var(--ui-accent)' : 'var(--ui-surface2)', color: store.playing ? 'var(--ui-accent-text)' : 'var(--ui-text)' }}>
        {store.playing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
      </button>
      <button onClick={() => { store.stop(); store.setPlayS(0); }} title="回到起點" className="p-1 rounded cursor-pointer hover:bg-white/10" style={{ color: 'var(--ui-muted)' }}><SkipBack className="w-3.5 h-3.5" /></button>
      <div className={`flex flex-col ${tiny ? 'w-20' : 'w-32'} shrink-0`}>
        <input id="sim-progress" type="range" min={0} max={Math.max(0.01, total)} step={0.05} value={Math.min(playS, total)}
          onChange={e => { store.stop(); store.setPlayS(parseFloat(e.target.value)); }} className="w-full" />
        <span className="text-[10px] font-mono text-center" style={{ color: 'var(--ui-muted)' }}>{Math.min(playS, total).toFixed(1)} / {total.toFixed(1)} m</span>
      </div>
      {!tiny && <span className="w-px h-8 shrink-0" style={{ background: 'var(--ui-border)' }} />}
      <div className={`flex-col shrink-0 ${tiny ? 'hidden' : 'flex'}`}>
        <span className="text-[10px] flex items-center gap-1" style={{ color: 'var(--ui-muted)' }}><span className="w-2 h-2 rounded-full inline-block" style={{ background: path.color }} />{path.name}</span>
        {path.vehicleIds.length > 1 ? (
          <select value={entry.vehicleId} onChange={e => store.setUi({ activeVehicleId: e.target.value })} className="text-[11.5px] rounded px-1 py-0.5 outline-none cursor-pointer" style={{ background: 'var(--ui-surface2)', color: 'var(--ui-text)', border: '1px solid var(--ui-border)' }}>
            {path.vehicleIds.map(id => <option key={id} value={id}>{store.vehicle(id).short}</option>)}
          </select>
        ) : <span className="text-[11.5px]">{r.vehicle.short}</span>}
      </div>
      <span className="w-px h-8 shrink-0" style={{ background: 'var(--ui-border)' }} />
      {cell('前輪轉角', `${steerDeg.toFixed(1)} / ${r.vehicle.maxSteerDeg.toFixed(0)}`, '°', over, over ? '超過最大轉角' : '目前轉角／上限')}
      {!compact && extra}
      {compact && (
        <div className="relative shrink-0">
          <button id="sim-hud-more" onClick={() => setShowMore(!showMore)} title="更多讀數" className="p-1.5 rounded-md cursor-pointer" style={{ color: showMore ? 'var(--ui-accent)' : 'var(--ui-muted)', border: '1px solid var(--ui-border)' }}>
            <Gauge className="w-4 h-4" />
          </button>
        </div>
      )}
      {firstConflict && (
        <button onClick={() => { store.stop(); store.requestFocus(firstConflict.at); const p = poses[Math.min(firstConflict.pose, poses.length - 1)]; if (p) store.setPlayS(p.s); }}
          className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] cursor-pointer shrink-0" title="跳到第一個衝突位置"
          style={{ color: firstConflict.severity === 'intrusion' ? '#f87171' : '#fbbf24', border: '1px solid var(--ui-border)' }}>
          <Crosshair className="w-3.5 h-3.5" /> {r.conflicts.length} 處
        </button>
      )}
      {entry.partial && <span className="text-[10.5px] shrink-0" style={{ color: 'var(--ui-muted)' }}>計算中…</span>}
    </div>
    </>
  );
}
