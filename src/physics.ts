// GC Physics Engine — real compressible-gas chromatography calculations

export const R_GAS = 8.314; // J/(mol·K)
const Pa_ATM = 101325; // Pa

// ─── Gas Properties ─────────────────────────────────────────────────────────

interface GasProps { eta0: number; T0: number; S: number; M: number; D0_cm2s: number; }

const GAS_DATA: Record<string, GasProps> = {
  He: { eta0: 1.87e-5, T0: 273.15, S: 79.4,  M: 4.003e-3,  D0_cm2s: 5.2e-1 },
  H2: { eta0: 8.42e-6, T0: 273.15, S: 97.0,  M: 2.016e-3,  D0_cm2s: 7.8e-1 },
  N2: { eta0: 1.66e-5, T0: 273.15, S: 107.0, M: 28.014e-3, D0_cm2s: 1.9e-1 },
};

// Sutherland equation: viscosity (Pa·s) at temperature T_K
export function gasViscosity(gas: string, T_K: number): number {
  const g = GAS_DATA[gas] ?? GAS_DATA['He'];
  return g.eta0 * Math.pow(T_K / g.T0, 1.5) * (g.T0 + g.S) / (T_K + g.S);
}

// Gas-phase diffusion coefficient of analyte vapour in carrier gas (m²/s)
// Uses Chapman-Enskog T^1.75 scaling, corrected for pressure
export function gasPhaseDm(gas: string, T_K: number, P_Pa: number): number {
  const g = GAS_DATA[gas] ?? GAS_DATA['He'];
  const D_cm2s = g.D0_cm2s * Math.pow(T_K / 300, 1.75) * (Pa_ATM / P_Pa);
  return D_cm2s * 1e-4; // → m²/s
}

// Stationary-phase diffusion (liquid film) — temperature-dependent (m²/s)
export function stationaryPhaseDm(T_K: number): number {
  // Approximate: D_s ~ 1e-9 m²/s at 300K, doubles every 30K
  return 1e-9 * Math.exp(0.023 * (T_K - 300));
}

// ─── Column Hydraulics ───────────────────────────────────────────────────────

// Average linear carrier velocity (m/s) for compressible Poiseuille flow
// Pi, Po in Pa; L in m; r in m; eta in Pa·s
export function columnLinearVelocity(Pi_Pa: number, Po_Pa: number, L_m: number, r_m: number, eta: number): number {
  const Pm = (Pi_Pa + Po_Pa) / 2;
  return r_m * r_m * (Pi_Pa * Pi_Pa - Po_Pa * Po_Pa) / (16 * eta * L_m * Pm);
}

// Column outlet volumetric flow (mL/min) from Pi, Po (Pa)
export function columnOutletFlow_mLmin(Pi_Pa: number, Po_Pa: number, L_m: number, r_m: number, eta: number): number {
  const F_m3s = Math.PI * Math.pow(r_m, 4) * (Pi_Pa * Pi_Pa - Po_Pa * Po_Pa) / (16 * eta * L_m * Po_Pa);
  return F_m3s * 60 * 1e6;
}

// Inlet pressure (Pa absolute) needed for a given outlet flow (mL/min)
export function inletPressureForFlow(F_mLmin: number, Po_Pa: number, L_m: number, r_m: number, eta: number): number {
  const F_m3s = F_mLmin * 1e-6 / 60;
  const Pi2 = Po_Pa * Po_Pa + 16 * eta * L_m * F_m3s * Po_Pa / (Math.PI * Math.pow(r_m, 4));
  return Math.sqrt(Math.max(Pi2, Po_Pa * Po_Pa));
}

// Dead-time (hold-up time) in seconds
export function holdUpTime_s(L_m: number, u_ms: number): number {
  return L_m / u_ms;
}

// Phase ratio β = r / (2·df)
export function phaseRatio(r_m: number, df_m: number): number {
  return r_m / (2 * df_m);
}

// ─── Retention ────────────────────────────────────────────────────────────────

// Retention factor k from van't Hoff parameters
// dH in J/mol, dS in J/(mol·K), β = phase ratio
export function retentionFactor(dH: number, dS: number, T_K: number, beta: number): number {
  const K = Math.exp(-dH / (R_GAS * T_K) + dS / R_GAS);
  return K / beta;
}

