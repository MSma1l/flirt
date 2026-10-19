# FLIRT Privacy and Personal Data Processing Policy

Version {{version}} · in force from {{effective_date}}

## In short

- We process your data only to make FLIRT work: your account, profile, profile recommendations, conversations, Flirt Party events, tickets and the Flirt Passport loyalty program.
- FLIRT is intended exclusively for people aged **18 or over**.
- We **do not sell** your data. We do not share it with advertising networks or data brokers. We do not use analytics tools or advertising trackers.
- Our servers and media files are located in a data center in **Chișinău, Republic of Moldova**.
- AI features are **turned off by default**. They are activated only if you turn them on yourself.
- In the app you can **download your data**, **turn off notifications** and **delete your account**.
- You have the right to lodge a complaint with the National Center for Personal Data Protection ([www.datepersonale.md](https://www.datepersonale.md)).

## 1. Legal framework

This policy complies with **Law No. 195/2024 on personal data protection**. The Law was adopted on 25 July 2024, published in the Official Gazette (Monitorul Oficial) of the Republic of Moldova No. 367-369 of 23 August 2024 (Art. 574), and applies from **23 August 2026**. It replaces Law No. 133/2011 and transposes Regulation (EU) 2016/679 (GDPR).

When we write "Art." without further details, we refer to the articles of Law No. 195/2024. If you are located in the European Union or the European Economic Area, the GDPR also applies directly. The GDPR articles have the same numbering.

This policy provides you with the information required by Art. 12–14: who processes the data, what data, for what purpose, on what legal basis, to whom we disclose it, how long we keep it and what rights you have.

## 2. The controller and contact details

The controller of the personal data processed through FLIRT is:

| | |
|---|---|
| **Name** | {{operator_name}} |
| **IDNO** | {{operator_idno}} |
| **Address** | {{operator_address}} |
| **Data protection e-mail** | [{{contact_email}}](mailto:{{contact_email}}) |
| **Data protection officer (Art. 37–39) / contact person** | {{dpo_contact}} |

You can write to us at this address with any question about your data or to exercise your rights.

## 3. Scope

This policy applies to the processing of data through:

- the FLIRT app as a Telegram Mini App (miniapp.flrt.md) and the Telegram bot @flrt_party_bot;
- the FLIRT mobile app (iOS and Android), where available;
- the servers and application programming interface (API, api.flrt.md) serving these apps;
- Flirt Party events organized by the controller: ticket sales, entry admission and the Flirt Passport program.

This policy does not cover third-party services, for example Telegram, app stores or your bank. They have their own privacy policies.

### Terms used

| Term | Meaning |
|---|---|
| **Personal data** | any information relating to an identified or identifiable natural person |
| **Processing** | any operation performed on data: collection, storage, display, disclosure, erasure, etc. |
| **Controller** | the party that determines the purposes and means of processing (us) |
| **Processor** | a provider that processes data on behalf of and on the instructions of the controller |
| **Special categories of data** | sensitive data, for example data revealing sexual orientation or biometric data (Art. 9) |
| **Profiling** | automated evaluation of certain personal aspects, for example compatibility with other people |

## 4. What data we process and where we get it from

| Category | What data | Source |
|---|---|---|
| **Telegram account** | your Telegram user identifier and Telegram interface language (ro/ru/en). For these accounts a technical e-mail address is also generated; it does not belong to you and is not used for communication. | Telegram, when you open the Mini App |
| **Telegram data used only on the device** | your Telegram first name, last name and username. The Mini App uses them on your phone: it pre-fills your name in the profile and in the ticket order. **The server does not store them**. | Telegram |
| **Telegram profile photo (fallback avatar)** | each time you sign in via Telegram we retrieve your Telegram profile photo, download it and **store it on our server** (a JPEG of at most 640 px, without metadata), together with its source address and the date of the last check. We show it to the people you have a conversation with (conversation list, conversation header, profile opened from the conversation) **only while you have no photos of your own in FLIRT**. It does not appear in recommendations and does not become a profile photo. | Telegram: the Mini App launch data or the Bot API, within your Telegram privacy settings |
| **Other sign-in methods** (mobile app only, when enabled) | e-mail and password (the password is stored only as an Argon2 hash), phone number for the SMS code, Google or Apple identifier | you / Google / Apple |
| **Account status** | role, creation date, last activity, any suspension and its reason, deletion request | the system |
| **Profile** | display name, date of birth (we show others only your age), gender, height, nationality, languages spoken, bio (max. 500 characters), interests, dating status (what you are looking for), "verified" badge | you |
| **Photos and stories** | 2–9 profile photos; stories, with a photo or video and a caption | you |
| **Location** | city (required), street (optional) and the coordinates derived from them by geocoding. **We do not use the device's GPS location** in the Mini App. | you / the geocoding service |
| **Preferences** | the genders you are interested in, age range, search radius, profile hiding, notification settings, activation of AI features | you |
| **Humor test** (only when enabled, see section 8) | your ratings of jokes ("funny" / "not") and the humor profile calculated from them (7 humor types) | you / automatic calculation |
| **Social activity** | likes and passes, super likes (with the attached message, if any), matches, favorites, blocks | you |
| **Profile views and activity center** | when someone likes or passes on your profile in recommendations or opens your profile (for example from a conversation), we record who viewed it, whose profile it was and the day: a single row per visitor, per profile and per day. We also keep the point up to which you have read your activity (read / unread). | you and other users / the system |
| **Conversations** | text messages, photos, videos and voice messages sent; reactions; read status; file metadata (size, duration, resolution). Voice messages are converted on our server to AAC/M4A so that they can be played on any device; no third party is involved in the conversion. | you and your conversation partners |
| **Reports** | reports submitted by you or about you: category, note, reference to the conversation, status | users / moderators |
| **Events and loyalty** | event attendance ("going"), ticket (code displayed as a QR code), entry scan, Flirt Passport stamps, loyalty level and discounts, invitation codes used | you / entry staff |
| **Ticket orders** | full name, phone, e-mail, your message, number of tickets, amount, payment method (MIA instant payment or bank transfer), payment reference and description, **proof of payment** (image or PDF, which may contain banking details), order status, administrator notes, the times of the decision and of entry | you / administrators |
| **Subscriptions** (mobile app, when enabled) | plan, transaction identifiers, expiry date, receipt from the App Store / Google Play or from the payment processor | the app store / the payment processor |
| **Notifications** | the permission given to the bot to message you in Telegram, the four notification toggles; in the mobile app, the push notification token and platform | you / Telegram |
| **Technical data** | IP address (truncated in access logs), browser/app type, request identifier, error logs, temporary abuse rate-limiting counters | your device |
| **Records** | consents given (document, version, date and time, IP, user agent); log of the team's administrative actions | the system |

**We do not receive or store your bank card details.** Tickets are paid from your bank's app (MIA or transfer). Subscriptions in the mobile app are paid through the app store.

**We do not ask you for** data about health, religion, political opinions, ethnic origin or criminal records.

## 5. Purposes, legal bases and retention periods

We process data only if we have a legal basis under Art. 6 (and, for special categories, Art. 9):

| Purpose | Data used | Legal basis | How long we keep it |
|---|---|---|---|
| Creating and managing the account, authentication | account, account status, technical data | performance of a contract (Terms of Use), Art. 6 | as long as the account exists (see section 12) |
| Displaying the profile, recommendations, likes, matches | profile, photos, location, preferences, humor test (when enabled), social activity | performance of a contract, Art. 6 | as long as the account exists |
| Telegram photo as a fallback avatar in conversations | Telegram profile photo | performance of a contract (conversations) and legitimate interest (so that your conversation partners recognize you while you have no photos of your own), Art. 6 | as long as the account exists; replaced when you change the photo in Telegram and deleted when it is no longer available there (see section 12) |
| Activity center: number of profile views, statistics (likes, super likes, passes, matches), list of people who liked you or matched with you | profile views, social activity | performance of a contract, Art. 6; recording your visits to other people's profiles: legitimate interest, Art. 6 | as long as the account exists (see section 12) |
| Recommendations based on gender and the genders you are interested in (may reveal sexual orientation) | gender, genders you are interested in, dating status | **explicit consent**, Art. 6 and Art. 9 (see section 6) | as long as the account exists or until you withdraw your consent |
| Conversations and stories | conversations, stories | performance of a contract, Art. 6 | until the message / story or the account is deleted |
| Events, tickets, entry, Flirt Passport | events, orders, loyalty | performance of a contract, Art. 6 | see section 12 |
| Accounting records of ticket sales | orders (anonymized after account deletion), proofs of payment | legal obligation (Law No. 287/2017 on accounting and financial reporting), Art. 6 | proofs: {{proof_retention_years}} years; anonymized records: as required by law |
| Telegram notifications about messages, likes, matches and stories | Telegram identifier, sender's first name, message preview | consent (permission given to the bot in Telegram) and performance of a contract, Art. 6; you can turn them off at any time | we do not store them after sending |
| AI features (message suggestions, "chemistry" explanation) | see section 7 | **consent** (activation in Settings), Art. 6 | we do not store requests; 5-minute temporary cache |
| Face verification (currently unavailable) | selfie, first profile photo | **explicit consent**, Art. 9 | the selfie is not stored; only the result is kept |
| Community safety: photo moderation, masking of contact details, reports, blocks, suspensions | photos, messages, reports, account status | legitimate interest, Art. 6 | reports are kept even after account deletion |
| Service security: logs, abuse rate limiting, fraud prevention | technical data | legitimate interest, Art. 6 | logs: max. {{log_retention_days}} days |
| Our own announcements between profiles (for example, event promotion) | gender and age, to choose the appropriate announcement | legitimate interest, Art. 6 | no per-user history is created |
| Backups | all data in the database and media files | legitimate interest, Art. 6 | {{backup_days}} days |
| Records of consents and of requests concerning rights | records | legal obligation (obligation to demonstrate consent), Art. 6 | for the lifetime of the account; after deletion, without IP and user agent |
| Responding to lawful requests from authorities | data required by law | legal obligation, Art. 6 | as long as the law requires |
| Establishment or defense of legal claims | reports, records | legitimate interest, Art. 6 | until the limitation periods expire |

**Our legitimate interest** is the safe and proper operation of the service, protecting users from abuse and fraud, and promoting our own events. You may ask us at any time for the assessment carried out for this legal basis. You may object to this processing (section 13).

**Without the mandatory data** (age, gender, city, photos) we cannot create your profile or recommend people to you. Optional data (street, height, bio, interests, etc.) is provided only if you wish.

## 6. Special categories of data (sensitive data)

**Sexual orientation.** Your gender, the genders you are interested in and your dating status may indirectly reveal your sexual orientation or aspects of your intimate life. These are special categories of data (Art. 9). We process them **only on the basis of your explicit consent**, given through the Personal Data Processing Agreement when you enter the app, and **only** to recommend suitable profiles to you. We do not show other users the genders you are interested in. We do not use this data for advertising.

You can change these preferences in your profile at any time. You can withdraw your consent by deleting your account, because without this data we cannot recommend people to you.

**Biometric data.** Face verification automatically compares a selfie with your profile photo to confirm that the profile belongs to you. This is processing of biometric data. It takes place only with explicit, separate and optional consent. **The selfie is not stored**. We keep only the result (profile verified or not). **The feature is currently unavailable.** We will ask for your consent when you use it.

**What you publish.** Please do not include sensitive data about yourself or others in your bio, stories or messages (for example about health or religion). If you do, it becomes visible to the people it is addressed to.

## 7. Optional features

| Feature | Default | What data it uses | How you control it |
|---|---|---|---|
| **AI message suggestions** | **off** | at most the last 8 messages of the conversation, each truncated to 400 characters and labeled only "me" / "partner". **No names, identifiers, dates or photos**. Contact details are masked before sending. | Settings → AI features |
| **"Chemistry" explanation (AI)** | **off** | compatibility score, shared interests, languages and dating statuses, approximate distance in words (for example "about 12 km away"). No names or photos. | Settings → AI features |
| **Notifications via the Telegram bot** | the bot messages you only after you allow it to in Telegram | the first name of the person who messaged or liked you and a preview of at most 80 characters of the message (with contact details masked), transmitted through Telegram's servers | Settings → notifications: four toggles (messages, likes, matches, stories) |
| **Push notifications** (mobile app) | only with the phone's permission | device token | phone / app settings |
| **Face verification** | unavailable | selfie, first profile photo | separate consent, withdrawable at any time from "Privacy & data" |

AI features use an external service (OpenRouter, which forwards the request to an AI model by Anthropic, USA). We do not log the requests: we keep only the feature type, success and duration. Responses are held temporarily in memory for 5 minutes. If you turn off AI features, we no longer send anything to the provider.

## 8. Profiling and automated decision-making

We use the following automated processing (Art. 22):

**Order of recommendations (profiling).** For each suitable profile we calculate a compatibility score from:

- shared interests (the highest weight);
- similarity of humor profiles (only while the humor test is enabled);
- shared dating statuses;
- distance (the closer, the higher);
- shared languages;
- recent activity in the app and the "verified" badge.

**The humor test** is turned off by default and we may enable it from the administration panel. When it is enabled, you are told what it is for before you start, and you may be asked to complete it before liking profiles. The result affects the compatibility score only while the test is enabled.

We first show you the profiles that match your preferences (gender, age, radius), in order of score. We do not show accounts inactive for more than 30 days. When there are no more such profiles, we may gradually widen the search: first without the age and radius limits, then with profiles you passed on at least 24 hours ago ("second chance"), then with other profiles. The score is not shown to other users and is not sold to anyone.

**Automated photo moderation.** Profile photos and stories may be checked automatically (by an AI model or, if needed, by a local check) for nudity or prohibited content. They may be rejected before publication. Uncertain cases are left for human review.

**Masking of contact details.** Phone numbers, e-mail addresses, links and social media accounts in messages are automatically replaced with "****" as protection against scams. The original text is not kept.

**Automatic hiding.** An account reported by several different users (currently, 3) may be automatically hidden until it is reviewed by a moderator.

This processing does not produce legal effects concerning you. Permanent suspension of an account is always decided by a human moderator. You have the right to obtain human intervention, to express your point of view and to contest an automated decision by writing to us at [{{contact_email}}](mailto:{{contact_email}}). You may object to the profiling used to order recommendations. In that case, recommendations may become less relevant.

## 9. Minimum age

FLIRT is intended exclusively for people aged at least **18**. You confirm your age when entering the app, and your date of birth is checked when the profile is created. We do not knowingly collect data about minors. If we learn that an account belongs to a person under 18, we suspend it and delete the data. You can report such cases to us at [{{contact_email}}](mailto:{{contact_email}}).

## 10. To whom we disclose data

**Other users.** Other users see your public profile: name, age, photos, city, approximate distance (in whole kilometers), interests, bio, "verified" badge and stories. Messages are visible only to the participants in the conversation. We do not show your e-mail, phone, date of birth, street, coordinates or the genders you are interested in.

In the activity center, the people you like (including with a super like) and the people you have matched with see your profile. Passes are shown to the other person only as a total number, without your identity. Profile views are shown only as a number (total, last 7 days and per day), never who visited. If you have no photos of your own, your conversation partners see your Telegram profile photo (section 4).

**Event entry staff.** When scanning a ticket, staff see the holder's first name, age and first profile photo to confirm their identity.

**Processors** (process data on our behalf, in accordance with Art. 28):

| Recipient | Role | What it receives | Where | When |
|---|---|---|---|---|
| Hosting provider (data center in Chișinău) | servers, database, media files, backups | all stored data (encrypted in transit) | Republic of Moldova | permanently |
| Telegram (Telegram FZ-LLC and affiliates) | authentication, running the Mini App, bot notifications, retrieving the Telegram profile photo | Telegram identifier, notification text | global infrastructure | permanently |
| OpenRouter, Inc. and Anthropic PBC | AI features; automated photo moderation | conversation excerpts and the data in section 7; the uploaded photo, without your identifier | USA | only when the features are enabled |
| OpenStreetMap Foundation (Nominatim) | converting the city / street into coordinates | only the text "street, city", without your identifier | EU / United Kingdom | when the profile is saved |
| Amazon Web Services | face verification (Rekognition); optional storage (S3) | selfie, profile photo | EU / USA | only when enabled (currently not) |
| Apple, Google, Expo, Firebase Cloud Messaging, Twilio, the payment processor | authentication, subscriptions, push notifications, SMS codes (mobile app) | data strictly necessary for the respective service | EU / USA | only in the mobile app, when enabled |

Providers process data only on our instructions and are contractually bound to protect it.

**Resources loaded directly by the Mini App.** Like any web page, the Mini App loads a few resources from third-party servers. They receive the device's IP address and browser type:

- the Telegram Web App script (telegram.org);
- Google Fonts (Google);
- OpenStreetMap maps on the events page;
- your conversation partners' Telegram profile photos (from Telegram's servers), only until their copy reaches our server.

We do not share any other data about you with them.

**Independent controllers.** The bank or payment institution through which you pay for the ticket. Public authorities, courts and law enforcement bodies, when the law obliges us or to protect the life and safety of a person. Our legal and accounting advisers, who are bound by confidentiality.

**We do not sell data** and do not share it with advertising networks or data brokers. The announcements in the app are our own and are selected on the server. We do not share anything about you with those who place the announcements.

## 11. Transfers outside the Republic of Moldova

Data is stored in the Republic of Moldova. However, some providers in section 10 process it in other countries: Telegram (global infrastructure), OpenRouter and Anthropic (USA), and Amazon Web Services, Apple, Google, Expo, Firebase and Twilio (EU or USA), when their services are used.

We transfer data only under the conditions of Art. 44–50:

- to countries or organizations recognized as ensuring an adequate level of protection;
- on the basis of appropriate safeguards, for example standard contractual clauses;
- in their absence, in the derogations permitted by law, for example when the transfer is necessary for the service you requested or when you have given your explicit consent.

We share as little data as possible. The AI provider receives only short excerpts, without names or identifiers. For moderation only the photo is sent, and for geocoding only the address text. You can ask us for information about the safeguards applied and a copy of them at [{{contact_email}}](mailto:{{contact_email}}).

## 12. How long we keep data

| Data | Period |
|---|---|
| Account and profile | as long as the account exists. Accounts inactive for more than 30 days no longer appear in recommendations. |
| **Account deletion request** | the profile is hidden immediately and all sessions are closed. A grace period of **{{grace_days}} days** follows, during which you can cancel the request. After it, the data is automatically and permanently deleted or anonymized (see below). |
| Photos, stories, messages, likes, matches, favorites, blocks, settings, sessions, devices, ticket, attendances, Flirt Passport stamps, subscription | until you delete them or until the account is deleted. Messages are also deleted when the conversation partner's account is deleted. |
| Stories | visible to others for 24 hours, then they remain archived in your account until you delete them or until the account is deleted |
| Telegram profile photo (copy on the server) | refreshed each time you sign in via Telegram. If you delete or hide the photo in Telegram, the copy is deleted at a later sign-in. It is also deleted when the account is permanently deleted. |
| Profile views and the "read" status of the activity | as long as the account exists; permanently deleted together with the account (both the visits you made and the visits you received). |
| Ticket orders | on account deletion they are anonymized: the name, phone, e-mail, messages, notes and payment description are deleted. The amount, currency, number of tickets, payment reference, event, dates and order status remain as accounting records, in accordance with Law No. 287/2017, and no longer identify you. |
| Proofs of payment (receipt images) | **{{proof_retention_years}} years** from the order date, as supporting accounting documents, then automatically deleted. Proofs for rejected or canceled orders are deleted **{{rejected_proof_days}} days** after the decision or immediately on account deletion. |
| Event entry records and invitation codes used | as records of events and of discounts granted. They are no longer linked to a profile after account deletion. |
| Minimal technical record of the deleted account | internal identifier, Telegram identifier, language and deletion date. We keep them as proof of deletion and to prevent accounts suspended for abuse from returning (legitimate interest). |
| Moderation reports | kept even after account deletion, linked to the anonymized account, to prevent abuse and for the establishment or defense of legal claims |
| Records of consents | for the lifetime of the account. After deletion they are kept as evidence, without the IP address and user agent. |
| Backups | **{{backup_days}} days**. Deleted data disappears from backups after at most {{backup_days}} days. |
| Technical logs | access logs contain only the truncated IP address (for example 1.2.3.0) and do not contain request parameters. All logs are deleted after at most **{{log_retention_days}} days**. Error logs, for example those recording blocked attack attempts, may contain the full IP address. |
| Abuse rate-limiting counters | from a few minutes to a few hours |
| Requests to the AI provider | we do not store them. The response is held temporarily for 5 minutes. |
| Verification selfie | not stored |

## 13. Your rights

Under Art. 13–22 you have the following rights:

| Right | What it means | How to exercise it |
|---|---|---|
| **To be informed** (Art. 13–14) | to know what data we process, why and how | this policy |
| **Of access** (Art. 15) | to find out whether we process your data and to receive a copy of it | "Privacy & data" → download data, or e-mail |
| **To rectification** (Art. 16) | to correct inaccurate or incomplete data | directly in your profile and settings, or e-mail |
| **To erasure** ("right to be forgotten", Art. 17) | to request the erasure of your data | Settings → "Delete account", or e-mail |
| **To restriction of processing** (Art. 18–19) | to ask us to store the data without using it any further, for example while we examine a dispute | e-mail |
| **To data portability** (Art. 20) | to receive the data you provided in a structured, machine-readable format (JSON) | "Privacy & data" → download data |
| **To object** (Art. 21) | to object to processing based on legitimate interest, including profiling | e-mail |
| **Regarding automated decisions** (Art. 22) | not to be subject to a decision based solely on automated processing that significantly affects you; to obtain human intervention and to contest the decision | e-mail |
| **To withdraw consent** | at any time, without affecting the lawfulness of processing carried out before | Settings (AI, notifications), "Privacy & data" (face verification), account deletion |
| **To lodge a complaint** (Art. 74) | with the NCPDP (CNPDCP) and with a court | section 14 |

**What the data export contains:** the account (without the password), profile, settings, likes sent, matches, conversations and **messages sent by you**, favorites, blocks, reports submitted, stories, event attendances, stamps, discounts, ticket, orders, subscriptions, sessions (dates only), consents and the deletion request. The export does not contain other people's messages, in order to protect their data.

**Response time.** We respond without undue delay and at the latest within **one month** of receiving the request. For complex or numerous requests, this period may be extended by at most **two further months**. If this happens, we will inform you within the first month and explain the reason.

To protect your data, we may ask you for additional information to confirm your identity, for example to send the request from the Telegram account linked to the profile. Exercising your rights is free of charge. For manifestly unfounded or excessive requests, we may charge a reasonable fee or refuse the request, stating our reasons.

## 14. Complaint to the supervisory authority

If you believe that your rights have been violated, please write to us first so that we can try to resolve the situation. However, you have the right to lodge a complaint with the supervisory authority at any time:

**National Center for Personal Data Protection (NCPDP / CNPDCP)**

- address: 48 Serghei Lazo St., MD-2004, Chișinău, Republic of Moldova;
- phone: (022) 820 801;
- e-mail: [centru@datepersonale.md](mailto:centru@datepersonale.md);
- website: [www.datepersonale.md](https://www.datepersonale.md).

You also have the right to bring an action before a court, including for compensation. If you live in the EU/EEA, you may also contact the data protection authority in your country.

## 15. Data security

We apply technical and organizational measures appropriate to the risk (Art. 32):

- all traffic between the app and the servers is encrypted (HTTPS/TLS);
- Telegram authentication is verified cryptographically (signature of the launch data). Each launch can be used only once, as protection against replay;
- sessions use signed access tokens (JWT) valid for 15 minutes and rotated refresh tokens, stored on the server only as a hash. Reuse of an old token closes the session. On a deletion request, all sessions are closed;
- passwords (mobile app) are stored exclusively as Argon2 hashes;
- the number of requests is limited, as protection against attacks and abuse;
- uploaded files are validated (type, size, content). Uploaded photos and the copy of the Telegram photo are re-encoded on the server without metadata (including GPS location in EXIF), and reduced-size copies (WebP) are generated for display. In addition, the Mini App resizes profile photos on the device before upload;
- access to production data is restricted to authorized persons, and administrative actions are logged. The admin panel does not allow reading conversations;
- we make daily backups with a limited retention period.

## 16. Security incidents

No system is completely secure. If a personal data breach occurs (for example unauthorized access, loss or disclosure), we document it and immediately take containment measures. If the incident poses a risk to the rights and freedoms of individuals, **we notify the NCPDP within 72 hours at the latest** of becoming aware of it (Art. 33). If the risk is high, **we will also inform you** without undue delay (Art. 34): what happened, what data is affected, what measures we have taken and what you can do to protect yourself.

## 17. Cookies and local storage

The FLIRT Mini App **does not use tracking cookies**, analytics tools or advertising trackers. We use browser storage strictly for the operation of the app:

| Storage | What it contains | How long |
|---|---|---|
| sessionStorage | session tokens, linked to the Telegram account | until the Mini App is closed |
| localStorage | interface preferences: tickets already shown, recent emojis, stories viewed, gesture hints viewed, the status of the notification permission request | until the Telegram app data is cleared |

This data stays on your device and we do not use it for tracking. Telegram, in which the Mini App runs, processes data according to its own policy: [telegram.org/privacy](https://telegram.org/privacy).

## 18. Changes to this policy

We update this policy when the service, the way we process data or the legislation changes. Each version has a number and an effective date. For substantial changes we notify you in the app and ask you to confirm the new version before continuing. Where processing is based on consent, we ask for new consent. We can send you previous versions on request.

## 19. Contact

For any question about this policy or about your data:

- {{operator_name}}, {{operator_address}}
- E-mail: [{{contact_email}}](mailto:{{contact_email}})
- Data protection officer: {{dpo_contact}}
