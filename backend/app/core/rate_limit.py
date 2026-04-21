"""
Simple in-memory rate limiter for auth endpoints.
Prevents brute force attacks on login-adjacent endpoints.
Uses sliding window per IP address.

For API usage rate limiting (per workspace, per day) — see AVA-36,
implemented separately with database-backed counters.
"""
import time
from collections import defaultdict
from fastapi import Request, HTTPException, status


class SlidingWindowRateLimiter:
    def __init__(self, max_requests: int, window_seconds: int):
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self._windows: dict[str, list[float]] = defaultdict(list)

    def check(self, key: str) -> None:
        now = time.time()
        window = self._windows[key]

        # Remove timestamps outside the window
        cutoff = now - self.window_seconds
        self._windows[key] = [t for t in window if t > cutoff]

        if len(self._windows[key]) >= self.max_requests:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Too many requests. Max {self.max_requests} per "
                       f"{self.window_seconds}s per IP.",
                headers={"Retry-After": str(self.window_seconds)},
            )

        self._windows[key].append(now)

    def get_client_ip(self, request: Request) -> str:
        # Trust X-Forwarded-For from Vercel/Railway proxies
        forwarded = request.headers.get("X-Forwarded-For")
        if forwarded:
            return forwarded.split(",")[0].strip()
        return request.client.host if request.client else "unknown"


# Auth endpoints: 20 requests per minute per IP
auth_limiter = SlidingWindowRateLimiter(max_requests=20, window_seconds=60)

# General API: 200 requests per minute per IP
api_limiter = SlidingWindowRateLimiter(max_requests=200, window_seconds=60)
