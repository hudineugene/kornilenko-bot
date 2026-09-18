# Construcciones Kornilenko — Admin panel redesign spec for Codex

## Goal
Re-style the EXISTING admin dashboard to match `admin_reference.png` without changing application behavior, routes, data models, API calls, authentication or business logic.

## Hard brand rule — DO NOT BREAK
Use the supplied logo asset as an image file. Do not redraw, recreate, trace, crop, simplify, recolor, rearrange or generate it. The lower geometric figures under the text are part of the logo and must always remain visible.

Preferred logo file for the white sidebar:
- `kornilenko_logo_sidebar_320.png`
High-resolution clean version:
- `kornilenko_logo_exact_white_clean.png`
Original visual reference:
- `kornilenko_logo_original_reference.jpg`

## Image assets
- `admin_reference.png` — visual target for the whole page.
- `admin_header_background_1920x480.webp` — desktop architectural/header background.
- `admin_header_background_1920x480.png` — lossless version.
- `admin_header_background_mobile_960x480.webp` — narrow/mobile fallback.

Do not bake UI text, buttons, cards, charts or icons into background images. Those must be real HTML/CSS components.

## Layout
Desktop reference: 1672×941.
- Sidebar: 250px fixed width, white background, subtle right border.
- Main content starts immediately after sidebar and scrolls independently with the document.
- Top utility bar: ~64px high. Search on the left/center, notification + administrator block on the right.
- Page content horizontal padding: 28–32px.
- Cards use 12–14px radius, 1px cool-gray border and very soft shadow.
- Keep information density high; do not waste vertical space.

## Header / hero
Use `admin_header_background_1920x480.webp` as an absolutely positioned decorative background behind the upper section of the main content.
Suggested CSS idea:
```css
.dashboard-main::before {
  content: "";
  position: absolute;
  inset: 0 0 auto 0;
  height: 350px;
  background: url('/assets/admin_header_background_1920x480.webp') center top / cover no-repeat;
  pointer-events: none;
  z-index: 0;
}
.dashboard-main > * { position: relative; z-index: 1; }
```
Do not put the company logo inside this header background. The logo belongs in the sidebar as a separate `<img>` asset.

## Typography
Preferred: Inter. Fallback: system-ui, -apple-system, Segoe UI, sans-serif.
- Main title: 44–48px / 700–800.
- Card title: 17–20px / 650–750.
- Large metric: 30–38px / 700–800.
- Body: 14–16px.
- Labels/captions: 12–13px.

## Core colors
```css
--bg: #f8fafc;
--surface: rgba(255,255,255,.94);
--surface-solid: #ffffff;
--text: #0f172a;
--muted: #64748b;
--border: #e2e8f0;
--primary: #2563eb;
--primary-hover: #1d4ed8;
--primary-soft: #eff6ff;
--success: #16a34a;
--success-soft: #ecfdf3;
--warning: #d97706;
--warning-soft: #fff7ed;
--purple: #7c3aed;
```
Brand red/yellow/cyan may be used only as restrained accents; do not turn the dashboard into a rainbow.

## Sidebar hierarchy
Keep the current navigation entries and URLs. Visual grouping should follow the reference:
- Main / Overview
- Content: Greeting, Objects, Promotions, About, Contacts
- Communications: Requests, Auto-replies, Broadcasts
- Audience: Users
- System: Settings, Logs (only if route exists already)

Selected item: pale blue fill + blue icon/text + 3–4px blue indicator on the left.
Counters should be compact pills aligned to the right.
At the bottom show the bot status card.

## Dashboard order
1. Welcome/header area.
2. Large bot-status card + attention/status card on the right.
3. Four KPI cards: Users, Active objects, New requests, Interest in objects.
4. 14-day messages chart.
5. Right column: Latest users, Latest requests.
6. Optional quick actions if the current app already has matching routes/actions.

Do not invent data. Use the existing values/state already provided by the application.

## Components
- Build cards, buttons, badges, chart containers and navigation in HTML/CSS/React/Vue components already used by the project.
- Use the project icon library (Lucide/Font Awesome/etc.) for UI icons. Do NOT create raster images for gear, users, heart, chat, bell, search etc.
- Keep buttons keyboard-focusable and accessible.
- Status must not be communicated by color only; keep text/icon labels.

## Responsive behavior
- >= 1280px: full sidebar ~250px.
- 900–1279px: sidebar can collapse to icon rail; labels accessible via tooltip.
- < 900px: sidebar becomes drawer; cards stack; KPI cards 2 columns then 1 column.
- Hero image uses mobile asset or `object-position: 70% top`.
- Charts must not overflow horizontally.

## Functional safety
DO NOT modify:
- Authentication/session code
- API requests/endpoints
- Database/storage
- Telegram bot logic
- Existing counters/calculations
- Routes/navigation destinations
- Existing form handlers

This is a UI/UX redesign only. If a reference element has no existing function/route, omit it rather than wiring fake functionality.

## Acceptance checklist
- Logo geometry is 100% unchanged and fully visible.
- Lower red/yellow/cyan logo pieces are present.
- Dashboard remains fully functional.
- No screenshots are used as the whole page background.
- Only the architectural hero is a background image.
- Cards/buttons/text remain real DOM elements.
- Existing data and chart values render correctly.
- Responsive at desktop/tablet/mobile widths.
