import React, { useState, useEffect, useRef } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import type { Params as WorkerParams, WorkerRequest, WorkerResponse, FinalsResponse, PathsResponse } from './simulationWorker';
import RrrCalculator from './rrr_calculator';

// Vite-friendly worker loader
const createSimulationWorker = () => new Worker(new URL('./simulationWorker.ts', import.meta.url), { type: 'module' });

// Local types
type Results = {
  mean: number;
  median: number;
  percentile25: number;
  percentile75: number;
  percentile10: number;
  percentile90: number;
  worst: number;
  best: number;
  allWinsCapital: number;
  allLossesCapital: number;
  chartData: Array<{
    month: number;
    'Worst Sim'?: number;
    '25th %ile'?: number;
    'Median'?: number;
    '75th %ile'?: number;
    'Best Sim'?: number;
  }>;
  totalTrades: number;
};

type ComponentParams = WorkerParams & { simulations: number };

const MonteCarloTrading: React.FC = () => {
  const [results, setResults] = useState<Results | null>(null);
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [showInputs, setShowInputs] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number }>({ done: 0, total: 0 });

  const [params, setParams] = useState<ComponentParams>({
    initialCapital: 50000,
    riskPercentage: 1,
    riskRewardRatio: 3,
    winRate: 30,
    tradesPerMonth: 7,
    timeMonths: 36,
    simulations: 10000,
    riskCapDollars: 3000
  });

  const handleInputChange = (field: keyof ComponentParams, value: string) => {
    setParams(prev => ({
      ...prev,
      [field]: (Number(value) || 0) as unknown as ComponentParams[keyof ComponentParams]
    }));
  };

  const pendingWorkers = useRef<Worker[]>([]);

  const runSimulation = () => {
    setIsRunning(true);
    setErrorMsg(null);
    setProgress({ done: 0, total: 0 });
    // Use a small bounded worker pool + batching to avoid huge allocations/OOM.
    const hw = (navigator as any).hardwareConcurrency ?? 4;
    const maxWorkers = Math.min(Math.max(1, hw), 8); // cap worker pool to at most 8
    const batchSize = 20000; // max sims per worker batch (tuneable)

    // Streaming stats to limit memory: track sum/min/max and a reservoir sample for percentiles
    const totalSims = params.simulations;
    const sampleSize = Math.min(20000, totalSims); // adjustable
    const reservoir: number[] = [];
    let seen = 0; // total finals seen
    let sum = 0;
    let minVal = Number.POSITIVE_INFINITY;
    let maxVal = Number.NEGATIVE_INFINITY;

    // compute number of batches and progress as batches completed
    const totalBatches = Math.ceil(totalSims / batchSize);
    setProgress({ done: 0, total: totalBatches });

    // atomic-ish pointer for next batch (main thread only)
    let nextStart = 0;

    // helper to request the next batch size
    const getNextBatch = () => {
      if (nextStart >= totalSims) return 0;
      const remaining = totalSims - nextStart;
      const take = Math.min(batchSize, remaining);
      nextStart += take;
      return take;
    };

    let completedBatches = 0;

    // spawn a pool of workers and have each reuse to process sequential batches
    const poolSize = Math.min(maxWorkers, totalBatches);
    pendingWorkers.current = [];

    const workerPromises: Promise<void>[] = [];

    for (let i = 0; i < poolSize; i++) {
      const w = createSimulationWorker();
      pendingWorkers.current.push(w);

      const p = new Promise<void>((resolve) => {
        const onMessage = (ev: MessageEvent<WorkerResponse>) => {
          const data = ev.data as FinalsResponse;
          if (!data || (data as any).kind !== 'finals' || !(data as any).finals) {
            console.error('Unexpected worker response', ev.data);
            setErrorMsg('Unexpected worker response received.');
            // terminate this worker and resolve (will reduce pool)
            w.removeEventListener('message', onMessage as any);
            w.terminate();
            resolve();
            return;
          }

          const finals = data.finals; // Float64Array
          // Update streaming stats and reservoir sample
          for (let k = 0; k < finals.length; k++) {
            const v = finals[k];
            sum += v;
            seen += 1;
            if (v < minVal) minVal = v;
            if (v > maxVal) maxVal = v;
            if (reservoir.length < sampleSize) {
              reservoir.push(v);
            } else {
              const j = Math.floor(Math.random() * seen);
              if (j < sampleSize) reservoir[j] = v;
            }
          }

          completedBatches += 1;
          setProgress(prev => ({ ...prev, done: Math.min(prev.done + 1, prev.total) }));

          // ask this worker to process another batch if available
          const nextSims = getNextBatch();
          if (nextSims > 0) {
            const wp: WorkerParams = {
              initialCapital: params.initialCapital,
              riskPercentage: params.riskPercentage,
              riskRewardRatio: params.riskRewardRatio,
              winRate: params.winRate,
              tradesPerMonth: params.tradesPerMonth,
              timeMonths: params.timeMonths,
              riskCapDollars: params.riskCapDollars,
            };
            const req: WorkerRequest = { kind: 'finals', params: wp, simulations: nextSims };
            w.postMessage(req);
            return; // continue listening
          }

          // no more batches for this worker: cleanup and resolve
          w.removeEventListener('message', onMessage as any);
          w.terminate();
          resolve();
        };

        w.addEventListener('message', onMessage as any);
        w.onerror = (err) => {
          console.error('Worker error', err);
          w.removeEventListener('message', onMessage as any);
          try { w.terminate(); } catch {}
          setErrorMsg('A worker encountered an error. Try lowering the number of simulations or batch size.');
          resolve();
        };

        // kick off first batch for this worker
        const firstSims = getNextBatch();
        if (firstSims > 0) {
          const wp: WorkerParams = {
            initialCapital: params.initialCapital,
            riskPercentage: params.riskPercentage,
            riskRewardRatio: params.riskRewardRatio,
            winRate: params.winRate,
            tradesPerMonth: params.tradesPerMonth,
            timeMonths: params.timeMonths,
            riskCapDollars: params.riskCapDollars,
          };
          const req: WorkerRequest = { kind: 'finals', params: wp, simulations: firstSims };
          w.postMessage(req);
        } else {
          // nothing to do
          w.removeEventListener('message', onMessage as any);
          w.terminate();
          resolve();
        }
      });

      workerPromises.push(p);
    }

    // When all workers finish batches, compute summary
    Promise.all(workerPromises).then(() => {
      // Compute summary from streaming stats and reservoir sample
      const mean = seen > 0 ? sum / seen : 0;
      reservoir.sort((a, b) => a - b);
      const pick = (p: number) => reservoir[Math.floor(reservoir.length * p)] ?? 0;
      const summary = {
        mean,
        median: pick(0.5),
        percentile25: pick(0.25),
        percentile75: pick(0.75),
        percentile10: pick(0.10),
        percentile90: pick(0.90),
        worst: minVal === Number.POSITIVE_INFINITY ? 0 : minVal,
        best: maxVal === Number.NEGATIVE_INFINITY ? 0 : maxVal,
        allWinsCapital: 0, // filled below
        allLossesCapital: 0, // filled below
        chartData: [],
        totalTrades: params.tradesPerMonth * params.timeMonths,
      } as Results;

      // Compute extremes (all wins/losses)
      const riskPercentDecimal = params.riskPercentage / 100;
      let bestCapital = params.initialCapital;
      let bestRisk = Math.min(bestCapital * riskPercentDecimal, params.riskCapDollars);
      let bestReward = bestRisk * params.riskRewardRatio;
      for (let month = 1; month <= params.timeMonths; month++) {
        for (let trade = 0; trade < params.tradesPerMonth; trade++) {
          bestCapital += bestReward;
        }
        if (month % 3 === 0) {
          bestRisk = Math.min(bestCapital * riskPercentDecimal, params.riskCapDollars);
          bestReward = bestRisk * params.riskRewardRatio;
        }
      }
      let worstCapitalCalc = params.initialCapital;
      let worstRisk = Math.min(worstCapitalCalc * riskPercentDecimal, params.riskCapDollars);
      for (let month = 1; month <= params.timeMonths; month++) {
        for (let trade = 0; trade < params.tradesPerMonth; trade++) {
          worstCapitalCalc -= worstRisk;
          if (worstCapitalCalc < 0) worstCapitalCalc = 0;
        }
        if (month % 3 === 0 && worstCapitalCalc > 0) {
          worstRisk = Math.min(worstCapitalCalc * riskPercentDecimal, params.riskCapDollars);
        }
      }
      summary.allWinsCapital = bestCapital;
      summary.allLossesCapital = worstCapitalCalc;

      // fetch chart path samples
      fetchChartPaths(params).then(chartData => {
        summary.chartData = chartData;
        setResults(summary);
        setIsRunning(false);
        pendingWorkers.current = [];
      }).catch(err => {
        console.error(err);
        setErrorMsg('Failed to compute chart paths.');
        setIsRunning(false);
      });
    }).catch(err => {
      console.error('Error waiting for worker pool', err);
      setErrorMsg('Worker pool failed. Try lowering simulations or batch size.');
      setIsRunning(false);
      pendingWorkers.current.forEach(w => { try { w.terminate(); } catch {} });
      pendingWorkers.current = [];
    });
  };
  // (removed old merge and compute helpers to avoid large-array allocations)

  // Fetch chart paths from a small paths worker job
  const fetchChartPaths = (params: ComponentParams) => {
    return new Promise<Results['chartData']>((resolve) => {
      const w = createSimulationWorker();
      const wp: WorkerParams = {
        initialCapital: params.initialCapital,
        riskPercentage: params.riskPercentage,
        riskRewardRatio: params.riskRewardRatio,
        winRate: params.winRate,
        tradesPerMonth: params.tradesPerMonth,
        timeMonths: params.timeMonths,
        riskCapDollars: params.riskCapDollars,
      };
      // Use a smaller count for paths to minimize cost
      const sims = Math.min(1000, params.simulations);
      w.onmessage = (ev: MessageEvent<PathsResponse>) => {
        const paths = ev.data.paths;
        const labels = ['Worst Sim', '25th %ile', 'Median', '75th %ile', 'Best Sim'] as const;
        const chartData: Results['chartData'] = [];
        for (let month = 0; month <= params.timeMonths; month++) {
          const point: any = { month };
          paths.forEach((p, i) => {
            const label = labels[i];
            point[label] = p.monthlyData[month]?.capital ?? 0;
          });
          chartData.push(point);
        }
        w.terminate();
        resolve(chartData);
      };
      const req: WorkerRequest = { kind: 'paths', params: wp, simulations: sims };
      w.postMessage(req);
    });
  };

  useEffect(() => {
    runSimulation();
    return () => {
      // Cleanup any running workers on unmount
      pendingWorkers.current.forEach(w => w.terminate());
      pendingWorkers.current = [];
    };
  }, []);

  // (removed unused old helper)

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(value);
  };

  const formatPercent = (initial: number, final: number) => {
    const percent = ((final - initial) / initial * 100).toFixed(1);
    return `${percent}%`;
  };

  // Calculate current risk/reward based on initial capital
  const initialRisk = Math.min(params.initialCapital * (params.riskPercentage / 100), params.riskCapDollars);
  const initialReward = initialRisk * params.riskRewardRatio;
  const expectedValuePerTrade = (params.winRate / 100) * initialReward - (1 - params.winRate / 100) * initialRisk;

  return (
    <div className="w-full max-w-6xl mx-auto p-6 bg-gray-50">
      <h1 className="text-3xl font-bold text-gray-800 mb-6">Monte Carlo Trading Analysis</h1>
      
      {/* Interactive Input Parameters */}
      <div className="bg-white rounded-lg shadow p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold">Input Parameters</h2>
          <button
            onClick={() => setShowInputs(!showInputs)}
            className="text-blue-600 hover:text-blue-800 font-medium"
          >
            {showInputs ? 'Hide' : 'Show'} Inputs
          </button>
        </div>
        
        {showInputs && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Initial Portfolio ($)
              </label>
              <input
                type="number"
                value={params.initialCapital}
                onChange={(e) => handleInputChange('initialCapital', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Risk per Trade (%)
              </label>
              <input
                type="number"
                value={params.riskPercentage}
                onChange={(e) => handleInputChange('riskPercentage', e.target.value)}
                step="0.1"
                min="0"
                max="100"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-xs text-gray-500 mt-1">% of capital risked per trade (reassessed quarterly)</p>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Risk-Reward Ratio (1:X)
              </label>
              <input
                type="number"
                value={params.riskRewardRatio}
                onChange={(e) => handleInputChange('riskRewardRatio', e.target.value)}
                step="0.1"
                min="0.1"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-xs text-gray-500 mt-1">For every $1 risked, how much do you aim to make?</p>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Max Risk per Trade Cap ($)
              </label>
              <input
                type="number"
                value={params.riskCapDollars}
                onChange={(e) => handleInputChange('riskCapDollars', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-xs text-gray-500 mt-1">Maximum $ amount to risk per trade (even if % would be higher)</p>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Win Rate (%)
              </label>
              <input
                type="number"
                value={params.winRate}
                onChange={(e) => handleInputChange('winRate', e.target.value)}
                min="0"
                max="100"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Trades per Month
              </label>
              <input
                type="number"
                value={params.tradesPerMonth}
                onChange={(e) => handleInputChange('tradesPerMonth', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Time Period (months)
              </label>
              <input
                type="number"
                value={params.timeMonths}
                onChange={(e) => handleInputChange('timeMonths', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Number of Simulations
              </label>
              <input
                type="number"
                value={params.simulations}
                onChange={(e) => handleInputChange('simulations', e.target.value)}
                min="1000"
                max="50000"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
        )}
        
        <div className="flex flex-wrap gap-4 items-center">
          <button
            onClick={runSimulation}
            disabled={isRunning}
            className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed font-medium transition-colors"
          >
            {isRunning ? 'Running...' : 'Run Simulation'}
          </button>
          
          <div className="flex flex-wrap gap-4 text-sm text-gray-600">
            <span>Initial Risk: {formatCurrency(initialRisk)}</span>
            <span>•</span>
            <span>Initial Reward: {formatCurrency(initialReward)}</span>
            <span>•</span>
            <span>RRR: 1:{params.riskRewardRatio}</span>
            <span>•</span>
            <span>EV/Trade: {formatCurrency(expectedValuePerTrade)}</span>
          </div>
        </div>
      </div>

      {isRunning ? (
        <div className="bg-white rounded-lg shadow p-12 text-center space-y-2">
          <p className="text-xl">Running simulation...</p>
          <p className="text-sm text-gray-600">Workers: {progress.done}/{progress.total} completed</p>
        </div>
      ) : errorMsg ? (
        <div className="bg-red-50 rounded-lg shadow p-6 text-red-700">
          <p className="font-semibold">Error</p>
          <p className="text-sm">{errorMsg}</p>
        </div>
      ) : results ? (
        <>
          {/* Theoretical Extremes */}
          <div className="bg-white rounded-lg shadow p-6 mb-6">
            <h2 className="text-xl font-semibold mb-4">Theoretical Extremes</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="border-l-4 border-green-500 pl-4">
                <p className="text-sm text-gray-600 mb-1">Best Case (All Wins)</p>
                <p className="text-2xl font-bold text-green-600">{formatCurrency(results.allWinsCapital)}</p>
                <p className="text-sm text-gray-500">Gain: {formatPercent(params.initialCapital, results.allWinsCapital)}</p>
              </div>
              <div className="border-l-4 border-red-500 pl-4">
                <p className="text-sm text-gray-600 mb-1">Worst Case (All Losses)</p>
                <p className="text-2xl font-bold text-red-600">{formatCurrency(results.allLossesCapital)}</p>
                <p className="text-sm text-gray-500">Loss: {formatPercent(params.initialCapital, results.allLossesCapital)}</p>
              </div>
            </div>
          </div>

          {/* Monte Carlo Results */}
          <div className="bg-white rounded-lg shadow p-6 mb-6">
            <h2 className="text-xl font-semibold mb-4">Monte Carlo Results ({params.simulations.toLocaleString()} Simulations)</h2>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              <div className="bg-blue-50 p-4 rounded">
                <p className="text-sm text-gray-600 mb-1">Mean</p>
                <p className="text-xl font-bold text-blue-600">{formatCurrency(results.mean)}</p>
                <p className="text-xs text-gray-500">{formatPercent(params.initialCapital, results.mean)}</p>
              </div>
              <div className="bg-blue-50 p-4 rounded">
                <p className="text-sm text-gray-600 mb-1">Median</p>
                <p className="text-xl font-bold text-blue-600">{formatCurrency(results.median)}</p>
                <p className="text-xs text-gray-500">{formatPercent(params.initialCapital, results.median)}</p>
              </div>
              <div className="bg-green-50 p-4 rounded">
                <p className="text-sm text-gray-600 mb-1">90th Percentile</p>
                <p className="text-xl font-bold text-green-600">{formatCurrency(results.percentile90)}</p>
                <p className="text-xs text-gray-500">{formatPercent(params.initialCapital, results.percentile90)}</p>
              </div>
              <div className="bg-green-50 p-4 rounded">
                <p className="text-sm text-gray-600 mb-1">75th Percentile</p>
                <p className="text-xl font-bold text-green-600">{formatCurrency(results.percentile75)}</p>
                <p className="text-xs text-gray-500">{formatPercent(params.initialCapital, results.percentile75)}</p>
              </div>
              <div className="bg-orange-50 p-4 rounded">
                <p className="text-sm text-gray-600 mb-1">25th Percentile</p>
                <p className="text-xl font-bold text-orange-600">{formatCurrency(results.percentile25)}</p>
                <p className="text-xs text-gray-500">{formatPercent(params.initialCapital, results.percentile25)}</p>
              </div>
              <div className="bg-red-50 p-4 rounded">
                <p className="text-sm text-gray-600 mb-1">10th Percentile</p>
                <p className="text-xl font-bold text-red-600">{formatCurrency(results.percentile10)}</p>
                <p className="text-xs text-gray-500">{formatPercent(params.initialCapital, results.percentile10)}</p>
              </div>
              <div className="bg-green-100 p-4 rounded">
                <p className="text-sm text-gray-600 mb-1">Best Simulation</p>
                <p className="text-xl font-bold text-green-700">{formatCurrency(results.best)}</p>
                <p className="text-xs text-gray-500">{formatPercent(params.initialCapital, results.best)}</p>
              </div>
              <div className="bg-red-100 p-4 rounded">
                <p className="text-sm text-gray-600 mb-1">Worst Simulation</p>
                <p className="text-xl font-bold text-red-700">{formatCurrency(results.worst)}</p>
                <p className="text-xs text-gray-500">{formatPercent(params.initialCapital, results.worst)}</p>
              </div>
            </div>
          </div>

          {/* Chart */}
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-semibold mb-4">Portfolio Growth Paths</h2>
            <ResponsiveContainer width="100%" height={400}>
              <LineChart data={results.chartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis 
                  dataKey="month" 
                  label={{ value: 'Month', position: 'insideBottom', offset: -5 }}
                />
                <YAxis 
                  label={{ value: 'Portfolio Value ($)', angle: -90, position: 'insideLeft' }}
                  tickFormatter={(value: number) => `$${(value / 1000).toFixed(0)}k`}
                />
                <Tooltip 
                  formatter={(value: number | string) => formatCurrency(Number(value))}
                  labelFormatter={(label: number | string) => `Month ${label}`}
                />
                <Legend />
                <Line type="monotone" dataKey="Worst Sim" stroke="#dc2626" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="25th %ile" stroke="#f97316" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="Median" stroke="#3b82f6" strokeWidth={3} dot={false} />
                <Line type="monotone" dataKey="75th %ile" stroke="#22c55e" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="Best Sim" stroke="#15803d" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Key Insights */}
          <div className="bg-white rounded-lg shadow p-6 mt-6">
            <h2 className="text-xl font-semibold mb-4">Key Insights</h2>
            <div className="space-y-2 text-gray-700">
              <p>• <strong>Risk Management:</strong> You risk {params.riskPercentage}% of capital per trade (starting at {formatCurrency(initialRisk)}), capped at {formatCurrency(params.riskCapDollars)}</p>
              <p>• <strong>Risk-Reward:</strong> 1:{params.riskRewardRatio} ratio means for every {formatCurrency(initialRisk)} risked initially, you aim to make {formatCurrency(initialReward)}</p>
              <p>• <strong>Expected Value:</strong> With {params.winRate}% win rate, each trade has an EV of {formatCurrency(expectedValuePerTrade)}</p>
              <p>• <strong>Quarterly Compounding:</strong> Every 3 months, risk is recalculated as {params.riskPercentage}% of current capital (up to ${params.riskCapDollars.toLocaleString()} cap)</p>
              <p>• <strong>Expected Outcome:</strong> Mean result is {formatCurrency(results.mean)} ({formatPercent(params.initialCapital, results.mean)} gain) over {results.totalTrades} trades</p>
              <p>• <strong>Median Outcome:</strong> 50% chance of being above {formatCurrency(results.median)}, 50% chance below</p>
              <p>• The cap at {formatCurrency(params.riskCapDollars)} {initialRisk >= params.riskCapDollars ? 'is active from the start' : `will activate when capital reaches ${formatCurrency(params.riskCapDollars / (params.riskPercentage / 100))}`}</p>
            </div>
          </div>
          </>
      ) : null}

        {/* RRR Calculator (placed under the Monte Carlo output) */}
        <div className="mt-6">
          <RrrCalculator />
        </div>
    </div>
  );
};

export default MonteCarloTrading;