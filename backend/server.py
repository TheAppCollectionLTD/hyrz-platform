# Preview-only shim: keeps MySQL + the hyrz Node/Express API running and forwards /api traffic to it. Not part of hyrz.
import asyncio
import subprocess
import httpx
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request, Response

HOP = {"host", "content-length", "connection", "transfer-encoding", "content-encoding"}
client = httpx.AsyncClient(base_url="http://127.0.0.1:4000", timeout=60)


def boot():
    subprocess.Popen(["bash", "/app/scripts/preview-start.sh"], start_new_session=True)


async def watchdog():
    while True:
        await asyncio.sleep(20)
        try:
            r = await client.get("/api/health", timeout=5)
            if r.status_code != 200:
                boot()
        except Exception:
            boot()


@asynccontextmanager
async def lifespan(_):
    boot()
    task = asyncio.create_task(watchdog())
    yield
    task.cancel()


app = FastAPI(lifespan=lifespan)


@app.api_route("/api/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"])
async def proxy(path: str, request: Request):
    headers = {k: v for k, v in request.headers.items() if k.lower() not in HOP}
    r = await client.request(request.method, f"/api/{path}", params=request.query_params,
                             content=await request.body(), headers=headers)
    return Response(content=r.content, status_code=r.status_code,
                    headers={k: v for k, v in r.headers.items() if k.lower() not in HOP})
