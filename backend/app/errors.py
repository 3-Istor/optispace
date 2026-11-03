from fastapi import Request
from fastapi.responses import JSONResponse


class DomainError(Exception):
    """A business rule refusal, answered as `{"detail": code}` with `status`."""

    def __init__(self, status: int, code: str):
        super().__init__(code)
        self.status = status
        self.code = code


async def domain_error_handler(request: Request, exc: DomainError) -> JSONResponse:
    return JSONResponse(status_code=exc.status, content={"detail": exc.code})
