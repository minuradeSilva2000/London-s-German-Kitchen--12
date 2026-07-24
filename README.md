# London's German Kitchen Specialists - Bug Image Detection

Cypress-based automation testing project to detect broken image URLs on the [London's German Kitchen Specialists](https://pgkltd.co.uk) website and generate image validation reports.

## Overview

This project uses Cypress to crawl multiple dashboard sections of the PGK website, extract all image URLs, and generate structured JSON reports. It covers the following website sections:

- **Kitchens** - Portfolio grid pages via AJAX `pgkf_filter` endpoint
- **Projects** - Portfolio grid pages via AJAX `pgkf_filter` endpoint
- **Inspirations** - Portfolio grid pages via AJAX `pgkf_filter` endpoint
- **Showrooms** - Static sub-pages (Amersham, Bounds Green, Wimbledon, Maida Vale)
- **Why PGK** - Static page at `/pgk-approach/`
- **Finance Options** - Static page at `/finance/`

The project also includes grayscale/line-art image style detection using pixel-level analysis via the `sharp` library.

## Tech Stack

- **Cypress** `^15.18.1` - E2E testing and browser automation
- **Axios** `^1.7.0` - Server-side HTTP requests for page fetching and AJAX calls
- **Sharp** `^0.33.5` - Image processing and pixel-level grayscale detection
- **Node.js** - Task runner environment (Cypress Node tasks)

## Project Structure

```
.
├── cypress.config.js                          # Main Cypress configuration with all Node tasks
├── package.json                               # Dependencies and project metadata
├── README.md                                  # Project documentation
├── cypress/
│   ├── e2e/                                   # Test specs
│   │   ├── kitchens.cy.js                     # Grayscale image scan for kitchen portfolio pages
│   │   ├── kitchens-dashboard-images.cy.js    # Image URL collector for kitchens dashboard
│   │   ├── project.cy.js                      # Grayscale image scan for project portfolio pages
│   │   ├── project-dashboard-images.cy.js     # Image URL collector for projects dashboard
│   │   ├── inspiration-dashboard-images.cy.js # Image URL collector for inspirations dashboard
│   │   ├── showrooms-all-images.cy.js         # Full showroom image collector (browser + server tasks)
│   │   ├── why-pgk-dashboard-images.cy.js     # Image URL collector for Why PGK page
│   │   └── finance-dashboard-images.cy.js     # Image URL collector for Finance Options page
│   ├── reports/                               # Generated JSON reports (output)
│   │   ├── kitchens-dashboard-images-report.json
│   │   ├── project-dashboard-images-report.json
│   │   ├── project-gray-image-report.json
│   │   ├── gray-image-report.json
│   │   ├── inspiration-dashboard-images-report.json
│   │   ├── showroom-section-images-report.json
│   │   ├── why-pgk-dashboard-images-report.json
│   │   └── finance-dashboard-images-report.json
│   ├── fixtures/
│   │   └── example.json                       # Default Cypress fixture
│   └── support/
│       ├── commands.js                        # Custom Cypress commands
│       └── e2e.js                             # Support file loaded before each spec
└── node_modules/                              # Installed dependencies
```

## Test Specs

### Image URL Collectors

| Spec | Source | Method | Description |
|------|--------|--------|-------------|
| `kitchens-dashboard-images.cy.js` | `/kitchens/` | AJAX `pgkf_filter` | Fetches all kitchen portfolio links via AJAX nonce, then scrapes each page for image URLs matching the PGK upload path pattern |
| `project-dashboard-images.cy.js` | `/projects/` | AJAX `pgkf_filter` | Fetches all project portfolio links via AJAX nonce, then scrapes each page for all image URLs |
| `inspiration-dashboard-images.cy.js` | `/inspirations/` | AJAX `pgkf_filter` | Fetches all inspiration portfolio links via AJAX nonce, then scrapes each page for all image URLs |
| `showrooms-all-images.cy.js` | `/showrooms/*` | Browser + Axios | Visits each showroom sub-page in the browser to detect nested `.pgkf` portfolio cards, then fetches all images via server-side HTTP requests |
| `why-pgk-dashboard-images.cy.js` | `/pgk-approach/` | Axios | Single-page fetch extracting all raster image URLs from the Why PGK page |
| `finance-dashboard-images.cy.js` | `/finance/` | Axios | Single-page fetch extracting all raster image URLs from the Finance Options page |

### Grayscale Image Detectors

| Spec | Source | Method | Description |
|------|--------|--------|-------------|
| `kitchens.cy.js` | `/kitchens/` | AJAX + Sharp | Scans kitchen portfolio images for grayscale/line-art styles using pixel analysis (gray %, color dominance, luminance) |
| `project.cy.js` | `/projects/` | AJAX + Sharp | Scans project portfolio images for grayscale/line-art styles using pixel analysis |

## How It Works

### AJAX-Based Pages (Kitchens, Projects, Inspirations)

1. Fetches the main dashboard page via HTTP
2. Extracts the `pgkf_filter` nonce from inline `<script>` tags
3. POSTs to `/wp-admin/admin-ajax.php` with `action=pgkf_filter` and the nonce to retrieve all portfolio card HTML
4. Parses `pgkf-link` hrefs from both initial HTML and AJAX response
5. Visits each portfolio page to extract image URLs from `src`, `data-orig-src`, `data-bg`, `srcset`, and inline `background-image` styles
6. Generates a JSON report with all collected image URLs

### Static Pages (Showrooms, Why PGK, Finance)

1. Fetches the page via HTTP (single request)
2. Extracts image URLs from HTML using regex patterns for `img src`, `data-orig-src`, `data-bg`, `data-srcset`, `srcset`, `background-image: url()`, OG meta tags, and WP uploads references
3. Filters to raster images only (`.jpg`, `.jpeg`, `.png`, `.webp`), excluding SVGs, logos, gravatars, and data URIs
4. Generates a JSON report with collected image URLs

### Showroom Sub-Pages

The `showrooms-all-images.cy.js` spec uses a hybrid approach:
1. Visits each showroom sub-page in the browser to check for `.pgkf` nested portfolio card grids
2. Collects any nested card URLs found (currently 0 across all showrooms)
3. Passes both showroom URLs and nested card URLs to the `collectShowroomSectionImages` Node task
4. The task fetches each page server-side and extracts all image URLs with showroom attribution

### Grayscale Detection

The `analyzeImageStyle` function:
1. Downloads the image via HTTP and processes it with Sharp
2. Resizes to 200x200 and extracts raw pixel data
3. Classifies each pixel as gray (R/G/B within 10 of each other) or colored
4. Checks color channel dominance and luminance (near-black/near-white)
5. Returns match info for images with >85% gray pixels (grayscale-render or line-art-sketch)

## Reports

All reports are saved as JSON files in `cypress/reports/`. Each report includes:

```json
{
  "totalImages": 25,
  "uniqueImageUrls": 13,
  "totalPagesScanned": 4,
  "collectedAt": "2026-07-23T18:02:49.119Z",
  "showrooms": [],
  "images": [
    {
      "url": "https://media.pgkltd.co.uk/...",
      "page": "https://pgkltd.co.uk/showrooms/amersham/",
      "showroom": "Amersham",
      "source": "showroom-page"
    }
  ]
}
```

## Getting Started

### Prerequisites

- Node.js (v16+)
- npm

### Installation

```bash
npm install
```

### Running Tests

```bash
# Open Cypress Test Runner (interactive)
npx cypress open

# Run all specs headlessly
npx cypress run

# Run a specific spec
npx cypress run --spec "cypress/e2e/finance-dashboard-images.cy.js"

# Run with browser selection
npx cypress run --browser chrome
```

## Configuration

Key settings in `cypress.config.js`:

| Setting | Value | Purpose |
|---------|-------|---------|
| `baseUrl` | `https://pgkltd.co.uk` | Target website |
| `defaultCommandTimeout` | `15000` | Default Cypress command timeout |
| `responseTimeout` | `60000` | HTTP response timeout |
| `pageLoadTimeout` | `120000` | Page load timeout |
| AJAX concurrency | `2` parallel requests | Rate limiting for page scraping |
| Batch delay | `1500ms` between batches | Rate limiting between batches |

## Notes

- The `pgkf_filter` AJAX nonce is session-bound and cannot be reused across separate sessions
- Showroom sub-pages do **not** contain `.pgkf` portfolio card grids (the CSS/JS is included but no HTML element is rendered)
- The "Why PGK" nav link points to `/pgk-approach/` (not `/why-pgk/` which returns 404)
- The Finance Options page is at `/finance/` (static content, no AJAX grid)
- All image extraction filters out SVGs, logos, gravatars, data URIs, and analytics/tracking pixels
