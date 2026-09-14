import { useState, useEffect, useRef, useCallback } from 'react';
import {
  gasViscosity, inletPressureForFlow, columnLinearVelocity, columnOutletFlow_mLmin,
  holdUpTime_s, ovenTemp_C, programRunTime, simulateChromatogram, resolution,
  type OvenProgram, type OvenRamp, type SimMethod, type SimPeak, type ChromSim,
} from './physics';
import {
  COLUMNS, ANALYTES, SAMPLE_MIXTURES,
  DEFAULT_METHOD, DEFAULT_OVEN,
  type GCColumn,
} from './gcData';

// ─── Types ───────────────────────────────────────────────────────────────────

type RunState = 'OFF' | 'STANDBY' | 'READY' | 'EQUILIBRATING' | 'IGNITING' | 'RUNNING' | 'POSTRUN' | 'COOLING';
type Panel = 'workflow' | 'dashboard' | 'method' | 'sequence' | 'live' | 'data' | 'diagnostics' | 'maintenance' | 'audit';
type MethodTab = 'epc' | 'injector' | 'oven' | 'column' | 'detector' | 'sample';

interface SequenceEntry {
  id: number; vial: number; name: string; method: string;
  type: 'Blank' | 'Std' | 'Sample' | 'QC' | 'SST' | 'Wash';
  injections: number; status: 'Pending' | 'Running' | 'Done' | 'Failed' | 'Skipped';
}

interface Fault { id: string; severity: 'Critical' | 'Warning' | 'Info'; message: string; time: string; }

interface MaintenanceItem { name: string; count: number; maxCount: number; condition: number; warning: number; }

// ─── Helpers ─────────────────────────────────────────────────────────────────

const fmt = (v: number, d = 2) => v.toFixed(d);
const fmtTime = (s: number) => {
  const m = Math.floor(s / 60); const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
};
const now = () => new Date().toLocaleTimeString();

function StatusDot({ color }: { color: string }) {
  return <span className="status-dot" style={{ background: color, boxShadow: `0 0 6px ${color}` }} />;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="section-label mb-2">{children}</div>;
}

function ValueCard({ label, value, unit, color = 'var(--cyan)' }: { label: string; value: string | number; unit?: string; color?: string }) {
  return (
    <div className="panel-card p-3">
      <div className="section-label mb-1">{label}</div>
      <div className="flex items-baseline gap-1">
        <span className="mono text-lg font-semibold" style={{ color }}>{value}</span>
        {unit && <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{unit}</span>}
      </div>
    </div>
  );
}

function GaugeBar({ value, max, color = 'var(--cyan)' }: { value: number; max: number; color?: string }) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100));
  return (
    <div className="h-1.5 rounded-full" style={{ background: 'var(--bg-secondary)' }}>
      <div className="h-1.5 rounded-full transition-all duration-300" style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}

// ─── Hardware Diagram (GC Flow Path) ─────────────────────────────────────────

function HardwareDiagram({ runState, method, column, ovenTempNow, fidSignal, Pi_kPa, flowNow, flameOn, setPanel }:
  { runState: RunState; method: SimMethod; column: GCColumn; ovenTempNow: number; fidSignal: number; Pi_kPa: number; flowNow: number; flameOn: boolean; setPanel: (p: Panel) => void }) {

  const isRunning = runState === 'RUNNING';
  const isReady = runState === 'READY' || isRunning;
  const flowColor = isReady ? 'var(--cyan)' : 'var(--text-dim)';

  return (
    <div className="flex flex-col items-center w-full h-full overflow-y-auto py-4" style={{ gap: 0 }}>
      <svg width="320" viewBox="0 0 320 1060" style={{ overflow: 'visible' }}>
        <defs>
          <marker id="arr" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto">
            <path d="M0,0 L6,3 L0,6 Z" fill={flowColor} />
          </marker>
          <filter id="glow-c">
            <feGaussianBlur stdDeviation="2" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>

        {/* ── Gas Cylinder ── */}
        <g onClick={() => setPanel('method')} style={{ cursor: 'pointer' }}>
          <rect x="30" y="20" width="70" height="100" rx="8" fill="var(--bg-card)" stroke={isReady ? 'var(--border-bright)' : 'var(--border)'} strokeWidth="1" />
          <ellipse cx="65" cy="24" rx="35" ry="10" fill="var(--bg-card)" stroke={isReady ? 'var(--border-bright)' : 'var(--border)'} strokeWidth="1" />
          <ellipse cx="65" cy="20" rx="35" ry="10" fill="var(--bg-panel)" stroke={isReady ? 'var(--border-bright)' : 'var(--border)'} strokeWidth="1" />
          <text x="65" y="72" textAnchor="middle" fill={isReady ? 'var(--cyan)' : 'var(--text-muted)'} fontSize="18" fontFamily="JetBrains Mono" fontWeight="700">{method.carrier}</text>
          <text x="65" y="90" textAnchor="middle" fill="var(--text-muted)" fontSize="9" fontFamily="Inter">CARRIER GAS</text>
          <text x="65" y="104" textAnchor="middle" fill="var(--text-secondary)" fontSize="9" fontFamily="JetBrains Mono">98.7%</text>
          <text x="110" y="75" textAnchor="start" fill="var(--text-secondary)" fontSize="9" fontFamily="Inter">Gas Cylinder</text>
          <line x1="108" y1="68" x2="130" y2="65" stroke="var(--border)" strokeWidth="0.5" />
        </g>

        {/* flow line down */}
        <line x1="65" y1="120" x2="65" y2="155" stroke={flowColor} strokeWidth="1.5" strokeDasharray={isRunning ? '4 3' : '0'}>
          {isRunning && <animate attributeName="strokeDashoffset" from="7" to="0" dur="0.6s" repeatCount="indefinite" />}
        </line>

        {/* ── Regulator ── */}
        <g onClick={() => setPanel('method')} style={{ cursor: 'pointer' }}>
          <rect x="30" y="155" width="70" height="55" rx="6" fill="var(--bg-card)" stroke="var(--border)" strokeWidth="1" />
          <text x="65" y="175" textAnchor="middle" fill="var(--text-secondary)" fontSize="9" fontFamily="Inter" fontWeight="600">REGULATOR</text>
          <text x="65" y="192" textAnchor="middle" fill="var(--cyan)" fontSize="11" fontFamily="JetBrains Mono">650 kPa</text>
          <text x="108" y="183" fill="var(--text-secondary)" fontSize="9" fontFamily="Inter">2-Stage Reg.</text>
          <line x1="100" y1="182" x2="110" y2="182" stroke="var(--border)" strokeWidth="0.5" />
        </g>

        <line x1="65" y1="210" x2="65" y2="245" stroke={flowColor} strokeWidth="1.5" strokeDasharray={isRunning ? '4 3' : '0'}>
          {isRunning && <animate attributeName="strokeDashoffset" from="7" to="0" dur="0.6s" repeatCount="indefinite" />}
        </line>

        {/* ── EPC Module ── */}
        <g onClick={() => setPanel('method')} style={{ cursor: 'pointer' }}>
          <rect x="20" y="245" width="90" height="75" rx="6" fill="var(--bg-card)" stroke={isReady ? 'var(--border-bright)' : 'var(--border)'} strokeWidth="1" />
          <text x="65" y="265" textAnchor="middle" fill="var(--text-secondary)" fontSize="9" fontFamily="Inter" fontWeight="600">EPC MODULE</text>
          <text x="65" y="282" textAnchor="middle" fill="var(--cyan)" fontSize="10" fontFamily="JetBrains Mono">{fmt(Pi_kPa)} kPa</text>
          <text x="65" y="298" textAnchor="middle" fill="var(--text-secondary)" fontSize="10" fontFamily="JetBrains Mono">{fmt(flowNow, 3)} mL/min</text>
          <text x="65" y="311" textAnchor="middle" fill="var(--text-muted)" fontSize="8" fontFamily="Inter">Const. Flow Mode</text>
          <text x="115" y="280" fill="var(--text-secondary)" fontSize="9" fontFamily="Inter">Pneumatics</text>
          <line x1="110" y1="282" x2="115" y2="280" stroke="var(--border)" strokeWidth="0.5" />
        </g>

        {/* split line */}
        <line x1="110" y1="282" x2="200" y2="282" stroke="var(--border)" strokeWidth="1" strokeDasharray="3 3" />
        <text x="205" y="286" fill="var(--text-muted)" fontSize="8" fontFamily="Inter">Split vent</text>

        <line x1="65" y1="320" x2="65" y2="355" stroke={flowColor} strokeWidth="1.5" strokeDasharray={isRunning ? '4 3' : '0'}>
          {isRunning && <animate attributeName="strokeDashoffset" from="7" to="0" dur="0.6s" repeatCount="indefinite" />}
        </line>

        {/* ── Injector ── */}
        <g onClick={() => setPanel('method')} style={{ cursor: 'pointer' }}>
          <rect x="20" y="355" width="90" height="80" rx="6" fill="var(--bg-card)" stroke={isReady ? 'var(--border-bright)' : 'var(--border)'} strokeWidth="1" />
          <text x="65" y="375" textAnchor="middle" fill="var(--text-secondary)" fontSize="9" fontFamily="Inter" fontWeight="600">SSL INJECTOR</text>
          <rect x="55" y="380" width="20" height="35" rx="3" fill="var(--bg-secondary)" stroke="var(--border-bright)" strokeWidth="1" />
          <ellipse cx="65" cy="380" rx="10" ry="4" fill="var(--bg-panel)" stroke="var(--border-bright)" strokeWidth="1" />
          <text x="65" y="407" textAnchor="middle" fill="var(--cyan)" fontSize="10" fontFamily="JetBrains Mono">{method.inletTemp}°C</text>
          <text x="65" y="423" textAnchor="middle" fill="var(--text-muted)" fontSize="8" fontFamily="Inter">{method.splitRatio > 0 ? `Split ${method.splitRatio}:1` : 'Splitless'}</text>
          <text x="115" y="390" fill="var(--text-secondary)" fontSize="9" fontFamily="Inter">Liner / Septum</text>
          <line x1="110" y1="395" x2="115" y2="390" stroke="var(--border)" strokeWidth="0.5" />
        </g>

        <line x1="65" y1="435" x2="65" y2="475" stroke={flowColor} strokeWidth="1.5" strokeDasharray={isRunning ? '4 3' : '0'}>
          {isRunning && <animate attributeName="strokeDashoffset" from="7" to="0" dur="0.6s" repeatCount="indefinite" />}
        </line>

        {/* ── Column Oven ── */}
        <g onClick={() => setPanel('method')} style={{ cursor: 'pointer' }}>
          <rect x="10" y="475" width="155" height="130" rx="8" fill="var(--bg-panel)" stroke={isReady ? 'var(--cyan)' : 'var(--border)'} strokeWidth="1.5"
            filter={isReady ? 'url(#glow-c)' : undefined} />
          <text x="88" y="496" textAnchor="middle" fill="var(--text-secondary)" fontSize="9" fontFamily="Inter" fontWeight="600">COLUMN OVEN</text>
          <text x="88" y="515" textAnchor="middle" fill={isReady ? 'var(--cyan)' : 'var(--text-muted)'} fontSize="16" fontFamily="JetBrains Mono" fontWeight="600">{fmt(ovenTempNow, 1)}°C</text>
          {/* Column coil */}
          {[0,1,2,3,4,5].map(i => (
            <ellipse key={i} cx="88" cy={540 + i * 8} rx="55" ry="6"
              fill="none" stroke={isReady ? 'var(--cyan)' : 'var(--text-dim)'}
              strokeWidth={isReady ? '1.5' : '1'} opacity={0.6 - i * 0.05} />
          ))}
          <text x="88" y="595" textAnchor="middle" fill="var(--text-secondary)" fontSize="8" fontFamily="Inter">{column.name} · {column.length}m × {column.innerDiameter}mm</text>
        </g>

        <line x1="88" y1="605" x2="88" y2="640" stroke={flowColor} strokeWidth="1.5" strokeDasharray={isRunning ? '4 3' : '0'} markerEnd="url(#arr)">
          {isRunning && <animate attributeName="strokeDashoffset" from="7" to="0" dur="0.6s" repeatCount="indefinite" />}
        </line>

        {/* ── FID Detector ── */}
        <g onClick={() => setPanel('method')} style={{ cursor: 'pointer' }}>
          <rect x="20" y="640" width="130" height="90" rx="8" fill="var(--bg-card)" stroke={flameOn ? 'rgba(255,179,64,0.5)' : 'var(--border)'} strokeWidth="1.5" />
          <text x="85" y="660" textAnchor="middle" fill="var(--text-secondary)" fontSize="9" fontFamily="Inter" fontWeight="600">FID DETECTOR</text>
          {/* flame */}
          <ellipse cx="85" cy="695" rx="12" ry="18" fill={flameOn ? 'rgba(255,179,64,0.15)' : 'transparent'} />
          <path d="M85,715 C80,705 78,698 82,690 C83,686 85,682 85,678 C85,682 87,686 88,690 C92,698 90,705 85,715Z"
            fill={flameOn ? 'var(--amber)' : 'var(--text-dim)'}
            style={flameOn ? { filter: 'drop-shadow(0 0 4px var(--amber))' } : {}} />
          <text x="110" y="685" fill="var(--text-secondary)" fontSize="8" fontFamily="Inter">{fmt(method.fidTemperature)}°C</text>
          <text x="110" y="698" fill={flameOn ? 'var(--amber)' : 'var(--text-muted)'} fontSize="8" fontFamily="JetBrains Mono">{fmt(fidSignal, 1)} pA</text>
          <text x="85" y="724" textAnchor="middle" fill={flameOn ? 'var(--amber)' : 'var(--red)'} fontSize="8" fontFamily="Inter">{flameOn ? 'FLAME ON' : 'FLAME OFF'}</text>
        </g>

        {/* Electrometer line to Data System */}
        <line x1="150" y1="685" x2="230" y2="685" stroke="rgba(0,212,255,0.3)" strokeWidth="1" strokeDasharray="4 2" />

        {/* ── Data System ── */}
        <g onClick={() => setPanel('live')} style={{ cursor: 'pointer' }}>
          <rect x="225" y="650" width="85" height="70" rx="8" fill="var(--bg-card)" stroke="var(--border-bright)" strokeWidth="1" />
          <rect x="233" y="660" width="69" height="42" rx="4" fill="var(--bg-secondary)" stroke="var(--border)" strokeWidth="0.5" />
          {/* mini chromatogram */}
          <polyline points="237,695 247,693 252,688 257,692 262,680 267,683 272,690 277,686 282,689 290,692 296,691"
            fill="none" stroke="var(--cyan)" strokeWidth="1.5" />
          <text x="267" y="714" textAnchor="middle" fill="var(--text-muted)" fontSize="8" fontFamily="Inter">Data System</text>
        </g>
      </svg>
    </div>
  );
}

