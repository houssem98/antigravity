import json, sys

f = open(sys.argv[1])
data = json.load(f)

print("=" * 70)
print(f"  OVERALL: {data['overall_accuracy']*100:.1f}%  ({data['total_correct']}/{data['total_examples']})")
print("=" * 70)

for bk, bv in data["benchmarks"].items():
    print(f"\n--- {bk.upper()} ({bv['accuracy']*100:.0f}%) ---")
    for d in bv["details"]:
        status = "PASS" if d["correct"] else "FAIL"
        pred_short = (d.get("predicted", "") or "")[:90].replace("\n", " ")
        exp_short = (d.get("expected", "") or "")[:60]
        print(f"  [{status}] {d['example_id']}  score={d['score']:.2f}  {d['reason']}")
        if pred_short:
            print(f"         pred: {pred_short}")
        print(f"         expected: {exp_short}")
        print()

print("\n--- ERRORS ---")
for r in data.get("raw_results", []):
    if r.get("error"):
        print(f"  {r['example_id']}: {r['error']}")
