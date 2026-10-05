/* ─────────────────────────────────────────
   FILE: pixel-emoji.js
   DESCRIPTION: (2026-10-05) Renders the site's emoji as retro pixel-art icons.
   One module instead of editing ~900 emoji across ~100 files: on every page it
   walks the DOM's text nodes, swaps each emoji listed in EMOJI for an inline
   pixel SVG, and keeps doing so for content added later (MutationObserver —
   chat, notifications, toasts, i18n re-renders).

   - Icons: Pixelarticons by Gerrit Halfmann (MIT, see pixelarticons.LICENSE.txt
     next to this file), 24×24 grid. Sized like a normal emoji: 1.2em rounded
     to a multiple of 4px (16px next to 14px text, 20px next to 16px text…),
     drawn with crisp edges. (Until 2026-10-05 evening they were forced to
     24px minimum for perfect pixels, which made them look too big next to
     small text — Andrei: "arată prea mari".)
   - Monochrome icons take the surrounding text color (fill: currentColor);
     emoji whose meaning is their color (❤ red, 🏆 gold, ✅ green…) get a
     retro palette color instead.
   - NOT touched: anything users typed (chat/DM text, forum posts and replies,
     comments, listings — see SKIP_SELECTOR), form fields, <option>s, code.
   - Emoji not in EMOJI (and plain text symbols like → ← ★ ☆) stay as they are.
   - Data-carrying emoji are safe: reactions keep their value in data-emoji,
     and no site code reads an emoji back out of the DOM's text.
   ───────────────────────────────────────── */