// Retention time (s) — isothermal shortcut: tR = tM*(1+k)
export function retentionTime_s(tM_s: number, k: number): number {
  return tM_s * (1 + k);
}

// ─── Golay Equation — Band Broadening ───────────────────────────────────────

// Plate height H (m) for a capillary column (no A term)
export function golayH(u_ms: number, r_m: number, df_m: number, k: number, Dm: number, Ds: number): number {
  const B  = 2 * Dm;
  const Cm = (1 + 6*k + 11*k*k) / (24 * Math.pow(1+k, 2)) * (r_m*r_m / Dm);
  const Cs = (2/3) * k / Math.pow(1+k, 2) * (df_m*df_m / Ds);
  if (u_ms <= 0) return 1e-3;
  return B / u_ms + (Cm + Cs) * u_ms;
}

// Theoretical plates N from column length and plate height
export function theoreticalPlates(L_m: number, H_m: number): number {
  return L_m / Math.max(H_m, 1e-6);
}

// Peak σ in time units (s)
export function peakSigma_t(tR_s: number, N: number): number {
  return tR_s / Math.sqrt(Math.max(N, 1));
}

// Resolution between two peaks
export function resolution(tR1: number, tR2: number, w1: number, w2: number): number {
  return 2 * Math.abs(tR2 - tR1) / (w1 + w2);
}

// ─── Oven Temperature Program ─────────────────────────────────────────────

export interface OvenRamp { rate: number; finalTemp: number; hold: number; }
export interface OvenProgram {
  initialTemp: number;
  initialHold: number;
  ramps: OvenRamp[];
  postRunTemp: number;
  equilibrationTime: number;
}

// Oven temperature (°C) at elapsed time t_min (minutes)
export function ovenTemp_C(oven: OvenProgram, t_min: number): number {
  if (t_min <= oven.initialHold) return oven.initialTemp;
  let time = oven.initialHold;
  let T = oven.initialTemp;
  for (const ramp of oven.ramps) {
    const rampDur = (ramp.finalTemp - T) / ramp.rate;
    if (t_min <= time + rampDur) return T + ramp.rate * (t_min - time);
    time += rampDur;
    T = ramp.finalTemp;
    if (t_min <= time + ramp.hold) return T;
    time += ramp.hold;
  }
  return T;
}

// Total programmed run time (min)
export function programRunTime(oven: OvenProgram): number {
  let time = oven.initialHold;
  let T = oven.initialTemp;
  for (const r of oven.ramps) {
    time += (r.finalTemp - T) / r.rate;
    T = r.finalTemp;
    time += r.hold;
  }
  return time;
}

// ─── Chromatogram Simulation ──────────────────────────────────────────────

export interface AnalyteParams {
  name: string;
  dH: number;   // J/mol (negative)
  dS: number;   // J/(mol·K) (negative)
  carbonN: number;
  color: string;
  concentration: number; // relative, 1 = normal
  mw: number;
}

export interface SimColumn {
  length: number;     // m
  id: number;         // m (inner diameter)
  filmThickness: number; // m
}

export interface SimMethod {
  carrier: string;
  flowRate: number;   // mL/min
  outletPressure: number; // Pa (usually atm = 101325)
  oven: OvenProgram;
  splitRatio: number;
  injVol: number;     // μL
  fidTemperature: number; // °C
  h2Flow: number;
  airFlow: number;
  makeupFlow: number;
  inletTemp: number;
}

export interface SimPeak {
  name: string;
  tR_s: number;
  sigma_s: number;
  height: number;
  area: number;
  N: number;
  k: number;
  color: string;
  tM_s: number;
}

export interface ChromSim {
  timeArr: Float64Array; // seconds
  signalArr: Float64Array; // pA
  peaks: SimPeak[];
  tM_s: number;
  totalTime_s: number;
  Pi_kPa: number;
  u_cms: number;
}

function noise1f(seed: number): number {
  // Simple 1/f-ish noise via summation of harmonics
  let n = 0;
  for (let h = 1; h <= 8; h++) n += Math.sin(seed * h * 0.37 + h) / h;
  return n * 0.15;
}

// White noise
function wn(): number { return (Math.random() - 0.5) * 2; }

