"""Textele botului Telegram (@flrt_party_bot), în trei limbi: ro (implicit), ru, en.

DE CE UN MODUL SEPARAT
----------------------
Aceleași texte sunt folosite în DOUĂ locuri: în webhook (`api/v1/telegram.py`, la
fiecare mesaj) și în scriptul de configurare a profilului botului
(`scripts/setup_telegram_bot.py`: comenzi, descriere, descriere scurtă, nume). Le
ținem într-un singur loc ca lista de comenzi din meniul Telegram să nu ajungă să
difere de ce înțelege webhookul.

FORMATARE: mesajele se trimit cu `parse_mode=HTML`. Tot ce vine din exterior
(numele userului, adrese din configurație) trece prin `html.escape` — un `<` în
prenume ar face Telegram să respingă tot mesajul („can't parse entities").
Descrierile de profil (`setMyDescription` etc.) sunt TEXT SIMPLU, fără HTML.

LIMITE TELEGRAM (verificate în teste):
  - descrierea botului ≤ 512 caractere, descrierea scurtă ≤ 120;
  - descrierea unei comenzi 1–256 caractere;
  - legenda unei poze (`caption`) ≤ 1024 de caractere.
"""
from __future__ import annotations

import html

from app.core.config import settings

# Limbile suportate. Româna e implicită (publicul principal: Moldova).
DEFAULT_LANG = "ro"
LANGS = ("ro", "ru", "en")

# Limbi pentru care un vorbitor citește mai ușor rusa decât româna/engleza.
_RU_LIKE = frozenset({"ru", "uk", "be"})

# Adresa publică de suport când `LEGAL_CONTACT_EMAIL` nu e setat (aceeași ca în
# `app/api/legal.py`).
DEFAULT_SUPPORT_EMAIL = "support@flrt.md"

# Parametrii de deep link pentru butoanele care deschid un ecran anume al Mini
# App-ului (ajung în URL ca `?startapp=<valoare>`, vezi `telegram_bot`).
START_EVENTS = "events"
START_TICKETS = "tickets"
START_PRIVACY = "privacy"

# Datele butoanelor inline de tip callback (≤ 64 de octeți, cerință Telegram).
CB_HELP = "help"
CB_CONTACTS = "contacts"
CB_PRIVACY = "privacy"
CALLBACKS = frozenset({CB_HELP, CB_CONTACTS, CB_PRIVACY})


def lang_for(language_code: str | None) -> str:
    """Limba mesajelor după `from.language_code` al userului Telegram.

    ru/uk/be → ru; en (inclusiv `en-US`) → en; orice altceva sau lipsă → ro.
    """
    code = (language_code or "").strip().lower().replace("_", "-").split("-", 1)[0]
    if code in _RU_LIKE:
        return "ru"
    if code == "en":
        return "en"
    return DEFAULT_LANG


# --------------------------------------------------------------------------- #
# Comenzi (meniul „/" din Telegram) — ordinea e cea afișată
# --------------------------------------------------------------------------- #

COMMANDS: dict[str, list[tuple[str, str]]] = {
    "ro": [
        ("start", "Deschide FLIRT și meniul principal"),
        ("events", "Evenimente Flirt Party"),
        ("tickets", "Biletele mele"),
        ("help", "Ce poate botul și cum cumperi bilete"),
        ("contacts", "Contacte și suport"),
        ("privacy", "Confidențialitate și termeni"),
    ],
    "ru": [
        ("start", "Открыть FLIRT и главное меню"),
        ("events", "Вечеринки Flirt Party"),
        ("tickets", "Мои билеты"),
        ("help", "Что умеет бот и как купить билет"),
        ("contacts", "Контакты и поддержка"),
        ("privacy", "Конфиденциальность и условия"),
    ],
    "en": [
        ("start", "Open FLIRT and the main menu"),
        ("events", "Flirt Party events"),
        ("tickets", "My tickets"),
        ("help", "What the bot does and how tickets work"),
        ("contacts", "Contacts and support"),
        ("privacy", "Privacy and terms"),
    ],
}

