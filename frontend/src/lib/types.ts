/** Server contract types — mirrors api/routers payloads. */

export type Tone = 'low' | 'moderate' | 'elevated' | 'high' | 'critical'

export interface RiskFactor {
  key: string
  label: string
  points: number
  cap: number
  raw: number
  detail: string
  share: number
}

export interface RecommendedAction {
  priority: 'immediate' | 'high' | 'medium' | string
  action: string
  owner_hint?: string
}

export interface RiskAssessment {
  zone_id: string
  mine_id: string
  as_of: string
  risk_score: number
  risk_level: string
  tone: Tone
  factors: RiskFactor[]
  drivers: string[]
  recommended_actions: RecommendedAction[]
  method: string
  metrics: {
    open_violations: number
    critical_violations: number
    high_violations: number
    violations_30d: number
    violations_prev_30d: number
    repeat_violations: number
    open_action_count: number
    overdue_action_count: number
    max_overdue_days: number
    unresolved_30_plus: number
    days_since_inspection: number | null
    inspection_cadence_days: number
    inspection_overdue: boolean
    departments: string[]
    severity_exposure: number
    target_exposure: number
    factor_points: Record<string, number>
  }
}

export interface ComplianceComponent {
  key: string
  label: string
  value: string
  penalty: number
  detail?: string
}

export interface CompliancePayload {
  compliance_score: number
  components: ComplianceComponent[]
}

export interface Trend {
  series: { date: string; risk: number; compliance: number }[]
  change: number
  change_pct: number
  direction: 'rising' | 'falling' | 'stable'
}

export interface User {
  id: string
  name: string
  role: 'INSPECTOR' | 'OFFICER' | 'MANAGER' | 'ADMIN'
  department: string
  designation: string
  mine_id: string | null
  initials: string
  open_actions?: number
  overdue_actions?: number
  violations_owned?: number
  inspections?: number
}

export interface Zone {
  id: string
  mine_id: string
  mine_name: string
  name: string
  short_name: string
  zone_type: string
  primary_department: string
  inspection_cadence_days: number
  notes?: string
  status: string
  risk_score: number
  risk_level: string
  risk_tone: Tone
  compliance_score: number
  geometry: { x: number; y: number; w: number; h: number; label_anchor?: string }
  /** Present on the mine-list projection; the dossier carries the full objects instead. */
  open_violations?: number
  trend?: number
}

export interface Mine {
  id: string
  code: string
  name: string
  location: string
  operator: string
  mine_type: string
  status: string
  annual_output_kt: number
  workforce: number
  regulatory_body: string
  reporting_current: boolean
  licence: string
  description: string
  zones: string[]
  risk_score: number
  risk_level: string
  compliance_score: number
}

export interface EvidenceItem {
  id: string
  violation_id: string | null
  action_id: string | null
  type: string
  file_name: string
  note?: string
  uploaded_by: string
  uploaded_at: string
  size_kb: number
  kind: string
}

export interface Violation {
  id: string
  inspection_id: string | null
  mine_id: string
  zone_id: string
  department: string
  category: string
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
  status: 'OPEN' | 'ASSIGNED' | 'IN_PROGRESS' | 'ACTION_SUBMITTED' | 'UNDER_VERIFICATION' | 'CLOSED'
  description: string
  regulation?: string
  notes?: string
  created_at: string
  due_date: string | null
  closed_at: string | null
  assigned_to: string | null
  occurrences: number
  repeat_of?: string
  action_ids: string[]
  evidence_count: number
  risk_contribution: number
  status_note?: string | null
  // derived
  age_days: number
  zone_name: string
  zone_short: string
  mine_name: string
  owner_name: string | null
  overdue: boolean
  days_overdue: number
  sla_days: number
  sla_state: 'ON_TRACK' | 'AT_RISK' | 'BREACHED' | 'CLOSED'
  evidence_items: EvidenceItem[]
  actions: CorrectiveAction[]
  next_status: string | null
  allowed_transitions: string[]
}

export interface CorrectiveAction {
  id: string
  violation_id: string
  mine_id: string
  zone_id: string
  description: string
  status: 'PENDING' | 'ASSIGNED' | 'IN_PROGRESS' | 'SUBMITTED' | 'VERIFIED' | 'REJECTED' | 'CLOSED'
  assigned_to: string
  created_at: string
  due_date: string | null
  started_at: string | null
  completed_at: string | null
  closed_at: string | null
  resolution_notes: string | null
  verification_notes: string | null
  verified_by: string | null
  verified_at: string | null
  evidence_count: number
  priority: string
  violation_severity?: string
  violation_status?: string
  violation_category?: string
  zone_name?: string
  zone_short?: string
  mine_name?: string
  owner_name?: string
  owner_initials?: string
  days_overdue?: number
  age_days?: number
  is_overdue?: boolean
  can_verify?: boolean
  evidence_items?: EvidenceItem[]
}

export interface Inspection {
  id: string
  mine_id: string
  zone_id: string
  department: string
  inspector_id: string
  inspector: string
  inspection_date: string
  status: string
  observations: string
  overall_rating: 'COMPLIANT' | 'NON_COMPLIANT' | 'NEEDS_ATTENTION'
  issues_found: number
  violation_ids: string[]
  evidence_count: number
  mine_name?: string
  zone_name?: string
  zone_short?: string
  violations?: Violation[]
}

