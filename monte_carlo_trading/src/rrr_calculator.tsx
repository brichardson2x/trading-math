import { useState } from "react";

type ComputeTargetsArgs = {
  accountBalance: number;
  riskPercent: number; // percent of account
  entryPrice: number;
  stopLossPrice: number;
  isLong?: boolean; // default true
};

export type TargetRow = {
  rrr: number; // e.g., 1, 1.5, 2 ...
  targetPrice: number;
  profitPerShare: number;
};

export function computeTargets({
  accountBalance,
  riskPercent,
  entryPrice,
  stopLossPrice,
  isLong = true,
}: ComputeTargetsArgs): {
  riskAmount: number;
  riskPerShare: number;
  positionSize: number;
  totalCost: number;
  targets: TargetRow[];
} {
  const riskAmount = (accountBalance ?? 0) * ((riskPercent ?? 0) / 100);
  const riskPerShare = Math.abs((entryPrice ?? 0) - (stopLossPrice ?? 0));

  const positionSize = riskPerShare > 0 ? Math.floor(riskAmount / riskPerShare) : 0;
  const totalCost = Number((positionSize * entryPrice).toFixed(8));

  const rrrs = [1, 1.5, 2, 3, 4, 5, 6, 7, 8, 9, 10];

  const targets: TargetRow[] = rrrs.map((rrr) => {
    const profitPerShare = rrr * riskPerShare;
    const targetPrice = isLong ? entryPrice + profitPerShare : entryPrice - profitPerShare;
    return {
      rrr,
      targetPrice: Number(targetPrice.toFixed(8)),
      profitPerShare: Number(profitPerShare.toFixed(8)),
    };
  });

  return { riskAmount: Number(riskAmount.toFixed(8)), riskPerShare: Number(riskPerShare.toFixed(8)), positionSize, totalCost, targets };
}

export default function RrrCalculator() {
  const [accountBalance, setAccountBalance] = useState<number>(10000);
  const [riskPercent, setRiskPercent] = useState<number>(1);
  const [entryPrice, setEntryPrice] = useState<number>(100);
  const [stopLossPrice, setStopLossPrice] = useState<number>(98);
  const [isLong, setIsLong] = useState<boolean>(true);

  const { riskAmount, riskPerShare, positionSize, totalCost, targets } = computeTargets({
    accountBalance,
    riskPercent,
    entryPrice,
    stopLossPrice,
    isLong,
  });

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <h3 className="text-xl font-semibold text-gray-800 mb-4">RRR Target Price Calculator</h3>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-lg">
        <label>
          <div className="block text-sm font-medium text-gray-700 mb-1">Account Balance</div>
          <input
            type="number"
            value={accountBalance}
            onChange={(e) => setAccountBalance(Number(e.target.value))}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </label>

        <label>
          <div className="block text-sm font-medium text-gray-700 mb-1">Risk per trade (%)</div>
          <input
            type="number"
            value={riskPercent}
            onChange={(e) => setRiskPercent(Number(e.target.value))}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </label>

        <label>
          <div className="block text-sm font-medium text-gray-700 mb-1">Entry price</div>
          <input
            type="number"
            value={entryPrice}
            onChange={(e) => setEntryPrice(Number(e.target.value))}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </label>

        <label>
          <div className="block text-sm font-medium text-gray-700 mb-1">Stop-loss price</div>
          <input
            type="number"
            value={stopLossPrice}
            onChange={(e) => setStopLossPrice(Number(e.target.value))}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </label>

        <label className="md:col-span-2">
          <div className="block text-sm font-medium text-gray-700 mb-1">Trade Direction</div>
          <select
            value={isLong ? "long" : "short"}
            onChange={(e) => setIsLong(e.target.value === "long")}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="long">Long (target &gt; entry)</option>
            <option value="short">Short (target &lt; entry)</option>
          </select>
        </label>
      </div>

      <div className="mt-4 text-sm text-gray-700">
        <strong>Risk amount:</strong> ${riskAmount} • <strong>Risk per share:</strong> {riskPerShare}
        <div className="mt-1"><strong>Position size (approx):</strong> {positionSize} shares</div>
        <div className="mt-1"><strong>Total cost (approx):</strong> ${totalCost}</div>
      </div>

      <div className="overflow-x-auto mt-4">
        <table className="w-full mt-2 text-sm">
          <thead>
            <tr className="text-left text-gray-600 border-b">
              <th className="py-2">RRR</th>
              <th className="py-2 text-right">Target Price</th>
              <th className="py-2 text-right">Profit / share</th>
              <th className="py-2 text-right">Total profit (approx)</th>
            </tr>
          </thead>
          <tbody>
            {targets.map((t) => {
              const totalProfit = Number((t.profitPerShare * positionSize).toFixed(8));
              return (
                <tr key={t.rrr} className="odd:bg-gray-50">
                  <td className="py-2">{`1:${t.rrr}`}</td>
                  <td className="py-2 text-right">{t.targetPrice}</td>
                  <td className="py-2 text-right">{t.profitPerShare}</td>
                  <td className="py-2 text-right">{totalProfit}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-4 text-sm text-gray-600">
        <strong>Notes:</strong>
        <ul className="list-disc ml-5 mt-1">
          <li>This assumes a single-leg trade. Position size is rounded down to the nearest whole share/contract.</li>
          <li>Risk amount = account balance * (risk %).</li>
          <li>RRR rows show target price for 1:1, 1:1.5, 1:2, 1:3 ... up to 1:10.</li>
        </ul>
      </div>
    </div>
  );
}
