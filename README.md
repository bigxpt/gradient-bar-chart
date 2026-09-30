# BIGXPT: Gradient Progress Chart

**Version 1.0.0**  
A free Tableau Viz Extension by **BIGXPT** for building customizable progress and target charts with gradient fills, stripe styling, rich labels, tooltips, animation, and responsive fit controls.

## Features

- Configurable gradient progress bars and striped remainder styling
- Value, Target, Category, and Label encodings
- Fixed maximum/target fallback (default: 100)
- Custom label and tooltip templates using `<Field>` placeholders
- Rich text formatting for labels and tooltips
- Inside/outside label placement and alignment controls
- Configurable stripe colour, width, and gap
- Animated value changes
- Fit Width, Fit Height, Standard, and Entire View modes
- Transparent worksheet background option
- Remembers the last active Format Extension tab

## Requirements

- Tableau version that supports Viz Extensions and the Extensions API level declared in `GradientProgressBar.trex`
- Internet access to the hosted extension URL

## Hosted Extension

Production URL:

`https://bigxpt.github.io/gradient-bar-chart/index.html`

## Installation

1. In Tableau, add a Viz Extension to the worksheet.
2. Select the BIGXPT Gradient Progress Chart listing from Tableau Exchange when published, or load the `GradientProgressBar.trex` manifest during testing.
3. Add fields to the Value, Target, Category, and Label encodings as needed.
4. Open **Format Extension** to configure colours, stripes, labels, tooltips, and layout.

## Data Access and Privacy

The extension uses Tableau-provided visible/summary data required to render the visualization. It does not independently transmit workbook data to BIGXPT-operated servers, and it contains no advertising, analytics, or user-tracking code. Local browser storage is used only for limited UI preferences such as the last active settings tab and remembered dialog geometry.

Privacy Policy: `https://bigxpt.github.io/gradient-bar-chart/privacy.html`  
Terms of Service: `https://bigxpt.github.io/gradient-bar-chart/terms.html`  
Support: `https://bigxpt.github.io/gradient-bar-chart/support.html`

## Support

Email: **bigxpt@gmail.com**  
Website: **https://www.bigxpt.com**  
Repository: **https://github.com/bigxpt/gradient-bar-chart**

## Licence

Copyright © 2026 BIGXPT. All rights reserved.

See `LICENSE.txt` for the applicable terms.

## Release

### 1.0.0

First public Tableau Exchange release of BIGXPT: Gradient Progress Chart.
