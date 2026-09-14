import type { AnalyteParams, OvenProgram, SimMethod } from './physics';

// ─── Column Library ──────────────────────────────────────────────────────────

export interface GCColumn {
  id: string;
  name: string;
  manufacturer: string;
  phase: string;
  polarity: 'Nonpolar' | 'Mid-polar' | 'Polar';
  maxTemp: number;
  minTemp: number;
  length: number;   // m
  innerDiameter: number; // mm
  filmThickness: number; // μm
  description: string;
}

export const COLUMNS: GCColumn[] = [
  { id: 'db5ms',   name: 'DB-5ms',      manufacturer: 'Agilent', phase: '5% Phenyl Polysiloxane',          polarity: 'Nonpolar',  maxTemp: 325, minTemp: -60, length: 30, innerDiameter: 0.25, filmThickness: 0.25, description: 'Most widely used GC column. Excellent for volatiles, semivolatiles, pesticides.' },
  { id: 'db1',     name: 'DB-1',        manufacturer: 'Agilent', phase: '100% Dimethylpolysiloxane',        polarity: 'Nonpolar',  maxTemp: 325, minTemp: -60, length: 30, innerDiameter: 0.25, filmThickness: 0.25, description: 'Ultra-low bleed nonpolar phase. Ideal for hydrocarbons and general use.' },
  { id: 'db17',    name: 'DB-17',       manufacturer: 'Agilent', phase: '50% Phenyl Polysiloxane',          polarity: 'Mid-polar', maxTemp: 360, minTemp:  20, length: 30, innerDiameter: 0.25, filmThickness: 0.25, description: 'Mid-polar phase for pesticides, steroids, drugs, and PAHs.' },
  { id: 'db624',   name: 'DB-624',      manufacturer: 'Agilent', phase: '6% Cyanopropyl / 94% Dimethyl',   polarity: 'Mid-polar', maxTemp: 260, minTemp: -20, length: 30, innerDiameter: 0.25, filmThickness: 1.40, description: 'Method 624 and 8260 volatiles. Ideal for EPA VOC analysis.' },
  { id: 'dbwax',   name: 'DB-Wax',      manufacturer: 'Agilent', phase: 'Polyethylene Glycol (PEG)',        polarity: 'Polar',     maxTemp: 260, minTemp:  20, length: 30, innerDiameter: 0.25, filmThickness: 0.25, description: 'Polar phase for solvents, alcohols, ethers, esters, and aldehydes.' },
  { id: 'rtx5',    name: 'Rtx-5',       manufacturer: 'Restek',  phase: '5% Diphenyl / 95% Dimethyl',      polarity: 'Nonpolar',  maxTemp: 330, minTemp: -60, length: 30, innerDiameter: 0.25, filmThickness: 0.25, description: 'High-resolution equivalent of DB-5. Low bleed, wide applicability.' },
  { id: 'hp5',     name: 'HP-5',        manufacturer: 'Agilent', phase: '5% Phenyl Methyl Siloxane',        polarity: 'Nonpolar',  maxTemp: 325, minTemp: -60, length: 30, innerDiameter: 0.32, filmThickness: 0.25, description: 'Classic general-purpose column matching NIST reference library.' },
  { id: 'vf17ms',  name: 'VF-17ms',     manufacturer: 'Agilent', phase: '50% Phenyl / 50% Dimethyl',       polarity: 'Mid-polar', maxTemp: 340, minTemp:  20, length: 30, innerDiameter: 0.25, filmThickness: 0.25, description: 'High phenyl mid-polar for isomer differentiation and PCBs.' },
];

// ─── Analyte Library ─────────────────────────────────────────────────────────
// van't Hoff params calibrated for DB-5 / nonpolar columns:
// k(T) = (1/β) * exp(-dH/(R·T) + dS/R)
// β = r/(2·df) = 0.125mm/(2×0.00025mm) = 250 (for 0.25mm ID, 0.25μm film)

