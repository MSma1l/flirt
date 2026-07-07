"""Agregatorul rutelor v1. Fiecare modul își expune propriul `router`."""
from fastapi import APIRouter

from app.api.v1 import (
    auth,
    chat,
    events,
    feed,
    humor,
    profiles,
    reports,
    settings,
    social,
    stories,
    ticket,
)

api_router = APIRouter()
api_router.include_router(auth.router, prefix="/auth", tags=["auth"])
api_router.include_router(profiles.router, prefix="/profiles", tags=["profiles"])
api_router.include_router(feed.router, prefix="/feed", tags=["feed"])
api_router.include_router(chat.router, prefix="/chats", tags=["chats"])
api_router.include_router(settings.router, prefix="/settings", tags=["settings"])
api_router.include_router(social.router, prefix="/social", tags=["social"])
api_router.include_router(ticket.router, prefix="/ticket", tags=["ticket"])
api_router.include_router(events.router, prefix="/events", tags=["events"])
api_router.include_router(stories.router, prefix="/stories", tags=["stories"])
api_router.include_router(humor.router, prefix="/humor", tags=["humor"])
api_router.include_router(reports.router, prefix="/reports", tags=["moderation"])
