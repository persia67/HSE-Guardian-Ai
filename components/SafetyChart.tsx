import React from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { LogEntry } from '../types';

interface SafetyChartProps {
  data: LogEntry[];
}

const SafetyChart: React.FC<SafetyChartProps> = ({ data }) => {
  // Take the last 10 entries for the chart
  const chartData = data.slice(-15).map(entry => ({
    time: entry.timestamp,
    score: entry.safetyScore,
  }));

  return (
    <div className="h-full w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartData}>
          <defs>
            <linearGradient id="colorScore" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/>
              <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
            </linearGradient>
            <linearGradient id="colorDanger" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3}/>
              <stop offset="95%" stopColor="#ef4444" stopOpacity={0}/>
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
          <XAxis dataKey="time" stroke="#9ca3af" fontSize={12} tickMargin={10} />
          <YAxis stroke="#9ca3af" domain={[0, 100]} fontSize={12} />
          <Tooltip 
            contentStyle={{ backgroundColor: '#1f2937', border: 'none', color: '#f3f4f6' }}
            itemStyle={{ color: '#10b981' }}
          />
          <Area 
            type="monotone" 
            dataKey="score" 
            stroke="#10b981" 
            fillOpacity={1} 
            fill="url(#colorScore)" 
            strokeWidth={2}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
};

export default SafetyChart;