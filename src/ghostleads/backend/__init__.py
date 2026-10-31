
"""Public dashboard-facing backend helpers (no automatic outreach sending)."""

__all__ = ["health", "run_stages", "status", "sync"]


def __getattr__(name):
    # Loading automation eagerly imports stage modules and causes runpy warnings
    # for `python -m ghostleads.backend.<stage>`; defer until the API is used.
    if name in __all__:
        from ghostleads.backend import automation
        return getattr(automation, name)
    raise AttributeError(name)
