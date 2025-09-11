import React, { useMemo } from 'react'
import { Bar } from 'react-chartjs-2'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js'

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend)

export default function HoursByCustomerChart({ kunden }) {
  const data = useMemo(() => {
    const top = kunden.slice(0, 15)
    return {
      labels: top.map((k) => k.kunde),
      datasets: [
        {
          label: 'Std. fakturiert',
          data: top.map((k) => k.stunden_fakt || 0),
          backgroundColor: 'rgba(79, 70, 229, 0.7)', // indigo-600
          borderRadius: 6,
        },
        {
          label: 'Std. geleistet',
          data: top.map((k) => k.stunden_gel || 0),
          backgroundColor: 'rgba(99, 102, 241, 0.4)', // indigo-400
          borderRadius: 6,
        },
      ],
    }
  }, [kunden])

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { position: 'top' },
      title: { display: true, text: 'Top 15 Kunden nach Stunden' },
      tooltip: { mode: 'index', intersect: false },
    },
    interaction: { mode: 'nearest', intersect: false },
    scales: {
      x: { stacked: false },
      y: { stacked: false, beginAtZero: true },
    },
  }

  return (
    <div style={{ height: 420, padding: 8, border: '1px solid #e5e5e5', borderRadius: 8 }}>
      <Bar data={data} options={options} />
    </div>
  )
}