# Comenzile pe care le înțelege webhookul (în afară de /start).
KNOWN_COMMANDS = frozenset(name for name, _ in COMMANDS[DEFAULT_LANG])


# --------------------------------------------------------------------------- #
# Profilul botului (setMyName / setMyDescription / setMyShortDescription)
# --------------------------------------------------------------------------- #

# Numele afișat al botului. Scurt și identic peste tot — e marca, nu o descriere.
BOT_NAME: dict[str, str] = {"ro": "FLIRT", "ru": "FLIRT", "en": "FLIRT"}

# Textul din chat-ul gol, înainte ca userul să apese „Start" (≤ 512).
DESCRIPTION: dict[str, str] = {
    "ro": (
        "💘 FLIRT — cunoștințe reale în Moldova, direct în Telegram.\n\n"
        "✨ Profiluri verificate, potriviri și chat cu poze, video și mesaje vocale\n"
        "🎉 Flirt Party — petreceri unde te cunoști pe viu\n"
        "🎫 Bilete online: plătești prin MIA și primești biletul cu cod QR\n\n"
        "Apasă „Start” ca să începi 👇"
    ),
    "ru": (
        "💘 FLIRT — реальные знакомства в Молдове прямо в Telegram.\n\n"
        "✨ Проверенные анкеты, мэтчи и чат с фото, видео и голосовыми\n"
        "🎉 Flirt Party — вечеринки, где знакомятся вживую\n"
        "🎫 Билеты онлайн: оплата через MIA и билет с QR-кодом\n\n"
        "Нажми «Старт», чтобы начать 👇"
    ),
    "en": (
        "💘 FLIRT — real dating in Moldova, right inside Telegram.\n\n"
        "✨ Verified profiles, matches and chat with photos, video and voice notes\n"
        "🎉 Flirt Party — parties where you meet in person\n"
        "🎫 Tickets online: pay via MIA and get a ticket with a QR code\n\n"
        "Tap “Start” to begin 👇"
    ),
}

# Textul din profilul botului și din previzualizarea la partajare (≤ 120).
SHORT_DESCRIPTION: dict[str, str] = {
    "ro": "💘 Cunoștințe reale și petreceri Flirt Party în Moldova. Bilete online cu cod QR.",
    "ru": "💘 Реальные знакомства и вечеринки Flirt Party в Молдове. Билеты онлайн с QR-кодом.",
    "en": "💘 Real dating and Flirt Party events in Moldova. Online tickets with a QR code.",
}

# Textul butonului persistent de meniu (lângă câmpul de mesaj).
MENU_BUTTON_TEXT = "FLIRT"


# --------------------------------------------------------------------------- #
# Butoane
# --------------------------------------------------------------------------- #

BUTTONS: dict[str, dict[str, str]] = {
    "ro": {
        "open": "💘 Deschide FLIRT",
        "events": "🎉 Evenimente",
        "tickets": "🎫 Biletele mele",
        "help": "❓ Ajutor",
        "contacts": "📞 Contacte",
        "privacy_app": "🔐 Confidențialitate și date",
        "privacy": "🔐 Confidențialitate",
        "write_support": "💬 Scrie-ne în Telegram",
        "website": "🌐 Site",
    },
    "ru": {
        "open": "💘 Открыть FLIRT",
        "events": "🎉 События",
        "tickets": "🎫 Мои билеты",
        "help": "❓ Помощь",
        "contacts": "📞 Контакты",
        "privacy_app": "🔐 Конфиденциальность и данные",
        "privacy": "🔐 Конфиденциальность",
        "write_support": "💬 Написать в Telegram",
        "website": "🌐 Сайт",
    },
    "en": {
        "open": "💘 Open FLIRT",
        "events": "🎉 Events",
        "tickets": "🎫 My tickets",
        "help": "❓ Help",
        "contacts": "📞 Contacts",
        "privacy_app": "🔐 Privacy & data",
        "privacy": "🔐 Privacy",
        "write_support": "💬 Message us on Telegram",
        "website": "🌐 Website",
    },
}