const ICONS = {
"close": "M7 19H5V17H7V19ZM19 19H17V17H19V19ZM9 15V17H7V15H9ZM17 17H15V15H17V17ZM11 15H9V13H11V15ZM15 15H13V13H15V15ZM13 13H11V11H13V13ZM11 11H9V9H11V11ZM15 11H13V9H15V11ZM9 9H7V7H9V9ZM17 9H15V7H17V9ZM7 7H5V5H7V7ZM19 7H17V5H19V7Z",
"checkbox-on": "M4 2h16v2H4zm0 18h16v2H4zM2 4h2v16H2zm18 0h2v16h-2zM7 12h2v2H7zm2 2h2v2H9zm2-2h2v2h-2zm2-2h2v2h-2zm2-2h2v2h-2z",
"warning-diamond": "M2 10h2v2H2zm0 4h2v-2H2zm20-4h-2v2h2zm0 4h-2v-2h2zM4 8h2v2H4zm0 8h2v-2H4zm16-8h-2v2h2zm0 8h-2v-2h2zM6 6h2v2H6zm0 12h2v-2H6zM18 6h-2v2h2zm0 12h-2v-2h2zM8 4h2v2H8zm0 16h2v-2H8zm8-16h-2v2h2zm0 16h-2v-2h2zM10 2h2v2h-2zm0 20h2v-2h-2zm4-20h-2v2h2zm0 20h-2v-2h2zm-3-5h2v-2h-2zm0-4h2V7h-2z",
"lightbulb": "M9 4h6v2H9zM7 6h2v2H7zm8 0h2v2h-2zm4-2h2v2h-2zm2-2h2v2h-2zM0 10h3v2H0zm21 0h3v2h-3zM3 4h2v2H3zM1 2h2v2H1zm6 12h2v2H7zm8 0h2v2h-2zM5 8h2v6H5zm12 0h2v6h-2zm-8 8h6v2H9zm0 4h6v2H9zm0-2h2v2H9zm4 0h2v2h-2zM11 0h2v3h-2z",
"key": "M11 18H3V16H11V18ZM23 15H21V18H17V16H19V13H21V11H11V8H13V9H23V15ZM3 16H1V8H3V16ZM17 16H15V15H13V16H11V13H17V16ZM9 14H5V10H9V14ZM11 8H3V6H11V8Z",
"tools": "M9 22H7v-2h2v2Zm12-6h2v6h-6v-6h2v-6h2v6Zm-2 2v2h2v-2h-2ZM7 20H5v-8h2v8Zm4 0H9v-8h2v8Zm-6-8H3v-2h2v2Zm8 0h-2v-2h2v2ZM3 10H1V4h2v6Zm12 0h-2V4h2v6Zm4 0h-2V4h2v6Zm4 0h-2V4h2v6ZM7 6h2V2h4v2h-2v4H5V4H3V2h4v4Zm14-2h-2V2h2v2Z",
"settings-cog": "M4 20h3v-2h4v4h2v-4h4v2h-2v4H9v-4H7v2H2v-5h2v3Zm18 2h-5v-2h3v-3h2v5ZM6 11H2v2h4v4H4v-2H0V9h4V7h2v4Zm14-2h4v6h-4v2h-2v-4h4v-2h-4V7h2v2Zm-6 7h-4v-2h4v2Zm-4-2H8v-4h2v4Zm6 0h-2v-4h2v4Zm-2-4h-4V8h4v2ZM7 4H4v3H2V2h5v2Zm8 0h2V2h5v5h-2V4h-3v2h-4V2h-2v4H7V4h2V0h6v4Z",
"gamepad": "M4 4h16v2H4zm0 14h16v2H4zM2 6h2v12H2zm18 0h2v12h-2zM8 9h2v6H8z M6 11h6v2H6zm8-2h2v2h-2zm2 4h2v2h-2z",
"joystick": "M4 14h16v2H4zm0 6h16v2H4zm-2-4h2v4H2zm18 0h2v4h-2zM10 2h4v2h-4zM8 4h2v4H8zm6 0h2v4h-2zm-4 4h4v2h-4zm1 2h2v4h-2zm-4 2h2v2H7z",
"message": "M20 2H4v2h16zm0 14H6v2h14zm2-12h-2v12h2zM4 4H2v18h2zm2 14H4v2h2z",
"comment": "M4 2h16v2H4zm0 14h14v2H4zM2 4h2v12H2zm18 0h2v18h-2zm-2 14h2v2h-2z",
"lock": "M5 8h14v2H5zm0 12h14v2H5zM3 10h2v10H3zm16 0h2v10h-2zM7 4h2v4H7zm2-2h6v2H9zm6 2h2v4h-2z",
"unlock": "M5 8h14v2H5zm0 12h14v2H5zM3 10h2v10H3zm16 0h2v10h-2zM7 4h2v4H7zm2-2h6v2H9zm6 2h2v2h-2z",
"trophy": "M16 17H13V19H15V21H9V19H11V17H8V15H16V17ZM18 5H22V11H20V7H18V11H20V13H18V15H16V5H8V15H6V13H4V11H6V7H4V11H2V5H6V3H18V5Z",
"check": "M10 18H8v-2h2v2Zm-2-2H6v-2h2v2Zm4-2v2h-2v-2h2Zm-6 0H4v-2h2v2Zm8 0h-2v-2h2v2Zm2-2h-2v-2h2v2Zm2-2h-2V8h2v2Zm2-2h-2V6h2v2Z",
"checkbox": "M4 2h16v2H4zm0 18h16v2H4zM2 4h2v16H2zm18 0h2v16h-2z",
"mail": "M6 8h2v2H6zm2 2h2v2H8zm10-2h-2v2h2zm-2 2h-2v2h2zm-6 2h4v2h-4zM2 6h2v12H2zm18 0h2v12h-2zM4 4h16v2H4zm0 14h16v2H4z",
"mail-right": "M6 8h2v2H6zm2 2h2v2H8zm10-2h-2v2h2zm-2 2h-2v2h2zm-6 2h4v2h-4z M4 4h16v2H4zm0 14h8v2H4zM2 6h2v12H2zm18 0h2v6h-2zM6 8h2v2H6zm2 2h2v2H8zm6 0h2v2h-2zm2-2h2v2h-2zm-6 4h4v2h-4zm12 6h2v2h-2zm-8 0h4v2h-4zm6-2h2v6h-2zm-2-2h2v10h-2z",
"mailbox": "M3 18h18v2H3zM1 8h2v10H1zm4-4h14v2H5zM3 6h2v2H3zm4 0h2v2H7zm12 0h2v2h-2zM9 8h2v10H9zm12 0h2v10h-2zM5 10h2v2H5zm9 0h4v2h-4zm2 2h2v2h-2z",
"inbox": "M2 4h2v16H2zm2 16h16v2H4zM20 4h2v16h-2zM4 2h16v2H4zm0 12h4v2H4zm4 2h8v2H8zm8-2h4v2h-4z",
"chart-bar-big": "M4 20h18v2H4zM2 2h2v18H2zm16 11v3h-2v-3zM8 13v3H6v-3zm8-2v2H8v-2zm0 5v2H8v-2zm4-12v3h-2V4zM8 4v3H6V4zm10-2v2H8V2zm0 5v2H8V7z",
"trending-up": "M4 18H2v-2h2v2Zm2-2H4v-2h2v2Zm8 0h-2v-2h2v2Zm-6-2H6v-2h2v2Zm4 0h-2v-2h2v2Zm4 0h-2v-2h2v2Zm6-8v8h-2v-4h-2V8h-4V6h8Zm-12 6H8v-2h2v2Zm8 0h-2v-2h2v2Z",
"clipboard": "M4 6h2v14H4zm2 14h12v2H6zM18 6h2v14h-2zM6 4h2v2H6zm10 0h2v2h-2zm-6-2h4v2h-4zm0 4h4v2h-4zM8 2h2v6H8zm6 0h2v6h-2z",
"users": "M5 2h6v2H5zm10 0h4v2h-4zM5 10h6v2H5zm10 0h4v2h-4zm4-6h2v6h-2zm-8 0h2v6h-2zM3 4h2v6H3zM0 18h2v4H0zm14 0h2v4h-2zm8 0h2v4h-2zM4 14h8v2H4zm12 0h4v2h-4zM2 16h2v2H2zm10 0h2v2h-2zm8 0h2v2h-2z",
"user": "M9 2h6v2H9zm0 8h6v2H9zm6-6h2v6h-2zM7 4h2v6H7zM4 18h2v4H4zm14 0h2v4h-2zM8 14h8v2H8zm-2 2h2v2H6zm10 0h2v2h-2z",
"heart": "M13 22h-2v-2h2v2Zm-2-2H9v-2h2v2Zm4 0h-2v-2h2v2Zm-6-2H7v-2h2v2Zm8 0h-2v-2h2v2ZM7 16H5v-2h2v2Zm12 0h-2v-2h2v2ZM5 14H3v-2h2v2Zm16 0h-2v-2h2v2ZM3 12H1V6h2v6Zm20 0h-2V6h2v6ZM13 8h-2V6h2v2ZM5 6H3V4h2v2Zm6 0H9V4h2v2Zm4 0h-2V4h2v2Zm6 0h-2V4h2v2ZM9 4H5V2h4v2Zm10 0h-4V2h4v2Z",
"flag": "M4 2h2v20H4z M4 4h16v2H4zm12 2h2v2h-2zm-2 2h2v2h-2zm2 2h2v2h-2zM4 12h16v2H4z",
"shopping-cart": "M2 2h2v2H2zm2 6h2v4H4zm2 4h2v4H6zm2 4h10v2H8zm10-4h2v4h-2zm2-4h2v4h-2zM4 6h18v2H4zm0-4h2v4H4zm2 17h3v3H6zm11 0h3v3h-3z",
"store": "M3 13h2v8H3zm2 8h14v2H5zm14-8h2v8h-2zm-9-2h4v2h-4zm4-2h4v2h-4zm4 2h4v2h-4zM6 9h4v2H6zm-4 2h4v2H2zM0 7h2v4H0zm2-2h2v2H2zm18 0h2v2h-2zm2 2h2v4h-2zM4 3h16v2H4zm6 12h4v2h-4zm-2 2h2v4H8zm6 0h2v4h-2z",
"library": "M3 4h2v17H3zm4 4h2v13H7zm4-2h2v15h-2zm4 0h2v5h-2zm2 5h2v5h-2zm2 5h2v5h-2z",
"book-open": "M2 3h9v2H2zM0 19h11v2H0zM13 3h9v2h-9zm0 16h11v2H13zM11 5h2v18h-2zM0 5h2v14H0zm22 0h2v14h-2zm-7 2h5v2h-5zm0 4h5v2h-5zm0 4h2v2h-2z",
"star": "M5 20H8V22H3V16H5V20ZM21 22H16V20H19V16H21V22ZM10 20H8V18H10V20ZM16 20H14V18H16V20ZM14 18H10V16H14V18ZM7 16H5V13H7V16ZM19 16H17V13H19V16ZM5 13H3V11H5V13ZM21 13H19V11H21V13ZM9 9H3V11H1V7H9V9ZM23 11H21V9H15V7H23V11ZM11 7H9V3H11V7ZM15 7H13V3H15V7ZM13 3H11V1H13V3Z",
"sparkles": "M11 1h2v4h-2zm0 22h2v-4h-2zM9 5h2v4H9zm0 14h2v-4H9zm4-14h2v4h-2zm0 14h2v-4h-2zM5 9h4v2H5zm14 0h-4v2h4zM1 11h4v2H1zm22 0h-4v2h4zM5 13h4v2H5zm14 0h-4v2h4zm0-12h2v6h-2z M17 3h6v2h-6zM3 17h2v2H3zm-2 2h2v2H1zm2 2h2v2H3zm2-2h2v2H5z",
"sword": "M11 2h2v2h-2zM9 4h2v12H9zm4 0h2v12h-2zM7 16h10v2H7zm4 2h2v4h-2z",
"bell": "M9 2h6v2H9zM7 4h2v2H7zm8 0h2v2h-2zM5 6h2v7H5zm12 0h2v7h-2zM3 13h2v4H3zm16 0h2v4h-2z M3 15h18v2H3zm5 3h2v2H8zm6 0h2v2h-2zm-4 2h4v2h-4z",
"bell-off": "M9 2h6v2H9zm6 2h2v2h-2zM5 6h2v7H5zm12 0h2v6h-2zM3 13h2v4H3z M3 15h14v2H3zm5 3h2v2H8zm6 0h2v2h-2zm-4 2h4v2h-4zM5 4h2v2H5zm2 2h2v2H7zm2 2h2v2H9zm2 2h2v2h-2zm2 2h2v2h-2z M15 14h2v2h-2zm2 2h2v2h-2zm2 2h2v2h-2zM3 2h2v2H3z",
"notes": "M6 8h2v12H6zM2 4h2v12H2zm18 4h2v8h-2zM8 6h12v2H8zM4 2h12v2H4zm14 14h2v2h-2zm-2 2h2v2h-2zm-8 2h8v2H8zm6-6h6v2h-6z M14 14h2v6h-2zm2-10h2v2h-2zM4 16h2v2H4z",
"pencil": "M4 16H6V18H8V20H10V22H2V14H4V16ZM12 20H10V18H12V20ZM14 18H12V16H14V18ZM10 16H8V14H10V16ZM16 16H14V14H16V16ZM6 14H4V12H6V14ZM12 14H10V12H12V14ZM18 14H16V12H18V14ZM8 12H6V10H8V12ZM14 12H12V10H14V12ZM20 12H18V10H20V12ZM10 10H8V8H10V10ZM18 10H16V8H18V10ZM22 10H20V8H22V10ZM12 8H10V6H12V8ZM16 8H14V6H16V8ZM20 8H18V6H20V8ZM14 6H12V4H14V6ZM18 6H16V4H18V6ZM16 4H14V2H16V4Z",
"feather": "M2 20h2v2H2zm6-2h6v2H8zm-2-2h2v2H6zm-2 2h2v2H4zm4-4h2v2H8zm2-2h2v2h-2zm2-2h2v2h-2zm2-2h2v2h-2zm0 8h2v2h-2zm2-2h2v2h-2zm2-2h2v2h-2zm2-6h2v6h-2zm-2-2h2v2h-2zM4 10h2v6H4zm2-2h2v2H6zm2-2h2v2H8zm2-2h2v2h-2zm2-2h6v2h-6z",
"trash": "M18 22H6V20H18V22ZM9 6H15V4H17V6H22V8H20V20H18V8H6V20H4V8H2V6H7V4H9V6ZM15 4H9V2H15V4Z",
"search": "M22 22h-2v-2h2v2Zm-2-2h-2v-2h2v2Zm-6-2H6v-2h8v2Zm4 0h-2v-2h2v2ZM6 16H4v-2h2v2Zm10 0h-2v-2h2v2ZM4 14H2V6h2v8Zm14 0h-2V6h2v8ZM6 6H4V4h2v2Zm10 0h-2V4h2v2Zm-2-2H6V2h8v2Z",
"link": "M4 6h7v2H4zm0 10h7v2H4zM2 8h2v8H2zm18-2h-7v2h7zm0 10h-7v2h7zm2-8h-2v8h2zM7 11h10v2H7z",
"crown": "M3 3h2v12H3zm16 0h2v12h-2zm-8 0h2v2h-2zM9 5h2v2H9zM5 5h2v2H5z M3 3h2v2H3zm4 4h2v2H7zm6-2h2v2h-2zm2 2h2v2h-2zm2-2h2v2h-2zM5 15h14v2H5zm-2 4h18v2H3z",
"calendar": "M5 4h14v2H5zm0 16h14v2H5zM3 10h2v10H3zm0-4h2v2H3zm16 0h2v2h-2zm0 4h2v10h-2zM3 8h18v2H3zm12-6h2v2h-2zM7 2h2v2H7z",
"calendar-text": "M5 4h14v2H5zm0 16h14v2H5zM3 10h2v10H3zm0-4h2v2H3zm16 0h2v2h-2zm0 4h2v10h-2zM3 8h18v2H3zm12-6h2v2h-2zM7 2h2v2H7zm0 10h8v2H7zm0 4h4v2H7z",
"party-popper": "M4 20H6V22H2V18H4V20ZM20 21H18V19H20V21ZM10 20H6V18H10V20ZM6 18H4V14H6V18ZM14 18H10V16H14V18ZM10 16H8V14H10V16ZM16 16H14V12H16V16ZM22 16H20V14H22V16ZM8 14H6V10H8V14ZM20 14H18V12H20V14ZM14 12H12V10H14V12ZM12 10H8V8H12V10ZM20 9H16V7H20V9ZM5 8H3V6H5V8ZM22 7H20V5H22V7ZM12 6H10V4H12V6ZM10 4H8V2H10V4ZM17 4H15V2H17V4Z",
"smartphone": "M6 2h12v2H6zm0 18h12v2H6zM4 4h2v16H4zm14 0h2v16h-2zm-7 13h2v2h-2z",
"laptop": "M3 18h18v-2h2v4H1v-4h2v2Zm2-4h14V6h2v10H3V6h2v8Zm14-8H5V4h14v2Z",
"logout": "M8 11h12v2H8zm8-2h2v2h-2z M14 7h2v10h-2zm2 6h2v2h-2zM6 2h12v2H6zm0 18h12v2H6zM4 4h2v16H4zm14 0h2v3h-2zm0 13h2v3h-2z",
"shield": "M4 2h16v2H4zM2 4h2v10H2zm18 0h2v10h-2zM4 14h2v2H4zm2 2h2v2H6zm4 4h4v2h-4zm10-6h-2v2h2zm-2 2h-2v2h2zm-2 2h-2v2h2zm-6 0H8v2h2z",
"university": "M1 10h2v10H1zm2 10h18v2H3zm18-10h2v10h-2zM3 8h4v2H3zm14 0h4v2h-4zM7 6h2v2H7zm2-2h2v2H9zm2-2h2v2h-2zm2 2h2v2h-2zm2 2h2v2h-2zm-4 2h2v2h-2zm-2 2h2v2H9zm2 2h2v2h-2zm2-2h2v2h-2zm-8 3h2v2H5zm0 4h2v2H5zm12 0h2v2h-2zm0-4h2v2h-2zm-8 5h2v2H9zm0-2h6v2H9zm4 2h2v2h-2z",
"tv": "M4 3h16v2H4zM2 5h2v10H2zm2 10h16v2H4zM20 5h2v10h-2zM6 19h12v2H6zm3-2h2v2H9zm4 0h2v2h-2z",
"cancel": "M6 2h12v2H6zm0 18h12v2H6zM2 6h2v12H2zm18 0h2v12h-2zm-2-2h2v2h-2zm-2 2h2v2h-2zm-2 2h2v2h-2zm-2 2h2v2h-2zm-2 2h2v2h-2zm-2 2h2v2H8zm-2 2h2v2H6zm12 2h2v2h-2zM4 4h2v2H4zm0 14h2v2H4z",
"save": "M20 22H4V20H6V14H8V20H16V14H18V20H20V22ZM4 20H2V4H4V20ZM22 20H20V6H22V20ZM16 14H8V12H16V14ZM12 10H6V6H12V10ZM20 6H18V4H20V6ZM18 4H4V2H18V4Z",
"circle": "M6 2h12v2H6zm0 18h12v2H6zM2 6h2v12H2zm18 0h2v12h-2zm-2-2h2v2h-2zm0 14h2v2h-2zM4 4h2v2H4zm0 14h2v2H4z",
"plug": "M16 18h-3v4h-2v-4H8v-2h8v2Zm-8-2H6v-2h2v2Zm10 0h-2v-2h2v2Zm-8-9h4V2h2v5h5v2h-1v5h-2V9H6v5H4V9H3V7h5V2h2v5Z",
"zap": "M4 13h8v6h2v2h-2v2h-2v-8H2v-4h2v2Zm12 6h-2v-2h2v2Zm2-2h-2v-2h2v2Zm2-2h-2v-2h2v2Zm-6-6h8v4h-2v-2h-8V5h-2V3h2V1h2v8Zm-8 2H4V9h2v2Zm2-2H6V7h2v2Zm2-2H8V5h2v2Z",
"hash": "M9 3h2v5H9zm6 0h2v5h-2zm-7 7h2v4H8zm6 0h2v4h-2zm-7 6h2v5H7zm6 0h2v5h-2zM3 8h18v2H3zm0 6h18v2H3z",
"undo": "M18 20h-6v-2h6v2Zm2-2h-2v-8h2v8Zm-10-4H8v-2H6v-2H4V8h2V6h2V4h2v4h8v2h-8v4Z",
"circle-question": "M18 22H6V20H18V22ZM6 20H4V18H6V20ZM20 20H18V18H20V20ZM4 18H2V6H4V18ZM13 18H11V16H13V18ZM22 18H20V6H22V18ZM15 13H13V15H11V11H15V13ZM17 11H15V8H17V11ZM9 10H7V8H9V10ZM15 8H9V6H15V8ZM6 6H4V4H6V6ZM20 6H18V4H20V6ZM18 4H6V2H18V4Z",
"camera": "M4 5h4v2H4zm4-2h8v2H8zm8 2h4v2h-4zM2 7h2v12H2zm2 12h16v2H4zM20 7h2v12h-2zM10 8h4v2h-4zm0 6h4v2h-4zm-2-4h2v4H8zm6 0h2v4h-2z",
"target": "M5 1h14v2H5zM3 3h2v2H3zm0 16h2v2H3zm16 0h2v2h-2zm0-16h2v2h-2zm2 2h2v14h-2zM5 21h14v2H5zM1 5h2v14H1zm8 0h6v2H9zM5 9h2v6H5zm4 8h6v2H9zm8-8h2v6h-2zm-6 0h2v2h-2zM7 7h2v2H7zm0 8h2v2H7zm8 0h2v2h-2zm0-8h2v2h-2zm-6 4h2v2H9zm2 2h2v2h-2zm2-2h2v2h-2z",
"map": "M4 20h2v2H2V6h2v14Zm12 0h2v2h-4v-2h-2v-2h2V8h-2V6h4v14Zm-8 0H6v-2h2v2Zm12 0h-2v-2h2v2ZM10 4h2v2h-2v10h2v2H8V4H6V2h4v2Zm12 14h-2V4h-2V2h4v16ZM6 6H4V4h2v2Zm12 0h-2V4h2v2Z",
"label": "M16 22h-4v-2h4v2Zm-4-2h-2v-2h2v2Zm6 0h-2v-2h2v2Zm-8-2H8v-2h2v2Zm10 0h-2v-2h2v2ZM8 16H6v-2h2v2Zm14 0h-2v-4h2v4ZM6 14H4v-2h2v2Zm-2-2H2V4h2v8Zm16 0h-2v-2h2v2Zm-2-2h-2V8h2v2ZM8 8H6V6h2v2Zm8 0h-2V6h2v2Zm-2-2h-2V4h2v2Zm-2-2H4V2h8v2Z",
"mic": "M10 2h4v2h-4zM8 4h2v10H8zm2 10h4v2h-4zm4-10h2v10h-2zM4 10h2v6H4zm2 6h2v2H6zm2 2h8v2H8zm8-2h2v2h-2zm2-6h2v6h-2zm-7 10h2v2h-2z",
"blocks": "M15 1h6v2h-6zm-2 2h2v6h-2zm2 6h6v2h-6zm6-6h2v6h-2zM3 5h6v2H3zM1 7h2v14H1zm2 14h14v2H3zm14-6h2v6h-2zM3 13h14v2H3z M9 7h2v14H9z",
"headphone": "M14 13h7v2h-7zm2 6h3v2h-3z M14 13h2v8h-2zm5-6h2v12h-2zM3 13h7v2H3zm2 6h3v2H5z M3 7h2v12H3zm5 6h2v8H8zM7 3h10v2H7zM5 5h2v2H5zm12 0h2v2h-2z",
"globe": "M6 2h12v2H6zm0 18h12v2H6zM4 4h2v2H4zm5 0h2v2H9zm0 14h2v2H9zm4 0h2v2h-2zM7 6h2v12H7zm8 0h2v12h-2zm-2-2h2v2h-2zm7 0h-2v2h2zM2 6h2v12H2zm20 0h-2v12h2zM4 18h2v2H4zm16 0h-2v2h2z M3 11h18v2H3z",
"earth": "M6 2h12v2H6zm0 18h12v2H6zM18 4h2v2h-2zM4 18h2v2H4zM4 4h2v2H4zm14 14h2v2h-2zM2 6h2v12H2zm18 0h2v12h-2zM8 4h2v4H8zm2 4h4v2h-4zm4 2h4v2h-4zm4-2h2v2h-2zM4 12h2v2H4zm6 4h2v4h-2zm-4-2h4v2H6zm8 2h2v4h-2zm2-2h4v2h-4z",
"colors-swatch": "M14 2h6v2h-6zm0 18h6v2h-6zM4 20h10v2H4zm8-16h2v16h-2zm8 0h2v16h-2zM2 16h2v4H2zm2-2h8v2H4zm12 2h2v2h-2zM6 12h2v2H6zM4 8h2v4H4zm2-2h4v2H6zm4 2h2v2h-2z",
"home": "M4 20h16v2H4zm16-10h2v10h-2zM2 10h2v10H2zm2-2h2v2H4zm2-2h2v2H6zm2-2h2v2H8zm2-2h4v2h-4zm4 2h2v2h-2zm2 2h2v2h-2zm2 2h2v2h-2zM8 14h2v6H8zm2-2h4v2h-4zm4 2h2v6h-2z",
"leaf": "M1 18h2v4H1zm2-2h2v2H3zm2-2h6v2H5zm6-2h2v2h-2zm-6 6h4v2H5zm4 2h4v2H9zm4-2h4v2h-4zm4-2h2v2h-2zm2-8h2v8h-2zm0-4h2v4h-2zm-2-2h2v2h-2zm-4 2h4v2h-4zM7 6h6v2H7zM5 8h2v2H5zm-2 2h2v4H3z",
"signal": "M19 3h2v18h-2zm-4 4h2v14h-2zm-4 4h2v10h-2zm-4 4h2v6H7zm-4 4h2v2H3z",
"percent": "M6 20H4v-2h2v2Zm12 0h-4v-2h4v2ZM8 18H6v-2h2v2Zm6 0h-2v-4h2v4Zm6 0h-2v-4h2v4Zm-10-2H8v-2h2v2Zm2-2h-2v-2h2v2Zm6 0h-4v-2h4v2Zm-8-2H6v-2h4v2Zm4 0h-2v-2h2v2Zm-8-2H4V6h2v4Zm6 0h-2V6h2v4Zm4 0h-2V8h2v2Zm2-2h-2V6h2v2Zm-8-2H6V4h4v2Zm10 0h-2V4h2v2Z",
"compass": "M18 22H6V20H18V22ZM6 20H4V18H6V20ZM20 20H18V18H20V20ZM10 16H12V18H10V19H8V10H10V16ZM4 18H2V6H4V18ZM22 18H20V6H22V18ZM14 16H12V14H14V16ZM16 14H14V8H12V6H14V5H16V14ZM13 13H11V11H13V13ZM12 10H10V8H12V10ZM6 6H4V4H6V6ZM20 6H18V4H20V6ZM18 4H6V2H18V4Z",
"diamond-gem": "M7 1h10v2H7zM5 3h2v2H5zm12 0h2v2h-2zm2 2h2v2h-2zm0 8h2v2h-2zm-2 2h2v2h-2zm-2 2h2v2h-2zm-2 2h2v2h-2zm-2 2h2v2h-2zm-2-2h2v2H9zm-2-2h2v2H7zm-2-2h2v2H5zm-2-2h2v2H3zm0-8h2v2H3zM1 7h2v6H1zm20 0h2v6h-2zM3 9h18v2H3zm6-6h2v3H9zM7 6h2v3H7zm8 0h2v3h-2zm-8 5h2v2H7zm2 2h2v3H9zm2 3h2v3h-2zm2-3h2v3h-2zm2-2h2v2h-2zm-2-8h2v3h-2z",
"package": "M10 20h4v2h-4zm0-16h4V2h-4zm0 6h4v2h-4zm4 8h4v2h-4zm0-12h4V4h-4zm0 2h4v2h-4zm4 8h4v2h-4zm0-8h4V6h-4zM6 18h4v2H6zM6 6h4V4H6zm0 2h4v2H6zm-4 8h4v2H2zm0-8h4V6H2z M2 6h2v12H2zm18 0h2v12h-2zm-8 6h2v8h-2zm-2-6h4v2h-4z",
"folder": "M4 4h6v2H4zm0 14h16v2H4zM20 8h2v10h-2zM2 6h2v12H2zm8 0h10v2H10z",
"files": "M9 3H7v14h2zM5 7H3v14h2zm12-6H9v2h8zm4 4h-2v12h2zm-2 12H9v2h10zm-4 4H5v2h10zm2-18h2v2h-2zm-4 0h2v6h-2z M13 7h6v2h-6zM5 5h2v2H5zm10 14h2v2h-2z",
"eye": "M16 20H8v-2h8v2Zm-8-2H4v-2h4v2Zm12 0h-4v-2h4v2ZM4 16H2v-2h2v2Zm10-6h-2v2h2v-2h2v4h-2v2h-4v-2H8v-4h2V8h4v2Zm8 6h-2v-2h2v2ZM2 14H0v-4h2v4Zm22 0h-2v-4h2v4ZM4 10H2V8h2v2Zm18 0h-2V8h2v2ZM8 8H4V6h4v2Zm12 0h-4V6h4v2Zm-4-2H8V4h8v2Z",
"arrow-big-up": "M8 21h8v-2H8zm0-2h2v-6H8zm-5-6h5v-2H3zm0-2h2V9H3zm2-2h2V7H5zm2-2h2V5H7zm2-2h2V3H9zm2-2h2V1h-2zm2 2h2V3h-2zm2 2h2V5h-2zm2 2h2V7h-2zm2 4h2V9h-2zm-3 0h3v-2h-3zm-2 6h2v-6h-2z",
"plus": "M13 11h7v2h-7v7h-2v-7H4v-2h7V4h2v7Z",
"article": "M8 2h12v2H8zM6 4h2v16H6zm14 0h2v16h-2zM4 20h16v2H4zm-2-9h2v9H2zm2-2h2v2H4zm6-3h8v2h-8zm0 4h8v2h-8zm0-2h2v2h-2zm6 0h2v2h-2zm-6 5h8v2h-8zm0 3h4v2h-4z",
"file-text": "M6 4H4v16h2zm10-2H6v2h10zm4 4h-2v14h2zm-2 14H6v2h12zM16 4h2v2h-2zm-4 0h2v6h-2z M12 8h6v2h-6zm-4 8h8v2H8zm0-4h8v2H8zm0-4h2v2H8z",
"fire": "M9 2h2v4H9zM7 6h2v2H7zM5 8h2v2H5zm8 2h2v2h-2zm2-2h2v2h-2zm2 2h2v2h-2zm2 2h2v6h-2zM3 10h2v8H3zm8-4h2v4h-2zm6 12h2v2h-2zM7 20h10v2H7zm-2-2h2v2H5zm4-2h6v4H9z M11 14h2v3h-2z",
"volume-x": "M13 22h-2v-2H9v-2h2V6H9V4h2V2h2v20Zm-4-4H7v-2h2v2Zm-2-8H5v4h2v2H3V8h4v2Zm10.001 5.224h-2v-2H17v-2h-1.999v-2h2v2H19v2h-1.999v2Zm3.999 0h-2v-2h2v2Zm0-4h-2v-2h2v2ZM9 8H7V6h2v2Z",
"map-pin": "M7 2h10v2H7zM5 4h2v2H5zm14 0h-2v2h2zM7 17h2v2H7zm2 2h2v2H9zm6-2h2v2h-2zm-2 2h2v2h-2zm-2 2h2v2h-2zm-6-7h2v3H5zm12 0h2v3h-2zM3 6h2v8H3zm18 0h-2v8h2zM10 6h4v2h-4zM8 8h2v4H8zm2 4h4v2h-4zm4-4h2v4h-2z",
"thumbs-up": "M2 12h2v8H2zm2 8h14v2H4zm14-4h2v4h-2zm2-4h2v4h-2zm-6-2h6v2h-6zm0-2h2v2h-2zm2-4h2v4h-2zm-2-2h2v2h-2zm-2 2h2v2h-2zm-2 2h2v2h-2zM8 8h2v2H8zm-4 2h4v2H4zm2 2h2v8H6z",
"section": "M5 21H3v-2h2v2Zm4 0H7v-2h2v2Zm4 0h-2v-2h2v2Zm4 0h-2v-2h2v2Zm4 0h-2v-2h2v2ZM5 17H3v-2h2v2Zm16 0h-2v-2h2v2ZM5 13H3v-2h2v2Zm16 0h-2v-2h2v2ZM5 9H3V7h2v2Zm16 0h-2V7h2v2ZM5 5H3V3h2v2Zm4 0H7V3h2v2Zm4 0h-2V3h2v2Zm4 0h-2V3h2v2Zm4 0h-2V3h2v2Z",
"backpack": "M5 6h14v2H5zM3 8h2v12H3zm2 12h14v2H5zM19 8h2v12h-2z M7 16h2v6H7zm8 0h2v6h-2zm-6-2h6v2H9zm-2-4h10v2H7zm1-6h2v2H8zm6 0h2v2h-2zm-4-2h4v2h-4z",
"hand": "M21 7h2v5h-2zm-4-2h2v7h-2zm-4-2h2v8h-2zM9 3h2v8H9zM5 5h2v8H5zm14 0h2v2h-2zm-4-2h2v2h-2zm-4-2h2v2h-2zM7 3h2v2H7zm-4 8h2v2H3zm-2 2h2v2H1zm0 2h2v2H1zm2 2h2v2H3zm2 2h2v2H5zm2 2h12v2H7zm12-2h2v2h-2zm2-7h2v7h-2zM5 13h2v2H5zm2 2h2v2H7z",
"menu": "M20 18H4v-2h16v2Zm0-5H4v-2h16v2Zm0-5H4V6h16v2Z",
"thermometer": "M9 2h6v2H9zm0 18h6v2H9zm2-4h2v2h-2zM7 4h2v16H7zm8 0h2v16h-2z M5 16h4v2H5zM5 6h4v2H5zm0 5h4v2H5z",
"spray": "M4 9h6v2H4zm2-2h2v2H6zm-4 4h2v10H2zm2 8h6v2H4zm6-8h2v10h-2zm2-4h2v2h-2zm2-2h2v2h-2zm0 6h2V9h-2zm2-8h2v2h-2zm0 10h2v-2h-2zm2-12h2v2h-2zm0 14h2v-2h-2zm-2-8h2v2h-2zm2-2h2v2h-2zm0 4h2v2h-2z",
"eraser": "M15 18h6v2H7v-2h6v-2h2v2Zm-8 0H5v-2h2v2Zm-2-2H3v-2h2v2Zm12 0h-2v-2h2v2ZM7 14H5v-2h2v2Zm8 0h-2v-2h2v2Zm4 0h-2v-2h2v2ZM9 12H7v-2h2v2Zm4 0h-2v-2h2v2Zm8 0h-2v-2h2v2Zm-10-2H9V8h2v2Zm8 0h-2V8h2v2Zm-6-2h-2V6h2v2Zm4 0h-2V6h2v2Zm-2-2h-2V4h2v2Z",
"album": "M4 2h16v2H4zm0 18h16v2H4zM2 4h2v16H2zm18 0h2v16h-2zm-4 0h2v8h-2zm-4 0h2v8h-2z M14 3h2v7h-2z",
"tool-case": "M2 11h20v2H2zm0 2h2v8H2zm2 8h16v2H4zm16-8h2v8h-2zM9 15h6v2H9zM4 8h2v3H4zm2-2h6v2H6zm6 2h2v3h-2zM8 4h2v2H8zm10 0h2v7h-2zm-8-2h8v2h-8z",
"test-tube": "M7 2h10v2H7zm1 2h2v16H8zm2 16h4v2h-4zm4-16h2v16h-2z M8 13h8v2H8z",
"cake": "M1 20h22v2H1zm2-8h2v8H3zm2-2h14v2H5zm14 2h2v8h-2zm-8-5h2v3h-2zM7 7h2v3H7zm8 0h2v3h-2zM7 3h2v2H7zm4 0h2v2h-2zm4 0h2v2h-2zM5 14h2v2H5zm2 2h4v2H7zm4-2h6v2h-6zm6 2h2v2h-2z",
"reload": "M16 4h2v6h-2zm-2-2h2v2h-2zm0 2h2v8h-2zM4 8H2v5h2z M4 6h16v2H4zm4 14H6v-6h2zm2 2H8v-2h2zm0-2H8v-8h2zm10-4h2v-5h-2z M20 18H4v-2h16z",
"smile": "M6 20h12v2H6zM6 2h12v2H6zm12 2h2v2h-2zM4 4h2v2H4zm0 14h2v2H4zm14 0h2v2h-2zM2 6h2v12H2zm18 0h2v12h-2zM7 13h2v2H7zm2 2h6v2H9zm6-2h2v2h-2zM8 8h2v2H8zm6 0h2v2h-2z",
"image": "M4 2h16v2H4zm0 18h16v2H4zM2 4h2v16H2zm18 0h2v16h-2zm-4 8h2v2h-2zm-2 2h2v2h-2zm4 0h2v2h-2zm-8 0h2v2h-2zm2 2h2v2h-2zm2 2h2v2h-2z M20 16h2v2h-2zM8 16h2v2H8zm-2 2h2v2H6zM8 6h2v2H8zM6 8h2v2H6zm2 2h2v2H8zm2-2h2v2h-2z",
"phone": "M4 1h5v2H4zm5 2h2v4H9zM7 7h2v4H7zm-3 5h2v2H4zM2 3h2v9H2zm7 8h2v2H9zm2 2h2v2h-2zm2 2h4v2h-4zm4-2h4v2h-4zm4 2h2v5h-2zM6 14h2v2H6zm2 2h2v2H8zm2 2h2v2h-2zm2 2h9v2h-9z",
"laugh": "M6 20h12v2H6zM6 2h12v2H6zm12 2h2v2h-2zM4 4h2v2H4zm0 14h2v2H4zm14 0h2v2h-2zM2 6h2v12H2zm18 0h2v12h-2zM7 14h2v2H7zm0-2h10v2H7zm2 4h6v2H9zm6-2h2v2h-2zM8 8h2v2H8zm6 0h2v2h-2z",
"meh": "M6 20h12v2H6zM6 2h12v2H6zm12 2h2v2h-2zM4 4h2v2H4zm0 14h2v2H4zm14 0h2v2h-2zM2 6h2v12H2zm18 0h2v12h-2zM7 14h10v2H7zm1-6h2v2H8zm6 0h2v2h-2z",
"frown": "M6 20h12v2H6zM6 2h12v2H6zm12 2h2v2h-2zM4 4h2v2H4zm0 14h2v2H4zm14 0h2v2h-2zM2 6h2v12H2zm18 0h2v12h-2zM8 8h2v2H8zm6 0h2v2h-2zm-7 7h2v2H7zm2-2h6v2H9zm6 2h2v2h-2z",
"bookmark": "M6 2h12v2H6zM4 4h2v18H4zm14 0h2v18h-2zm-2 16h2v2h-2zm-2-2h2v2h-2zm-8 2h2v2H6zm2-2h2v2H8zm2-2h4v2h-4z",
"angry": "M6 20h12v2H6zM6 2h12v2H6zm12 2h2v2h-2zM4 4h2v2H4zm0 14h2v2H4zm14 0h2v2h-2zM2 6h2v12H2zm18 0h2v12h-2zM7 7h2v2H7zm2 2h2v2H9zm6-2h2v2h-2zm-2 2h2v2h-2zm-6 6h2v2H7zm2-2h6v2H9zm6 2h2v2h-2z",
"road-sign": "M2 10h2v2H2zm0 4h2v-2H2zm20-4h-2v2h2zm0 4h-2v-2h2zM4 8h2v2H4zm0 8h2v-2H4zm16-8h-2v2h2zm0 8h-2v-2h2zM6 6h2v2H6zm0 12h2v-2H6zM18 6h-2v2h2zm0 12h-2v-2h2zM8 4h2v2H8zm0 16h2v-2H8zm8-16h-2v2h2zm0 16h-2v-2h2zM10 2h2v2h-2zm0 20h2v-2h-2zm4-20h-2v2h2zm0 20h-2v-2h2zm2-11h2v2h-2zm-2-2h2v6h-2zm-2-2h2v10h-2zm-4 4h2v4H8z M10 11h3v2h-3z",
"twitter-bird": "M14 21H6V19H14V21ZM6 19H2V17H6V19ZM16 19H14V17H16V19ZM8 17H6V15H8V17ZM18 17H16V14H18V17ZM6 15H4V13H6V15ZM20 14H18V12H20V14ZM4 5H6V7H4V13H2V3H4V5ZM18 8H22V12H20V10H16V5H18V8ZM11 9H6V7H9V5H11V9ZM16 5H11V3H16V5Z"
};

