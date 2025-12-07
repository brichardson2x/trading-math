// Web Worker performing Monte Carlo trading simulation
// Receives Params and returns Results

export type Params = {
  initialCapital: number;
  riskPercentage: number; // percent
  riskRewardRatio: number;
  winRate: number; // percent
  tradesPerMonth: number;
  timeMonths: number;
  riskCapDollars: number;
  compoundingFrequency?: 'daily' | 'monthly' | 'quarterly' | 'yearly';
};

type MonthlyPoint = { month: number; capital: number };
export type SimulationResult = { finalCapital: number; monthlyData: MonthlyPoint[] };

// labels not needed in worker when returning raw results

export type ChartPoint = {
  month: number;
  'Worst Sim'?: number;
  '25th %ile'?: number;
  'Median'?: number;
  '75th %ile'?: number;
  'Best Sim'?: number;
};

// Message contract: provide params and simulations count for this chunk
export type WorkerRequest = 
  | { kind: 'finals'; params: Params; simulations: number }
  | { kind: 'paths'; params: Params; simulations: number };
export type FinalsResponse = { kind: 'finals'; finals: Float64Array };
export type PathsResponse = { kind: 'paths'; paths: SimulationResult[] };
export type WorkerResponse = FinalsResponse | PathsResponse;

// Heavy computation moved here
function runChunk(params: Params, simulations: number): SimulationResult[] {
  const winRateDecimal: number = params.winRate / 100;
  const riskPercentDecimal: number = params.riskPercentage / 100;
  const simResults: SimulationResult[] = [];

  for (let sim = 0; sim < simulations; sim++) {
    let capital: number = params.initialCapital;
    const monthlyData: MonthlyPoint[] = [{ month: 0, capital }];
    let currentRiskPerTrade: number = Math.min(capital * riskPercentDecimal, params.riskCapDollars);
    let currentRewardPerTrade: number = currentRiskPerTrade * params.riskRewardRatio;

    // determine recalc interval in months (0 means recalc every trade)
    const freq = params.compoundingFrequency ?? 'quarterly';
    const recalcMonths = freq === 'daily' ? 0 : freq === 'monthly' ? 1 : freq === 'quarterly' ? 3 : 12;

    for (let month = 1; month <= params.timeMonths; month++) {
      for (let trade = 0; trade < params.tradesPerMonth; trade++) {
        const isWin = Math.random() < winRateDecimal;
        if (isWin) {
          capital += currentRewardPerTrade;
        } else {
          capital -= currentRiskPerTrade;
        }
        if (capital < 0) capital = 0;

        // If daily compounding (recalc every trade), update after each trade
        if (recalcMonths === 0) {
          currentRiskPerTrade = Math.min(capital * riskPercentDecimal, params.riskCapDollars);
          currentRewardPerTrade = currentRiskPerTrade * params.riskRewardRatio;
        }
      }

      // Reassess risk depending on selected frequency
      if (recalcMonths > 0 && month % recalcMonths === 0) {
        currentRiskPerTrade = Math.min(capital * riskPercentDecimal, params.riskCapDollars);
        currentRewardPerTrade = currentRiskPerTrade * params.riskRewardRatio;
      }

      monthlyData.push({ month, capital });
    }

    simResults.push({ finalCapital: capital, monthlyData });
  }
  return simResults;
}

// Worker message handling
self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;
  if (msg.kind === 'finals') {
    const simResults = runChunk(msg.params, msg.simulations);
    // Return only final capitals as a transferable Float64Array to minimize copy cost
    const finals = new Float64Array(simResults.map(r => r.finalCapital));
    // postMessage with transferable
    // @ts-ignore
    self.postMessage({ kind: 'finals', finals } as FinalsResponse, [finals.buffer]);
  } else if (msg.kind === 'paths') {
    // For charting, compute a smaller set and return full monthly paths for sampling
    const simResults = runChunk(msg.params, msg.simulations);
    // Sort and pick 5 percentiles
    const sorted = simResults.slice().sort((a, b) => a.finalCapital - b.finalCapital);
    const picks = [
      0,
      Math.floor(sorted.length * 0.25),
      Math.floor(sorted.length * 0.5),
      Math.floor(sorted.length * 0.75),
      sorted.length - 1,
    ];
    const paths = picks.map(i => sorted[i]);
    self.postMessage({ kind: 'paths', paths } as PathsResponse);
  }
};