def button(lang: str, key: str) -> str:
    return BUTTONS.get(lang, BUTTONS[DEFAULT_LANG])[key]


# --------------------------------------------------------------------------- #
# Date publice din configurație
# --------------------------------------------------------------------------- #


def support_email() -> str:
    value = (getattr(settings, "legal_contact_email", "") or "").strip()
    return value or DEFAULT_SUPPORT_EMAIL


def support_telegram_username() -> str:
    """Username-ul contului de suport, fără `@` (gol = nesetat)."""
    value = getattr(settings, "support_telegram_username", "") or ""
    return value.strip().lstrip("@")


def website_url() -> str:
    return (getattr(settings, "public_website_url", "") or "").strip().rstrip("/")


def _legal_base() -> str:
    return (getattr(settings, "public_legal_base_url", "") or "").strip().rstrip("/")


def privacy_url() -> str:
    base = _legal_base()
    return f"{base}/legal/privacy" if base else ""


def terms_url() -> str:
    base = _legal_base()
    return f"{base}/legal/terms" if base else ""


def _e(value: str) -> str:
    """Escape HTML pentru text și atribute (`quote=True` acoperă `href="..."`)."""
    return html.escape(value or "", quote=True)


def _link(url: str, label: str) -> str:
    return f'<a href="{_e(url)}">{_e(label)}</a>'


# --------------------------------------------------------------------------- #
# Mesaje
# --------------------------------------------------------------------------- #


def welcome(lang: str, first_name: str | None = None) -> str:
    """Legenda pozei de bun venit (HTML, ≤ 1024 caractere)."""
    name = _e((first_name or "").strip()[:64])
    if lang == "ru":
        hello = f"Привет, <b>{name}</b>! 👋" if name else "Привет! 👋"
        return (
            f"{hello}\n\n"
            "Добро пожаловать в <b>FLIRT</b> — место для настоящих знакомств в Молдове 💘\n\n"
            "✨ Листай анкеты рядом, ставь лайки и общайся после мэтча\n"
            "🎉 Приходи на <b>Flirt Party</b> — вечеринки, где знакомятся вживую\n"
            "🎫 Покупай билеты прямо здесь — QR-код появится в «Мои билеты»\n\n"
            "Нажми кнопку ниже — приложение откроется прямо в Telegram 👇"
        )
    if lang == "en":
        hello = f"Hi, <b>{name}</b>! 👋" if name else "Hi there! 👋"
        return (
            f"{hello}\n\n"
            "Welcome to <b>FLIRT</b> — the place for real dating in Moldova 💘\n\n"
            "✨ Browse profiles nearby, like and chat once you match\n"
            "🎉 Join <b>Flirt Party</b> — parties where people meet in person\n"
            "🎫 Buy tickets right here — your QR code shows up in “My tickets”\n\n"
            "Tap the button below — the app opens right inside Telegram 👇"
        )
    hello = f"Salut, <b>{name}</b>! 👋" if name else "Salut! 👋"
    return (
        f"{hello}\n\n"
        "Bine ai venit la <b>FLIRT</b> — locul cunoștințelor reale din Moldova 💘\n\n"
        "✨ Descoperă oameni din apropiere, dă like și scrie-le după potrivire\n"
        "🎉 Vino la <b>Flirt Party</b> — petreceri unde te cunoști pe viu\n"
        "🎫 Cumpără bilete direct de aici — codul QR apare în „Biletele mele”\n\n"
        "Apasă butonul de mai jos — aplicația se deschide direct în Telegram 👇"
    )


