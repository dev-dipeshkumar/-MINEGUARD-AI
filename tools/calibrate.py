"""Seed calibration: print the scores the engine derives from the seed data."""
import sys, time
sys.path.insert(0, "/home/user/mineguard")
t0 = time.time()
from api import store as S
s = S.store
print(f"seed+recompute: {time.time()-t0:.2f}s  counts={s.counts()}")
print()
for m in s.data["mines"]:
    mc = s.mine_computed(m["id"])
    print(f"{m['name']:<26} risk={mc['risk_score']:>5} ({mc['risk_level']:<9}) comp={mc['compliance_score']:>5} critZ={mc['critical_zones']} open={mc['open_violations']} ovd={mc['overdue_actions']}")
    for z in s.zones(m["id"]):
        zr = s.zone_assessment(z["id"]); fp = zr["risk"]["metrics"]["factor_points"]
        print(f"    {z['name']:<38} {zr['risk']['risk_score']:>5} {zr['risk']['risk_level']:<9} comp={zr['compliance']['compliance_score']:>5}  sev={fp['severity']:>4} rep={fp['repeat']:>4} unr={fp['unresolved']:>4} ovd={fp['overdue']:>4} ins={fp['inspection_delay']:>4}")
    print()
print("ENTERPRISE:", s.enterprise)
