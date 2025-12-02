import React, { useState, useEffect } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

type Params = {
  initialCapital: number;
  riskPercentage: number; // percent
  riskRewardRatio: number;
  winRate: number; // percent
  tradesPerMonth: number;
  timeMonths: number;
  simulations: number;
  riskCapDollars: number;
};

type MonthlyPoint = { month: number; capital: number };

type SimulationResult = { finalCapital: number; monthlyData: MonthlyPoint[] };

const labels = ['Worst Sim', '25th %ile', 'Median', '75th %ile', 'Best Sim'] as const;

type ChartPoint = {
  month: number;
  'Worst Sim'?: number;
  '25th %ile'?: number;
  'Median'?: number;
  '75th %ile'?: number;
  'Best Sim'?: number;
};

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
  chartData: ChartPoint[];
  totalTrades: number;
};

const MonteCarloTrading: React.FC = () => {
  const [results, setResults] = useState<Results | null>(null);
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [showInputs, setShowInputs] = useState<boolean>(true);

  const [params, setParams] = useState<Params>({
    initialCapital: 50000,
    riskPercentage: 1,
    riskRewardRatio: 3,
    winRate: 30,
    tradesPerMonth: 7,
    timeMonths: 36,
    simulations: 10000,
    riskCapDollars: 3000
  });

  const handleInputChange = (field: keyof Params, value: string) => {
    setParams(prev => ({
      ...prev,
      [field]: (Number(value) || 0) as unknown as Params[keyof Params]
    }));
  };

  const runSimulation = () => {
    setIsRunning(true);

    setTimeout(() => {
      const winRateDecimal: number = params.winRate / 100;
      const riskPercentDecimal: number = params.riskPercentage / 100;
      const totalTrades: number = params.tradesPerMonth * params.timeMonths;
      const simResults: SimulationResult[] = [];

      for (let sim = 0; sim < params.simulations; sim++) {
        let capital: number = params.initialCapital;
        const monthlyData: MonthlyPoint[] = [{ month: 0, capital }];
        let currentRiskPerTrade: number = Math.min(capital * riskPercentDecimal, params.riskCapDollars);
        let currentRewardPerTrade: number = currentRiskPerTrade * params.riskRewardRatio;
        for (let month = 1; month <= params.timeMonths; month++) {
          for (let trade = 0; trade < params.tradesPerMonth; trade++) {
            const isWin = Math.random() < winRateDecimal;

            if (isWin) {
              capital += currentRewardPerTrade;
            } else {
              capital -= currentRiskPerTrade;
            }

            if (capital < 0) capital = 0;
          }

          // Reassess risk quarterly
          if (month % 3 === 0) {
            currentRiskPerTrade = Math.min(capital * riskPercentDecimal, params.riskCapDollars);
            currentRewardPerTrade = currentRiskPerTrade * params.riskRewardRatio;
          }

          monthlyData.push({ month, capital });
        }

        simResults.push({ finalCapital: capital, monthlyData });
      }

      // Sort results and compute statistics
      simResults.sort((a, b) => a.finalCapital - b.finalCapital);
      const finalCapitals = simResults.map(r => r.finalCapital);
      const mean = finalCapitals.reduce((a, b) => a + b, 0) / params.simulations;
      const median = finalCapitals[Math.floor(params.simulations / 2)];
      const percentile25 = finalCapitals[Math.floor(params.simulations * 0.25)];
      const percentile75 = finalCapitals[Math.floor(params.simulations * 0.75)];
      const percentile10 = finalCapitals[Math.floor(params.simulations * 0.10)];
      const percentile90 = finalCapitals[Math.floor(params.simulations * 0.90)];
      const worst = finalCapitals[0];
      const best = finalCapitals[params.simulations - 1];

      // Best case (all wins) - compounding
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

      // Worst case (all losses) - compounding
      let worstCapital = params.initialCapital;
      let worstRisk = Math.min(worstCapital * riskPercentDecimal, params.riskCapDollars);

      for (let month = 1; month <= params.timeMonths; month++) {
        for (let trade = 0; trade < params.tradesPerMonth; trade++) {
          worstCapital -= worstRisk;
          if (worstCapital < 0) worstCapital = 0;
        }

        if (month % 3 === 0 && worstCapital > 0) {
          worstRisk = Math.min(worstCapital * riskPercentDecimal, params.riskCapDollars);
        }
      }

      const allWinsCapital = bestCapital;
      const allLossesCapital = worstCapital;

      // Prepare chart data
      const sampleIndices = [
        0,
        Math.floor(params.simulations * 0.25),
        Math.floor(params.simulations * 0.5),
        Math.floor(params.simulations * 0.75),
        params.simulations - 1
      ];

      const chartData: ChartPoint[] = [];
      for (let month = 0; month <= params.timeMonths; month++) {
        const dataPoint: ChartPoint = { month };
        sampleIndices.forEach((idx, i) => {
          const label = labels[i];
          const point = simResults[idx].monthlyData[month];
          dataPoint[label] = point ? point.capital : 0;
        });
        chartData.push(dataPoint);
      }

      setResults({
        mean,
        median,
        percentile25,
        percentile75,
        percentile10,
        percentile90,
        worst,
        best,
        allWinsCapital,
        allLossesCapital,
        chartData,
        totalTrades
      });

      setIsRunning(false);
    }, 100);
  };

  useEffect(() => {
    runSimulation();
  }, []);

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
        <div className="bg-white rounded-lg shadow p-12 text-center">
          <p className="text-xl">Running simulation...</p>
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
    </div>
  );
};

export default MonteCarloTrading;