// emoji (without the U+FE0F variation selector) -> [icon name, color class]
const EMOJI = {
"❌": [
"close",
"red"
],
"✅": [
"checkbox-on",
"green"
],
"⚠": [
"warning-diamond",
"amber"
],
"💡": [
"lightbulb",
"gold"
],
"🔑": [
"key",
"gold"
],
"🔧": [
"tools",
""
],
"🛠": [
"tools",
""
],
"🔩": [
"settings-cog",
""
],
"🎮": [
"gamepad",
""
],
"🕹": [
"joystick",
""
],
"💬": [
"message",
""
],
"💭": [
"comment",
""
],
"🔒": [
"lock",
""
],
"🔐": [
"lock",
""
],
"🔓": [
"unlock",
""
],
"🏆": [
"trophy",
"gold"
],
"✓": [
"check",
"green"
],
"☑": [
"checkbox-on",
"green"
],
"☐": [
"checkbox",
""
],
"📧": [
"mail",
""
],
"✉": [
"mail",
""
],
"📨": [
"mail-right",
""
],
"📬": [
"mailbox",
""
],
"📭": [
"inbox",
""
],
"📊": [
"chart-bar-big",
""
],
"📈": [
"trending-up",
"green"
],
"📋": [
"clipboard",
""
],
"👥": [
"users",
""
],
"👤": [
"user",
""
],
"❤": [
"heart",
"red"
],
"♥": [
"heart",
"red"
],
"♡": [
"heart",
""
],
"🤍": [
"heart",
""
],
"⚑": [
"flag",
""
],
"🚩": [
"flag",
"red"
],
"🛒": [
"shopping-cart",
""
],
"🏪": [
"store",
""
],
"📚": [
"library",
""
],
"📖": [
"book-open",
""
],
"⭐": [
"star",
"gold"
],
"🌟": [
"star",
"gold"
],
"✨": [
"sparkles",
"gold"
],
"⚔": [
"sword",
""
],
"🔔": [
"bell",
""
],
"🔕": [
"bell-off",
""
],
"📝": [
"notes",
""
],
"✏": [
"pencil",
""
],
"✎": [
"pencil",
""
],
"✍": [
"feather",
""
],
"🗑": [
"trash",
""
],
"🔍": [
"search",
""
],
"🔗": [
"link",
""
],
"👑": [
"crown",
"gold"
],
"📅": [
"calendar",
""
],
"🗓": [
"calendar-text",
""
],
"🎉": [
"party-popper",
"gold"
],
"📱": [
"smartphone",
""
],
"💻": [
"laptop",
""
],
"🚪": [
"logout",
""
],
"🏅": [
"trophy",
"bronze"
],
"🥇": [
"trophy",
"gold"
],
"🥈": [
"trophy",
"silver"
],
"🥉": [
"trophy",
"bronze"
],
"🛡": [
"shield",
""
],
"⚙": [
"settings-cog",
""
],
"🎓": [
"university",
""
],
"🏛": [
"university",
""
],
"📺": [
"tv",
""
],
"🚫": [
"cancel",
"red"
],
"⛔": [
"cancel",
"red"
],
"🔞": [
"cancel",
"red"
],
"💾": [
"save",
""
],
"🔵": [
"circle",
"blue"
],
"🟢": [
"circle",
"green"
],
"🟡": [
"circle",
"gold"
],
"🔌": [
"plug",
""
],
"⚡": [
"zap",
"gold"
],
"🔢": [
"hash",
""
],
"↩": [
"undo",
""
],
"❓": [
"circle-question",
""
],
"📸": [
"camera",
""
],
"📷": [
"camera",
""
],
"🎯": [
"target",
"red"
],
"✕": [
"close",
""
],
"✗": [
"close",
"red"
],
"✖": [
"close",
""
],
"🗺": [
"map",
""
],
"🏷": [
"label",
""
],
"🎤": [
"mic",
""
],
"🧩": [
"blocks",
""
],
"🎧": [
"headphone",
""
],
"🌐": [
"globe",
""
],
"🌍": [
"earth",
""
],
"🎨": [
"colors-swatch",
""
],
"🏠": [
"home",
""
],
"🌱": [
"leaf",
"green"
],
"📡": [
"signal",
""
],
"💯": [
"percent",
"red"
],
"🧭": [
"compass",
""
],
"💎": [
"diamond-gem",
"cyan"
],
"📦": [
"package",
""
],
"📂": [
"folder",
""
],
"📁": [
"folder",
""
],
"🗂": [
"files",
""
],
"👀": [
"eye",
""
],
"👁": [
"eye",
""
],
"🔝": [
"arrow-big-up",
""
],
"➕": [
"plus",
""
],
"📰": [
"article",
""
],
"📜": [
"article",
""
],
"📄": [
"file-text",
""
],
"🔥": [
"fire",
"orange"
],
"🔇": [
"volume-x",
""
],
"📍": [
"map-pin",
"red"
],
"📌": [
"map-pin",
"red"
],
"👍": [
"thumbs-up",
""
],
"⚖": [
"section",
""
],
"🎒": [
"backpack",
""
],
"👋": [
"hand",
""
],
"🤝": [
"hand",
""
],
"☰": [
"menu",
""
],
"🌡": [
"thermometer",
""
],
"🧴": [
"spray",
""
],
"🧽": [
"eraser",
""
],
"💿": [
"album",
""
],
"🧰": [
"tool-case",
""
],
"🧪": [
"test-tube",
""
],
"🍪": [
"cake",
""
],
"↻": [
"reload",
""
],
"🧠": [
"lightbulb",
"gold"
],
"🦋": [
"smile",
""
],
"🖼": [
"image",
""
],
"📞": [
"phone",
""
],
"😂": [
"laugh",
"gold"
],
"😮": [
"meh",
"gold"
],
"😢": [
"frown",
"blue"
],
"😊": [
"smile",
"gold"
],
"🔖": [
"bookmark",
""
],
"💢": [
"angry",
"red"
],
"😡": [
"angry",
"red"
],
"🚧": [
"road-sign",
"amber"
],
"🐦": [
"twitter-bird",
""
]
};

