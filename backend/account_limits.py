"""
Account Limits Module -- fetch and cache Claude API account limits and quotas.

The Anthropic API returns rate limit information in response headers:
    - anthropic-ratelimit-requests-limit: Max requests per minute
    - anthropic-ratelimit-requests-remaining: Requests left in current window
    - anthropic-ratelimit-requests-reset: When the limit resets (ISO timestamp)
    - anthropic-ratelimit-tokens-limit: Max tokens per minute
    - anthropic-ratelimit-tokens-remaining: Tokens left in current window
    - anthropic-ratelimit-tokens-reset: When token limit resets

This module fetches these limits by making a minimal API call and caching
the results for 5 minutes to avoid excessive API calls.
"""

import logging
import time
from datetime import datetime
from typing import Optional

from anthropic import Anthropic

from backend.config import ANTHROPIC_API_KEY

logger = logging.getLogger(__name__)

# Cache for account limits (to avoid hitting API on every request)
_limits_cache: Optional[dict] = None
_cache_timestamp: float = 0
CACHE_TTL_SECONDS = 300  # 5 minutes


def _parse_reset_time(reset_value: Optional[str]) -> Optional[str]:
    """Parse the reset timestamp from header value.

    The header can be either an ISO timestamp or a Unix timestamp.
    """
    if not reset_value:
        return None

    try:
        # Try parsing as ISO timestamp first
        if 'T' in reset_value or '-' in reset_value:
            dt = datetime.fromisoformat(reset_value.replace('Z', '+00:00'))
            return dt.isoformat()
        # Try parsing as Unix timestamp
        else:
            timestamp = float(reset_value)
            dt = datetime.fromtimestamp(timestamp)
            return dt.isoformat()
    except (ValueError, TypeError) as e:
        logger.warning(f"Failed to parse reset time '{reset_value}': {e}")
        return None


def fetch_account_limits() -> dict:
    """Fetch account limits from Anthropic API.

    Makes a minimal API call to get rate limit headers.
    Results are cached for CACHE_TTL_SECONDS to minimize API usage.

    Returns:
        {
            "success": bool,
            "limits": {
                "requests_limit": int,
                "requests_remaining": int,
                "requests_reset": str (ISO timestamp),
                "tokens_limit": int,
                "tokens_remaining": int,
                "tokens_reset": str (ISO timestamp),
            },
            "error": str (if success=False),
            "cached": bool,
            "fetched_at": str (ISO timestamp),
        }
    """
    global _limits_cache, _cache_timestamp

    # Return cached data if still valid
    now = time.time()
    if _limits_cache and (now - _cache_timestamp) < CACHE_TTL_SECONDS:
        return {
            **_limits_cache,
            "cached": True,
        }

    # Check if API key is configured
    if not ANTHROPIC_API_KEY:
        return {
            "success": False,
            "error": "ANTHROPIC_API_KEY not configured",
            "cached": False,
            "fetched_at": datetime.now().isoformat(),
        }

    try:
        # Make minimal API call to get headers
        client = Anthropic(api_key=ANTHROPIC_API_KEY)

        # Use the raw HTTP client to access response headers
        # Make a minimal request to /v1/messages with max_tokens=1
        response = client.messages.with_raw_response.create(
            model="claude-3-5-haiku-20241022",  # Use cheapest model
            max_tokens=1,
            messages=[{"role": "user", "content": "hi"}]
        )

        # Extract rate limit headers
        headers = response.headers

        limits = {
            "requests_limit": int(headers.get("anthropic-ratelimit-requests-limit", 0)),
            "requests_remaining": int(headers.get("anthropic-ratelimit-requests-remaining", 0)),
            "requests_reset": _parse_reset_time(headers.get("anthropic-ratelimit-requests-reset")),
            "tokens_limit": int(headers.get("anthropic-ratelimit-tokens-limit", 0)),
            "tokens_remaining": int(headers.get("anthropic-ratelimit-tokens-remaining", 0)),
            "tokens_reset": _parse_reset_time(headers.get("anthropic-ratelimit-tokens-reset")),
        }

        result = {
            "success": True,
            "limits": limits,
            "cached": False,
            "fetched_at": datetime.now().isoformat(),
        }

        # Update cache
        _limits_cache = result.copy()
        _cache_timestamp = now

        logger.info(f"Fetched account limits: {limits['requests_remaining']}/{limits['requests_limit']} requests")

        return result

    except Exception as exc:
        logger.error(f"Failed to fetch account limits: {exc}")
        return {
            "success": False,
            "error": str(exc),
            "cached": False,
            "fetched_at": datetime.now().isoformat(),
        }


def clear_cache() -> None:
    """Clear the limits cache (useful for testing or forced refresh)."""
    global _limits_cache, _cache_timestamp
    _limits_cache = None
    _cache_timestamp = 0
