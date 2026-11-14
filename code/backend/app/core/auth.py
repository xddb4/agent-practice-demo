import hashlib
from datetime import datetime, timezone
from fastapi import Request, HTTPException
from .db import Session
from ..models.record import Record

def uid(request: Request):
    token=request.cookies.get('session','')
    with Session() as db:
        row=db.get(Record,'session:'+hashlib.sha256(token.encode()).hexdigest())
        if not row or row.data['expires']<datetime.now(timezone.utc).isoformat(): raise HTTPException(401,'请先登录')
        return row.owner
def digest(password,salt): return hashlib.pbkdf2_hmac('sha256',password.encode(),bytes.fromhex(salt),210000).hex()
