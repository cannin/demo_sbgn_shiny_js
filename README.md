# Reactome SBGN Cytoscape Shiny Demo

This repository is a self-contained R Shiny app that displays Reactome SBGN
pathway diagrams in the browser with Cytoscape.js.

It is designed as a small teaching example for students learning how Shiny can
coordinate R server logic with browser-side JavaScript.

## Shiny App Elements

The app has two tabs:

1. `Dropdown Test`
   - Uses Shiny dropdown inputs to choose a pathway.
   - Sends the selected pathway to JavaScript.
   - Renders the selected SBGN graph with Cytoscape.js.

2. `Table Test`
   - Shows all highlighted pathway examples in a paginated table.
   - Displays 10 rows per page.
   - Uses linked pathway names instead of a dropdown.
   - Clicking a pathway name renders that pathway below the table.

Both tabs use the same basic idea: R decides which pathway should be shown, and
JavaScript renders the graph.

## Purpose

This app demonstrates several common Shiny programming ideas:

- `ui` defines what the user sees.
- `server` defines how the app reacts to input.
- `reactive()` and `reactiveVal()` store values that change over time.
- `observe()` and `observeEvent()` run code when inputs change.
- `renderUI()` updates text in the page.
- `renderDT()` creates an interactive data table.
- `session$sendCustomMessage()` sends data from R to JavaScript.
- `Shiny.setInputValue()` sends data from JavaScript back to R.

The Cytoscape graph is not drawn by R. R prepares the pathway metadata and tells
the browser what to load. The browser then parses and draws the SBGN XML.

## Repository Layout

```text
.
├── app.R
├── data/
│   ├── ReactomePathways.txt
│   ├── highlighted_examples.json
│   └── reactome_homo_sapiens.sbgn_20260612/
├── www/
│   ├── sbgn-cytoscape-shiny.js
│   ├── styles.css
│   └── vendor/
└── playwright_test.js
```

Important files:

- `app.R`: the Shiny app UI and server logic.
- `data/highlighted_examples.json`: the examples used by the table and
  highlighted rendering mode.
- `data/reactome_homo_sapiens.sbgn_20260612/`: local SBGN pathway XML files.
- `www/sbgn-cytoscape-shiny.js`: JavaScript that creates Cytoscape graphs and
  communicates with Shiny.
- `www/vendor/`: local browser JavaScript dependencies used by the app.
- `playwright_test.js`: optional browser test script.

## Install Requirements

You need R with these packages:

```r
install.packages(c("shiny", "DT", "jsonlite"))
```

The app does not need a separate `npm install` step to run. Cytoscape.js and the
SBGN parser are vendored in `www/vendor/`.

## Run The App

From this repository directory:

```sh
Rscript -e "shiny::runApp('.', host = '127.0.0.1', port = 3877)"
```

Then open:

```text
http://127.0.0.1:3877
```

## How The Dropdown Tab Works

In `Dropdown Test`, Shiny owns the dropdown state:

1. The user selects a type: `static` or `highlighted`.
2. Shiny updates the pathway dropdown.
3. Shiny builds a payload with:
   - Reactome ID
   - pathway name
   - SBGN file URL
   - optional highlighted genes and colors
4. Shiny sends that payload to JavaScript with `session$sendCustomMessage()`.
5. JavaScript fetches the SBGN file and renders it in Cytoscape.
6. JavaScript sends node and edge counts back to Shiny.

## How The Table Tab Works

In `Table Test`, the table replaces the dropdown:

1. Shiny renders `highlighted_examples.json` as a data table.
2. Each pathway name is an HTML link.
3. Clicking a link calls `Shiny.setInputValue()` in JavaScript.
4. Shiny stores the clicked Reactome ID in a `reactiveVal()`.
5. Shiny sends the selected pathway payload to a second Cytoscape renderer.
6. The selected graph appears below the table.

Row selection is disabled. The pathway links are the intended interaction.

## Optional Playwright Test

The Playwright test checks both tabs:

- the dropdown highlighted graph renders;
- highlighted colors appear in the Cytoscape canvas;
- the table has 10 rows per page;
- clicking a table pathway link renders the graph below the table.

The test requires Node.js with Playwright installed. If Playwright is available,
run:

```sh
node playwright_test.js
```

If your app is running on a different URL, set `APP_URL`:

```sh
APP_URL=http://127.0.0.1:3877 node playwright_test.js
```

The test writes screenshot files named `playwright_*.png`. Those files are
ignored by git.

## Notes For Students

This app is larger than a minimal Shiny example because it includes real pathway
data and a JavaScript renderer. When reading the code, start with `app.R`:

1. Read the configuration section at the top.
2. Read the helper functions.
3. Read the UI section.
4. Read the server section.
5. Then read `www/sbgn-cytoscape-shiny.js`.

The main lesson is that Shiny can be the controller for an app even when the
visualization itself is handled by a browser library.
