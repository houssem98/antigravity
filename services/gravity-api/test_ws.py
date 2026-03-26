import asyncio
import json
import websockets

async def test():
    uri = "ws://localhost:8000/v1/search/stream"
    try:
        async with websockets.connect(uri, open_timeout=5) as ws:
            print("Connected")
            await ws.send(json.dumps({"query": "NVIDIA revenue", "trace_id": "t1"}))
            print("Sent")
            for i in range(10):
                try:
                    m = await asyncio.wait_for(ws.recv(), timeout=10)
                    d = json.loads(m)
                    print(f"Event {i}: type={d.get('type')}, data={str(d.get('data',''))[:150]}")
                except asyncio.TimeoutError:
                    print(f"Timeout {i}")
                    break
    except Exception as e:
        print(f"Error: {type(e).__name__}: {e}")

asyncio.run(test())
