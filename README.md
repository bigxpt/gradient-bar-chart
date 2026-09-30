# BIGXPT: Gradient Progress Chart v10.1

Changes in v7:

- Fixed maximum / target now defaults to **100**.
- Label text example now uses **`<Field>`**.
- Label text has an **Apply** button; clicking it updates the label without closing Format Extension. Other formatting controls remain live.
- Added a dedicated **Tooltip** tab. Tooltip text supports `<Field>` tokens and formatting for font, size, text colour, background, border, bold and italic.
- The extension renders its own tooltip instead of relying on Tableau's native tooltip display. Fields placed on Tableau's Tooltip shelf are used as values/tokens.
- Format Extension opens narrower, with controls stacked vertically and tabs kept horizontally aligned.
- Existing v6 stripe defaults remain: black stripes, 2 px stripe width, 7 px stripe gap.

## Start

1. Double-click `start-server.bat`.
2. Keep the command window open.
3. Remove the previous extension from Tableau.
4. Add `GradientProgressBar.trex` from this folder.
5. Use Format Extension to configure the chart.


## v8 changes
- Added an **Apply** button for Tooltip text; text edits are draft-only until Apply is clicked.
- Label and Tooltip **Insert field** sections now list every unique field used anywhere on the active Marks card, regardless of encoding. Duplicate uses of the same underlying field are removed.
- Fields placed specifically on Label or Tooltip still prefill the corresponding text draft when that draft is empty.
- Label and Tooltip templates can reference any field shown in Insert field.
- Tableau owns the Marks-card tile click behavior. The Extensions API exposes **Format Extension** as the supported configuration entry point, so clicking Tableau's Label/Tooltip tiles cannot be redirected by the extension to a specific settings tab.


## Version 10 changes
- Added meaningful Tableau encoding icons to the custom Value, Target, Category and Label tiles.
- Label uses Tableau's `text` encoding icon.
- Tableau's built-in Tooltip tile remains the tooltip field drop zone and already uses Tableau's native tooltip icon; Viz Extensions always include the built-in Tooltip and Detail tiles.
- Format Extension now remembers the last active tab and reopens to that tab the next time it is opened.


## v10 updates
- Remembers the Format Extension window size and, where the Tableau host permits it, its screen position.
- Label and Tooltip editors now support independent bold, italic and underline formatting for selected text.
- Ctrl+Tab inserts a four-space tab when the host passes the shortcut through; the **Tab ⇥** toolbar button provides a reliable fallback.
- Includes `GradientProgressBar.trex` for the GitHub Pages deployment and `GradientProgressBar.local.trex` for localhost development.