const COLORS = {
    gold: '#E3A92B', red: '#D9473A', green: '#5BAE4B', amber: '#E8902A', orange: '#E8742A',
    blue: '#4A8FD6', cyan: '#3FB8C4', silver: '#AEB4BC', bronze: '#B8733C',
};

// User-written text keeps its native emoji.
const SKIP_SELECTOR = [
    'script', 'style', 'textarea', 'input', 'select', 'option', 'title', 'code', 'pre', 'kbd', 'svg',
    '[contenteditable]', '[data-px-skip]', '.px-skip',
    '.hub-dm-msg__text', '.hub-thread-card__title', '.hub-thread-card__preview',
    '.hub-comment__body', '.hub-view-header__title', '.hub-thread-original__text',
    '.hub-listing-info__title', '.hub-listing-info__desc', '.hub-detail-title', '.hub-detail-desc',
    '.lsn-comment__content',
].join(',');

const KEYS = Object.keys(EMOJI).sort((a, b) => b.length - a.length);
const EMOJI_RE = new RegExp('(' + KEYS.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')\uFE0F?', 'gu');

function injectStyles() {
    if (document.getElementById('px-emoji-styles')) return;
    const style = document.createElement('style');
    style.id = 'px-emoji-styles';
    style.textContent = `
        .px-emoji {
            display: inline-block; width: 1.2em; height: 1.2em;
            vertical-align: -0.2em; flex-shrink: 0;
            fill: currentColor; shape-rendering: crispEdges;
        }
        @supports (width: round(nearest, 30px, 4px)) {
            .px-emoji { width: max(12px, round(nearest, 1.2em, 4px)); height: max(12px, round(nearest, 1.2em, 4px)); }
        }
        ${Object.entries(COLORS).map(([k, v]) => `.px-emoji--${k} { fill: ${v}; }`).join('\n')}
    `;
    document.head.appendChild(style);
}