export interface Alert {
  id: string
  kind: string
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'WATCH'
  title: string
  scope_type: 'ZONE' | 'MINE'
  scope_id: string
  scope_name: string
  mine_id: string
  mine_name: string
  risk_score: number
  risk_level: string
  previous_score?: number
  delta?: number
  reasons: { label: string; value: string; delta?: string }[]
  narrative: string
  recommendation: string
  entity_ids?: string[]
  projected_impact?: { action: string; after: number; delta: number } | null
  status: string
  created_at: string
}

export interface Insight {
  id: string
  kind: string
  priority: number
  title: string
  body: string
  scope?: { mine_id?: string; zone_id?: string }
  metrics: Record<string, any>
  action: { label: string; to: string }
}

export interface ZoneHeat extends Zone {
  risk: number
  tone: Tone
  open_violations: number
  overdue_actions: number
  top_factor: string
  trend: number
  compliance_score: number
}

export interface DashboardPayload {
  enterprise: { risk_score: number; risk_level: string; tone: Tone; compliance_score: number; compliance_label: string }
  kpis: {
    critical_alerts: number
    high_risk_zones: number
    zones_needing_attention: number
    overdue_actions: number
    open_violations: number
    critical_violations: number
    unassigned_violations: number
    verification_backlog: number
    compliance: number
    risk: number
  }
  band_distribution: Record<string, number>
  priority_alerts: Alert[]
  insights: Insight[]
  zone_heat: ZoneHeat[]
  mine_cards: {
    id: string
    name: string
    code: string
    location: string
    mine_type: string
    status: string
    risk_score: number
    risk_level: string
    compliance_score: number
    open_violations: number
    overdue_actions: number
    critical_zones: number
    trend: number
    alerts: number
  }[]
  department_health: { department: string; open: number; high_or_critical: number; trend_pct: number; exposure: number }[]
  overdue_actions: (CorrectiveAction & { days_overdue: number; owner: string })[]
  risk_trend: Trend
  activity: { id: string; at: string; actor: string; kind: string; message: string; entity: string | null }[]
  as_of: string
  generated_at: string
}

export interface Impact {
  before: number
  after: number
  delta: number
  zone_name?: string
  explanation?: string
  factor_delta?: { key: string; label: string; before: number; after: number; delta: number }[]
  level?: string
  drivers?: string[]
  factors?: RiskFactor[]
}

export interface SimulationResult {
  zone_id: string
  zone_name: string
  before: { risk_score: number; risk_level: string }
  after: { risk_score: number; risk_level: string }
  delta: number
  factor_delta: { key: string; label: string; before: number; after: number }[]
  after_factors: RiskFactor[]
  after_drivers: string[]
  note: string
}

export interface Bootstrap {
  mines: Mine[]
  zones: Zone[]
  users: User[]
  config: {
    departments: string[]
    violation_categories: Record<string, { name: string; default_severity: string; regulation: string }[]>
    violation_statuses: string[]
    action_statuses: string[]
    severity_levels: { name: string; weight: number }[]
    risk_bands: { min: number; max: number; label: string }[]
    sla: Record<string, number>
  }
  enterprise: { risk_score: number; risk_level: string; tone: Tone; compliance_score: number; compliance_label?: string }
  engine: {
    mode: string
    label: string
    phase: string
    factors: { key: string; label: string; weight_cap: number; coefficient: number | null }[]
    bands: { max: number; label: string; tone: string }[]
    severity_weights: Record<string, number>
  }
  as_of: string
  generated_at: string
}

export interface ReportPayload {
  report_type: string
  title: string
  subtitle: string
  generated_at: string
  period: { from: string; to: string; days: number }
  scope: { mine_id: string | null; zone_id: string | null }
  meta: { prepared_by: string; engine: string; audience: string }
  executive_summary: string
  counts: Record<string, number>
  sections: {
    type: 'KEY_FACTS' | 'TABLE' | 'EXPLANATION' | 'ACTIONS' | 'LIST' | 'CALLOUT'
    title: string
    items?: any[]
    columns?: string[]
    rows?: any[][]
    data?: any[]
    score?: number
    level?: string
    factors?: RiskFactor[]
    drivers?: string[]
    body?: string
  }[]
}

export interface DocumentRecord {
  id: string
  file_name: string
  mine_id: string
  zone_id: string | null
  doc_type: string
  type_label: string
  uploaded_at: string
  uploaded_by: string
  uploader: string
  status: string
  pages: number
  confidence: number
  ocr_engine: string
  extracted: Record<string, string>
  severity_hint?: string | null
  summary: string
  flags: string[]
  linked_violations: string[]
  mine_name?: string
  zone_name?: string | null
  text_chars?: number
}

export interface ZoneDossier {
  zone: Zone
  mine: Mine
  risk: RiskAssessment
  compliance: CompliancePayload
  trend: Trend
  violations: (Violation & { overdue: boolean })[]
  actions: (CorrectiveAction & { overdue: boolean })[]
  inspections: Inspection[]
  overdue_actions: (CorrectiveAction & { days_overdue: number; owner: string })[]
  alerts: Alert[]
  closure_relief: SimulationResult | null
  aging: { id: string; days: number; severity: string; category: string }[]
}
