import React from 'react'
import { Link, useLocation } from 'react-router-dom'
import { cx } from './ui'

export function DashboardTabs() {
  const location = useLocation()
  
  const tabs = [
    { name: 'Overview', to: '/' },
    { name: 'Labour Attendance', to: '/attendance' },
    { name: 'Contractor Management', to: '/contractors' },
    { name: 'Safety Inspections', to: '/inspections' },
  ]

  return (
    <div className="flex items-center gap-4 border-b-2 border-transparent">
      {tabs.map((t) => {
        const active = location.pathname === t.to
        return (
          <Link
            key={t.name}
            to={t.to}
            className={cx(
              'pb-2 text-[13px] font-medium transition-colors',
              active ? 'border-b-2 border-[color:var(--accent)] text-ink' : 'border-b-2 border-transparent text-ink-dim hover:text-ink'
            )}
            style={{ marginBottom: '-14px' }}
          >
            {t.name}
          </Link>
        )
      })}
    </div>
  )
}