// ─── Navigation Drawer ────────────────────────────────────────────────────────

function NavDrawer({ open, onClose, activePanel, setPanel, runState, role, setRole }:
  { open: boolean; onClose: () => void; activePanel: Panel; setPanel: (p: Panel) => void; runState: RunState; role: string; setRole: (r: string) => void }) {
  if (!open) return null;

  const items: { panel: Panel; icon: string; label: string }[] = [
    { panel: 'dashboard',    icon: '⬡', label: 'Dashboard' },
    { panel: 'method',       icon: '⚙', label: 'Method Setup' },
    { panel: 'sequence',     icon: '≡', label: 'Sequence' },
    { panel: 'live',         icon: '▶', label: 'Live Analysis' },
    { panel: 'data',         icon: '📊', label: 'Data Analysis' },
    { panel: 'diagnostics',  icon: '🔧', label: 'Diagnostics' },
    { panel: 'maintenance',  icon: '🔩', label: 'Maintenance' },
    { panel: 'audit',        icon: '📋', label: 'Audit Trail' },
  ];

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="drawer-open w-72 h-full flex flex-col" style={{ background: 'var(--bg-secondary)', borderRight: '1px solid var(--border)' }}>
        <div className="flex items-center justify-between p-4" style={{ borderBottom: '1px solid var(--border)' }}>
          <button onClick={onClose} style={{ color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 16 }}>✕</button>
        </div>

        <div className="p-4 overflow-y-auto flex-1">
          <div className="section-label mb-2">SYSTEM</div>
          <button onClick={() => { setPanel('workflow'); onClose(); }}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm mb-1"
            style={{ background: activePanel === 'workflow' ? 'rgba(0,212,255,0.12)' : 'transparent',
              color: activePanel === 'workflow' ? 'var(--cyan)' : 'var(--text-secondary)',
              border: activePanel === 'workflow' ? '1px solid var(--border-bright)' : '1px solid transparent', cursor: 'pointer' }}>
            <span>⏻</span> Power & Workflow
          </button>

          <div className="section-label mt-4 mb-2">CONTROL STATION</div>
          {items.map(item => (
            <button key={item.panel} onClick={() => { setPanel(item.panel); onClose(); }}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm mb-1"
              style={{ background: activePanel === item.panel ? 'rgba(0,212,255,0.12)' : 'transparent',
                color: activePanel === item.panel ? 'var(--cyan)' : 'var(--text-secondary)',
                border: activePanel === item.panel ? '1px solid var(--border-bright)' : '1px solid transparent', cursor: 'pointer' }}>
              <span style={{ opacity: 0.7 }}>{item.icon}</span> {item.label}
            </button>
          ))}

          <div className="section-label mt-4 mb-2">OPERATOR ROLE</div>
          {['Analyst', 'Method Dev', 'Admin/QA'].map(r => (
            <button key={r} onClick={() => setRole(r)}
              className="w-full px-3 py-2 rounded-lg text-sm mb-1 text-left"
              style={{ background: role === r ? 'rgba(255,179,64,0.1)' : 'transparent',
                border: `1px solid ${role === r ? 'rgba(255,179,64,0.4)' : 'var(--border)'}`,
                color: role === r ? 'var(--amber)' : 'var(--text-secondary)', cursor: 'pointer', fontWeight: role === r ? 600 : 400 }}>
              {r}
            </button>
          ))}
        </div>

        <div className="p-4" style={{ borderTop: '1px solid var(--border)' }}>
          <div className="mono text-xs" style={{ color: 'var(--text-muted)' }}>GC-2600 CDS v3.1.4</div>
          <div className="mono text-xs" style={{ color: 'var(--text-dim)' }}>SN: GC-2024-08-001</div>
        </div>
      </div>
      <div className="flex-1" onClick={onClose} />
    </div>
  );
}

// ─── Workflow Panel ────────────────────────────────────────────────────────────