export function simulateChromatogram(
  method: SimMethod,
  column: SimColumn,
  analytes: AnalyteParams[]
): ChromSim {
  const DT = 0.2; // simulation time step (seconds)
  const Po = method.outletPressure;
  const L = column.length;
  const r = column.id / 2;
  const df = column.filmThickness;
  const beta = phaseRatio(r, df);

  // Calculate inlet pressure from target flow at initial oven temp
  const T0_K = method.oven.initialTemp + 273.15;
  const eta0 = gasViscosity(method.carrier, T0_K);
  const Pi = inletPressureForFlow(method.flowRate, Po, L, r, eta0);

  const u0 = columnLinearVelocity(Pi, Po, L, r, eta0); // m/s at initial T
  const tM0_s = holdUpTime_s(L, u0);

  const runTime_s = programRunTime(method.oven) * 60 + 60; // add 1 min buffer
  const N_steps = Math.ceil(runTime_s / DT);

  // Baseline noise parameters
  const noiseAmp = 0.3 + Math.random() * 0.1; // pA

  // Store signal array
  const timeArr = new Float64Array(N_steps);
  const signalArr = new Float64Array(N_steps);

  // Simulate analyte migration
  const analyte_pos: number[] = analytes.map(() => 0); // 0 to L (m)
  const retentionResults: SimPeak[] = [];
  const exited: boolean[] = analytes.map(() => false);

  for (let i = 0; i < N_steps; i++) {
    const t_s = i * DT;
    const t_min = t_s / 60;
    const T_K = ovenTemp_C(method.oven, t_min) + 273.15;
    const eta = gasViscosity(method.carrier, T_K);

    // Constant-flow EPC: adjust Pi to maintain flow
    const Pi_i = inletPressureForFlow(method.flowRate, Po, L, r, eta);
    const Pm_i = (Pi_i + Po) / 2;
    const u_i = columnLinearVelocity(Pi_i, Po, L, r, eta); // m/s

    timeArr[i] = t_s;

    // Baseline: drift + noise + bleed
    const bleed = Math.max(0, (T_K - 573) * 0.002); // pA, above 300°C
    const drift = Math.sin(t_s * 0.002) * 0.05;
    signalArr[i] = 5.0 + drift + bleed + noise1f(t_s * 0.7) * noiseAmp + wn() * noiseAmp * 0.3;

    // Migrate each analyte
    for (let a = 0; a < analytes.length; a++) {
      if (exited[a]) continue;
      const an = analytes[a];
      const k = retentionFactor(an.dH, an.dS, T_K, beta);
      const dx = u_i * DT / (1 + k); // meters this step
      analyte_pos[a] += dx;

      if (analyte_pos[a] >= L) {
        exited[a] = true;
        const tR_s = t_s;
        // Calculate efficiency at this temperature/velocity
        const Dm = gasPhaseDm(method.carrier, T_K, Pm_i);
        const Ds = stationaryPhaseDm(T_K);
        const H = golayH(u_i, r, df, k, Dm, Ds);
        const N = theoreticalPlates(L, H);
        const sigma_s = peakSigma_t(tR_s, N);
        const splitEff = method.splitRatio > 0 ? 1 / (1 + method.splitRatio) : 1;
        const height = an.concentration * an.carbonN * splitEff * 800 / sigma_s;

        retentionResults.push({
          name: an.name,
          tR_s,
          sigma_s,
          height,
          area: height * sigma_s * Math.sqrt(2 * Math.PI),
          N,
          k,
          color: an.color,
          tM_s: tM0_s,
        });
      }
    }
  }

  // Add Gaussian peaks to signal array
  for (const peak of retentionResults) {
    const i_center = Math.round(peak.tR_s / DT);
    const i_span = Math.ceil(peak.sigma_s * 5 / DT);
    for (let di = -i_span; di <= i_span; di++) {
      const idx = i_center + di;
      if (idx < 0 || idx >= N_steps) continue;
      const t = idx * DT;
      signalArr[idx] += peak.height * Math.exp(-0.5 * Math.pow((t - peak.tR_s) / peak.sigma_s, 2));
    }
  }

  return {
    timeArr,
    signalArr,
    peaks: retentionResults.sort((a, b) => a.tR_s - b.tR_s),
    tM_s: tM0_s,
    totalTime_s: runTime_s,
    Pi_kPa: (Pi - Po) / 1000, // gauge kPa
    u_cms: u0 * 100,
  };
}
