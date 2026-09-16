import React from 'react'
import { useNavigate } from 'react-router-dom'
import { PageBody, PageHeader } from '../components/layout'
import { Badge, Panel, Skeleton } from '../components/ui'
import { PortfolioScene3D } from '../components/scene3d/PortfolioScene3D'
import { useAsync, useDocumentTitle } from '../state/app'
import { endpoints } from '../lib/api'
import { fmt } from '../lib/format'

/**
 * Portfolio3DPage — the multi-mine immersive scene.
 *
 * This page is the **novel showpiece** of v2.1: a single 3D scene
 * that arranges all 4 mines as islands. Critical zones across the
 * portfolio pulse together via shared risk beacons. The user can
 * orbit the whole portfolio, see at a glance which mine carries the
 * most exposure, and click any island to drill into the per-mine
 * detailed scene.
 *
 * Try it:
 *   - Drag to orbit · scroll to zoom · click an island label
 *   - Open Brahma (open-cast) to see the haul trucks moving on the loop
 *   - Open Alpha (underground) to see the shaft and galleries + gas sensors
 */
export function Portfolio3DPage() {
  useDocumentTitle('3D Portfolio · MINEGUARD AI')
  const navigate = useNavigate()
  const { data, loading } = useAsync<any>(endpoints.scene3dPortfolio, [])

  return (
    <>
      <PageHeader
        eyebrow="Module · Immersive view"
        title="3D mine portfolio"
        subtitle="All four mines in a single scene — risk drives zone heights, critical zones pulse together with shared risk beacons, and animated entities (trucks / conveyors / ventilation / gas sensors) reveal the mine type at a glance. Click an island to drill into its per-mine scene."
        actions={
          data ? (
            <Badge tone="neutral">{data.islands?.length ?? 0} mines · as of {data.as_of}</Badge>
          ) : null
        }
      />
      <PageBody className="space-y-3.5">
        {loading && !data && <Skeleton className="h-[640px] w-full" />}
        {data && (
          <>
            <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
              {data.islands.map((island: any) => (
                <button
                  key={island.id}
                  onClick={() => navigate(`/mines/${island.id}`)}
                  className="panel relative flex min-h-[110px] flex-col justify-between overflow-hidden p-3 text-left transition-all hover:border-line-strong hover:shadow-panel"
                >
                  <span className="absolute inset-x-0 top-0 h-[2px]" style={{ background: `var(--risk-${island.risk_level.toLowerCase()})` }} />
                  <div className="flex items-start justify-between">
                    <span className="text-[12.5px] font-semibold leading-tight">{island.name}</span>
                    <span className="text-[10px] text-ink-faint">{island.mine_type === 'UNDERGROUND' ? 'UG' : 'OC'}</span>
                  </div>
                  <div className="mt-2 flex items-center justify-between">
                    <span className="font-mono text-[20px] font-semibold" style={{ color: `var(--risk-${island.risk_level.toLowerCase()})` }}>
                      {fmt(island.risk_score, 0)}
                    </span>
                    <span className="text-[10.5px] text-ink-dim">compliance {fmt(island.compliance_score, 0)}</span>
                  </div>
                </button>
              ))}
            </div>
            <Panel title="Portfolio scene" subtitle="Drag to orbit · scroll to zoom · click an island label to drill in">
              <PortfolioScene3D onSelectMine={(id) => navigate(`/mines/${id}`)} />
            </Panel>
          </>
        )}
      </PageBody>
    </>
  )
}