def help_text(lang: str) -> str:
    if lang == "ru":
        return (
            "❓ <b>Что умеет FLIRT</b>\n\n"
            "💘 <b>Знакомства</b> — анкеты рядом, лайки, мэтчи и чат с фото, видео и голосовыми.\n"
            "🎉 <b>Flirt Party</b> — афиша вечеринок и билеты на них.\n\n"
            "🎫 <b>Как купить билет</b>\n"
            "1. Открой «События» и выбери вечеринку.\n"
            "2. Оплати через <b>MIA</b> (мгновенный перевод по QR-коду или номеру телефона).\n"
            "3. Загрузи чек из приложения банка — без него мы не сможем подтвердить оплату.\n"
            "4. После проверки билет с QR-кодом появится в «Мои билеты». "
            "Покажи его на входе.\n\n"
            "⏰ Онлайн-продажа закрывается незадолго до начала вечеринки.\n\n"
            "<b>Команды</b>\n"
            "/start — главное меню\n"
            "/events — вечеринки\n"
            "/tickets — мои билеты\n"
            "/contacts — контакты и поддержка\n"
            "/privacy — конфиденциальность и условия\n"
            "/help — эта справка"
        )
    if lang == "en":
        return (
            "❓ <b>What FLIRT can do</b>\n\n"
            "💘 <b>Dating</b> — profiles nearby, likes, matches and chat with photos, video and voice notes.\n"
            "🎉 <b>Flirt Party</b> — upcoming parties and tickets for them.\n\n"
            "🎫 <b>How to buy a ticket</b>\n"
            "1. Open “Events” and pick a party.\n"
            "2. Pay via <b>MIA</b> (instant transfer by QR code or phone number).\n"
            "3. Upload the receipt from your banking app — we can't confirm the payment without it.\n"
            "4. Once we check it, your ticket with a QR code appears in “My tickets”. "
            "Show it at the entrance.\n\n"
            "⏰ Online sales close shortly before the party starts.\n\n"
            "<b>Commands</b>\n"
            "/start — main menu\n"
            "/events — parties\n"
            "/tickets — my tickets\n"
            "/contacts — contacts and support\n"
            "/privacy — privacy and terms\n"
            "/help — this help"
        )
    return (
        "❓ <b>Ce poți face în FLIRT</b>\n\n"
        "💘 <b>Cunoștințe</b> — profiluri din apropiere, like-uri, potriviri și chat cu poze, video și mesaje vocale.\n"
        "🎉 <b>Flirt Party</b> — petrecerile care urmează și biletele pentru ele.\n\n"
        "🎫 <b>Cum cumperi un bilet</b>\n"
        "1. Deschide „Evenimente” și alege petrecerea.\n"
        "2. Plătește prin <b>MIA</b> (transfer instant, cu cod QR sau după numărul de telefon).\n"
        "3. Încarcă bonul din aplicația băncii — fără el nu putem confirma plata.\n"
        "4. După verificare, biletul cu cod QR apare în „Biletele mele”. "
        "Arată-l la intrare.\n\n"
        "⏰ Vânzarea online se închide cu puțin înainte de începutul petrecerii.\n\n"
        "<b>Comenzi</b>\n"
        "/start — meniul principal\n"
        "/events — evenimente\n"
        "/tickets — biletele mele\n"
        "/contacts — contacte și suport\n"
        "/privacy — confidențialitate și termeni\n"
        "/help — acest ajutor"
    )


