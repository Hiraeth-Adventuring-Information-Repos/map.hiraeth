## 2023-10-27 - Map Chooser Screen Reader Metadata
**Learning:** Using a single overriding `aria-label` on complex map cards masks rich internal content (like edit dates, descriptions, and regions) from screen readers.
**Action:** When a UI component contains rich inner metadata, use dynamically generated IDs bound via `aria-labelledby` and `aria-describedby` to safely expose its full context.

## 2023-10-27 - Archive <summary> Focus and Hover States
**Learning:** Native HTML `<summary>` tags often lack visual feedback (focus rings, hover colors) in custom design systems, severely degrading keyboard accessibility and mouse discoverability.
**Action:** Always ensure custom-styled summary elements receive the global `:focus-visible` ring and a subtle hover transition state.

## 2026-04-29 - Map Chooser Image Accessibility
**Learning:** Images inside interactive components like buttons that already provide rich text context via `aria-labelledby` cause redundant and noisy screen reader announcements if they retain their descriptive `alt` text.
**Action:** Set the image `alt` attribute to an empty string (`alt=''`) and add `aria-hidden='true'` to explicitly hide decorative or redundant images from the accessibility tree when the parent component already provides the necessary context.

## 2026-05-01 - Hidden Input Keyboard Accessibility
**Learning:** Custom UI components (like toggles) that use a visually hidden `<input>` element with `opacity: 0` alongside a custom surrogate element (like a `.slider` div) lose default browser focus rings. The invisible input still receives focus via Tab navigation, but no visual indicator is shown to the user.
**Action:** When hiding native inputs for custom styling, always apply a `:focus-visible` ring on the custom surrogate element using the adjacent sibling combinator (e.g., `input:focus-visible + .slider`).

## 2023-10-24 - Make filter group headers keyboard accessible
**Learning:** Adding `tabindex="0"` and `role="button"` makes custom group headers keyboard focusable, but requires an explicit `keydown` listener for 'Enter' and 'Space'. The default 'Space' behavior scrolls the page, requiring `e.preventDefault()`. Custom focus outlines via `:focus-visible` can cause layout shifts if not balanced with equal positive padding and negative margin (e.g., `padding: 2px 4px; margin: -2px -4px;`).
**Action:** When implementing custom toggle elements, always add the `keydown` event listener, suppress default spacebar scrolling, and use the padding/margin trick to safely add focus rings without breaking the layout.

## 2026-05-06 - Programmatic Checkbox Toggling
**Learning:** When programmatically toggling the `checked` property of a native `<input type="checkbox">` in a custom `keydown` event listener (e.g., to handle 'Space' or 'Enter'), the browser does not automatically fire a 'change' event like it does for a physical click. This breaks any downstream logic relying on 'change' listeners.
**Action:** Always explicitly dispatch a new 'change' event (e.g., `element.dispatchEvent(new Event('change'))`) immediately after programmatically mutating the `checked` state to ensure complete functionality parity with native clicks.

## 2026-05-15 - Destructive Actions and Confirmation
**Learning:** Destructive actions without confirmation dialogs can easily lead to accidental data loss and frustration. Users often click quickly and don't realize the consequences of their action until it's too late.
**Action:** Always wrap destructive actions, such as deleting a feature in a map editor, with a confirmation dialog (e.g., `window.confirm`) to explicitly require user consent and prevent accidental data loss. Furthermore, make the prompt contextual by including the feature name to reduce ambiguity.
## 2026-05-18 - Popup 'Read More' Button Accessibility\n**Learning:** Using a `<div>` for a clickable 'Read More' toggle in map popups breaks keyboard accessibility and hides its role from screen readers. Even with an `onclick` handler, a generic `<div>` is not natively focusable or announced correctly.\n**Action:** When implementing expandable content toggles, always use a semantic `<button type="button">`, include the `aria-expanded` attribute, and reset default browser button styles via CSS to preserve the visual design while maintaining accessibility.

## 2026-06-08 - Icon-Only Button Characters Accessibility
**Learning:** Using text characters (like '>', 'v', or '-') as makeshift icons inside buttons without explicit `aria-label` attributes results in screen readers reading the literal characters (e.g., "greater than") to users, causing confusion and poor UX.
**Action:** When implementing icon-only buttons using text characters as symbols, always provide an explicit `aria-label` attribute to describe the action, use `aria-expanded` when acting as a toggle, and set `aria-hidden="true"` on disabled placeholder buttons that have no action.

## 2024-05-24 - Add aria-live to dynamic utility outputs
**Learning:** Screen readers will not announce dynamic text updates in utility output containers unless aria-live="polite" and aria-atomic="true" are added to the target elements.
**Action:** When creating containers for dynamic text updates injected via JavaScript, always add aria-live="polite" and aria-atomic="true".

## 2024-06-19 - Ensure complete dynamic region readouts
**Learning:** Screen readers might miss partial updates to dynamic utility output containers (like search results or map options) if `aria-live="polite"` is used without `aria-atomic="true"`.
**Action:** When creating or modifying dynamic regions that inject complete sets of content (like lists or grids) via JavaScript, always pair `aria-live="polite"` with `aria-atomic="true"` to ensure the screen reader announces the entire updated content instead of just the changed nodes.

## 2026-06-20 - Dynamic Status Announcements
**Learning:** Screen readers may fail to announce text that is dynamically injected via JavaScript into utility output containers (like status messages or export outcomes) unless explicitly instructed.
**Action:** When implementing containers for dynamic status updates, always add `aria-live="polite"` and `aria-atomic="true"` to ensure the content changes are announced to assistive technologies without interrupting the user's current flow.

## 2026-06-30 - Summary Element Accessibility & Destructive Action Confirmation
**Learning:** Custom-styled `<summary>` elements often lose native focus rings and hover states, harming keyboard accessibility and discoverability. Furthermore, removing detail sections without confirmation risks accidental data loss.
**Action:** Always ensure custom `<summary>` elements have explicit `:focus-visible` and `:hover` states in CSS. Always wrap destructive actions (like removing detail sections) in a `window.confirm()` dialog with clear, contextual labeling to prevent user error.