function WorkflowPanel({ runState, powerOn, onPowerOn, onIgnite, onRun, flameOn, faults }:
  { runState: RunState; powerOn: boolean; onPowerOn: () => void; onIgnite: () => void; onRun: () => void; flameOn: boolean; faults: Fault[] }) {
  const steps = [
    { n: 1, title: 'Power On Instrument', desc: 'Switch system on from button above.', done: powerOn, action: null },
    { n: 2, title: 'Leak Check / Gas Stabilise', desc: 'Purge carrier gas lines, confirm no leaks. Wait for EPC ready.', done: runState !== 'OFF' && runState !== 'STANDBY', action: null },
    { n: 3, title: 'Oven Equilibration', desc: 'Allow column oven to reach initial temperature setpoint.', done: runState === 'READY' || runState === 'RUNNING', action: null },
    { n: 4, title: 'FID Ignition', desc: 'Ignite hydrogen flame. Verify stable >5 pA baseline.', done: flameOn, action: powerOn && runState !== 'OFF' ? onIgnite : null },
    { n: 5, title: 'Load Sequence & Run', desc: 'Configure sequence, load sample vials, start analysis.', done: runState === 'RUNNING', action: flameOn ? onRun : null },
  ];

  return (
    <div className="p-4 overflow-y-auto h-full">
      <div className="text-lg font-semibold mb-1" style={{ color: 'var(--cyan)' }}>Power &amp; Workflow</div>
      <div className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>Follow steps in order after powering on the instrument.</div>

      <div className="panel-card p-4 mb-4">
        <div className="section-label mb-3">INSTRUMENT POWER</div>
        <div className="flex items-center gap-4">
          <button onClick={onPowerOn} className="w-20 h-20 rounded-full flex items-center justify-center text-2xl"
            style={{ background: powerOn ? 'rgba(0,255,136,0.1)' : 'rgba(255,255,255,0.05)',
              border: `3px solid ${powerOn ? 'var(--green)' : 'var(--border)'}`,
              boxShadow: powerOn ? '0 0 20px rgba(0,255,136,0.3)' : 'none', cursor: 'pointer' }}>
            ⏻
          </button>
          <div>
            <div className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>SYSTEM</div>
            <div className="text-lg font-bold mono" style={{ color: powerOn ? 'var(--green)' : 'var(--text-muted)' }}>
              {powerOn ? 'POWERED ON' : 'POWERED OFF'}
            </div>
            <div className="text-xs mono mt-1" style={{ color: 'var(--text-muted)' }}>{runState}</div>
          </div>
        </div>
      </div>

      <div className="section-label mb-2">STARTUP WORKFLOW</div>
      <div className="flex flex-col gap-2">
        {steps.map(step => (
          <div key={step.n} className="panel-card p-4" style={{ borderColor: step.done ? 'rgba(0,255,136,0.25)' : 'var(--border)', background: step.done ? 'rgba(0,255,136,0.04)' : 'var(--bg-card)' }}>
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-sm font-bold"
                style={{ background: step.done ? 'var(--green)' : 'var(--bg-secondary)', color: step.done ? '#000' : 'var(--text-muted)', border: step.done ? 'none' : '1px solid var(--border)' }}>
                {step.done ? '✓' : step.n}
              </div>
              <div className="flex-1">
                <div className="font-semibold text-sm mb-0.5" style={{ color: 'var(--text-primary)' }}>{step.title}</div>
                <div className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>{step.desc}</div>
                {step.action && !step.done && (
                  <button onClick={step.action} className="btn-cyan text-xs py-1.5 px-3">{step.n === 4 ? 'Ignite FID' : 'Start Run'}</button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {faults.length > 0 && (
        <div className="mt-4">
          <div className="section-label mb-2">ACTIVE FAULTS</div>
          {faults.map(f => (
            <div key={f.id} className="panel-card px-3 py-2 mb-1 flex items-center gap-2">
              <StatusDot color={f.severity === 'Critical' ? 'var(--red)' : f.severity === 'Warning' ? 'var(--amber)' : 'var(--cyan)'} />
              <span className="text-xs flex-1" style={{ color: 'var(--text-secondary)' }}>{f.message}</span>
              <span className="mono text-xs" style={{ color: 'var(--text-muted)' }}>{f.time}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Oven Program Editor ───────────────────────────────────────────────────────

function OvenProgramEditor({ oven, setOven }: { oven: OvenProgram; setOven: (o: OvenProgram) => void }) {
  const totalTime = programRunTime(oven);

  const updateRamp = (i: number, key: keyof OvenRamp, val: number) => {
    const ramps = [...oven.ramps];
    ramps[i] = { ...ramps[i], [key]: val };
    setOven({ ...oven, ramps });
  };
  const addRamp = () => {
    const lastT = oven.ramps.length ? oven.ramps[oven.ramps.length - 1].finalTemp : oven.initialTemp;
    setOven({ ...oven, ramps: [...oven.ramps, { rate: 10, finalTemp: lastT + 50, hold: 2 }] });
  };
  const removeRamp = (i: number) => {
    const ramps = oven.ramps.filter((_, j) => j !== i);
    setOven({ ...oven, ramps });
  };

  // Build temperature profile for mini-chart
  const chartPts: { t: number; T: number }[] = [];
  for (let t = 0; t <= totalTime; t += totalTime / 80) {
    chartPts.push({ t, T: ovenTemp_C(oven, t) });
  }
  const minT = oven.initialTemp - 10;
  const maxT = Math.max(...oven.ramps.map(r => r.finalTemp)) + 10;
  const toX = (t: number) => 20 + (t / totalTime) * 260;
  const toY = (T: number) => 85 - ((T - minT) / (maxT - minT)) * 65;
  const path = chartPts.map((p, i) => `${i === 0 ? 'M' : 'L'}${toX(p.t).toFixed(1)},${toY(p.T).toFixed(1)}`).join(' ');

  return (
    <div>
      <SectionLabel>OVEN TEMPERATURE PROGRAM</SectionLabel>
      {/* Mini chart */}
      <div className="panel-card p-2 mb-3" style={{ borderColor: 'var(--border-bright)' }}>
        <svg width="100%" viewBox="0 0 300 95">
          <line x1="20" y1="5" x2="20" y2="90" stroke="var(--border)" strokeWidth="0.5" />
          <line x1="20" y1="90" x2="290" y2="90" stroke="var(--border)" strokeWidth="0.5" />
          <path d={path} fill="none" stroke="var(--cyan)" strokeWidth="2" />
          <path d={path + `L${toX(totalTime)},90 L20,90 Z`} fill="rgba(0,212,255,0.06)" />
          <text x="6" y="12" fill="var(--text-muted)" fontSize="7" fontFamily="JetBrains Mono">{Math.round(maxT)}°</text>
          <text x="6" y="90" fill="var(--text-muted)" fontSize="7" fontFamily="JetBrains Mono">{Math.round(minT)}°</text>
          <text x="20" y="93" fill="var(--text-muted)" fontSize="7" fontFamily="JetBrains Mono">0</text>
          <text x={toX(totalTime) - 8} y="93" fill="var(--text-muted)" fontSize="7" fontFamily="JetBrains Mono">{fmt(totalTime, 0)}m</text>
        </svg>
      </div>

      {/* Initial conditions */}
      <div className="panel-card p-3 mb-2">
        <div className="text-xs font-semibold mb-2" style={{ color: 'var(--text-secondary)' }}>Initial Conditions</div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="section-label mb-1">TEMP (°C)</div>
            <input type="number" value={oven.initialTemp} onChange={e => setOven({ ...oven, initialTemp: +e.target.value })} className="input-gc w-full" min="0" max="450" />
          </div>
          <div>
            <div className="section-label mb-1">HOLD (min)</div>
            <input type="number" value={oven.initialHold} onChange={e => setOven({ ...oven, initialHold: +e.target.value })} className="input-gc w-full" min="0" step="0.5" />
          </div>
        </div>
      </div>

      {/* Ramps */}
      {oven.ramps.map((ramp, i) => (
        <div key={i} className="panel-card p-3 mb-2">
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>Ramp {i + 1}</div>
            <button onClick={() => removeRamp(i)} className="text-xs" style={{ color: 'var(--red)', background: 'none', border: 'none', cursor: 'pointer' }}>✕</button>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <div className="section-label mb-1">RATE (°C/min)</div>
              <input type="number" value={ramp.rate} onChange={e => updateRamp(i, 'rate', +e.target.value)} className="input-gc w-full" min="0.1" max="120" />
            </div>
            <div>
              <div className="section-label mb-1">FINAL (°C)</div>
              <input type="number" value={ramp.finalTemp} onChange={e => updateRamp(i, 'finalTemp', +e.target.value)} className="input-gc w-full" min="0" max="450" />
            </div>
            <div>
              <div className="section-label mb-1">HOLD (min)</div>
              <input type="number" value={ramp.hold} onChange={e => updateRamp(i, 'hold', +e.target.value)} className="input-gc w-full" min="0" step="0.5" />
            </div>
          </div>
        </div>
      ))}

      <button onClick={addRamp} className="btn-cyan w-full text-sm py-2 mb-3">+ Add Ramp</button>

      <div className="panel-card p-3">
        <div className="section-label mb-2">POST-RUN</div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="section-label mb-1">POST-RUN TEMP (°C)</div>
            <input type="number" value={oven.postRunTemp} onChange={e => setOven({ ...oven, postRunTemp: +e.target.value })} className="input-gc w-full" />
          </div>
          <div>
            <div className="section-label mb-1">EQUILIBRATION (min)</div>
            <input type="number" value={oven.equilibrationTime} onChange={e => setOven({ ...oven, equilibrationTime: +e.target.value })} className="input-gc w-full" step="0.5" />
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Method Panel ─────────────────────────────────────────────────────────────

function MethodPanel({ method, setMethod, column, setColumn, selectedAnalyteNames, setSelectedAnalyteNames }:
  { method: SimMethod; setMethod: (m: SimMethod) => void; column: GCColumn; setColumn: (c: GCColumn) => void; selectedAnalyteNames: string[]; setSelectedAnalyteNames: (n: string[]) => void }) {
  const [tab, setTab] = useState<MethodTab>('epc');

  const setOven = (o: OvenProgram) => setMethod({ ...method, oven: o });

  const tabs: { key: MethodTab; label: string }[] = [
    { key: 'epc', label: 'Gas / EPC' }, { key: 'injector', label: 'Injector' },
    { key: 'oven', label: 'Oven Program' }, { key: 'column', label: 'Column' },
    { key: 'detector', label: 'FID Detector' }, { key: 'sample', label: 'Sample' },
  ];

  return (
    <div className="p-4 overflow-y-auto h-full">
      <div className="text-lg font-semibold mb-3" style={{ color: 'var(--cyan)' }}>Method Setup</div>
      <div className="flex gap-1 mb-4 flex-wrap">
        {tabs.map(t => <button key={t.key} onClick={() => setTab(t.key)} className={`tab-btn ${tab === t.key ? 'active' : ''}`}>{t.label}</button>)}
      </div>

      {tab === 'epc' && (
        <div className="flex flex-col gap-3">
          <SectionLabel>CARRIER GAS SYSTEM</SectionLabel>
          <div className="panel-card p-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="section-label mb-1">CARRIER GAS</div>
                <select value={method.carrier} onChange={e => setMethod({ ...method, carrier: e.target.value })} className="select-gc w-full">
                  <option>He</option><option>H2</option><option>N2</option>
                </select>
                <div className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                  {method.carrier === 'He' ? 'Helium — universal, safe, excellent diffusion' : method.carrier === 'H2' ? 'Hydrogen — fastest, highest efficiency, CAUTION flammable' : 'Nitrogen — lowest cost, slower, avoid for capillary GC'}
                </div>
              </div>
              <div>
                <div className="section-label mb-1">FLOW MODE</div>
                <select className="select-gc w-full">
                  <option>Constant Flow</option><option>Constant Pressure</option><option>Constant Linear Velocity</option>
                </select>
              </div>
              <div>
                <div className="section-label mb-1">COLUMN FLOW (mL/min)</div>
                <input type="number" value={method.flowRate} onChange={e => setMethod({ ...method, flowRate: +e.target.value })} className="input-gc w-full" min="0.1" max="10" step="0.1" />
              </div>
              <div>
                <div className="section-label mb-1">OUTLET PRESSURE</div>
                <input value="Atmospheric (101.3 kPa)" className="input-gc w-full" readOnly style={{ opacity: 0.6 }} />
              </div>
            </div>
          </div>

          {/* Calculated values */}
          <SectionLabel>CALCULATED PARAMETERS</SectionLabel>
          <div className="grid grid-cols-2 gap-2">
            {(() => {
              const T_K = method.oven.initialTemp + 273.15;
              const r = column.innerDiameter * 1e-3 / 2;
              const L = column.length;
              const eta = gasViscosity(method.carrier, T_K);
              const Pi = inletPressureForFlow(method.flowRate, method.outletPressure, L, r, eta);
              const u = columnLinearVelocity(Pi, method.outletPressure, L, r, eta);
              const tM = holdUpTime_s(L, u);
              return [
                { label: 'INLET PRESSURE', value: fmt((Pi - method.outletPressure) / 1000), unit: 'kPa gauge' },
                { label: 'LINEAR VELOCITY', value: fmt(u * 100, 1), unit: 'cm/s' },
                { label: 'HOLD-UP TIME', value: fmt(tM, 1), unit: 's' },
                { label: 'GAS VISCOSITY', value: (eta * 1e5).toFixed(3), unit: '×10⁻⁵ Pa·s' },
              ];
            })().map(v => <ValueCard key={v.label} label={v.label} value={v.value} unit={v.unit} />)}
          </div>
        </div>
      )}

      {tab === 'injector' && (
        <div className="flex flex-col gap-3">
          <SectionLabel>SPLIT/SPLITLESS INLET</SectionLabel>
          <div className="panel-card p-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="section-label mb-1">INJECTION MODE</div>
                <select className="select-gc w-full"
                  value={method.splitRatio > 0 ? 'split' : 'splitless'}
                  onChange={e => setMethod({ ...method, splitRatio: e.target.value === 'split' ? 50 : 0 })}>
                  <option value="split">Split</option>
                  <option value="splitless">Splitless</option>
                </select>
              </div>
              <div>
                <div className="section-label mb-1">INLET TEMP (°C)</div>
                <input type="number" value={method.inletTemp} onChange={e => setMethod({ ...method, inletTemp: +e.target.value })} className="input-gc w-full" min="50" max="400" />
              </div>
              {method.splitRatio > 0 && (
                <div>
                  <div className="section-label mb-1">SPLIT RATIO</div>
                  <input type="number" value={method.splitRatio} onChange={e => setMethod({ ...method, splitRatio: +e.target.value })} className="input-gc w-full" min="1" max="1000" />
                </div>
              )}
              <div>
                <div className="section-label mb-1">INJECTION VOLUME (μL)</div>
                <input type="number" value={method.injVol} onChange={e => setMethod({ ...method, injVol: +e.target.value })} className="input-gc w-full" min="0.1" max="10" step="0.1" />
              </div>
            </div>
          </div>
          <div className="panel-card p-3">
            <div className="section-label mb-2">CALCULATED FLOWS</div>
            <div className="grid grid-cols-3 gap-2">
              <ValueCard label="COLUMN FLOW" value={fmt(method.flowRate, 2)} unit="mL/min" />
              <ValueCard label="SPLIT FLOW" value={fmt(method.flowRate * (method.splitRatio || 0), 1)} unit="mL/min" color="var(--amber)" />
              <ValueCard label="TOTAL INLET" value={fmt(method.flowRate * (1 + (method.splitRatio || 0)), 1)} unit="mL/min" color="var(--text-secondary)" />
            </div>
          </div>
          <div className="panel-card p-3">
            <div className="section-label mb-2">SEPTUM PURGE</div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="section-label mb-1">PURGE FLOW (mL/min)</div>
                <input type="number" defaultValue={3} className="input-gc w-full" />
              </div>
              <div>
                <div className="section-label mb-1">PURGE TIME (min)</div>
                <input type="number" defaultValue={0.75} className="input-gc w-full" step="0.25" />
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === 'oven' && <OvenProgramEditor oven={method.oven} setOven={setOven} />}

      {tab === 'column' && (
        <div className="flex flex-col gap-3">
          <SectionLabel>COLUMN SELECTION</SectionLabel>
          <div className="flex flex-col gap-2">
            {COLUMNS.map(col => (
              <button key={col.id} onClick={() => setColumn(col)}
                className="panel-card p-3 text-left w-full transition-all"
                style={{ borderColor: column.id === col.id ? 'var(--border-bright)' : 'var(--border)', background: column.id === col.id ? 'rgba(0,212,255,0.06)' : 'var(--bg-card)', cursor: 'pointer' }}>
                <div className="flex items-start justify-between">
                  <div>
                    <div className="font-semibold text-sm" style={{ color: column.id === col.id ? 'var(--cyan)' : 'var(--text-primary)' }}>{col.name}</div>
                    <div className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{col.phase}</div>
                    <div className="mono text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
                      {col.length}m × {col.innerDiameter}mm × {col.filmThickness}μm
                    </div>
                  </div>
                  <div className="text-xs px-2 py-0.5 rounded" style={{
                    background: col.polarity === 'Nonpolar' ? 'rgba(0,212,255,0.1)' : col.polarity === 'Mid-polar' ? 'rgba(255,179,64,0.1)' : 'rgba(255,68,85,0.1)',
                    color: col.polarity === 'Nonpolar' ? 'var(--cyan)' : col.polarity === 'Mid-polar' ? 'var(--amber)' : 'var(--red)',
                    border: `1px solid ${col.polarity === 'Nonpolar' ? 'rgba(0,212,255,0.2)' : col.polarity === 'Mid-polar' ? 'rgba(255,179,64,0.2)' : 'rgba(255,68,85,0.2)'}`,
                  }}>{col.polarity}</div>
                </div>
                <div className="text-xs mt-2" style={{ color: 'var(--text-muted)' }}>{col.description}</div>
                <div className="mono text-xs mt-1" style={{ color: 'var(--text-muted)' }}>Max: {col.maxTemp}°C · {col.manufacturer}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {tab === 'detector' && (
        <div className="flex flex-col gap-3">
          <SectionLabel>FID DETECTOR</SectionLabel>
          <div className="panel-card p-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="section-label mb-1">DETECTOR TEMP (°C)</div>
                <input type="number" value={method.fidTemperature} onChange={e => setMethod({ ...method, fidTemperature: +e.target.value })} className="input-gc w-full" min="100" max="450" />
              </div>
              <div>
                <div className="section-label mb-1">DETECTOR TYPE</div>
                <input value="FID — Flame Ionisation" className="input-gc w-full" readOnly style={{ opacity: 0.6 }} />
              </div>
            </div>
          </div>
          <SectionLabel>FID GAS FLOWS</SectionLabel>
          <div className="panel-card p-4">
            <div className="grid grid-cols-1 gap-4">
              <div>
                <div className="flex justify-between mb-1">
                  <div className="section-label">HYDROGEN (mL/min)</div>
                  <span className="mono text-xs" style={{ color: 'var(--cyan)' }}>{method.h2Flow}</span>
                </div>
                <input type="range" min="20" max="80" value={method.h2Flow} onChange={e => setMethod({ ...method, h2Flow: +e.target.value })} className="w-full" style={{ accentColor: 'var(--cyan)' }} />
                <div className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>Recommended: 30–50 mL/min</div>
              </div>
              <div>
                <div className="flex justify-between mb-1">
                  <div className="section-label">AIR (mL/min)</div>
                  <span className="mono text-xs" style={{ color: 'var(--amber)' }}>{method.airFlow}</span>
                </div>
                <input type="range" min="200" max="600" value={method.airFlow} onChange={e => setMethod({ ...method, airFlow: +e.target.value })} className="w-full" style={{ accentColor: 'var(--amber)' }} />
                <div className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>Recommended: 300–500 mL/min · H₂:Air ratio ~1:10</div>
              </div>
              <div>
                <div className="flex justify-between mb-1">
                  <div className="section-label">MAKE-UP GAS (mL/min)</div>
                  <span className="mono text-xs" style={{ color: 'var(--text-secondary)' }}>{method.makeupFlow}</span>
                </div>
                <input type="range" min="0" max="60" value={method.makeupFlow} onChange={e => setMethod({ ...method, makeupFlow: +e.target.value })} className="w-full" style={{ accentColor: 'var(--text-secondary)' }} />
                <div className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>N₂ or He make-up gas to maintain sensitivity</div>
              </div>
            </div>
          </div>
          <div className="panel-card p-3">
            <div className="section-label mb-2">FID CHECKS</div>
            <div className="flex flex-col gap-1">
              {[
                { label: 'H₂:Air Ratio', ok: method.h2Flow * 10 < method.airFlow + 60, msg: `${(method.airFlow / method.h2Flow).toFixed(1)}:1 (optimal 8–12:1)` },
                { label: 'Detector Temperature', ok: method.fidTemperature >= 200, msg: `${method.fidTemperature}°C (must be > column max temp)` },
                { label: 'Make-up Flow', ok: method.makeupFlow >= 5, msg: `${method.makeupFlow} mL/min (minimum 5 mL/min)` },
              ].map(chk => (
                <div key={chk.label} className="flex items-center gap-2 text-xs py-1">
                  <span style={{ color: chk.ok ? 'var(--green)' : 'var(--red)' }}>{chk.ok ? '✓' : '✗'}</span>
                  <span style={{ color: 'var(--text-secondary)' }}>{chk.label}</span>
                  <span className="ml-auto mono" style={{ color: 'var(--text-muted)' }}>{chk.msg}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {tab === 'sample' && (
        <div className="flex flex-col gap-3">
          <SectionLabel>SAMPLE MIXTURE PRESETS</SectionLabel>
          <div className="flex flex-col gap-2 mb-2">
            {SAMPLE_MIXTURES.map(mix => (
              <button key={mix.name} onClick={() => setSelectedAnalyteNames(mix.analyteNames)}
                className="panel-card p-3 text-left w-full transition-all"
                style={{ borderColor: JSON.stringify(selectedAnalyteNames) === JSON.stringify(mix.analyteNames) ? 'var(--border-bright)' : 'var(--border)', cursor: 'pointer' }}>
                <div className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>{mix.name}</div>
                <div className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{mix.description}</div>
                <div className="flex flex-wrap gap-1 mt-1">
                  {mix.analyteNames.map(n => {
                    const an = ANALYTES.find(a => a.name === n);
                    return <span key={n} className="text-xs px-1.5 py-0.5 rounded" style={{ background: (an?.color ?? '#888') + '22', color: an?.color ?? '#888', border: `1px solid ${(an?.color ?? '#888')}44` }}>{n}</span>;
                  })}
                </div>
              </button>
            ))}
          </div>

          <SectionLabel>INDIVIDUAL COMPOUND SELECTION</SectionLabel>
          <div className="flex flex-col gap-1">
            {ANALYTES.map(an => (
              <label key={an.name} className="flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer"
                style={{ background: selectedAnalyteNames.includes(an.name) ? 'rgba(0,212,255,0.04)' : 'transparent' }}>
                <input type="checkbox" checked={selectedAnalyteNames.includes(an.name)}
                  onChange={e => setSelectedAnalyteNames(e.target.checked ? [...selectedAnalyteNames, an.name] : selectedAnalyteNames.filter(x => x !== an.name))}
                  style={{ accentColor: an.color }} />
                <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: an.color }} />
                <span className="text-sm flex-1" style={{ color: 'var(--text-secondary)' }}>{an.name}</span>
                <span className="mono text-xs" style={{ color: 'var(--text-muted)' }}>MW {an.mw}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Live Analysis Panel ────────────────────────────────────────────────────

function LiveAnalysisPanel({ sim, playbackPct, runState, ovenTempNow, fidSignal, Pi_kPa, flowNow, elapsedTime, onStart, onStop, onPause, paused }:
  { sim: ChromSim | null; playbackPct: number; runState: RunState; ovenTempNow: number; fidSignal: number; Pi_kPa: number; flowNow: number; elapsedTime: number; onStart: () => void; onStop: () => void; onPause: () => void; paused: boolean }) {

  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !sim) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    const totalPts = sim.timeArr.length;
    const showPts = Math.min(totalPts, Math.ceil(totalPts * playbackPct));
    if (showPts < 2) return;

    const minT = 0, maxT = sim.totalTime_s;
    const signals = Array.from(sim.signalArr.slice(0, showPts));
    const minS = Math.min(...signals) - 2;
    const maxS = Math.max(Math.max(...signals), minS + 10) + 5;

    const toX = (t: number) => ((t - minT) / (maxT - minT)) * (W - 20) + 10;
    const toY = (s: number) => H - 10 - ((s - minS) / (maxS - minS)) * (H - 20);

    // Grid
    ctx.strokeStyle = 'rgba(0,212,255,0.05)';
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= 10; i++) {
      const x = 10 + i * (W - 20) / 10;
      ctx.beginPath(); ctx.moveTo(x, 5); ctx.lineTo(x, H - 5); ctx.stroke();
      const y = 10 + i * (H - 20) / 10;
      ctx.beginPath(); ctx.moveTo(10, y); ctx.lineTo(W - 10, y); ctx.stroke();
    }

    // Signal trace
    ctx.beginPath();
    ctx.strokeStyle = '#00d4ff';
    ctx.lineWidth = 1.5;
    ctx.shadowColor = '#00d4ff';
    ctx.shadowBlur = 4;
    for (let i = 0; i < showPts; i++) {
      const x = toX(sim.timeArr[i]);
      const y = toY(sim.signalArr[i]);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Peak labels (for peaks already passed)
    ctx.font = '9px JetBrains Mono';
    ctx.fillStyle = '#7fb5d0';
    for (const peak of sim.peaks) {
      if (peak.tR_s <= (sim.timeArr[showPts - 1] ?? 0)) {
        const px = toX(peak.tR_s);
        const py = toY(peak.height + minS + 2);
        ctx.fillStyle = peak.color;
        ctx.fillText(peak.name, px + 2, Math.max(py - 4, 12));
        ctx.strokeStyle = peak.color + '55';
        ctx.lineWidth = 0.5;
        ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.moveTo(px, 5); ctx.lineTo(px, H - 5); ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // Time axis labels
    ctx.fillStyle = '#3d6a85';
    ctx.font = '8px JetBrains Mono';
    for (let m = 0; m <= Math.ceil(maxT / 60); m += 5) {
      const x = toX(m * 60);
      if (x < W - 20) ctx.fillText(`${m}m`, x - 6, H - 1);
    }
  }, [sim, playbackPct]);

  const isRunning = runState === 'RUNNING';
  const totalMin = sim ? sim.totalTime_s / 60 : 0;
  const elapsed_min = elapsedTime / 60;

  return (
    <div className="flex flex-col h-full p-4 gap-3">
      <div className="flex items-center justify-between">
        <div className="text-lg font-semibold" style={{ color: 'var(--cyan)' }}>Live Analysis</div>
        <div className="flex items-center gap-2">
          {!isRunning && !paused && <button onClick={onStart} className="btn-green px-4 py-2 text-sm">▶ Start Run</button>}
          {(isRunning || paused) && <button onClick={onPause} className="btn-cyan px-3 py-2 text-sm">{paused ? '▶ Resume' : '⏸ Pause'}</button>}
          {(isRunning || paused) && <button onClick={onStop} className="btn-red px-3 py-2 text-sm">■ Stop</button>}
        </div>
      </div>

      {/* Live status */}
      <div className="grid grid-cols-4 gap-2">
        <ValueCard label="ELAPSED" value={fmtTime(elapsedTime)} color="var(--green)" />
        <ValueCard label="OVEN TEMP" value={fmt(ovenTempNow, 1)} unit="°C" />
        <ValueCard label="FID SIGNAL" value={fmt(fidSignal, 1)} unit="pA" color="var(--amber)" />
        <ValueCard label="INLET PRES" value={fmt(Pi_kPa, 1)} unit="kPa" />
      </div>

      {/* Progress bar */}
      <div className="panel-card p-2">
        <div className="flex justify-between text-xs mono mb-1" style={{ color: 'var(--text-muted)' }}>
          <span>0:00</span><span>{fmtTime(elapsedTime)} / {fmtTime(totalMin * 60)}</span><span>{fmt(totalMin, 1)} min</span>
        </div>
        <GaugeBar value={elapsed_min} max={totalMin || 1} color={isRunning ? 'var(--cyan)' : 'var(--text-muted)'} />
        {isRunning && <div className="text-center text-xs mt-1 mono" style={{ color: 'var(--cyan)' }}>
          OVEN: {fmt(ovenTempNow, 1)}°C  ·  FLOW: {fmt(flowNow, 3)} mL/min  ·  Pi: {fmt(Pi_kPa, 1)} kPa
        </div>}
      </div>

      {/* Chromatogram canvas */}
      <div className="flex-1 panel-card p-2 relative" style={{ minHeight: 200 }}>
        {!sim && <div className="absolute inset-0 flex items-center justify-center" style={{ color: 'var(--text-dim)' }}>
          <div className="text-center">
            <div className="text-3xl mb-2" style={{ opacity: 0.3 }}>📈</div>
            <div className="text-sm">No chromatogram data — press Start Run</div>
          </div>
        </div>}
        <canvas ref={canvasRef} width={800} height={340} style={{ width: '100%', height: '100%' }} />
        <div className="absolute bottom-3 left-3 text-xs mono" style={{ color: 'var(--text-dim)' }}>
          Signal (pA) / Time (min)
        </div>
      </div>
    </div>
  );
}

// ─── Data Analysis Panel ────────────────────────────────────────────────────

function DataAnalysisPanel({ sim }: { sim: ChromSim | null }) {
  if (!sim || sim.peaks.length === 0) return (
    <div className="flex items-center justify-center h-full" style={{ color: 'var(--text-dim)' }}>
      <div className="text-center">
        <div className="text-4xl mb-3" style={{ opacity: 0.3 }}>📊</div>
        <div className="text-sm">No data — complete a run first</div>
      </div>
    </div>
  );

  const peaks = sim.peaks;
  const totalArea = peaks.reduce((s, p) => s + p.area, 0);

  return (
    <div className="p-4 overflow-y-auto h-full">
      <div className="flex items-center justify-between mb-3">
        <div className="text-lg font-semibold" style={{ color: 'var(--cyan)' }}>Data Analysis</div>
        <button className="btn-cyan text-xs py-1.5 px-3">Export CSV</button>
      </div>

      <div className="grid grid-cols-3 gap-2 mb-4">
        <ValueCard label="PEAKS DETECTED" value={peaks.length} />
        <ValueCard label="DEAD TIME" value={fmt(sim.tM_s, 1)} unit="s" color="var(--text-secondary)" />
        <ValueCard label="RUN TIME" value={fmt(sim.totalTime_s / 60, 1)} unit="min" color="var(--text-secondary)" />
      </div>

      <SectionLabel>PEAK TABLE</SectionLabel>
      <div className="panel-card overflow-hidden mb-4">
        <div className="overflow-x-auto">
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-secondary)' }}>
                {['#','Compound','RT (min)','Area','Height','Width(s)','N','k','Area%','Rs'].map(h => (
                  <th key={h} style={{ padding: '6px 8px', textAlign: 'left', color: 'var(--text-muted)', fontFamily: 'Inter', fontWeight: 600, fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {peaks.map((p, i) => {
                const prev = peaks[i - 1];
                const Rs = prev ? resolution(prev.tR_s, p.tR_s, prev.sigma_s * 4, p.sigma_s * 4) : null;
                return (
                  <tr key={p.name} style={{ borderBottom: '1px solid var(--border)', background: i % 2 === 0 ? 'transparent' : 'rgba(0,212,255,0.02)' }}>
                    <td style={{ padding: '6px 8px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono' }}>{i + 1}</td>
                    <td style={{ padding: '6px 8px' }}>
                      <div className="flex items-center gap-1.5">
                        <div className="w-2 h-2 rounded-full" style={{ background: p.color }} />
                        <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{p.name}</span>
                      </div>
                    </td>
                    <td style={{ padding: '6px 8px', color: 'var(--cyan)', fontFamily: 'JetBrains Mono' }}>{fmt(p.tR_s / 60, 3)}</td>
                    <td style={{ padding: '6px 8px', color: 'var(--text-secondary)', fontFamily: 'JetBrains Mono' }}>{p.area.toExponential(2)}</td>
                    <td style={{ padding: '6px 8px', color: 'var(--text-secondary)', fontFamily: 'JetBrains Mono' }}>{fmt(p.height, 0)}</td>
                    <td style={{ padding: '6px 8px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono' }}>{fmt(p.sigma_s * 4, 1)}</td>
                    <td style={{ padding: '6px 8px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono' }}>{Math.round(p.N).toLocaleString()}</td>
                    <td style={{ padding: '6px 8px', color: 'var(--amber)', fontFamily: 'JetBrains Mono' }}>{fmt(p.k, 2)}</td>
                    <td style={{ padding: '6px 8px', color: 'var(--text-secondary)', fontFamily: 'JetBrains Mono' }}>{fmt((p.area / totalArea) * 100, 1)}%</td>
                    <td style={{ padding: '6px 8px', fontFamily: 'JetBrains Mono', color: Rs === null ? 'var(--text-dim)' : Rs >= 1.5 ? 'var(--green)' : Rs >= 1.0 ? 'var(--amber)' : 'var(--red)' }}>
                      {Rs !== null ? fmt(Rs, 2) : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <SectionLabel>SYSTEM SUITABILITY</SectionLabel>
      <div className="panel-card p-3">
        {(() => {
          const avgN = peaks.reduce((s, p) => s + p.N, 0) / peaks.length;
          const minRs = peaks.slice(1).reduce((min, p, i) => {
            const rs = resolution(peaks[i].tR_s, p.tR_s, peaks[i].sigma_s * 4, p.sigma_s * 4);
            return Math.min(min, rs);
          }, Infinity);
          const checks = [
            { label: 'Avg Theoretical Plates N', value: `${Math.round(avgN).toLocaleString()}`, pass: avgN >= 5000, req: '≥ 5,000' },
            { label: 'Minimum Resolution Rs', value: isFinite(minRs) ? fmt(minRs, 2) : '—', pass: minRs >= 1.5, req: '≥ 1.5' },
            { label: 'Peak Count', value: peaks.length.toString(), pass: peaks.length >= 1, req: '≥ 1' },
          ];
          return checks.map(chk => (
            <div key={chk.label} className="flex items-center gap-2 py-2" style={{ borderBottom: '1px solid var(--border)' }}>
              <span className="w-4 h-4 rounded-full flex items-center justify-center text-xs font-bold" style={{ background: chk.pass ? 'rgba(0,255,136,0.15)' : 'rgba(255,68,85,0.15)', color: chk.pass ? 'var(--green)' : 'var(--red)' }}>{chk.pass ? '✓' : '✗'}</span>
              <span className="text-xs flex-1" style={{ color: 'var(--text-secondary)' }}>{chk.label}</span>
              <span className="mono text-xs" style={{ color: 'var(--cyan)' }}>{chk.value}</span>
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{chk.req}</span>
            </div>
          ));
        })()}
      </div>
    </div>
  );
}

// ─── Sequence Panel ────────────────────────────────────────────────────────────

function SequencePanel({ entries, setEntries, onRunSequence, runState }:
  { entries: SequenceEntry[]; setEntries: (e: SequenceEntry[]) => void; onRunSequence: () => void; runState: RunState }) {
  const typeColor: Record<string, string> = { Blank: 'var(--text-muted)', Std: 'var(--cyan)', Sample: 'var(--green)', QC: 'var(--amber)', SST: 'var(--purple)', Wash: 'var(--red)' };
  const statusColor: Record<string, string> = { Pending: 'var(--text-muted)', Running: 'var(--cyan)', Done: 'var(--green)', Failed: 'var(--red)', Skipped: 'var(--text-dim)' };

  const addEntry = (type: SequenceEntry['type']) => {
    setEntries([...entries, { id: Date.now(), vial: entries.length + 1, name: `${type}-${entries.length + 1}`, method: 'Method-001', type, injections: 1, status: 'Pending' }]);
  };

  return (
    <div className="p-4 overflow-y-auto h-full">
      <div className="flex items-center justify-between mb-3">
        <div className="text-lg font-semibold" style={{ color: 'var(--cyan)' }}>Sequence</div>
        <button onClick={onRunSequence} disabled={runState === 'RUNNING'} className="btn-green px-4 py-2 text-sm"
          style={{ opacity: runState === 'RUNNING' ? 0.5 : 1 }}>▶ Run Sequence</button>
      </div>

      <div className="flex gap-1 mb-3 flex-wrap">
        {(['Blank','Std','Sample','QC','SST','Wash'] as const).map(t => (
          <button key={t} onClick={() => addEntry(t)} className="text-xs px-2 py-1 rounded"
            style={{ background: typeColor[t] + '18', border: `1px solid ${typeColor[t]}44`, color: typeColor[t], cursor: 'pointer' }}>
            + {t}
          </button>
        ))}
      </div>

      {entries.length === 0 && (
        <div className="panel-card p-8 flex flex-col items-center" style={{ color: 'var(--text-dim)' }}>
          <div className="text-3xl mb-2">≡</div>
          <div className="text-sm">No entries — add samples above</div>
        </div>
      )}

      <div className="flex flex-col gap-1">
        {entries.map((entry, i) => (
          <div key={entry.id} className="panel-card px-3 py-2.5 flex items-center gap-3">
            <div className="mono text-xs w-5" style={{ color: 'var(--text-muted)' }}>{i + 1}</div>
            <div className="w-8 h-8 rounded flex items-center justify-center text-xs font-bold"
              style={{ background: typeColor[entry.type] + '18', color: typeColor[entry.type], border: `1px solid ${typeColor[entry.type]}44` }}>
              {entry.type[0]}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{entry.name}</div>
              <div className="text-xs" style={{ color: 'var(--text-muted)' }}>Vial {entry.vial} · {entry.method} · {entry.injections}×</div>
            </div>
            <div className="flex items-center gap-1">
              <StatusDot color={statusColor[entry.status]} />
              <span className="text-xs" style={{ color: statusColor[entry.status] }}>{entry.status}</span>
            </div>
            <button onClick={() => setEntries(entries.filter(e => e.id !== entry.id))}
              style={{ color: 'var(--text-dim)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 14 }}>✕</button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Diagnostics Panel ────────────────────────────────────────────────────────

function DiagnosticsPanel({ runState, flameOn, powerOn }: { runState: RunState; flameOn: boolean; powerOn: boolean }) {
  const [leakTest, setLeakTest] = useState<'idle' | 'running' | 'pass' | 'fail'>('idle');
  const [leakProgress, setLeakProgress] = useState(0);

  const runLeakTest = () => {
    setLeakTest('running'); setLeakProgress(0);
    const iv = setInterval(() => {
      setLeakProgress(p => {
        if (p >= 100) { clearInterval(iv); setLeakTest('pass'); return 100; }
        return p + 5;
      });
    }, 100);
  };

  const selfTest = [
    { name: 'EPC Valve', ok: powerOn },
    { name: 'Carrier Pressure', ok: powerOn },
    { name: 'Oven Sensor', ok: powerOn },
    { name: 'Inlet Heater', ok: powerOn },
    { name: 'FID Heater', ok: powerOn },
    { name: 'FID Flame', ok: flameOn },
    { name: 'Electrometer', ok: flameOn },
    { name: 'Column Flow', ok: powerOn },
    { name: 'Acquisition', ok: powerOn },
    { name: 'Data System', ok: true },
  ];

  return (
    <div className="p-4 overflow-y-auto h-full">
      <div className="text-lg font-semibold mb-4" style={{ color: 'var(--cyan)' }}>Diagnostics</div>

      <SectionLabel>SELF-TEST RESULTS</SectionLabel>
      <div className="panel-card mb-4 overflow-hidden">
        {selfTest.map((item, i) => (
          <div key={item.name} className="flex items-center gap-3 px-4 py-2.5" style={{ borderBottom: i < selfTest.length - 1 ? '1px solid var(--border)' : 'none' }}>
            <StatusDot color={item.ok ? 'var(--green)' : 'var(--red)'} />
            <span className="text-sm flex-1" style={{ color: 'var(--text-secondary)' }}>{item.name}</span>
            <span className="mono text-xs" style={{ color: item.ok ? 'var(--green)' : 'var(--red)' }}>{item.ok ? 'PASS' : 'FAIL'}</span>
          </div>
        ))}
      </div>

      <SectionLabel>LEAK CHECK</SectionLabel>
      <div className="panel-card p-4 mb-4">
        <div className="text-sm mb-3" style={{ color: 'var(--text-muted)' }}>Isolate and pressure-test each section of the gas path. Check for pressure decay over 30 seconds.</div>
        {leakTest === 'idle' && <button onClick={runLeakTest} className="btn-cyan">Run Leak Check</button>}
        {leakTest === 'running' && (
          <div>
            <div className="text-sm mono mb-2" style={{ color: 'var(--cyan)' }}>Testing… {leakProgress}%</div>
            <GaugeBar value={leakProgress} max={100} color="var(--cyan)" />
          </div>
        )}
        {leakTest === 'pass' && (
          <div className="flex items-center gap-2">
            <StatusDot color="var(--green)" />
            <span className="mono font-semibold" style={{ color: 'var(--green)' }}>PASS — No leaks detected. ΔP = 0.0 kPa/min</span>
            <button onClick={() => setLeakTest('idle')} className="ml-auto text-xs" style={{ color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer' }}>Reset</button>
          </div>
        )}
        {leakTest === 'fail' && <span className="mono" style={{ color: 'var(--red)' }}>FAIL — Leak detected. Check ferrules and connections.</span>}
      </div>

      <SectionLabel>TROUBLESHOOTING TREE</SectionLabel>
      <div className="panel-card p-3">
        {[
          { symptom: 'No peaks', causes: ['No injection', 'No carrier gas', 'Column broken/blocked', 'FID flameout', 'Acquisition disabled'] },
          { symptom: 'Baseline noise / instability', causes: ['Septum leak', 'Column bleed (temp too high)', 'EPC oscillation', 'Electrometer contamination', 'Dirty inlet'] },
          { symptom: 'Retention time shift', causes: ['Carrier gas leak', 'EPC set point drift', 'Column degradation', 'Temperature calibration error'] },
          { symptom: 'Peak tailing', causes: ['Active sites in inlet liner', 'Column adsorption', 'Injection technique', 'Overloaded column'] },
        ].map(item => (
          <div key={item.symptom} className="mb-3">
            <div className="text-sm font-semibold mb-1" style={{ color: 'var(--amber)' }}>⚠ {item.symptom}</div>
            {item.causes.map(c => <div key={c} className="text-xs pl-3" style={{ color: 'var(--text-muted)' }}>├ {c}</div>)}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Maintenance Panel ─────────────────────────────────────────────────────────

function MaintenancePanel() {
  const [items, setItems] = useState<MaintenanceItem[]>([
    { name: 'Septum', count: 47, maxCount: 100, condition: 72, warning: 30 },
    { name: 'Inlet Liner', count: 8, maxCount: 20, condition: 85, warning: 25 },
    { name: 'Column (usage h)', count: 420, maxCount: 1000, condition: 91, warning: 20 },
    { name: 'FID Jet', count: 6, maxCount: 12, condition: 68, warning: 25 },
    { name: 'O-Ring / Gold Seal', count: 3, maxCount: 6, condition: 54, warning: 30 },
    { name: 'In-line Gas Filter', count: 180, maxCount: 500, condition: 82, warning: 20 },
  ]);

  const replace = (name: string) => {
    setItems(items.map(i => i.name === name ? { ...i, count: 0, condition: 100 } : i));
  };

  return (
    <div className="p-4 overflow-y-auto h-full">
      <div className="text-lg font-semibold mb-4" style={{ color: 'var(--cyan)' }}>Maintenance</div>

      <SectionLabel>CONSUMABLES STATUS</SectionLabel>
      <div className="flex flex-col gap-2 mb-4">
        {items.map(item => {
          const condColor = item.condition > 60 ? 'var(--green)' : item.condition > item.warning ? 'var(--amber)' : 'var(--red)';
          return (
            <div key={item.name} className="panel-card p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>{item.name}</div>
                <div className="flex items-center gap-2">
                  <span className="mono text-xs" style={{ color: condColor }}>{item.condition}%</span>
                  {item.condition < 40 && <button onClick={() => replace(item.name)} className="text-xs px-2 py-0.5 rounded" style={{ background: 'rgba(255,68,85,0.12)', border: '1px solid rgba(255,68,85,0.3)', color: 'var(--red)', cursor: 'pointer' }}>Replace</button>}
                </div>
              </div>
              <GaugeBar value={item.condition} max={100} color={condColor} />
              <div className="flex justify-between mt-1">
                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Uses: {item.count} / {item.maxCount}</span>
                {item.condition < item.warning + 15 && <span className="text-xs" style={{ color: 'var(--amber)' }}>Service soon</span>}
              </div>
            </div>
          );
        })}
      </div>

      <SectionLabel>GAS SUPPLY</SectionLabel>
      <div className="panel-card p-3 mb-4">
        {[
          { gas: 'He (Carrier)', pct: 82, pressure: 'P=51.5 bar', est: '47.2 h' },
          { gas: 'H₂ (FID)', pct: 65, pressure: 'P=38.2 bar', est: '29.1 h' },
          { gas: 'Air (FID)', pct: 90, pressure: 'P=5.5 bar', est: '62.0 h' },
        ].map(g => (
          <div key={g.gas} className="mb-3">
            <div className="flex justify-between mb-1 text-xs">
              <span style={{ color: 'var(--text-secondary)' }}>{g.gas}</span>
              <span className="mono" style={{ color: g.pct > 20 ? 'var(--text-secondary)' : 'var(--red)' }}>{g.pressure} · Est {g.est}</span>
            </div>
            <GaugeBar value={g.pct} max={100} color={g.pct > 20 ? 'var(--cyan)' : 'var(--red)'} />
          </div>
        ))}
      </div>

      <SectionLabel>BAKEOUT / CONDITIONING</SectionLabel>
      <div className="panel-card p-3">
        <div className="text-sm mb-2" style={{ color: 'var(--text-muted)' }}>Perform column bakeout to remove contamination and restore baseline.</div>
        <button className="btn-cyan w-full">Start Column Bakeout (250°C, 60 min)</button>
      </div>
    </div>
  );
}

// ─── Audit Trail Panel ────────────────────────────────────────────────────────

function AuditTrailPanel({ entries }: { entries: string[] }) {
  return (
    <div className="p-4 overflow-y-auto h-full">
      <div className="text-lg font-semibold mb-4" style={{ color: 'var(--cyan)' }}>Audit Trail</div>
      <div className="panel-card overflow-hidden">
        {entries.length === 0 && <div className="p-6 text-center text-sm" style={{ color: 'var(--text-dim)' }}>No audit events recorded yet.</div>}
        {entries.map((e, i) => (
          <div key={i} className="px-4 py-2 text-xs mono flex gap-3" style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
            <span style={{ color: 'var(--text-muted)', flexShrink: 0 }}>{i + 1}</span>
            <span style={{ flex: 1 }}>{e}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────

export default function App() {
  const [runState, setRunState] = useState<RunState>('OFF');
  const [activePanel, setActivePanel] = useState<Panel>('workflow');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [role, setRole] = useState('Analyst');
  const [powerOn, setPowerOn] = useState(false);
  const [flameOn, setFlameOn] = useState(false);
  const [paused, setPaused] = useState(false);

  const [method, setMethod] = useState<SimMethod>(DEFAULT_METHOD);
  const [column, setColumn] = useState<GCColumn>(COLUMNS[0]);
  const [selectedAnalyteNames, setSelectedAnalyteNames] = useState<string[]>(['Hexane','Heptane','Octane','Nonane','Decane']);

  const [sim, setSim] = useState<ChromSim | null>(null);
  const [playbackPct, setPlaybackPct] = useState(0);
  const [elapsedTime, setElapsedTime] = useState(0);

  const [ovenTempNow, setOvenTempNow] = useState(method.oven.initialTemp);
  const [fidSignal, setFidSignal] = useState(5.2);
  const [Pi_kPa, setPi_kPa] = useState(0);
  const [flowNow, setFlowNow] = useState(method.flowRate);

  const [sequence, setSequence] = useState<SequenceEntry[]>([
    { id: 1, vial: 1, name: 'Blank-001', method: 'Method-001', type: 'Blank', injections: 1, status: 'Pending' },
    { id: 2, vial: 2, name: 'STD-001', method: 'Method-001', type: 'Std', injections: 3, status: 'Pending' },
    { id: 3, vial: 3, name: 'Sample-001', method: 'Method-001', type: 'Sample', injections: 2, status: 'Pending' },
    { id: 4, vial: 4, name: 'QC-001', method: 'Method-001', type: 'QC', injections: 1, status: 'Pending' },
  ]);
  const [faults, setFaults] = useState<Fault[]>([]);
  const [audit, setAudit] = useState<string[]>([]);

  const animRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const simRef = useRef<ChromSim | null>(null);

  const addAudit = useCallback((msg: string) => {
    setAudit(a => [`${now()} | ${msg}`, ...a].slice(0, 200));
  }, []);

  const addFault = useCallback((id: string, severity: Fault['severity'], msg: string) => {
    setFaults(f => [{ id, severity, message: msg, time: now() }, ...f.filter(x => x.id !== id)].slice(0, 20));
  }, []);

  const clearFault = useCallback((id: string) => setFaults(f => f.filter(x => x.id !== id)), []);

  const handlePowerOn = () => {
    if (!powerOn) {
      setPowerOn(true);
      setRunState('STANDBY');
      addAudit(`Instrument powered ON by ${role}`);
      setTimeout(() => { setRunState('EQUILIBRATING'); }, 2000);
      setTimeout(() => { setRunState('READY'); }, 6000);
    } else {
      setPowerOn(false); setRunState('OFF'); setFlameOn(false);
      addAudit(`Instrument powered OFF by ${role}`);
    }
  };

  const handleIgnite = () => {
    if (!flameOn) {
      setFlameOn(true);
      addAudit('FID ignition initiated');
      clearFault('fid_flame');
    } else {
      setFlameOn(false);
      addFault('fid_flame', 'Critical', 'FID flame extinguished');
      addAudit('FID flame extinguished');
    }
  };

  const startRun = useCallback(() => {
    const analytes = ANALYTES.filter(a => selectedAnalyteNames.includes(a.name));
    if (analytes.length === 0) {
      addFault('no_analytes', 'Warning', 'No analytes selected for simulation');
      return;
    }
    const simCol = { length: column.length, id: column.innerDiameter * 1e-3, filmThickness: column.filmThickness * 1e-6 };
    const result = simulateChromatogram(method, simCol, analytes);
    setSim(result);
    simRef.current = result;
    setPlaybackPct(0);
    setElapsedTime(0);
    setRunState('RUNNING');
    setPaused(false);
    addAudit(`Run started: ${analytes.map(a => a.name).join(', ')}`);
    setActivePanel('live');

    // Initial Pi
    const T_K = method.oven.initialTemp + 273.15;
    const r = column.innerDiameter * 1e-3 / 2;
    const eta = gasViscosity(method.carrier, T_K);
    const Pi = inletPressureForFlow(method.flowRate, method.outletPressure, column.length, r, eta);
    setPi_kPa((Pi - method.outletPressure) / 1000);

    if (animRef.current) clearInterval(animRef.current);
    const SPEED = 60; // 60× real time
    const INTERVAL = 200; // ms wall clock
    const dt_sim = (SPEED * INTERVAL) / 1000; // simulated seconds per tick

    animRef.current = setInterval(() => {
      setElapsedTime(prev => {
        const next = prev + dt_sim;
        const s = simRef.current!;
        if (next >= s.totalTime_s) {
          clearInterval(animRef.current!);
          setRunState('POSTRUN');
          setPlaybackPct(1);
          addAudit('Run complete — post-run cooling');
          setTimeout(() => setRunState('READY'), 3000);
          return s.totalTime_s;
        }
        const pct = next / s.totalTime_s;
        setPlaybackPct(pct);
        const t_min = next / 60;
        const T_now = ovenTemp_C(method.oven, t_min);
        setOvenTempNow(T_now);
        const T_K2 = T_now + 273.15;
        const r2 = column.innerDiameter * 1e-3 / 2;
        const eta2 = gasViscosity(method.carrier, T_K2);
        const Pi2 = inletPressureForFlow(method.flowRate, method.outletPressure, column.length, r2, eta2);
        const flow = columnOutletFlow_mLmin(Pi2, method.outletPressure, column.length, r2, eta2);
        setPi_kPa((Pi2 - method.outletPressure) / 1000);
        setFlowNow(flow);
        const idx = Math.min(Math.floor(pct * s.signalArr.length), s.signalArr.length - 1);
        setFidSignal(s.signalArr[idx]);
        return next;
      });
    }, INTERVAL);
  }, [method, column, selectedAnalyteNames, addAudit, addFault]);

  const handleStop = () => {
    if (animRef.current) clearInterval(animRef.current);
    setRunState('READY');
    setPaused(false);
    addAudit('Run stopped by operator');
  };

  const handlePause = () => {
    if (paused) {
      setPaused(false);
      addAudit('Run resumed');
    } else {
      if (animRef.current) clearInterval(animRef.current);
      setPaused(true);
      addAudit('Run paused');
    }
  };

  // Simulate EPC noise when on standby
  useEffect(() => {
    if (runState === 'READY' || runState === 'STANDBY') {
      const iv = setInterval(() => {
        setOvenTempNow(method.oven.initialTemp + (Math.random() - 0.5) * 0.2);
        setFidSignal(flameOn ? 5.1 + Math.random() * 0.4 : 0.1 + Math.random() * 0.05);
        const T_K = method.oven.initialTemp + 273.15;
        const r = column.innerDiameter * 1e-3 / 2;
        const eta = gasViscosity(method.carrier, T_K);
        const Pi = inletPressureForFlow(method.flowRate, method.outletPressure, column.length, r, eta);
        setPi_kPa((Pi - method.outletPressure) / 1000 + (Math.random() - 0.5) * 0.05);
        setFlowNow(method.flowRate + (Math.random() - 0.5) * 0.002);
      }, 1000);
      return () => clearInterval(iv);
    }
  }, [runState, method, column, flameOn]);

  const stateColor: Record<RunState, string> = {
    OFF: 'var(--text-dim)', STANDBY: 'var(--amber)', READY: 'var(--green)',
    EQUILIBRATING: 'var(--cyan)', IGNITING: 'var(--amber)', RUNNING: 'var(--cyan)',
    POSTRUN: 'var(--amber)', COOLING: 'var(--amber)',
  };

  return (
    <div className="grid-bg flex flex-col h-full" style={{ userSelect: 'none' }}>
      {/* ── Top Bar ── */}
      <div className="flex items-center gap-2 px-3 py-2.5 flex-shrink-0" style={{ background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)' }}>
        <button onClick={() => setDrawerOpen(true)} className="flex flex-col gap-1 p-2 rounded" style={{ background: 'rgba(0,212,255,0.08)', border: '1px solid var(--border)', cursor: 'pointer' }}>
          <div className="w-4 h-0.5" style={{ background: 'var(--cyan)' }} />
          <div className="w-4 h-0.5" style={{ background: 'var(--cyan)' }} />
          <div className="w-4 h-0.5" style={{ background: 'var(--cyan)' }} />
        </button>

        <div className="flex-1 flex items-center justify-center gap-2">
          <StatusDot color={stateColor[runState]} />
          <span className="mono font-semibold text-sm tracking-widest" style={{ color: stateColor[runState] }}>{runState}</span>
          {runState === 'RUNNING' && (
            <span className="mono text-xs" style={{ color: 'var(--text-muted)' }}>{fmtTime(elapsedTime)}</span>
          )}
        </div>

        <button className="flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs" style={{ background: 'rgba(255,179,64,0.08)', border: '1px solid rgba(255,179,64,0.2)', color: 'var(--amber)', cursor: 'pointer' }}>
          🔊 AUDIO
        </button>
      </div>

      {/* ── Drawer ── */}
      <NavDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)}
        activePanel={activePanel} setPanel={setActivePanel}
        runState={runState} role={role} setRole={setRole} />

      {/* ── Main Content ── */}
      <div className="flex-1 overflow-hidden">
        {activePanel === 'workflow' && (
          <WorkflowPanel runState={runState} powerOn={powerOn} onPowerOn={handlePowerOn}
            onIgnite={handleIgnite} onRun={startRun} flameOn={flameOn} faults={faults} />
        )}
        {activePanel === 'dashboard' && (
          <div className="flex flex-col h-full">
            <div className="flex items-center justify-between px-4 pt-3 pb-1">
              <div className="text-lg font-semibold" style={{ color: 'var(--cyan)' }}>GC-2600 Instrument</div>
              <div className="flex items-center gap-2">
                <StatusDot color={stateColor[runState]} />
                <span className="text-xs mono" style={{ color: stateColor[runState] }}>{runState}</span>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 px-4 pb-2">
              <ValueCard label="OVEN" value={fmt(ovenTempNow, 1)} unit="°C" />
              <ValueCard label="FID" value={fmt(fidSignal, 1)} unit="pA" color={flameOn ? 'var(--amber)' : 'var(--text-dim)'} />
              <ValueCard label="INLET PRES" value={fmt(Pi_kPa, 1)} unit="kPa" />
              <ValueCard label="FLOW" value={fmt(flowNow, 3)} unit="mL/min" />
            </div>
            <HardwareDiagram runState={runState} method={method} column={column}
              ovenTempNow={ovenTempNow} fidSignal={fidSignal} Pi_kPa={Pi_kPa}
              flowNow={flowNow} flameOn={flameOn} setPanel={setActivePanel} />
          </div>
        )}
        {activePanel === 'method' && (
          <MethodPanel method={method} setMethod={setMethod} column={column} setColumn={setColumn}
            selectedAnalyteNames={selectedAnalyteNames} setSelectedAnalyteNames={setSelectedAnalyteNames} />
        )}
        {activePanel === 'live' && (
          <LiveAnalysisPanel sim={sim} playbackPct={playbackPct} runState={runState}
            ovenTempNow={ovenTempNow} fidSignal={fidSignal} Pi_kPa={Pi_kPa} flowNow={flowNow}
            elapsedTime={elapsedTime} onStart={startRun} onStop={handleStop}
            onPause={handlePause} paused={paused} />
        )}
        {activePanel === 'data' && <DataAnalysisPanel sim={sim} />}
        {activePanel === 'sequence' && (
          <SequencePanel entries={sequence} setEntries={setSequence}
            onRunSequence={startRun} runState={runState} />
        )}
        {activePanel === 'diagnostics' && (
          <DiagnosticsPanel runState={runState} flameOn={flameOn} powerOn={powerOn} />
        )}
        {activePanel === 'maintenance' && <MaintenancePanel />}
        {activePanel === 'audit' && <AuditTrailPanel entries={audit} />}
      </div>
    </div>
  );
}
