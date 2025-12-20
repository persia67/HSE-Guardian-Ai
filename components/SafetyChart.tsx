import React from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { LogEntry } from '../types';

interface SafetyChartProps {
  data: LogEntry[];
}

const SafetyChart: React.FC<SafetyChartProps> = ({ data }) => {
  const chartData = data.slice(-15).map(entry => ({
    time: entry.timestamp,
    score: entry.safetyScore,
  }));

  return (
    <div className="h-full w-full" style={{ direction: 'ltr' }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartData}>
          <defs>
            <linearGradient id="colorScore" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/>
              <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
          <XAxis dataKey="time" stroke="#9ca3af" fontSize={10} tickMargin={10} hide />
          <YAxis stroke="#9ca3af" domain={[0, 100]} fontSize={10} orientation="right" />
          <Tooltip 
            contentStyle={{ backgroundColor: '#1f2937', border: 'none', color: '#f3f4f6', fontSize: '12px' }}
            itemStyle={{ color: '#10b981' }}
          />
          <Area 
            type="monotone" 
            dataKey="score" 
            stroke="#10b981" 
            fillOpacity={1} 
            fill="url(#colorScore)" 
            strokeWidth={3}
            animationDuration={1500}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
};

export default SafetyChart;