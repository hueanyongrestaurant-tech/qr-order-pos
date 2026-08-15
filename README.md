# 🍜 QR Order POS

A QR-code table ordering and point-of-sale system built for a Northern Thai restaurant. Customers scan a QR code at their table to browse the menu and order directly from their phone, no app, no login. Staff manage incoming orders, payments, the menu, and sales stats from a single dashboard.

Built as a real-world production system for a working restaurant, deployed and in active use.

## Features

**Customer side**
- Scan-to-order via table-specific QR codes (`?table=1-3` — floor-table format)
- Browse menu by category, bilingual (Thai / English)
- Per-item options: meat choice, spice level, portion size, custom option groups — each with independent pricing
- Free-text special requests per item
- Cart review before confirming
- "Busy" banner shown automatically when the kitchen has a high order volume

**Staff side (authenticated)**
- Real-time order queue, grouped by status (in progress / awaiting payment)
- Edit or cancel individual line items mid-order
- Walk-in takeaway orders with daily-reset queue numbers (T-1, T-2, ...)
- Payment with cash or transfer, automatic change calculation for cash
- Full menu management: add/edit/delete items, toggle categories, upload photos, configure option groups and pricing per item
- Category and item-level "Signature" tagging
- Order history and sales stats (revenue by cash/transfer, top-selling items, custom date range)

## Tech Stack

- **Frontend**: React + TypeScript, Vite, Tailwind CSS
- **Backend**: Firebase (Firestore for data, Firebase Authentication for staff login)
- **Hosting**: GitHub Pages
- **Images**: Stored as compressed Base64 directly in Firestore (no paid storage tier required)

Runs entirely on free-tier infrastructure — no credit card required for either Firebase or GitHub Pages.

## Local Development

```bash
npm install
npm run dev
```

Requires a Firebase project with Firestore and Authentication (Email/Password) enabled. Add your config to `src/lib/firebase.ts`.

## Deployment

```bash
npm run deploy
```

Builds the app and publishes it to the `gh-pages` branch via the `gh-pages` package.

## License

Private project — built for a specific restaurant's internal use.