function makeIcon(emoji) {
    const [name, color] = EMOJI[emoji];
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('class', 'px-emoji' + (color ? ' px-emoji--' + color : ''));
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', emoji);
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', ICONS[name]);
    svg.appendChild(path);
    return svg;
}

function shouldSkip(textNode) {
    const parent = textNode.parentElement;
    return !parent || !!parent.closest(SKIP_SELECTOR);
}

function replaceInTextNode(node) {
    const text = node.nodeValue;
    EMOJI_RE.lastIndex = 0;
    if (!text || !EMOJI_RE.test(text) || shouldSkip(node)) return;
    EMOJI_RE.lastIndex = 0;
    const frag = document.createDocumentFragment();
    let last = 0;
    for (const m of text.matchAll(EMOJI_RE)) {
        if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
        frag.appendChild(makeIcon(m[1]));
        last = m.index + m[0].length;
    }
    if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
    node.parentNode.replaceChild(frag, node);
}

function scan(root) {
    if (!root) return;
    if (root.nodeType === Node.TEXT_NODE) { replaceInTextNode(root); return; }
    if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(replaceInTextNode);
}

let pending = new Set();
let scheduled = false;
function flush() {
    scheduled = false;
    const batch = pending;
    pending = new Set();
    batch.forEach(n => { if (n.isConnected) scan(n); });
}

export function initPixelEmoji() {
    if (window.__pxEmojiInit) return;
    window.__pxEmojiInit = true;
    injectStyles();
    scan(document.body);
    new MutationObserver(mutations => {
        for (const m of mutations) {
            if (m.type === 'characterData') pending.add(m.target);
            else m.addedNodes.forEach(n => pending.add(n));
        }
        if (!scheduled && pending.size) { scheduled = true; requestAnimationFrame(flush); }
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
}