def contacts_text(lang: str) -> str:
    email = support_email()
    tg = support_telegram_username()
    site = website_url()
    title = {"ru": "📞 <b>Контакты FLIRT</b>", "en": "📞 <b>FLIRT contacts</b>"}.get(
        lang, "📞 <b>Contacte FLIRT</b>"
    )
    intro = {
        "ru": "Есть вопрос по приложению, оплате или билету? Напиши нам — ответим как можно скорее.",
        "en": "Questions about the app, a payment or a ticket? Write to us — we'll reply as soon as we can.",
    }.get(lang, "Ai o întrebare despre aplicație, plată sau bilet? Scrie-ne — îți răspundem cât de repede putem.")
    lines = [title, "", intro, ""]
    lines.append(f"✉️ Email: {_link('mailto:' + email, email)}")
    if tg:
        lines.append(f"💬 Telegram: {_link('https://t.me/' + tg, '@' + tg)}")
    if site:
        label = site.split("://", 1)[-1]
        lines.append(f"🌐 {_link(site, label)}")
    tip = {
        "ru": "Если вопрос по билету — укажи название вечеринки и номер заказа.",
        "en": "For a ticket question, please include the event name and your order number.",
    }.get(lang, "Pentru un bilet, menționează numele evenimentului și numărul comenzii.")
    lines += ["", f"<i>{_e(tip)}</i>"]
    return "\n".join(lines)


def privacy_text(lang: str) -> str:
    p_url, t_url = privacy_url(), terms_url()
    if lang == "ru":
        head = (
            "🔐 <b>Конфиденциальность</b>\n\n"
            "Мы обрабатываем данные только для работы сервиса. Скачать свои данные, "
            "отозвать согласия или удалить аккаунт можно в приложении — раздел "
            "«Конфиденциальность и данные»."
        )
        labels = ("Политика конфиденциальности", "Условия использования")
    elif lang == "en":
        head = (
            "🔐 <b>Privacy</b>\n\n"
            "We process data only to run the service. You can export your data, "
            "withdraw consents or delete your account in the app — under "
            "“Privacy & data”."
        )
        labels = ("Privacy policy", "Terms of use")
    else:
        head = (
            "🔐 <b>Confidențialitate</b>\n\n"
            "Prelucrăm datele doar ca serviciul să funcționeze. Îți poți descărca "
            "datele, retrage acordurile sau șterge contul din aplicație — secțiunea "
            "„Confidențialitate și date”."
        )
        labels = ("Politica de confidențialitate", "Termeni și condiții")
    lines = [head]
    links = [(u, l) for u, l in zip((p_url, t_url), labels) if u]
    if links:
        lines.append("")
        lines += [f"📄 {_link(u, l)}" for u, l in links]
    return "\n".join(lines)


def events_text(lang: str) -> str:
    return {
        "ru": "🎉 <b>Flirt Party</b>\n\nАфиша ближайших вечеринок и билеты — в приложении 👇",
        "en": "🎉 <b>Flirt Party</b>\n\nUpcoming parties and tickets are in the app 👇",
    }.get(lang, "🎉 <b>Flirt Party</b>\n\nPetrecerile care urmează și biletele le găsești în aplicație 👇")


def tickets_text(lang: str) -> str:
    return {
        "ru": "🎫 <b>Мои билеты</b>\n\nЗдесь твои заказы, их статус и QR-коды для входа 👇",
        "en": "🎫 <b>My tickets</b>\n\nYour orders, their status and the QR codes for entry 👇",
    }.get(lang, "🎫 <b>Biletele mele</b>\n\nComenzile tale, starea lor și codurile QR de intrare 👇")


def fallback_text(lang: str) -> str:
    return {
        "ru": (
            "Я открываю приложение FLIRT — общение происходит внутри него 💬\n\n"
            "Нажми кнопку ниже или /help, чтобы увидеть все команды."
        ),
        "en": (
            "I open the FLIRT app — conversations happen inside it 💬\n\n"
            "Tap the button below or send /help to see all commands."
        ),
    }.get(
        lang,
        "Eu deschid aplicația FLIRT — conversațiile se poartă în aplicație 💬\n\n"
        "Apasă butonul de mai jos sau trimite /help ca să vezi toate comenzile.",
    )


def no_miniapp_text(lang: str) -> str:
    return {
        "ru": "Приложение FLIRT сейчас недоступно. Загляни чуть позже 🙏",
        "en": "The FLIRT app isn't available right now. Please check back a bit later 🙏",
    }.get(lang, "Aplicația FLIRT nu e disponibilă momentan. Revino puțin mai târziu 🙏")
