"""Agregatorul rutelor v1. Fiecare modul își expune propriul `router`."""
from fastapi import APIRouter

from app.api.v1 import (
    admin,
    ads,
    auth,
    chat,
    events,
    feed,
    humor,
    profiles,
    push,
    reports,
    settings,
    social,
    stories,
    subscriptions,
    ticket,
    ticket_orders,
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
# Bilete online (transfer bancar + verificare manuală). Rutele își declară căile
# absolute (`/events/{id}/ticket-orders`, `/ticket-orders/*`) → fără prefix.
api_router.include_router(ticket_orders.router, tags=["ticket-orders"])
api_router.include_router(stories.router, prefix="/stories", tags=["stories"])
api_router.include_router(humor.router, prefix="/humor", tags=["humor"])
api_router.include_router(reports.router, prefix="/reports", tags=["moderation"])
api_router.include_router(subscriptions.router, prefix="/subscriptions", tags=["billing"])
api_router.include_router(push.router, prefix="/push", tags=["push"])
api_router.include_router(ads.router, prefix="/ads", tags=["ads"])
# Panoul de administrare. `require_admin` NU se aplică aici, ci în interiorul
# pachetului, pe fiecare sub-router (vezi `api/v1/admin/__init__.py`) — pentru că
# `POST /admin/login` trebuie să rămână accesibil celui care încă nu are token.
api_router.include_router(admin.router, prefix="/admin", tags=["admin"])
