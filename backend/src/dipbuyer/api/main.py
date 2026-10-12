"""ASGI entrypoint: ``uvicorn dipbuyer.api.main:app``."""

from dipbuyer.api.app import create_app

app = create_app()