export const ANALYTES: AnalyteParams[] = [
  // n-Alkanes (homologous series on DB-5)
  { name: 'Pentane',       dH: -53500, dS: -127, carbonN: 5,  color: '#00d4ff', concentration: 1.0, mw:  72.15 },
  { name: 'Hexane',        dH: -59200, dS: -137, carbonN: 6,  color: '#00aaff', concentration: 1.0, mw:  86.18 },
  { name: 'Heptane',       dH: -64700, dS: -147, carbonN: 7,  color: '#0088ff', concentration: 1.0, mw: 100.21 },
  { name: 'Octane',        dH: -70200, dS: -157, carbonN: 8,  color: '#0066ff', concentration: 1.0, mw: 114.23 },
  { name: 'Nonane',        dH: -75700, dS: -167, carbonN: 9,  color: '#4455ff', concentration: 1.0, mw: 128.26 },
  { name: 'Decane',        dH: -81200, dS: -177, carbonN: 10, color: '#6644ff', concentration: 1.0, mw: 142.28 },
  { name: 'Undecane',      dH: -86700, dS: -187, carbonN: 11, color: '#8833ff', concentration: 1.0, mw: 156.31 },
  { name: 'Dodecane',      dH: -92200, dS: -197, carbonN: 12, color: '#aa22ff', concentration: 1.0, mw: 170.34 },
  // BTEX (aromatics)
  { name: 'Benzene',       dH: -61000, dS: -140, carbonN: 6,  color: '#ff6644', concentration: 1.0, mw:  78.11 },
  { name: 'Toluene',       dH: -66500, dS: -150, carbonN: 7,  color: '#ff8844', concentration: 1.0, mw:  92.14 },
  { name: 'Ethylbenzene',  dH: -72000, dS: -160, carbonN: 8,  color: '#ffaa44', concentration: 1.0, mw: 106.17 },
  { name: 'm-Xylene',      dH: -72800, dS: -161, carbonN: 8,  color: '#ffcc44', concentration: 1.0, mw: 106.17 },
  { name: 'p-Xylene',      dH: -72400, dS: -160, carbonN: 8,  color: '#ffdd55', concentration: 1.0, mw: 106.17 },
  { name: 'o-Xylene',      dH: -74000, dS: -163, carbonN: 8,  color: '#ffee66', concentration: 1.0, mw: 106.17 },
  // Oxygenates
  { name: 'Methanol',      dH: -44000, dS: -118, carbonN: 1,  color: '#ff4488', concentration: 1.0, mw:  32.04 },
  { name: 'Ethanol',       dH: -49500, dS: -128, carbonN: 2,  color: '#ff55aa', concentration: 1.0, mw:  46.07 },
  { name: 'Isopropanol',   dH: -53000, dS: -133, carbonN: 3,  color: '#ff66cc', concentration: 1.0, mw:  60.10 },
  { name: 'Acetone',       dH: -47000, dS: -126, carbonN: 3,  color: '#ff77dd', concentration: 1.0, mw:  58.08 },
  { name: 'MEK',           dH: -52500, dS: -136, carbonN: 4,  color: '#ff88ee', concentration: 1.0, mw:  72.11 },
  // Halogenated
  { name: 'Dichloromethane', dH: -48000, dS: -129, carbonN: 1, color: '#44ffcc', concentration: 1.0, mw:  84.93 },
  { name: 'Chloroform',    dH: -53500, dS: -139, carbonN: 1,  color: '#44ffaa', concentration: 1.0, mw: 119.38 },
  { name: 'CCl4',          dH: -59000, dS: -149, carbonN: 0,  color: '#44ff88', concentration: 1.0, mw: 153.82 },
  // Solvents
  { name: 'Diethyl ether', dH: -50500, dS: -131, carbonN: 4,  color: '#aaffcc', concentration: 1.0, mw:  74.12 },
  { name: 'THF',           dH: -55000, dS: -141, carbonN: 4,  color: '#88ffaa', concentration: 1.0, mw:  72.11 },
  { name: 'Ethyl acetate', dH: -57000, dS: -144, carbonN: 4,  color: '#66ff88', concentration: 1.0, mw:  88.11 },
];

// ─── Preset Sample Mixtures ─────────────────────────────────────────────────

export interface SampleMixture {
  name: string;
  description: string;
  analyteNames: string[];
}

export const SAMPLE_MIXTURES: SampleMixture[] = [
  { name: 'n-Alkane Standard (C5-C10)', description: 'Retention index standard mixture for column characterisation', analyteNames: ['Pentane','Hexane','Heptane','Octane','Nonane','Decane'] },
  { name: 'BTEX / Aromatics', description: 'Benzene, Toluene, Ethylbenzene, Xylenes — environmental EPA 8260', analyteNames: ['Benzene','Toluene','Ethylbenzene','m-Xylene','p-Xylene','o-Xylene'] },
  { name: 'Alcohol / Oxygenate Mix', description: 'Common solvents and oxygenates in pharmaceutical QC', analyteNames: ['Methanol','Ethanol','Isopropanol','Acetone','MEK'] },
  { name: 'Halogenated Solvents', description: 'Chlorinated solvents for ICH Q3C residual solvents', analyteNames: ['Dichloromethane','Chloroform','CCl4'] },
  { name: 'Gasoline / Petroleum', description: 'Aliphatic + aromatic fraction simulation', analyteNames: ['Pentane','Hexane','Benzene','Heptane','Toluene','Octane','Ethylbenzene','p-Xylene'] },
  { name: 'Unknown Sample A', description: 'Unknown mixture for identification exercise', analyteNames: ['Hexane','Toluene','Octane','Ethylbenzene','Decane'] },
];

// ─── Default Method ──────────────────────────────────────────────────────────

export const DEFAULT_OVEN: OvenProgram = {
  initialTemp: 50,
  initialHold: 2,
  ramps: [
    { rate: 10, finalTemp: 200, hold: 2 },
    { rate: 20, finalTemp: 280, hold: 5 },
  ],
  postRunTemp: 50,
  equilibrationTime: 2,
};

export const DEFAULT_METHOD: SimMethod = {
  carrier: 'He',
  flowRate: 1.0,
  outletPressure: 101325,
  oven: DEFAULT_OVEN,
  splitRatio: 50,
  injVol: 1.0,
  fidTemperature: 300,
  h2Flow: 40,
  airFlow: 400,
  makeupFlow: 25,
  inletTemp: 250,
};
