# Preview-only shim: boots MySQL + the hyrz Node/Express API and forwards /api traffic to it. Not part of hyrz.
import subprocess
import httpx
from fastapi import FastAPI, Request, Response

subprocess.Popen(["bash", "/app/scripts/preview-start.sh"])
app = FastAPI()
client = httpx.AsyncClient(base_url="http://127.0.0.1:4000", timeout=60)
HOP = {"host", "content-length", "connection", "transfer-encoding", "content-encoding"}


@app.api_route("/api/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"])
async def proxy(path: str, request: Request):
    headers = {k: v for k, v in request.headers.items() if k.lower() not in HOP}
    r = await client.request(request.method, f"/api/{path}", params=request.query_params,
                             content=await request.body(), headers=headers)
    return Response(content=r.content, status_code=r.status_code,
                    headers={k: v for k, v in r.headers.items() if k.lower() not in HOP})
