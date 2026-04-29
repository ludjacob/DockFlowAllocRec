
# DockFlow Allocation Recommender

A Tampermonkey userscript that recommends sorter lane allocation changes on DockFlow OBA pages. It compares current arc assignments against projected volume across multiple time intervals and displays actionable increase/decrease badges directly in the UI.

## Features

- Allocation delta badges on arc detail pages showing whether to increase, decrease, or hold current allocations
- Per-interval needed allocations row spanning 15 MIN through 24 HR
- Inline delta badges on the arcs list page for every arc via GraphQL API
- Configurable containerize rates for Case and Tote arcs through a settings modal
- Persistent settings stored in localStorage
- SPA navigation detection — works across page transitions without reload
- Excludes PID workcells from allocation counts
- Concurrent API fetching with max 3 parallel requests on list pages

## Installation

### Prerequisites

- [Tampermonkey](https://www.tampermonkey.net/) browser extension installed in Chrome, Firefox, or Edge

### Install from GitHub

1. Open Tampermonkey in your browser and go to the **Utilities** tab
2. Under **Install from URL**, paste the raw script URL:

